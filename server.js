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

const server = http.createServer((req, res) => {
  // CORS Headers for Telegram Webview
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // Helper for POST body parsing
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try {
        if (body) data = JSON.parse(body);
      } catch (err) {}

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
