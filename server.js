const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    });
  }
} catch (e) {
  console.warn('[Env] Could not read .env file:', e.message);
}

// Supabase Cloud PostgreSQL Credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ikzcinamnepakpixqpoi.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlremNpbmFtbmVwYWtwaXhxcG9pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjI3OTE4NywiZXhwIjoyMTA3ODU1MTg3fQ._QFLT6lb2RiIg_BZgylnnK3yU9-DTV_FyEYUY-lq3Nc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Local DB Backup file fallback
const DB_FILE = path.join(__dirname, 'database.json');
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, withdrawals: [], deposits: [], creditedDeposits: {} }, null, 2));
}

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: {}, withdrawals: [], deposits: [], creditedDeposits: {} };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Local DB] Write error:', e.message);
  }
}

// ================= ARENA BATTLE ROOMS (4 CARDS) =================
const DEFAULT_ARENA_ROOMS = [
  {
    id: 'trio',
    name: 'TRIO SHOWDOWN',
    desc: '3 Players Solo Knockout',
    players: 3,
    entryFee: 2,
    prize: 5,
    badge: 'FASTEST MATCH',
    theme: 'cyan'
  },
  {
    id: 'squad',
    name: 'SQUAD DOMINATION',
    desc: '5-Player Rush Elimination',
    players: 5,
    entryFee: 4,
    prize: 16,
    badge: 'SQUAD BATTLE',
    theme: 'purple'
  },
  {
    id: 'elite',
    name: 'ELITE SYNDICATE',
    desc: '8-Player Mega Clash',
    players: 8,
    entryFee: 7,
    prize: 50,
    badge: 'HIGH STAKES',
    theme: 'amber'
  },
  {
    id: 'royale',
    name: 'CHAMPIONS ROYALE',
    desc: '12-Player Ultimate Showdown',
    players: 12,
    entryFee: 15,
    prize: 170,
    badge: 'GRAND JACKPOT',
    theme: 'gold'
  }
];

// ================= REAL-TIME BROADCAST ENGINE (SSE) =================
const liveSyncClients = new Set();
function broadcastLiveUpdate(eventType, payload) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of liveSyncClients) {
    try {
      client.write(message);
    } catch (e) {
      liveSyncClients.delete(client);
    }
  }
}
// Heartbeat keep-alive every 25s for SSE clients
setInterval(() => {
  for (const client of liveSyncClients) {
    try {
      client.write(': ping\n\n');
    } catch (e) {
      liveSyncClients.delete(client);
    }
  }
}, 25000);

// ================= TELEGRAM BOT NOTIFICATION SERVICE =================
// Active Bot Token: reads from .env (TELEGRAM_BOT_TOKEN) or database.json (gameConfig.botToken)
function getTelegramBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim()) {
    return process.env.TELEGRAM_BOT_TOKEN.trim();
  }
  const localDB = readDB();
  if (localDB.gameConfig?.botToken && String(localDB.gameConfig.botToken).trim()) {
    return String(localDB.gameConfig.botToken).trim();
  }
  return null;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramMessage(chatId, text) {
  const token = getTelegramBotToken();
  if (!token) {
    console.log(`[Telegram Bot] Notification skipped for ${chatId} (TELEGRAM_BOT_TOKEN not configured yet).`);
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  if (!chatId) return { ok: false, error: 'Chat ID missing' };

  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        chat_id: String(chatId),
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            if (json.ok) {
              console.log(`[Telegram Bot] Message delivered to ${chatId}`);
              resolve({ ok: true, result: json.result });
            } else {
              console.warn(`[Telegram Bot] Send failed to ${chatId}:`, json.description);
              resolve({ ok: false, error: json.description });
            }
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        });
      });

      req.on('error', (err) => {
        console.warn(`[Telegram Bot] Network error for ${chatId}:`, err.message);
        resolve({ ok: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Request timeout' });
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.warn(`[Telegram Bot] Exception for ${chatId}:`, err.message);
      resolve({ ok: false, error: err.message });
    }
  });
}

// Convert Supabase DB snake_case row to frontend camelCase user object
function formatUser(row) {
  if (!row) return null;
  // Support firstName stored as 'FirstName||@username' in username field
  let storedUsername = row.username || 'Gamer';
  let extractedFirstName = row.first_name || row.firstName || '';
  if (storedUsername.includes('||')) {
    const parts = storedUsername.split('||');
    extractedFirstName = extractedFirstName || parts[0] || '';
    storedUsername = parts[1] || parts[0] || 'Gamer';
  }
  return {
    telegramId: String(row.telegram_id),
    username: storedUsername,
    firstName: extractedFirstName,
    email: row.email || '',
    bscAddress: row.bsc_address,
    wallet: parseFloat(row.wallet || 0),
    profitWallet: parseFloat(row.profit_wallet || 0),
    withdrawWallet: parseFloat(row.withdraw_wallet !== undefined && row.withdraw_wallet !== null ? row.withdraw_wallet : (row.profit_wallet || 0)),
    refWallet: parseFloat(row.ref_wallet || 0),
    friendsCount: parseInt(row.friends_count || 0),
    totalRefEarned: parseFloat(row.total_ref_earned || 0),
    referredBy: row.referred_by || null,
    createdAt: row.created_at
  };
}

// Supabase User Helpers
async function getSupabaseUser(telegramId) {
  if (!telegramId) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', String(telegramId))
      .maybeSingle();

    if (error) {
      console.error('[Supabase] getSupabaseUser error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[Supabase] getSupabaseUser exception:', err.message);
    return null;
  }
}

async function upsertSupabaseUser(userObj) {
  try {
    const row = {
      telegram_id: String(userObj.telegramId || userObj.telegram_id),
      username: userObj.username,
      first_name: userObj.firstName || userObj.first_name || null,
      email: userObj.email || null,
      bsc_address: userObj.bscAddress || userObj.bsc_address,
      wallet: parseFloat(userObj.wallet || 0),
      profit_wallet: parseFloat(userObj.profitWallet || userObj.profit_wallet || 0),
      withdraw_wallet: parseFloat(userObj.withdrawWallet || userObj.withdraw_wallet || 0),
      ref_wallet: parseFloat(userObj.refWallet || userObj.ref_wallet || 0),
      friends_count: parseInt(userObj.friendsCount || userObj.friends_count || 0),
      total_ref_earned: parseFloat(userObj.totalRefEarned || userObj.total_ref_earned || 0),
      referred_by: userObj.referredBy || userObj.referred_by || null,
      updated_at: new Date().toISOString()
    };
    if (userObj.createdAt || userObj.created_at) {
      row.created_at = userObj.createdAt || userObj.created_at;
    }

    const { data, error } = await supabase
      .from('users')
      .upsert(row)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[Supabase] upsert error:', error);
      return null;
    }
    return data || row;
  } catch (err) {
    console.error('[Supabase] upsert exception:', err.message);
    return null;
  }
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
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

const PLISIO = {
  secretKey: process.env.PLISIO_SECRET_KEY || 'i1yF7lDXacUvZjI1q37KEqcFDKrTBJIXS0whbdGqmB8tHz6yhJqNKHTaLwpzsmZs',
  baseUrl: 'https://api.plisio.net/api/v1',
  currency: 'USDT_BSC', // Strictly BEP-20 USDT on Binance Smart Chain
  callbackUrl: 'https://turbo-tap-game.onrender.com/api/plisio/callback'
};

// ================= REAL-TIME ON-CHAIN BSC BEP-20 SCANNER =================
async function checkBscUsdtBalance(address) {
  if (!address || !address.startsWith('0x') || address.length !== 42) return 0;
  try {
    const data = '0x70a08231000000000000000000000000' + address.slice(2).toLowerCase();
    const res = await fetch('https://bsc-dataseed1.binance.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: '0x55d398326f99059fF775485246999027B3197955', data }, 'latest']
      })
    }).then(r => r.json());

    if (res && res.result && res.result !== '0x') {
      const raw = BigInt(res.result);
      return Number(raw) / 1e18;
    }
  } catch (e) {
    console.warn('[BSC RPC] Check balance failed:', e.message);
  }
  return 0;
}

// ================= ANTI-HACKER RATE LIMITING ENGINE =================
const ipRateLimitMap = new Map();

// Periodic GC for expired IP rate-limit records (every 2 mins)
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of ipRateLimitMap.entries()) {
    if (now > data.resetTime) {
      ipRateLimitMap.delete(key);
    }
  }
}, 120000);

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';
}

