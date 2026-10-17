const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'database.json');

// Initialize database file if not exists
if (!fs.existsSync(DB_FILE)) {
  const initialData = {
    users: {},
    withdrawals: [],
    deposits: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { users: {}, withdrawals: [], deposits: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Generate deterministic 42-char BSC BEP-20 address
function generateBscAddress(userId) {
  const hash = crypto.createHash('sha256').update(String(userId) + '_turbo_bsc_salt').digest('hex');
  return '0x' + hash.slice(0, 40);
}

const mimeTypes = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const NOWPAYMENTS = {
  apiKey: 'MQG8HTE-JCFMPDQ-HJWHJZQ-498VAM5',
  publicKey: '6e4d94cc-3799-430e-80c2-7569eeb326d4',
  baseUrl: 'https://api.nowpayments.io/v1',
  payCurrency: 'usdtbsc', // Strictly BEP-20 USDT on Binance Smart Chain
  ipnUrl: 'https://turbo-tap-game.onrender.com/api/nowpayments/ipn'
};

const server = http.createServer((req, res) => {
  // CORS Headers for Telegram Webview
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const [reqPath, queryString] = req.url.split('?');

  // Lightweight Ping / Health Check for Keep-Alive Monitors (prevents Render sleep)
  if (reqPath === '/health' || reqPath === '/ping' || reqPath === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
  }

  // ================= API ROUTES =================
  if (reqPath.startsWith('/api/')) {

    // 1. Check / Get User Profile: GET /api/user?telegramId=123
    if (req.method === 'GET' && reqPath === '/api/user') {
      const urlParams = new URLSearchParams(queryString);
      const telegramId = urlParams.get('telegramId');

      if (!telegramId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'telegramId is required' }));
      }

      const db = readDB();
      const user = db.users[telegramId];

      if (user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ exists: true, user }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ exists: false }));
      }
    }

    // 2. NOWPAYMENTS: GET /api/nowpayments/deposit-address?telegramId=123
    if (req.method === 'GET' && reqPath === '/api/nowpayments/deposit-address') {
      const urlParams = new URLSearchParams(queryString);
      const telegramId = urlParams.get('telegramId');

      if (!telegramId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'telegramId is required' }));
      }

      const db = readDB();
      let user = db.users[telegramId];
      if (!user) {
        user = {
          telegramId: String(telegramId),
          username: 'Gamer_' + String(telegramId).slice(-4),
          wallet: 0,
          profitWallet: 0,
          withdrawWallet: 0,
          refWallet: 0,
          friendsCount: 0,
          totalRefEarned: 0,
          createdAt: new Date().toISOString()
        };
        db.users[telegramId] = user;
      }

      // If user already has an active NOWPayments address valid for at least another 2 hours AND not already credited, reuse it!
      const now = Date.now();
      db.creditedDeposits = db.creditedDeposits || {};
      if (
        user.nowpaymentsDeposit &&
        user.nowpaymentsDeposit.pay_address &&
        !db.creditedDeposits[String(user.nowpaymentsDeposit.payment_id)] &&
        new Date(user.nowpaymentsDeposit.valid_until).getTime() > now + 7200000
      ) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          pay_address: user.nowpaymentsDeposit.pay_address,
          payment_id: user.nowpaymentsDeposit.payment_id,
          currency: 'USDT',
          network: 'BSC (BEP-20)',
          min_amount: 1,
          valid_until: user.nowpaymentsDeposit.valid_until
        }));
      }


      // Generate real BEP-20 address via NOWPayments API
      fetch(`${NOWPAYMENTS.baseUrl}/payment`, {
        method: 'POST',
        headers: {
          'x-api-key': NOWPAYMENTS.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          price_amount: 1, // Standard minimum placeholder
          price_currency: 'usd',
          pay_currency: NOWPAYMENTS.payCurrency, // 'usdtbsc' strictly BEP-20
          ipn_callback_url: NOWPAYMENTS.ipnUrl,
          order_id: `dep_${telegramId}_${Date.now()}`,
          order_description: `Turbo Tap BEP-20 Deposit user ${telegramId}`
        })
      })
      .then(r => r.json())
      .then(payment => {
        if (!payment || !payment.pay_address) {
          console.error('[NOWPayments] Create payment failed:', payment);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Could not generate NOWPayments address', details: payment }));
        }

        user.nowpaymentsDeposit = {
          payment_id: String(payment.payment_id),
          pay_address: payment.pay_address,
          valid_until: payment.valid_until || new Date(Date.now() + 7 * 86400000).toISOString(),
          created_at: new Date().toISOString()
        };
        user.bscAddress = payment.pay_address;
        writeDB(db);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          pay_address: payment.pay_address,
          payment_id: payment.payment_id,
          currency: 'USDT',
          network: 'BSC (BEP-20)',
          min_amount: 1,
          valid_until: user.nowpaymentsDeposit.valid_until
        }));
      })
      .catch(err => {
        console.error('[NOWPayments] Fetch error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'NOWPayments connection error', message: err.message }));
      });
      return;
    }

    // 3. NOWPAYMENTS: Check Deposit Status GET /api/nowpayments/check?telegramId=123&paymentId=456
    if (req.method === 'GET' && reqPath === '/api/nowpayments/check') {
      const urlParams = new URLSearchParams(queryString);
      const telegramId = urlParams.get('telegramId');
      let paymentId = urlParams.get('paymentId');

      const db = readDB();
      const user = db.users[telegramId];
      if (!paymentId && user?.nowpaymentsDeposit?.payment_id) {
        paymentId = user.nowpaymentsDeposit.payment_id;
      }

      if (!paymentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'paymentId is required' }));
      }

      fetch(`${NOWPAYMENTS.baseUrl}/payment/${paymentId}`, {
        headers: { 'x-api-key': NOWPAYMENTS.apiKey }
      })
      .then(r => r.json())
      .then(data => {
        db.creditedDeposits = db.creditedDeposits || {};
        const isPaid = ['finished', 'confirmed', 'partially_paid'].includes(data.payment_status);
        const paidAmount = parseFloat(data.actually_paid || data.outcome_amount || 0);

        if (isPaid && paidAmount > 0 && user) {
          if (!db.creditedDeposits[String(paymentId)]) {
            db.creditedDeposits[String(paymentId)] = {
              amount: paidAmount,
              telegramId,
              date: new Date().toISOString()
            };
            // Credit directly to Game Wallet!
            user.wallet = (user.wallet || 0) + paidAmount;
            db.deposits.push({
              id: 'dep_' + paymentId,
              telegramId,
              amount: paidAmount,
              network: 'BSC-BEP20',
              txHash: data.payin_hash || null,
              timestamp: new Date().toISOString()
            });
            writeDB(db);
            console.log(`[NOWPayments Check] Successfully credited $${paidAmount} to user ${telegramId}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: data.payment_status,
            credited: true,
            amount: paidAmount,
            wallet: user.wallet,
            message: `Deposit of $${paidAmount.toFixed(2)} USDT credited to Game Wallet!`
          }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: data.payment_status || 'waiting',
          credited: false,
          actually_paid: paidAmount
        }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // Helper for POST body parsing
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try {
        if (body) data = JSON.parse(body);
      } catch (err) {}

      // 1. NOWPAYMENTS IPN WEBHOOK: POST /api/nowpayments/ipn
      if (req.method === 'POST' && reqPath === '/api/nowpayments/ipn') {
        console.log('[NOWPayments IPN] Callback received:', JSON.stringify(data));
        const paymentId = data.payment_id;
        const status = data.payment_status;
        const actuallyPaid = parseFloat(data.actually_paid || data.outcome_amount || (status === 'finished' || status === 'confirmed' ? data.pay_amount : 0) || 0);
        const orderId = data.order_id || '';
        const payAddress = data.pay_address;

        const db = readDB();
        db.creditedDeposits = db.creditedDeposits || {};

        let targetUser = null;
        if (orderId && orderId.startsWith('dep_')) {
          const parts = orderId.split('_');
          const tId = parts[1];
          if (db.users[tId]) targetUser = db.users[tId];
        }

        if (!targetUser) {
          for (const uid in db.users) {
            const u = db.users[uid];
            if (
              (u.nowpaymentsDeposit && String(u.nowpaymentsDeposit.payment_id) === String(paymentId)) ||
              u.bscAddress === payAddress ||
              (u.nowpaymentsDeposit && u.nowpaymentsDeposit.pay_address === payAddress)
            ) {
              targetUser = u;
              break;
            }
          }
        }

        const isPaid = ['finished', 'confirmed', 'partially_paid', 'sending'].includes(status);
        if (isPaid && actuallyPaid > 0 && targetUser) {
          if (!db.creditedDeposits[String(paymentId)]) {
            db.creditedDeposits[String(paymentId)] = {
              amount: actuallyPaid,
              telegramId: targetUser.telegramId,
              date: new Date().toISOString()
            };
            targetUser.wallet = (targetUser.wallet || 0) + actuallyPaid;
            db.deposits.push({
              id: 'dep_' + paymentId,
              telegramId: targetUser.telegramId,
              amount: actuallyPaid,
              network: 'BSC-BEP20',
              txHash: data.payin_hash || null,
              timestamp: new Date().toISOString()
            });
            writeDB(db);
            console.log(`[NOWPayments IPN] Auto-credited $${actuallyPaid} USDT to Game Wallet of user ${targetUser.telegramId}`);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }

      // 2. 1st Time Sign Up: POST /api/register
      if (req.method === 'POST' && reqPath === '/api/register') {
        const { telegramId, username, email, referrerId } = data;

        if (!telegramId || !username || !email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'telegramId, username, and email are required' }));
        }

        const db = readDB();
        
        // Check if user already exists
        if (db.users[telegramId]) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: db.users[telegramId], message: 'User already exists' }));
        }

        const bscAddress = generateBscAddress(telegramId);
        const newUser = {
          telegramId: String(telegramId),
          username: username.trim(),
          email: email.trim().toLowerCase(),
          bscAddress: bscAddress,
          wallet: 0.00, // Game Wallet (Starts at $0, gets funds from deposit)
          profitWallet: 0.00, // Profit Wallet (Game winnings / Battle rewards)
          withdrawWallet: 0.00, // Withdrawal Wallet
          refWallet: 0.00, // Referral Bonus Wallet
          friendsCount: 0,
          totalRefEarned: 0.00,
          referredBy: referrerId ? String(referrerId) : null,
          createdAt: new Date().toISOString()
        };

        db.users[telegramId] = newUser;

        // If joined via a valid Referrer: Award +$25 to the Referrer!
        if (referrerId && db.users[referrerId]) {
          db.users[referrerId].refWallet = (db.users[referrerId].refWallet || 0) + 25.00;
          db.users[referrerId].totalRefEarned = (db.users[referrerId].totalRefEarned || 0) + 25.00;
          db.users[referrerId].friendsCount = (db.users[referrerId].friendsCount || 0) + 1;
        }

        writeDB(db);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, user: newUser }));
      }

      // 3. Update Balance / Win / Deposit: POST /api/wallet/update
      if (req.method === 'POST' && reqPath === '/api/wallet/update') {
        const { telegramId, amount, type } = data;
        const db = readDB();

        if (!db.users[telegramId]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const delta = parseFloat(amount);
        if (type === 'ref') {
          db.users[telegramId].refWallet = Math.max(0, (db.users[telegramId].refWallet || 0) + delta);
        } else if (type === 'profit') {
          db.users[telegramId].profitWallet = Math.max(0, (db.users[telegramId].profitWallet || 0) + delta);
        } else if (type === 'withdraw') {
          db.users[telegramId].withdrawWallet = Math.max(0, (db.users[telegramId].withdrawWallet || 0) + delta);
        } else {
          // Default: Game Wallet (deposits or entry fees)
          db.users[telegramId].wallet = Math.max(0, (db.users[telegramId].wallet || 0) + delta);
        }

        writeDB(db);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, user: db.users[telegramId] }));
      }

      // 4. Request Withdrawal: POST /api/withdraw
      if (req.method === 'POST' && reqPath === '/api/withdraw') {
        const { telegramId, address, amount, source } = data;
        const db = readDB();
        const user = db.users[telegramId];

        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const amt = parseFloat(amount);
        let avail = 0;
        if (source === 'referral') {
          avail = user.refWallet || 0;
        } else if (source === 'profit') {
          avail = user.profitWallet || 0;
        } else if (source === 'withdraw') {
          avail = user.withdrawWallet || 0;
        } else {
          avail = user.wallet || 0;
        }

        if (amt > avail || amt < 5) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid withdrawal amount' }));
        }

        // Deduct balance from chosen source
        if (source === 'referral') {
          user.refWallet -= amt;
        } else if (source === 'profit') {
          user.profitWallet -= amt;
        } else if (source === 'withdraw') {
          user.withdrawWallet -= amt;
        } else {
          user.wallet -= amt;
        }

        const withdrawRecord = {
          id: 'wd_' + Date.now(),
          telegramId,
          username: user.username,
          address,
          network: 'BSC-BEP20',
          amount: amt,
          source,
          status: 'PENDING_PAYOUT',
          timestamp: new Date().toISOString()
        };

        db.withdrawals.push(withdrawRecord);
        writeDB(db);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, withdrawal: withdrawRecord, user }));
      }

      // Fallback API 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API Endpoint not found' }));
    });
    return;
  }

  // ================= STATIC FILE SERVING =================
  let filePath = path.join(__dirname, reqPath === '/' ? 'index.html' : reqPath);
  let ext = path.extname(filePath).toLowerCase();
  let contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      let cacheControl = 'no-cache';
      if (['.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp'].includes(ext)) {
        // High-speed caching for images - loads instantly from phone memory
        cacheControl = 'public, max-age=604800, stale-while-revalidate=86400';
      } else if (['.css', '.js'].includes(ext)) {
        cacheControl = 'public, max-age=300, must-revalidate';
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl
      });
      res.end(content);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Turbo Backend + Mini App Server live on port ${PORT}`);
});
