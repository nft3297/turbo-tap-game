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
          wallet: 25.00, // $25 Welcome Game Bonus
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

      // 3. Update Balance / Win: POST /api/wallet/update
      if (req.method === 'POST' && reqPath === '/api/wallet/update') {
        const { telegramId, amount, type } = data;
        const db = readDB();

        if (!db.users[telegramId]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        if (type === 'ref') {
          db.users[telegramId].refWallet += parseFloat(amount);
        } else {
          db.users[telegramId].wallet += parseFloat(amount);
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
        const avail = source === 'referral' ? user.refWallet : user.wallet;

        if (amt > avail || amt < 5) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid withdrawal amount' }));
        }

        // Deduct balance
        if (source === 'referral') {
          user.refWallet -= amt;
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
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Turbo Backend + Mini App Server live on port ${PORT}`);
});
