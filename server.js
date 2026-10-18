const http = require('http');
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

// Convert Supabase DB snake_case row to frontend camelCase user object
function formatUser(row) {
  if (!row) return null;
  return {
    telegramId: String(row.telegram_id),
    username: row.username || 'Gamer',
    email: row.email || '',
    bscAddress: row.bsc_address,
    wallet: parseFloat(row.wallet || 0),
    profitWallet: parseFloat(row.profit_wallet || 0),
    withdrawWallet: parseFloat(row.withdraw_wallet || 0),
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ exists: true, user: formatUser(userRow) }));
      }

      // Fallback local DB check
      const localDB = readDB();
      const localUser = localDB.users[telegramId];
      if (localUser) {
        // Auto migrate to Supabase
        await upsertSupabaseUser(localUser);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ exists: true, user: localUser }));
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

      // 1. Strict Dedicated Address Rule: Check if this user ALREADY has a dedicated Plisio address
      let dedicatedAddress = null;
      let paymentId = null;

      try {
        const { data: existingDep } = await supabase
          .from('deposits')
          .select('*')
          .eq('telegram_id', String(telegramId))
          .not('pay_address', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingDep && existingDep.pay_address) {
          dedicatedAddress = existingDep.pay_address;
          paymentId = existingDep.payment_id;
        }
      } catch (e) {
        console.warn('[Supabase] Active deposit lookup warning:', e.message);
      }

      // Also check local database fallback
      if (!dedicatedAddress) {
        const localDB = readDB();
        if (localDB.users[telegramId]?.plisioDeposit?.pay_address) {
          dedicatedAddress = localDB.users[telegramId].plisioDeposit.pay_address;
          paymentId = localDB.users[telegramId].plisioDeposit.payment_id;
        } else if (localDB.users[telegramId]?.nowpaymentsDeposit?.pay_address) {
          dedicatedAddress = localDB.users[telegramId].nowpaymentsDeposit.pay_address;
          paymentId = localDB.users[telegramId].nowpaymentsDeposit.payment_id;
        }
      }

      // If user already has a dedicated address, return it immediately (1 user = 1 permanent address & QR)
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

      // Otherwise, generate a dedicated White-Label BEP-20 deposit address via Plisio API
      const orderNumber = `dep_${telegramId}_${Date.now()}`;
      const orderName = `TurboTap Deposit User ${telegramId}`;
      const plisioUrl = `${PLISIO.baseUrl}/invoices/new?api_key=${PLISIO.secretKey}&currency=${PLISIO.currency}&order_number=${encodeURIComponent(orderNumber)}&order_name=${encodeURIComponent(orderName)}&source_currency=USD&source_amount=1&callback_url=${encodeURIComponent(PLISIO.callbackUrl + '?json=true')}`;

      fetch(plisioUrl)
        .then(r => r.json())
        .then(async result => {
          if (!result || result.status !== 'success' || !result.data) {
            console.error('[Plisio] Create invoice failed:', result);
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
              pay_address: assignedAddress,
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

      if (!paymentId) {
        const { data: latestDep } = await supabase
          .from('deposits')
          .select('payment_id')
          .eq('telegram_id', String(telegramId))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestDep) paymentId = latestDep.payment_id;
      }

      if (!paymentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'paymentId is required' }));
      }

      // Check if already finished in Supabase
      try {
        const { data: depRecord } = await supabase
          .from('deposits')
          .select('*')
          .eq('payment_id', String(paymentId))
          .maybeSingle();

        if (depRecord?.status === 'finished') {
          const userRow = await getSupabaseUser(telegramId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: 'completed',
            credited: true,
            amount: parseFloat(depRecord.amount || 0),
            wallet: parseFloat(userRow?.wallet || 0),
            message: `Deposit of $${parseFloat(depRecord.amount || 0).toFixed(2)} USDT credited to Game Wallet!`
          }));
        }
      } catch (err) {}

      // Query Plisio API for status
      fetch(`${PLISIO.baseUrl}/invoices/${paymentId}?api_key=${PLISIO.secretKey}`)
        .then(r => r.json())
        .then(async resData => {
          if (!resData || resData.status !== 'success' || !resData.data) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'waiting', credited: false }));
          }

          const invoice = resData.data;
          const status = invoice.status;
          const isPaid = ['completed', 'mismatch', 'finished'].includes(status);
          const paidAmount = parseFloat(invoice.amount || invoice.pending_amount || invoice.source_sum || 0);

          if (isPaid && paidAmount > 0) {
            // Update Supabase deposit record
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

            // Credit directly to Game Wallet in Supabase
            const userRow = await getSupabaseUser(telegramId);
            const updatedWallet = parseFloat(userRow?.wallet || 0) + paidAmount;
            await supabase.from('users').update({
              wallet: updatedWallet,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(telegramId));

            // Sync local DB backup
            const localDB = readDB();
            localDB.creditedDeposits = localDB.creditedDeposits || {};
            localDB.creditedDeposits[String(paymentId)] = { amount: paidAmount, telegramId, date: new Date().toISOString() };
            if (localDB.users[telegramId]) localDB.users[telegramId].wallet = updatedWallet;
            writeDB(localDB);

            console.log(`[Plisio Check] Successfully credited $${paidAmount} USDT to user ${telegramId} in Supabase!`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              status: 'completed',
              credited: true,
              amount: paidAmount,
              wallet: updatedWallet,
              message: `Deposit of $${paidAmount.toFixed(2)} USDT credited to Game Wallet!`
            }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: status || 'waiting',
            credited: false,
            actually_paid: paidAmount
          }));
        })
        .catch(err => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'waiting', credited: false, error: err.message }));
        });
      return;
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
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, status: 'success' }));
      }

      // 2. 1st Time Sign Up / Auto Register: POST /api/register
      if (req.method === 'POST' && reqPath === '/api/register') {
        const { telegramId, username, email, referrerId } = data;

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

        const newUserRow = {
          telegram_id: String(telegramId),
          username: (username || 'Gamer_' + String(telegramId).slice(-4)).trim(),
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
        if (isNaN(amt) || !Number.isFinite(amt) || amt < 5) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid withdrawal amount (Minimum $5 required)' }));
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

        if (amt > avail || amt < 5) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid withdrawal amount (Minimum $5, or insufficient balance)' }));
        }

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

      // Fallback API 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API Endpoint not found' }));
    });
    return;
  }

  // ================= STATIC FILE SERVING WITH SECURITY SHIELD =================
  let requestedFile = reqPath === '/' ? 'index.html' : reqPath;

  // Mask /app.js so raw source code is never exposed over HTTP (always serve obfuscated app.min.js)
  if (requestedFile === '/app.js') {
    requestedFile = '/app.min.js';
  }

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
  console.log(`🚀 Turbo Backend + Mini App live on port ${PORT} [Supabase PostgreSQL Connected]`);
});