function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  let record = ipRateLimitMap.get(key);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    ipRateLimitMap.set(key, record);
    return { allowed: true, remaining: limit - 1 };
  }
  record.count++;
  if (record.count > limit) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }
  return { allowed: true, remaining: limit - record.count };
}

const server = http.createServer(async (req, res) => {
  const clientIp = getClientIp(req);

  // ================= OWASP MILITARY-GRADE SECURITY HEADERS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  // Anti-Clickjacking / Anti-MIME Sniffing / Anti-XSS
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Secure Content Security Policy: Allow Telegram mini-app embed only, block arbitrary frames
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org;");

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const [reqPath, queryString] = req.url.split('?');

  // Rate Limiting Layer 1: General IP Limit (150 requests/min)
  const genLimit = checkRateLimit(`gen_${clientIp}`, 150, 60000);
  if (!genLimit.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(genLimit.retryAfter)
    });
    return res.end(JSON.stringify({ error: 'Too Many Requests. Firewall rate limit triggered.', retryAfter: genLimit.retryAfter }));
  }

  // Rate Limiting Layer 2: Sensitive Financial & State Routes (25 requests/min)
  if (reqPath.startsWith('/api/wallet') || reqPath.startsWith('/api/withdraw') || reqPath.startsWith('/api/register')) {
    const secLimit = checkRateLimit(`sec_${clientIp}`, 25, 60000);
    if (!secLimit.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(secLimit.retryAfter)
      });
      return res.end(JSON.stringify({ error: 'Security alert: Too many requests on sensitive financial endpoint. Please wait.', retryAfter: secLimit.retryAfter }));
    }
  }

  // Lightweight Ping / Health Check for Keep-Alive Monitors
  if (reqPath === '/health' || reqPath === '/ping' || reqPath === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', database: 'supabase_connected', firewall: 'active', time: new Date().toISOString() }));
  }

  // ================= API ROUTES =================
  if (reqPath.startsWith('/api/')) {

    // Real-Time SSE Stream for Instant Updates across all users: GET /api/live/stream
    if (req.method === 'GET' && reqPath === '/api/live/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      const localDB = readDB();
      res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, time: Date.now() })}\n\n`);
      res.write(`event: roomsUpdated\ndata: ${JSON.stringify({ rooms: localDB.battleRooms || DEFAULT_ARENA_ROOMS, time: Date.now() })}\n\n`);
      liveSyncClients.add(res);
      req.on('close', () => {
        liveSyncClients.delete(res);
      });
      return;
    }

    // 1. Check / Get User Profile: GET /api/user?telegramId=123
    if (req.method === 'GET' && reqPath === '/api/user') {
      const urlParams = new URLSearchParams(queryString);
      const telegramId = urlParams.get('telegramId');

      if (!telegramId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'telegramId is required' }));
      }

      // Fetch from Supabase
      const userRow = await getSupabaseUser(telegramId);
      if (userRow) {
        // Fetch latest completed deposit for this user so client accurately tracks new deposit events
        let latestDeposit = null;
        try {
          const { data: depData } = await supabase
            .from('deposits')
            .select('id, amount, created_at')
            .eq('telegram_id', String(telegramId))
            .eq('status', 'finished')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (depData) {
            latestDeposit = {
              id: String(depData.id),
              amount: parseFloat(depData.amount || 0),
              createdAt: depData.created_at
            };
          }
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ exists: true, user: formatUser(userRow), latestDeposit }));
      }

      // Fallback local DB check
      const localDB = readDB();
      const localUser = localDB.users[telegramId];
      if (localUser) {
        // Auto migrate to Supabase
        await upsertSupabaseUser(localUser);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ exists: true, user: localUser, latestDeposit: null }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ exists: false }));
    }

    // 2. PLISIO: GET /api/plisio/deposit-address?telegramId=123 (with /api/nowpayments/deposit-address alias)
    if (req.method === 'GET' && (reqPath === '/api/plisio/deposit-address' || reqPath === '/api/nowpayments/deposit-address')) {
      const urlParams = new URLSearchParams(queryString);
      const telegramId = urlParams.get('telegramId');

      if (!telegramId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'telegramId is required' }));
      }

      let userRow = await getSupabaseUser(telegramId);
      if (!userRow) {
        const bscAddress = generateBscAddress(telegramId);
        userRow = await upsertSupabaseUser({
          telegramId: String(telegramId),
          username: 'Gamer_' + String(telegramId).slice(-4),
          bscAddress: bscAddress,
          wallet: 0,
          profitWallet: 0,
          withdrawWallet: 0,
          refWallet: 0,
          friendsCount: 0,
          totalRefEarned: 0,
          createdAt: new Date().toISOString()
        });
      }

      // 1. Strict Dedicated Address Rule: Check if user already has a dedicated Plisio address
      let dedicatedAddress = null;
      let paymentId = null;

      try {
        const localDB = readDB();
        if (localDB.users[telegramId]?.plisioDeposit?.pay_address) {
          dedicatedAddress = localDB.users[telegramId].plisioDeposit.pay_address;
          paymentId = localDB.users[telegramId].plisioDeposit.payment_id;
        }
      } catch (e) {}

      // If user already has a dedicated Plisio address, return it immediately (1 user = 1 permanent address & QR)
      if (dedicatedAddress) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          pay_address: dedicatedAddress,
          payment_id: paymentId,
          currency: 'USDT',
          network: 'BSC (BEP-20)',
          gateway: 'Plisio'
        }));
      }

      // Otherwise, request a dedicated White-Label BEP-20 deposit address via Plisio API
      const orderNumber = `dep_${telegramId}_${Date.now()}`;
      const orderName = `TurboTap Deposit User ${telegramId}`;
      const plisioUrl = `${PLISIO.baseUrl}/invoices/new?api_key=${PLISIO.secretKey}&currency=${PLISIO.currency}&order_number=${encodeURIComponent(orderNumber)}&order_name=${encodeURIComponent(orderName)}&source_currency=USD&source_amount=1&callback_url=${encodeURIComponent(PLISIO.callbackUrl + '?json=true')}`;

      fetch(plisioUrl)
        .then(r => r.json())
        .then(async result => {
          if (!result || result.status !== 'success' || !result.data) {
            console.warn('[Plisio] Create invoice notice:', result?.data?.message || result);
            const fallbackAddr = userRow?.bsc_address || generateBscAddress(telegramId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              pay_address: fallbackAddr,
              payment_id: 'local_' + telegramId,
              currency: 'USDT',
              network: 'BSC (BEP-20)',
              gateway: 'Fallback'
            }));
          }

          const invoice = result.data;
          const assignedAddress = invoice.wallet_hash || invoice.invoice_url;
          const txnId = invoice.txn_id;

          // Save dedicated deposit record in Supabase
          try {
            await supabase.from('deposits').upsert({
              id: 'plisio_' + txnId,
              payment_id: String(txnId),
              telegram_id: String(telegramId),
              amount: 1,
              network: 'BSC-BEP20',
              tx_hash: assignedAddress,
              status: 'waiting',
              created_at: new Date().toISOString()
            });

            // Update user profile bsc_address
            await supabase.from('users').update({
              bsc_address: assignedAddress,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(telegramId));
          } catch (err) {
            console.warn('[Supabase] Plisio deposit record error:', err.message);
          }

          // Sync local DB backup
          const localDB = readDB();
          localDB.users[telegramId] = localDB.users[telegramId] || formatUser(userRow);
          localDB.users[telegramId].plisioDeposit = {
            payment_id: String(txnId),
            pay_address: assignedAddress,
            created_at: new Date().toISOString()
          };
          localDB.users[telegramId].bscAddress = assignedAddress;
          writeDB(localDB);

          console.log(`[Plisio] Generated dedicated BEP-20 address for user ${telegramId}: ${assignedAddress}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            pay_address: assignedAddress,
            payment_id: txnId,
            currency: 'USDT',
            network: 'BSC (BEP-20)',
            gateway: 'Plisio'
          }));
        })
        .catch(err => {
          console.error('[Plisio] Connection error:', err);
          const fallbackAddr = userRow?.bsc_address || generateBscAddress(telegramId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            pay_address: fallbackAddr,
            payment_id: 'local_' + telegramId,
            currency: 'USDT',
            network: 'BSC (BEP-20)',
            gateway: 'Fallback'
          }));
        });
      return;
    }

    // 3. PLISIO: Check Deposit Status GET /api/plisio/check?telegramId=123&paymentId=456 (with /api/nowpayments/check alias)
    if (req.method === 'GET' && (reqPath === '/api/plisio/check' || reqPath === '/api/nowpayments/check')) {
      const urlParams = new URLSearchParams(queryString);
      const telegramId = urlParams.get('telegramId');
      let paymentId = urlParams.get('paymentId');

      if (!telegramId && !paymentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'telegramId is required' }));
      }

      // Tier 1: Check if this specific paymentId is marked finished in Supabase
      try {
        let depRecord = null;
        if (paymentId && !paymentId.startsWith('local_')) {
          const { data } = await supabase
            .from('deposits')
            .select('*')
            .or(`payment_id.eq.${paymentId},id.eq.plisio_${paymentId}`)
            .maybeSingle();
          depRecord = data;
        }

        if (depRecord && depRecord.status === 'finished') {
          const userRow = await getSupabaseUser(telegramId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: 'completed',
            credited: true,
            depositId: depRecord.id || ('plisio_' + paymentId),
            amount: parseFloat(depRecord.amount || 0),
            wallet: parseFloat(userRow?.wallet || 0),
            message: `Deposit of $${parseFloat(depRecord.amount || 0).toFixed(2)} USDT credited to Game Wallet!`
          }));
        }
      } catch (err) {
        console.warn('[Deposit Check] Supabase check error:', err.message);
      }

      // Tier 2: Check Plisio API if paymentId is a live Plisio invoice
      if (paymentId && !paymentId.startsWith('local_')) {
        try {
          const resData = await fetch(`${PLISIO.baseUrl}/invoices/${paymentId}?api_key=${PLISIO.secretKey}`).then(r => r.json());
          if (resData && resData.status === 'success' && resData.data) {
            const invoice = resData.data;
            const isPaid = ['completed', 'mismatch', 'finished'].includes(invoice.status);
            const paidAmount = parseFloat(invoice.amount || invoice.pending_amount || invoice.source_sum || 0);

            if (isPaid && paidAmount > 0) {
              await supabase.from('deposits').upsert({
                id: 'plisio_' + paymentId,
                payment_id: String(paymentId),
                telegram_id: String(telegramId),
                amount: paidAmount,
                network: 'BSC-BEP20',
                tx_hash: invoice.tx_urls || invoice.txn_id || null,
                status: 'finished',
                created_at: new Date().toISOString()
              });

              const userRow = await getSupabaseUser(telegramId);
              const updatedWallet = parseFloat(userRow?.wallet || 0) + paidAmount;
              await supabase.from('users').update({
                wallet: updatedWallet,
                updated_at: new Date().toISOString()
              }).eq('telegram_id', String(telegramId));

              // Sync local DB
              const localDB = readDB();
              if (localDB.users[telegramId]) localDB.users[telegramId].wallet = updatedWallet;
              writeDB(localDB);

              // Send Telegram Notification to user
              const depMsg = `🎮 <b>Turbo Tap Game — Deposit Confirmed!</b> 💰\n\n` +
                `Hello <b>${escapeHtml(userRow?.username || 'Player')}</b>!\n` +
                `Your deposit of <b>$${paidAmount.toFixed(2)} USDT</b> has been verified and added to your Game Wallet! 🚀\n\n` +
                `💳 <b>Amount:</b> $${paidAmount.toFixed(2)} USDT\n` +
                `💰 <b>New Game Balance:</b> $${updatedWallet.toFixed(2)}\n` +
                `⚡ <b>Status:</b> Completed\n\n` +
                `⚔️ <i>Jump into Turbo Team Battle and multiply your coins!</i>\n` +
                `🕹️ <b>Play Now:</b> <a href="https://t.me/TurboTapgame_bot">@TurboTapgame_bot</a>`;
              sendTelegramMessage(telegramId, depMsg).catch(() => {});

              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                status: 'completed',
                credited: true,
                depositId: 'plisio_' + paymentId,
                amount: paidAmount,
                wallet: updatedWallet,
                message: `Deposit of $${paidAmount.toFixed(2)} USDT credited to Game Wallet!`
              }));
            }
          }
        } catch (e) {
          console.warn('[Plisio API] invoice check warning:', e.message);
        }
      }

      // Tier 3: Real-Time On-Chain BSC Blockchain Scanner for BEP-20 USDT
      try {
        const userRow = await getSupabaseUser(telegramId);
        if (userRow?.bsc_address) {
          const onChainBal = await checkBscUsdtBalance(userRow.bsc_address);
          if (onChainBal > 0) {
            const { data: allDeps } = await supabase
              .from('deposits')
              .select('amount')
              .eq('telegram_id', String(telegramId))
              .eq('status', 'finished');

            const totalCredited = (allDeps || []).reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
            if (onChainBal > totalCredited) {
              const diff = parseFloat((onChainBal - totalCredited).toFixed(4));
              const updatedWallet = parseFloat(userRow.wallet || 0) + diff;

              await supabase.from('deposits').insert({
                id: `dep_bsc_${telegramId}_${Date.now()}`,
                payment_id: `bsc_onchain_${telegramId}_${Date.now()}`,
                telegram_id: String(telegramId),
                amount: diff,
                network: 'BSC-BEP20',
                tx_hash: userRow.bsc_address,
                status: 'finished',
                created_at: new Date().toISOString()
              });

              await supabase.from('users').update({
                wallet: updatedWallet,
                updated_at: new Date().toISOString()
              }).eq('telegram_id', String(telegramId));

              const localDB = readDB();
              if (localDB.users[telegramId]) localDB.users[telegramId].wallet = updatedWallet;
              writeDB(localDB);

              // Send Telegram Notification to user
              const bscDepMsg = `🎮 <b>Turbo Tap Game — On-Chain Deposit Detected!</b> ⚡\n\n` +
                `Hello <b>${escapeHtml(userRow?.username || 'Player')}</b>!\n` +
                `Your Binance Smart Chain (BEP-20) deposit of <b>$${diff.toFixed(2)} USDT</b> has been confirmed on-chain and credited to your Game Wallet! 💎\n\n` +
                `💳 <b>Deposited:</b> $${diff.toFixed(2)} USDT\n` +
                `💰 <b>New Game Balance:</b> $${updatedWallet.toFixed(2)}\n` +
                `⛓️ <b>Network:</b> BSC (BEP-20)\n\n` +
                `🕹️ <b>Play Now:</b> <a href="https://t.me/TurboTapgame_bot">@TurboTapgame_bot</a>`;
              sendTelegramMessage(telegramId, bscDepMsg).catch(() => {});

              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                status: 'completed',
                credited: true,
                depositId: `dep_bsc_${telegramId}_${Date.now()}`,
                amount: diff,
                wallet: updatedWallet,
                message: `Deposit of $${diff.toFixed(2)} USDT verified on Binance Smart Chain!`
              }));
            }
          }
        }
      } catch (chainErr) {
        console.warn('[BSC Scanner] Error:', chainErr.message);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'waiting', credited: false }));
    }


    // ================= ANTI-DOS PAYLOAD SIZE GUARD (50KB MAX) =================
    let body = '';
    let bodyLength = 0;
    const MAX_PAYLOAD_BYTES = 50 * 1024; // 50 KB max body
    let isPayloadOversized = false;

    req.on('data', chunk => {
      bodyLength += chunk.length;
      if (!isPayloadOversized && bodyLength > MAX_PAYLOAD_BYTES) {
        isPayloadOversized = true;
        res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
        res.end(JSON.stringify({ error: 'Payload Too Large: maximum allowed body size is 50KB' }));
        req.pause();
        return;
      }
      if (!isPayloadOversized) {
        body += chunk;
      }
    });

    req.on('end', async () => {
      if (isPayloadOversized) return;
      let data = {};
      try {
        if (body) {
          const trimmed = body.trim();
          if (trimmed.startsWith('{')) {
            data = JSON.parse(body);
          } else {
            const params = new URLSearchParams(body);
            data = Object.fromEntries(params.entries());
          }
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid JSON request payload' }));
      }

      // 1. PLISIO IPN CALLBACK: POST /api/plisio/callback (with /api/nowpayments/ipn fallback alias)
      if (req.method === 'POST' && (reqPath === '/api/plisio/callback' || reqPath === '/api/nowpayments/ipn')) {
        console.log('[Plisio Callback] Webhook received:', JSON.stringify(data));
        const paymentId = data.txn_id || data.payment_id;
        const status = data.status || data.payment_status;
        const actuallyPaid = parseFloat(data.amount || data.source_sum || data.pending_amount || data.actually_paid || 0);
        const orderId = data.order_number || data.order_id || '';
        const payAddress = data.wallet_hash || data.pay_address;

        let targetTelegramId = null;
        if (orderId && orderId.startsWith('dep_')) {
          const parts = orderId.split('_');
          targetTelegramId = parts[1];
        }

        if (!targetTelegramId && payAddress) {
          const { data: u } = await supabase.from('users').select('telegram_id').eq('bsc_address', payAddress).maybeSingle();
          if (u) targetTelegramId = u.telegram_id;
        }

        if (!targetTelegramId && paymentId) {
          const { data: d } = await supabase.from('deposits').select('telegram_id').eq('payment_id', String(paymentId)).maybeSingle();
          if (d) targetTelegramId = d.telegram_id;
        }

        const isPaid = ['completed', 'mismatch', 'finished', 'confirmed', 'partially_paid'].includes(status);
        if (isPaid && actuallyPaid > 0 && targetTelegramId) {
          const { data: depRecord } = await supabase
            .from('deposits')
            .select('status')
            .eq('payment_id', String(paymentId))
            .maybeSingle();

          if (depRecord?.status !== 'finished') {
            await supabase.from('deposits').upsert({
              id: 'plisio_' + paymentId,
              payment_id: String(paymentId),
              telegram_id: String(targetTelegramId),
              amount: actuallyPaid,
              network: 'BSC-BEP20',
              tx_hash: data.tx_urls || data.txn_id || data.payin_hash || null,
              status: 'finished',
              created_at: new Date().toISOString()
            });

            const userRow = await getSupabaseUser(targetTelegramId);
            const newBal = parseFloat(userRow?.wallet || 0) + actuallyPaid;
            await supabase.from('users').update({
              wallet: newBal,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(targetTelegramId));

            // Sync local DB backup
            const localDB = readDB();
            localDB.creditedDeposits = localDB.creditedDeposits || {};
            localDB.creditedDeposits[String(paymentId)] = { amount: actuallyPaid, telegramId: targetTelegramId, date: new Date().toISOString() };
            if (localDB.users[targetTelegramId]) localDB.users[targetTelegramId].wallet = newBal;
            writeDB(localDB);

            console.log(`[Plisio Callback] Auto-credited $${actuallyPaid} USDT to Game Wallet of user ${targetTelegramId} in Supabase!`);

            // Send Telegram Notification to user
            const ipnDepMsg = `🎮 <b>Turbo Tap Game — Deposit Successful!</b> 💳\n\n` +
              `Hello <b>${escapeHtml(userRow?.username || 'Player')}</b>!\n` +
              `Your payment of <b>$${actuallyPaid.toFixed(2)} USDT</b> has been processed and credited to your Game Wallet! 🎉\n\n` +
              `💵 <b>Amount Credited:</b> $${actuallyPaid.toFixed(2)} USDT\n` +
              `💰 <b>New Game Balance:</b> $${newBal.toFixed(2)}\n` +
              `⚡ <b>Status:</b> Finished\n\n` +
              `🕹️ <b>Play Now:</b> <a href="https://t.me/TurboTapgame_bot">@TurboTapgame_bot</a>`;
            sendTelegramMessage(targetTelegramId, ipnDepMsg).catch(() => {});
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, status: 'success' }));
      }

      // 2. 1st Time Sign Up / Auto Register: POST /api/register
      if (req.method === 'POST' && reqPath === '/api/register') {
        const { telegramId, username, firstName, email, referrerId } = data;

        if (!telegramId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'telegramId is required' }));
        }

        const cleanTelegramId = String(telegramId).trim();
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanTelegramId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid telegramId format' }));
        }

        // Anti-XSS String Sanitization
        const cleanUsername = String(username || 'Gamer').replace(/[<>&"']/g, '').trim().slice(0, 32) || 'Gamer';
        const cleanFirstName = firstName ? String(firstName).replace(/[<>&"']/g, '').trim().slice(0, 64) : null;
        const cleanEmail = email ? String(email).replace(/[<>&"']/g, '').trim().slice(0, 64) : null;

        let referrer = null;
        if (referrerId && String(referrerId).trim() !== cleanTelegramId) {
          const rawRef = String(referrerId).trim();
          const strippedRef = rawRef.startsWith('ref_') ? rawRef.slice(4).trim() : rawRef;
          referrer = await getSupabaseUser(strippedRef);
          if (!referrer && strippedRef !== rawRef) {
            referrer = await getSupabaseUser(rawRef);
          }
        }
        const validReferrer = referrer ? referrer.telegram_id : null;

        // Check if user already exists in Supabase
        let existing = await getSupabaseUser(telegramId);
        if (existing) {
          // If existing user doesn't have a referrer yet and opens via a valid referral link:
          if (validReferrer && !existing.referred_by && referrer) {
            // 1. Award +$25 to Referrer
            await supabase.from('users').update({
              ref_wallet: parseFloat(referrer.ref_wallet || 0) + 25.00,
              total_ref_earned: parseFloat(referrer.total_ref_earned || 0) + 25.00,
              friends_count: parseInt(referrer.friends_count || 0) + 1,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(validReferrer));

            // 2. Award +$25 to the Referred User
            const newRefBal = parseFloat(existing.ref_wallet || 0) + 25.00;
            const { data: updatedSelf } = await supabase.from('users').update({
              referred_by: String(validReferrer),
              ref_wallet: newRefBal,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(telegramId)).select().single();

            if (updatedSelf) existing = updatedSelf;
            console.log(`[Referral Success] Existing User ${telegramId} linked to ${validReferrer}. Both awarded +$25!`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: formatUser(existing), message: 'User updated' }));
        }

        const bscAddress = generateBscAddress(telegramId);
        let initialRefWallet = 0.00;

        // If new user joined via a valid Referrer:
        if (validReferrer && referrer) {
          // 1. Award +$25.00 to the Referrer in Supabase!
          await supabase.from('users').update({
            ref_wallet: parseFloat(referrer.ref_wallet || 0) + 25.00,
            total_ref_earned: parseFloat(referrer.total_ref_earned || 0) + 25.00,
            friends_count: parseInt(referrer.friends_count || 0) + 1,
            updated_at: new Date().toISOString()
          }).eq('telegram_id', String(validReferrer));

          // 2. Award +$25.00 Welcome Starter Bonus to the Referred User!
          initialRefWallet = 25.00;
          console.log(`[Referral Success] New User ${telegramId} joined via ${validReferrer}! Both received +$25 in Referral Wallet!`);
        }

        const cleanHandle = (username || 'Gamer_' + String(telegramId).slice(-4)).trim();
        const newUserRow = {
          telegram_id: String(telegramId),
          // Store as 'FirstName||@handle' so we can extract name without extra DB column
          username: cleanFirstName ? `${cleanFirstName}||${cleanHandle}` : cleanHandle,
          email: (email || `user_${telegramId}@telegram.org`).trim().toLowerCase(),
          bsc_address: bscAddress,
          wallet: 0.00,
          profit_wallet: 0.00,
          withdraw_wallet: 0.00,
          ref_wallet: initialRefWallet, // $25 if referred!
          friends_count: 0,
          total_ref_earned: 0.00,
          referred_by: validReferrer,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data: createdUser, error: insErr } = await supabase
          .from('users')
          .insert(newUserRow)
          .select()
          .single();

        if (insErr) {
          console.error('[Supabase] Register insert error:', insErr);
        }

        // Sync local DB backup
        const localDB = readDB();
        localDB.users[telegramId] = formatUser(createdUser || newUserRow);
        writeDB(localDB);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, user: formatUser(createdUser || newUserRow) }));
      }

      // 3. Update Balance / Win / Entry Fee / Referral Bonus: POST /api/wallet/update
      if (req.method === 'POST' && reqPath === '/api/wallet/update') {
        const { telegramId, amount, type } = data;

        if (!telegramId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'telegramId is required' }));
        }

        const cleanTelegramId = String(telegramId).trim();
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanTelegramId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid telegramId format' }));
        }

        const delta = parseFloat(amount);
        if (isNaN(delta) || !Number.isFinite(delta)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid amount numeric value' }));
        }

        // Bound single transaction threshold against exploits
        if (Math.abs(delta) > 50000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Transaction amount exceeds maximum allowed limits' }));
        }

        let userRow = await getSupabaseUser(cleanTelegramId);
        if (!userRow) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        let updateData = { updated_at: new Date().toISOString() };

        if (type === 'ref') {
          const newRefBal = Math.max(0, parseFloat(userRow.ref_wallet || 0) + delta);
          updateData.ref_wallet = newRefBal;
          if (delta > 0) {
            updateData.total_ref_earned = parseFloat(userRow.total_ref_earned || 0) + delta;
            updateData.friends_count = parseInt(userRow.friends_count || 0) + 1;
          }
        } else if (type === 'profit') {
          updateData.profit_wallet = Math.max(0, parseFloat(userRow.profit_wallet || 0) + delta);
          updateData.withdraw_wallet = Math.max(0, parseFloat(userRow.withdraw_wallet || 0) + delta);
        } else if (type === 'withdraw') {
          updateData.withdraw_wallet = Math.max(0, parseFloat(userRow.withdraw_wallet || 0) + delta);
        } else {
          updateData.wallet = Math.max(0, parseFloat(userRow.wallet || 0) + delta);
        }

        const { data: updatedUser, error: updErr } = await supabase
          .from('users')
          .update(updateData)
          .eq('telegram_id', cleanTelegramId)
          .select()
          .single();

        if (updErr) {
          console.error('[Supabase] Wallet update error:', updErr);
        }

        // Sync local DB backup
        const localDB = readDB();
        if (localDB.users[cleanTelegramId]) {
          localDB.users[cleanTelegramId] = formatUser(updatedUser || userRow);
          writeDB(localDB);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, user: formatUser(updatedUser || userRow) }));
      }

      // 4. Request Withdrawal: POST /api/withdraw
      if (req.method === 'POST' && reqPath === '/api/withdraw') {
        const { telegramId, address, amount, source } = data;

        if (!telegramId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'telegramId is required' }));
        }

        const cleanTelegramId = String(telegramId).trim();
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanTelegramId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid telegramId format' }));
        }

        const amt = parseFloat(amount);
        if (isNaN(amt) || !Number.isFinite(amt) || amt < 20) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid withdrawal amount (Minimum $20 required)' }));
        }

        const cleanAddress = String(address || '').trim();
        // Strict BSC BEP-20 / EVM address check (0x followed by exactly 40 hex characters)
        if (!/^0x[a-fA-F0-9]{40}$/.test(cleanAddress)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid BSC (BEP-20) address format! Must start with 0x followed by 40 hex characters.' }));
        }

        let userRow = await getSupabaseUser(cleanTelegramId);
        if (!userRow) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        let avail = 0;
        let fieldToDeduct = 'wallet';

        if (source === 'referral') {
          avail = parseFloat(userRow.ref_wallet || 0);
          fieldToDeduct = 'ref_wallet';
        } else if (source === 'profit') {
          avail = parseFloat(userRow.profit_wallet || 0);
          fieldToDeduct = 'profit_wallet';
        } else if (source === 'withdraw') {
          avail = parseFloat(userRow.withdraw_wallet || 0);
          fieldToDeduct = 'withdraw_wallet';
        } else {
          avail = parseFloat(userRow.wallet || 0);
          fieldToDeduct = 'wallet';
        }

        if (amt > avail || amt < 20) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid withdrawal amount (Minimum $20 required, or insufficient balance)' }));
        }

        // Calculate 3% fee deduction
        const fee = amt * 0.03;
        const netAmount = Math.max(0, amt - fee);

        // Deduct balance in Supabase
        const newBalance = Math.max(0, avail - amt);
        const { data: updatedUser } = await supabase
          .from('users')
          .update({
            [fieldToDeduct]: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('telegram_id', String(telegramId))
          .select()
          .single();

        // Insert into Supabase withdrawals table
        const withdrawRecord = {
          id: 'wd_' + Date.now(),
          telegram_id: String(telegramId),
          wallet_type: source,
          amount: amt,
          fee: fee,
          net_amount: netAmount,
          bsc_address: address,
          status: 'pending',
          created_at: new Date().toISOString()
        };

        const { error: wdErr } = await supabase.from('withdrawals').insert(withdrawRecord);
        if (wdErr) console.error('[Supabase] Withdrawal insert error:', wdErr);

        // Sync local DB backup
        const localDB = readDB();
        localDB.withdrawals = localDB.withdrawals || [];
        localDB.withdrawals.push({
          ...withdrawRecord,
          username: userRow.username,
          network: 'BSC-BEP20'
        });
        if (localDB.users[telegramId]) {
          localDB.users[telegramId] = formatUser(updatedUser || userRow);
        }
        writeDB(localDB);

        console.log(`[Supabase] Withdrawal requested: $${amt} by user ${telegramId}`);

        // Send Telegram Notification to user
        const wdReqMsg = `🎮 <b>Turbo Tap Game — Withdrawal Request Placed</b> ⏳\n\n` +
          `Hello <b>${escapeHtml(userRow?.username || 'Player')}</b>,\n` +
          `Your withdrawal request has been received and is queued for verification.\n\n` +
          `💵 <b>Requested Amount:</b> $${amt.toFixed(2)}\n` +
          `💸 <b>Fee (3%):</b> $${fee.toFixed(2)}\n` +
          `✅ <b>Net to Receive:</b> $${netAmount.toFixed(2)} USDT\n` +
          `📍 <b>BSC Address:</b> <code>${cleanAddress}</code>\n` +
          `⏳ <b>Status:</b> Pending Admin Approval\n\n` +
          `<i>You will receive another message as soon as the payout is approved!</i>`;
        sendTelegramMessage(telegramId, wdReqMsg).catch(() => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, withdrawal: withdrawRecord, user: formatUser(updatedUser || userRow) }));
      }

      // 5. Withdrawal History: GET /api/withdraw/history?telegramId=123
      if (req.method === 'GET' && reqPath === '/api/withdraw/history') {
        const { telegramId } = data;
        const { data: wds } = await supabase
          .from('withdrawals')
          .select('*')
          .eq('telegram_id', String(telegramId))
          .order('created_at', { ascending: false });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, withdrawals: wds || [] }));
      }

      // ================= ADMIN PANEL API ROUTES =================
      // STRICT ACCESS: Only Telegram ID 8291758870 allowed
      const ADMIN_TELEGRAM_ID = '8291758870';

      function hashAdminPassword(pwd) {
        return crypto.createHash('sha256').update(String(pwd).trim()).digest('hex');
      }

      function getAdminPasswordHash() {
        const localDB = readDB();
        return localDB.adminPassword || null;
      }

      function saveAdminPasswordHash(hash) {
        const localDB = readDB();
        localDB.adminPassword = hash;
        writeDB(localDB);
      }

      // Check Admin Status (whether password exists): POST /api/admin/check-status
      if (req.method === 'POST' && reqPath === '/api/admin/check-status') {
        const { telegramId } = data;
        if (String(telegramId) !== ADMIN_TELEGRAM_ID) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Access Denied. Only Admin ID 8291758870 is allowed.' }));
        }
        const currentHash = getAdminPasswordHash();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          adminId: ADMIN_TELEGRAM_ID,
          hasPassword: !!currentHash
        }));
      }

      // Set New Admin Password: POST /api/admin/set-password
      if (req.method === 'POST' && reqPath === '/api/admin/set-password') {
        const { telegramId, newPassword } = data;
        if (String(telegramId) !== ADMIN_TELEGRAM_ID) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Access Denied. Admin only.' }));
        }
        if (!newPassword || String(newPassword).trim().length < 4) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Password must be at least 4 characters long.' }));
        }
        const hash = hashAdminPassword(newPassword);
        saveAdminPasswordHash(hash);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Admin password created successfully! You are now logged in.',
          adminId: ADMIN_TELEGRAM_ID
        }));
      }

      // Admin Auth Check: POST /api/admin/auth
      if (req.method === 'POST' && reqPath === '/api/admin/auth') {
        const { telegramId, password } = data;
        if (String(telegramId) !== ADMIN_TELEGRAM_ID) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Access Denied. Admin only.' }));
        }
        const currentHash = getAdminPasswordHash();
        if (!currentHash) {
          // If no password set yet, prompt client to set one
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            needPasswordSetup: true,
            message: 'No password set yet. Please create a new password.'
          }));
        }
        if (!password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Password is required to login.' }));
        }
        if (hashAdminPassword(password) !== currentHash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: '❌ Incorrect Admin Password! Please try again.' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, admin: true, adminId: ADMIN_TELEGRAM_ID, message: 'Welcome, Super Admin!' }));
      }

      // Change Admin Password: POST /api/admin/change-password
      if (req.method === 'POST' && reqPath === '/api/admin/change-password') {
        const { telegramId, oldPassword, newPassword } = data;
        if (String(telegramId) !== ADMIN_TELEGRAM_ID) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Access Denied.' }));
        }
        const currentHash = getAdminPasswordHash();
        if (currentHash && hashAdminPassword(oldPassword) !== currentHash) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Current password does not match.' }));
        }
        if (!newPassword || String(newPassword).trim().length < 4) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'New password must be at least 4 characters long.' }));
        }
        saveAdminPasswordHash(hashAdminPassword(newPassword));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Admin password changed successfully!' }));
      }

      // Admin middleware check helper (inline for all admin routes)
      function isAdmin(d) { return String(d?.adminId || d?.telegramId || '') === ADMIN_TELEGRAM_ID; }

      // Admin Dashboard Stats: POST /api/admin/stats
      if (req.method === 'POST' && reqPath === '/api/admin/stats') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        try {
          const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
          const { data: walletSum } = await supabase.from('users').select('wallet, profit_wallet, ref_wallet, withdraw_wallet');
          const { data: allWds } = await supabase.from('withdrawals').select('amount, status');
          const { data: allDeps } = await supabase.from('deposits').select('amount, status');
          const { data: recentUsers } = await supabase.from('users').select('telegram_id, username, wallet, profit_wallet, ref_wallet, created_at').order('created_at', { ascending: false }).limit(10);

          const totalGameWallet = (walletSum || []).reduce((s, u) => s + parseFloat(u.wallet || 0), 0);
          const totalProfitWallet = (walletSum || []).reduce((s, u) => s + parseFloat(u.profit_wallet || 0), 0);
          const totalRefWallet = (walletSum || []).reduce((s, u) => s + parseFloat(u.ref_wallet || 0), 0);
          const totalWithdrawWallet = (walletSum || []).reduce((s, u) => s + parseFloat(u.withdraw_wallet || 0), 0);
          const pendingWithdrawals = (allWds || []).filter(w => w.status === 'pending');
          const completedWithdrawals = (allWds || []).filter(w => w.status === 'completed');
          const totalDeposited = (allDeps || []).filter(d => d.status === 'finished').reduce((s, d) => s + parseFloat(d.amount || 0), 0);
          const totalWithdrawn = completedWithdrawals.reduce((s, w) => s + parseFloat(w.amount || 0), 0);

          const localDB = readDB();
          const gameConfig = localDB.gameConfig || {};

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            stats: {
              totalUsers: userCount || 0,
              totalGameWallet: totalGameWallet.toFixed(2),
              totalProfitWallet: totalProfitWallet.toFixed(2),
              totalRefWallet: totalRefWallet.toFixed(2),
              totalWithdrawWallet: totalWithdrawWallet.toFixed(2),
              pendingWithdrawalsCount: pendingWithdrawals.length,
              pendingWithdrawalsAmount: pendingWithdrawals.reduce((s, w) => s + parseFloat(w.amount || 0), 0).toFixed(2),
              totalDeposited: totalDeposited.toFixed(2),
              totalWithdrawn: totalWithdrawn.toFixed(2),
              recentUsers: recentUsers || []
            },
            gameConfig
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Get All Users: POST /api/admin/users
      if (req.method === 'POST' && reqPath === '/api/admin/users') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        try {
          const page = parseInt(data.page || 1);
          const limit = parseInt(data.limit || 20);
          const search = (data.search || '').trim();
          const from = (page - 1) * limit;
          const to = from + limit - 1;

          let query = supabase.from('users').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
          if (search) {
            query = supabase.from('users').select('*', { count: 'exact' }).or(`telegram_id.ilike.%${search}%,username.ilike.%${search}%,email.ilike.%${search}%`).order('created_at', { ascending: false }).range(from, to);
          }

          const { data: users, count, error } = await query;
          if (error) throw error;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, users: (users || []).map(formatUser), total: count, page, limit }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Update User: POST /api/admin/user/update
      if (req.method === 'POST' && reqPath === '/api/admin/user/update') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { targetTelegramId, field, value } = data;
        if (!targetTelegramId || !field) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'targetTelegramId and field required' })); }

        const allowedFields = { wallet: 'wallet', profitWallet: 'profit_wallet', refWallet: 'ref_wallet', withdrawWallet: 'withdraw_wallet', username: 'username', email: 'email', banned: 'banned', bscAddress: 'bsc_address' };
        const dbField = allowedFields[field];
        if (!dbField) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid field' })); }

        try {
          const updateObj = { [dbField]: value, updated_at: new Date().toISOString() };
          if (field === 'profitWallet') {
            const userRow = await getSupabaseUser(targetTelegramId);
            const curProfit = parseFloat(userRow?.profit_wallet || 0);
            const curWithdraw = parseFloat(userRow?.withdraw_wallet || 0);
            const diff = parseFloat(value) - curProfit;
            if (diff > 0) {
              updateObj.withdraw_wallet = Math.max(0, curWithdraw + diff);
            }
          }
          const { data: updated, error } = await supabase.from('users').update(updateObj).eq('telegram_id', String(targetTelegramId)).select().single();
          if (error) throw error;

          // Sync local DB
          const localDB = readDB();
          if (localDB.users[targetTelegramId]) localDB.users[targetTelegramId] = formatUser(updated);
          writeDB(localDB);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: formatUser(updated), message: `Field '${field}' updated successfully!` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Delete/Reset User Wallet: POST /api/admin/user/reset-wallet
      if (req.method === 'POST' && reqPath === '/api/admin/user/reset-wallet') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { targetTelegramId, walletType } = data;
        const walletMap = { game: 'wallet', profit: 'profit_wallet', ref: 'ref_wallet', withdraw: 'withdraw_wallet' };
        const dbWallet = walletMap[walletType] || 'wallet';
        try {
          const { data: updated } = await supabase.from('users').update({ [dbWallet]: 0, updated_at: new Date().toISOString() }).eq('telegram_id', String(targetTelegramId)).select().single();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: formatUser(updated) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Get All Withdrawals: POST /api/admin/withdrawals
      if (req.method === 'POST' && reqPath === '/api/admin/withdrawals') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        try {
          const status = data.status || null;
          let query = supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(100);
          if (status) query = supabase.from('withdrawals').select('*').eq('status', status).order('created_at', { ascending: false }).limit(100);
          const { data: wds, error } = await query;
          if (error) throw error;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, withdrawals: wds || [] }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Update Withdrawal Status: POST /api/admin/withdrawal/update
      if (req.method === 'POST' && reqPath === '/api/admin/withdrawal/update') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { withdrawalId, status, txHash } = data;
        if (!withdrawalId || !status) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'withdrawalId and status required' })); }
        try {
          const updateData = { status, updated_at: new Date().toISOString() };
          if (txHash) updateData.tx_hash = txHash;
          const { data: updated, error } = await supabase.from('withdrawals').update(updateData).eq('id', withdrawalId).select().single();
          if (error) throw error;

          // If rejected, refund amount to user wallet
          if (status === 'rejected' && updated) {
            const walletField = updated.wallet_type === 'referral' ? 'ref_wallet' : (updated.wallet_type === 'withdraw' || updated.wallet_type === 'profit') ? 'withdraw_wallet' : 'wallet';
            const userRow = await getSupabaseUser(updated.telegram_id);
            if (userRow) {
              const refundAmt = parseFloat(updated.amount || 0);
              await supabase.from('users').update({ [walletField]: parseFloat(userRow[walletField] || 0) + refundAmt, updated_at: new Date().toISOString() }).eq('telegram_id', String(updated.telegram_id));
            }
          }

          // Send Telegram Notification to user
          if (updated && updated.telegram_id) {
            const userRow = await getSupabaseUser(updated.telegram_id);
            const userName = escapeHtml(userRow?.username || 'Player');
            if (status === 'completed') {
              const txInfo = txHash ? `\n🔗 <b>Transaction Hash:</b> <code>${txHash}</code>` : '';
              const compMsg = `🎮 <b>Turbo Tap Game — Withdrawal Approved & Sent!</b> ✅\n\n` +
                `Hello <b>${userName}</b>!\n` +
                `Your withdrawal of <b>$${parseFloat(updated.amount || 0).toFixed(2)} USDT</b> has been approved and successfully transferred! 🚀\n\n` +
                `💵 <b>Net Amount:</b> $${parseFloat(updated.net_amount || updated.amount || 0).toFixed(2)} USDT\n` +
                `📍 <b>BSC Address:</b> <code>${updated.bsc_address || ''}</code>${txInfo}\n` +
                `✅ <b>Status:</b> Completed\n\n` +
                `<i>Thank you for playing Turbo Tap Game! Keep tapping and winning! ⚔️</i>\n` +
                `🕹️ <b>Play Now:</b> <a href="https://t.me/TurboTapgame_bot">@TurboTapgame_bot</a>`;
              sendTelegramMessage(updated.telegram_id, compMsg).catch(() => {});
            } else if (status === 'rejected') {
              const rejMsg = `🎮 <b>Turbo Tap Game — Withdrawal Request Update</b> ⚠️\n\n` +
                `Hello <b>${userName}</b>,\n` +
                `Your withdrawal request of <b>$${parseFloat(updated.amount || 0).toFixed(2)} USDT</b> was rejected by Admin.\n\n` +
                `💰 <b>Refund:</b> The full amount of $${parseFloat(updated.amount || 0).toFixed(2)} has been refunded back to your wallet.\n` +
                `⚠️ <b>Notice:</b> Please ensure your BSC address is valid and contact support if you need assistance.\n\n` +
                `🆘 <b>Support:</b> @TurboSupport`;
              sendTelegramMessage(updated.telegram_id, rejMsg).catch(() => {});
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, withdrawal: updated, message: `Withdrawal ${status}!` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Get All Deposits: POST /api/admin/deposits
      if (req.method === 'POST' && reqPath === '/api/admin/deposits') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        try {
          const { data: deps, error } = await supabase.from('deposits').select('*').order('created_at', { ascending: false }).limit(100);
          if (error) throw error;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, deposits: deps || [] }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Manual Credit Deposit: POST /api/admin/deposit/credit
      if (req.method === 'POST' && reqPath === '/api/admin/deposit/credit') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { targetTelegramId, amount } = data;
        const amt = parseFloat(amount);
        if (!targetTelegramId || isNaN(amt) || amt <= 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid parameters' })); }
        try {
          const userRow = await getSupabaseUser(targetTelegramId);
          if (!userRow) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'User not found' })); }
          const newWallet = parseFloat(userRow.wallet || 0) + amt;
          const { data: updated } = await supabase.from('users').update({ wallet: newWallet, updated_at: new Date().toISOString() }).eq('telegram_id', String(targetTelegramId)).select().single();
          await supabase.from('deposits').insert({ id: `admin_credit_${targetTelegramId}_${Date.now()}`, payment_id: `admin_${Date.now()}`, telegram_id: String(targetTelegramId), amount: amt, network: 'ADMIN-CREDIT', tx_hash: 'ADMIN_MANUAL_CREDIT', status: 'finished', created_at: new Date().toISOString() });
          const localDB = readDB();
          if (localDB.users[targetTelegramId]) localDB.users[targetTelegramId].wallet = newWallet;
          writeDB(localDB);

          // Send Telegram Notification to user
          const adminDepMsg = `🎮 <b>Turbo Tap Game — Funds Credited!</b> 🎁\n\n` +
            `Hello <b>${escapeHtml(userRow?.username || 'Player')}</b>!\n` +
            `An amount of <b>$${amt.toFixed(2)}</b> has been credited to your Game Wallet by Admin! 🌟\n\n` +
            `💵 <b>Credited Amount:</b> $${amt.toFixed(2)}\n` +
            `💰 <b>New Game Balance:</b> $${newWallet.toFixed(2)}\n\n` +
            `🕹️ <b>Play Now:</b> <a href="https://t.me/TurboTapgame_bot">@TurboTapgame_bot</a>`;
          sendTelegramMessage(targetTelegramId, adminDepMsg).catch(() => {});

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: formatUser(updated), message: `$${amt} credited to user ${targetTelegramId}` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Game Config: GET via POST /api/admin/config
      if (req.method === 'POST' && reqPath === '/api/admin/config') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const localDB = readDB();
        const defaultConfig = {
          referralBonus: 25,
          minWithdrawal: 20,
          withdrawalFee: 3,
          battleEntryFee: 10,
          battleWinMultiplier: 1.8,
          maxBattleBoost: 100,
          battleDuration: 15,
          maintenanceMode: false,
          welcomeMessage: 'Welcome to Turbo Team Battle! 🚀',
          botName: 'Turbo Team Battle',
          supportUsername: '@TurboSupport',
          announcementText: '',
          announcementActive: false,
          minDepositAmount: 1,
          depositNetwork: 'BSC (BEP-20)',
          autoApproveWithdrawals: false,
          maxDailyWithdrawal: 1000,
          playerMatchTimeout: 30,
          boostCooldown: 10
        };
        localDB.gameConfig = { ...defaultConfig, ...(localDB.gameConfig || {}) };
        writeDB(localDB);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, config: localDB.gameConfig }));
      }

      // Admin Update Game Config: POST /api/admin/config/update
      if (req.method === 'POST' && reqPath === '/api/admin/config/update') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { configKey, configValue } = data;
        if (!configKey) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'configKey required' })); }
        try {
          const localDB = readDB();
          localDB.gameConfig = localDB.gameConfig || {};
          localDB.gameConfig[configKey] = configValue;
          localDB.gameConfig.lastUpdated = new Date().toISOString();
          localDB.gameConfig.updatedBy = ADMIN_TELEGRAM_ID;
          if (configKey === 'botToken') {
            process.env.TELEGRAM_BOT_TOKEN = String(configValue || '').trim();
          }
          writeDB(localDB);
          broadcastLiveUpdate('configUpdated', {
            config: localDB.gameConfig,
            updatedAt: Date.now()
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, config: localDB.gameConfig, message: `Config '${configKey}' updated!` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Broadcast Message (stored for frontend + direct Telegram broadcast to all registered users): POST /api/admin/broadcast
      if (req.method === 'POST' && reqPath === '/api/admin/broadcast') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { message, title, type } = data;
        if (!message) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Message required' })); }
        try {
          const localDB = readDB();
          localDB.broadcasts = localDB.broadcasts || [];
          const broadcast = { id: 'bc_' + Date.now(), title: title || 'Admin Notice', message, type: type || 'info', createdAt: new Date().toISOString(), active: true };
          localDB.broadcasts.unshift(broadcast);
          localDB.broadcasts = localDB.broadcasts.slice(0, 20); // keep last 20
          localDB.gameConfig = localDB.gameConfig || {};
          localDB.gameConfig.announcementText = message;
          localDB.gameConfig.announcementActive = true;
          writeDB(localDB);

          // Get all registered users from Supabase and Local DB
          const { data: dbUsers } = await supabase.from('users').select('telegram_id, username, first_name');
          const localUsers = Object.values(localDB.users || {});
          const userMap = new Map();
          (dbUsers || []).forEach(u => { if (u.telegram_id) userMap.set(String(u.telegram_id), u); });
          localUsers.forEach(u => { if (u.telegramId && !userMap.has(String(u.telegramId))) userMap.set(String(u.telegramId), u); });
          const recipients = Array.from(userMap.values());

          const typeIcons = { info: 'ℹ️', success: '✅', warning: '⚠️', alert: '🚨', error: '🚨' };
          const icon = typeIcons[type] || '📢';
          const titleLine = title ? `\n\n📌 <b>${escapeHtml(title)}</b>` : '';
          const broadcastText = `🎮 <b>Turbo Tap Game — Announcement</b> ${icon}${titleLine}\n\n${escapeHtml(message)}\n\n━━━━━━━━━━━━━━━━━\n🕹️ <b>Play & Battle Now:</b> <a href="https://t.me/TurboTapgame_bot">@TurboTapgame_bot</a>\n💬 <b>Join Community:</b> <a href="https://t.me/turbotapgame_2nd">Turbo Tap Community</a>`;

          // Asynchronously dispatch direct Telegram messages to all registered users
          let sentTotal = 0;
          let failTotal = 0;
          (async () => {
            console.log(`[Broadcast] Starting Telegram broadcast to ${recipients.length} registered users...`);
            for (const r of recipients) {
              const tid = r.telegram_id || r.telegramId;
              if (tid) {
                const res = await sendTelegramMessage(tid, broadcastText);
                if (res.ok) sentTotal++;
                else failTotal++;
                await new Promise(resolve => setTimeout(resolve, 35)); // 28 msgs/sec safely below Telegram 30/s limit
              }
            }
            console.log(`[Broadcast] Telegram broadcast finished. Sent: ${sentTotal}, Failed: ${failTotal}, Total: ${recipients.length}`);
          })();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            success: true, 
            broadcast, 
            totalRecipients: recipients.length, 
            message: `Broadcast message sent to ${recipients.length} registered users on Telegram!` 
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Public: Get Active Broadcast: GET /api/broadcast
      // (Used by bot frontend to show announcements)

      // Admin Ban/Unban User: POST /api/admin/user/ban
      if (req.method === 'POST' && reqPath === '/api/admin/user/ban') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { targetTelegramId, ban } = data;
        if (!targetTelegramId) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'targetTelegramId required' })); }
        try {
          const { data: updated } = await supabase.from('users').update({ banned: ban === true || ban === 'true', updated_at: new Date().toISOString() }).eq('telegram_id', String(targetTelegramId)).select().single();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: formatUser(updated), message: ban ? `User ${targetTelegramId} BANNED!` : `User ${targetTelegramId} UNBANNED!` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Delete User: POST /api/admin/user/delete
      if (req.method === 'POST' && reqPath === '/api/admin/user/delete') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        const { targetTelegramId } = data;
        if (!targetTelegramId) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'targetTelegramId required' })); }
        try {
          await supabase.from('users').delete().eq('telegram_id', String(targetTelegramId));
          const localDB = readDB();
          delete localDB.users[targetTelegramId];
          writeDB(localDB);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: `User ${targetTelegramId} deleted!` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Leaderboard: POST /api/admin/leaderboard
      if (req.method === 'POST' && reqPath === '/api/admin/leaderboard') {
        if (!isAdmin(data)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Access Denied' })); }
        try {
          const { data: topUsers } = await supabase.from('users').select('telegram_id, username, wallet, profit_wallet, ref_wallet, friends_count, total_ref_earned, created_at').order('profit_wallet', { ascending: false }).limit(50);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, leaderboard: (topUsers || []).map(formatUser) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Public: Get Battle Rooms: GET /api/rooms
      if (req.method === 'GET' && reqPath === '/api/rooms') {
        const localDB = readDB();
        if (!localDB.battleRooms || !Array.isArray(localDB.battleRooms) || localDB.battleRooms.length === 0) {
          localDB.battleRooms = DEFAULT_ARENA_ROOMS;
          writeDB(localDB);
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        return res.end(JSON.stringify({ success: true, rooms: localDB.battleRooms, updatedAt: Date.now() }));
      }

      // Admin: Update Battle Rooms (single or all): POST /api/admin/rooms/update
      if (req.method === 'POST' && reqPath === '/api/admin/rooms/update') {
        if (!isAdmin(data)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Access Denied' }));
        }
        try {
          const localDB = readDB();
          if (!localDB.battleRooms || !Array.isArray(localDB.battleRooms)) {
            localDB.battleRooms = JSON.parse(JSON.stringify(DEFAULT_ARENA_ROOMS));
          }
          const { rooms, roomId, roomData } = data;
          if (Array.isArray(rooms)) {
            localDB.battleRooms = rooms.map((r, i) => {
              const def = DEFAULT_ARENA_ROOMS[i] || {};
              const feeVal = parseFloat(r.entryFee);
              const prizeVal = parseFloat(r.prize);
              return {
                id: r.id || def.id || (i === 0 ? 'trio' : i === 1 ? 'squad' : i === 2 ? 'elite' : 'royale'),
                name: String(r.name || def.name || '').trim(),
                desc: String(r.desc || def.desc || '').trim(),
                players: parseInt(r.players) || def.players || 3,
                entryFee: !isNaN(feeVal) && feeVal >= 0 ? feeVal : (def.entryFee || 2),
                prize: !isNaN(prizeVal) && prizeVal >= 0 ? prizeVal : (def.prize || 2),
                badge: String(r.badge || def.badge || '').trim(),
                theme: r.theme || def.theme || 'cyan'
              };
            });
          } else if (roomId && roomData) {
            let idx = localDB.battleRooms.findIndex(r => r.id === roomId);
            if (idx === -1) {
              if (roomId === 'trio') idx = localDB.battleRooms.findIndex(r => r.players === 3);
              else if (roomId === 'squad') idx = localDB.battleRooms.findIndex(r => r.players === 5);
              else if (roomId === 'elite') idx = localDB.battleRooms.findIndex(r => r.players === 8);
              else if (roomId === 'royale') idx = localDB.battleRooms.findIndex(r => r.players === 12);
            }
            if (idx === -1) {
              idx = roomId === 'trio' ? 0 : roomId === 'squad' ? 1 : roomId === 'elite' ? 2 : 3;
            }
            if (idx !== -1 && localDB.battleRooms[idx]) {
              const feeVal = parseFloat(roomData.entryFee);
              const prizeVal = parseFloat(roomData.prize);
              localDB.battleRooms[idx] = {
                ...localDB.battleRooms[idx],
                id: roomId || localDB.battleRooms[idx].id,
                name: roomData.name !== undefined ? String(roomData.name).trim() : localDB.battleRooms[idx].name,
                desc: roomData.desc !== undefined ? String(roomData.desc).trim() : localDB.battleRooms[idx].desc,
                players: parseInt(roomData.players) || localDB.battleRooms[idx].players,
                entryFee: !isNaN(feeVal) && feeVal >= 0 ? feeVal : localDB.battleRooms[idx].entryFee,
                prize: !isNaN(prizeVal) && prizeVal >= 0 ? prizeVal : localDB.battleRooms[idx].prize,
                badge: roomData.badge !== undefined ? String(roomData.badge).trim() : localDB.battleRooms[idx].badge
              };
            }
          }
          writeDB(localDB);

          // REAL-TIME BROADCAST: Instantly push updated cards to all active users via SSE
          broadcastLiveUpdate('roomsUpdated', {
            rooms: localDB.battleRooms,
            updatedAt: Date.now()
          });

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
          });
          return res.end(JSON.stringify({
            success: true,
            rooms: localDB.battleRooms,
            message: 'Battle room cards saved successfully and pushed live!'
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Public: Get Game Config (for bot use): GET /api/config
      if (req.method === 'GET' && reqPath === '/api/config') {
        const localDB = readDB();
        const config = localDB.gameConfig || {};
        // Only expose safe public fields
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
        return res.end(JSON.stringify({
          referralBonus: config.referralBonus || 25,
          minWithdrawal: config.minWithdrawal || 20,
          withdrawalFee: config.withdrawalFee || 3,
          battleEntryFee: config.battleEntryFee || 10,
          battleWinMultiplier: config.battleWinMultiplier || 1.8,
          battleDuration: config.battleDuration || 15,
          maintenanceMode: config.maintenanceMode || false,
          welcomeMessage: config.welcomeMessage || 'Welcome to Turbo Team Battle!',
          announcementText: config.announcementActive ? (config.announcementText || '') : '',
          announcementActive: config.announcementActive || false,
          depositNetwork: config.depositNetwork || 'BSC (BEP-20)',
          minDepositAmount: config.minDepositAmount || 1,
          rooms: localDB.battleRooms || DEFAULT_ARENA_ROOMS
        }));
      }
      // ==================== END ADMIN API ROUTES ====================

      // Fallback API 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API Endpoint not found' }));
    });
    return;
  }

  // ================= STATIC FILE SERVING WITH SECURITY SHIELD =================
  let requestedFile = reqPath === '/' ? 'index.html' : reqPath;


  // Serve app.js directly (latest code with all fixes)

  // Prevent Directory Traversal & normalize path
  const safePath = path.normalize(path.join(__dirname, requestedFile));
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Access Denied: Path traversal blocked' }));
  }

  // Blacklist sensitive internal files & folders
  const baseName = path.basename(safePath).toLowerCase();
  const relPath = path.relative(__dirname, safePath).replace(/\\/g, '/').toLowerCase();
  const isForbidden =
    baseName.startsWith('.') ||
    baseName === 'database.json' ||
    baseName === 'package.json' ||
    baseName === 'package-lock.json' ||
    baseName === 'server.js' ||
    baseName === 'readme.md' ||
    relPath.startsWith('scripts/') ||
    relPath.startsWith('node_modules/') ||
    relPath.startsWith('.git');

  if (isForbidden) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Access Denied: Protected system resource' }));
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File Not Found' }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server File Read Error' }));
      }
    } else {
      let cacheControl = 'no-cache';
      if (['.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.woff2'].includes(ext)) {
        cacheControl = 'public, max-age=604800, stale-while-revalidate=86400';
      } else if (['.css', '.js'].includes(ext)) {
        cacheControl = 'no-cache, must-revalidate';
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
  console.log(`🚀 Turbo Backend + Mini App live on port ${PORT} [Supabase PostgreSQL Connected]`);
});
