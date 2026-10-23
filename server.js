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

      // Tier 1: Check if deposit is already marked finished in Supabase
      try {
        let depRecord = null;
        if (paymentId && !paymentId.startsWith('local_')) {
          const { data } = await supabase
            .from('deposits')
            .select('*')
            .eq('payment_id', String(paymentId))
            .maybeSingle();
          depRecord = data;
        }

        if (!depRecord || depRecord.status !== 'finished') {
          const { data } = await supabase
            .from('deposits')
            .select('*')
            .eq('telegram_id', String(telegramId))
            .eq('status', 'finished')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data) depRecord = data;
        }

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

              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                status: 'completed',
                credited: true,
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

              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                status: 'completed',
                credited: true,
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

      // Admin Auth Check: POST /api/admin/auth
      if (req.method === 'POST' && reqPath === '/api/admin/auth') {
        const { telegramId } = data;
        if (String(telegramId) !== ADMIN_TELEGRAM_ID) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Access Denied. Admin only.' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, admin: true, message: 'Welcome, Admin!' }));
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
            const walletField = updated.wallet_type === 'referral' ? 'ref_wallet' : updated.wallet_type === 'profit' ? 'profit_wallet' : 'wallet';
            const userRow = await getSupabaseUser(updated.telegram_id);
            if (userRow) {
              const refundAmt = parseFloat(updated.amount || 0);
              await supabase.from('users').update({ [walletField]: parseFloat(userRow[walletField.replace('_wallet', '').replace('ref', 'ref')] || userRow[walletField] || 0) + refundAmt, updated_at: new Date().toISOString() }).eq('telegram_id', String(updated.telegram_id));
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
          writeDB(localDB);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, config: localDB.gameConfig, message: `Config '${configKey}' updated!` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      // Admin Broadcast Message (stored for frontend to pick up): POST /api/admin/broadcast
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
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, broadcast, message: 'Broadcast sent to all users!' }));
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

      // Public: Get Game Config (for bot use): GET /api/config
      if (req.method === 'GET' && reqPath === '/api/config') {
        const localDB = readDB();
        const config = localDB.gameConfig || {};
        // Only expose safe public fields
        res.writeHead(200, { 'Content-Type': 'application/json' });
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
          minDepositAmount: config.minDepositAmount || 1
        }));
      }

      // ==================== ADMIN PANEL API ROUTES ====================
      // Admin Telegram ID (ONLY this ID can access admin panel)
      const ADMIN_ID = '8291758870';

      // Helper: verify admin
      function isAdmin(body) {
        return String(body.telegramId || body.adminId || '') === ADMIN_ID;
      }

      // POST /api/admin/auth — Verify admin identity
      if (req.method === 'POST' && reqPath === '/api/admin/auth') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (isAdmin(body)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: 'Admin verified', adminId: ADMIN_ID }));
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Access Denied. Unauthorized Telegram ID.' }));
      }

      // POST /api/admin/stats — Dashboard statistics
      if (req.method === 'POST' && reqPath === '/api/admin/stats') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { data: users } = await supabase.from('users').select('telegram_id,username,wallet,profit_wallet,ref_wallet,created_at');
          const { data: withdrawals } = await supabase.from('withdrawals').select('amount,net_amount,status');
          const { data: deposits } = await supabase.from('deposits').select('amount,status');
          const { data: recentUsers } = await supabase.from('users').select('telegram_id,username,wallet,created_at').order('created_at',{ascending:false}).limit(10);
          const { data: cfgRow } = await supabase.from('config').select('*').eq('id', 1).maybeSingle();
          const totalUsers = users?.length || 0;
          const totalDeposited = (deposits||[]).filter(d=>d.status==='finished').reduce((s,d)=>s+(+d.amount||0),0).toFixed(2);
          const pendingWD = (withdrawals||[]).filter(w=>w.status==='pending');
          const pendingWithdrawalsCount = pendingWD.length;
          const pendingWithdrawalsAmount = pendingWD.reduce((s,w)=>s+(+w.amount||0),0).toFixed(2);
          const totalGameWallet = (users||[]).reduce((s,u)=>s+(+u.wallet||0),0).toFixed(2);
          const totalProfitWallet = (users||[]).reduce((s,u)=>s+(+u.profit_wallet||0),0).toFixed(2);
          const totalRefWallet = (users||[]).reduce((s,u)=>s+(+u.ref_wallet||0),0).toFixed(2);
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, stats:{ totalUsers, totalDeposited, pendingWithdrawalsCount, pendingWithdrawalsAmount, totalGameWallet, totalProfitWallet, totalRefWallet, recentUsers: recentUsers||[] }, gameConfig: cfgRow?.data || {} }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
      }

      // POST /api/admin/users — List/search users with pagination
      if (req.method === 'POST' && reqPath === '/api/admin/users') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const page = Math.max(1, parseInt(body.page)||1);
          const limit = Math.min(100, parseInt(body.limit)||20);
          const search = (body.search||'').trim();
          const offset = (page-1)*limit;
          let query = supabase.from('users').select('*', {count:'exact'});
          if (search) query = query.or(`telegram_id.eq.${search},username.ilike.%${search}%,email.ilike.%${search}%`);
          const { data, count, error } = await query.order('created_at',{ascending:false}).range(offset, offset+limit-1);
          if (error) throw error;
          const users = (data||[]).map(formatUser);
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, users, total: count||0, page, limit }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
      }

      // POST /api/admin/user/update — Update any user field
      if (req.method === 'POST' && reqPath === '/api/admin/user/update') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { targetTelegramId, field, value } = body;
          if (!targetTelegramId || !field) throw new Error('targetTelegramId and field required');
          const fieldMap = { username:'username', email:'email', wallet:'wallet', profitWallet:'profit_wallet', refWallet:'ref_wallet', withdrawWallet:'withdraw_wallet', bscAddress:'bsc_address', banned:'banned' };
          const dbField = fieldMap[field];
          if (!dbField) throw new Error('Invalid field: '+field);
          const { error } = await supabase.from('users').update({ [dbField]: value, updated_at: new Date().toISOString() }).eq('telegram_id', targetTelegramId);
          if (error) throw error;
          // Sync to local DB
          const db = readDB();
          if (db.users[targetTelegramId]) { db.users[targetTelegramId][field] = value; writeDB(db); }
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, message:`User ${targetTelegramId} ${field} updated` }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:false,error:e.message})); }
      }

      // POST /api/admin/user/ban — Ban or unban user
      if (req.method === 'POST' && reqPath === '/api/admin/user/ban') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { targetTelegramId, ban } = body;
          if (!targetTelegramId) throw new Error('targetTelegramId required');
          const { error } = await supabase.from('users').update({ banned: !!ban, updated_at: new Date().toISOString() }).eq('telegram_id', targetTelegramId);
          if (error) throw error;
          const db = readDB();
          if (db.users[targetTelegramId]) { db.users[targetTelegramId].banned = !!ban; writeDB(db); }
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, message: `User ${targetTelegramId} ${ban?'banned':'unbanned'} successfully` }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:false,error:e.message})); }
      }

      // POST /api/admin/user/delete — Permanently delete user
      if (req.method === 'POST' && reqPath === '/api/admin/user/delete') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { targetTelegramId } = body;
          if (!targetTelegramId) throw new Error('targetTelegramId required');
          await supabase.from('users').delete().eq('telegram_id', targetTelegramId);
          const db = readDB();
          delete db.users[targetTelegramId];
          writeDB(db);
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, message:`User ${targetTelegramId} permanently deleted` }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:false,error:e.message})); }
      }

      // POST /api/admin/withdrawals — Get all withdrawals
      if (req.method === 'POST' && reqPath === '/api/admin/withdrawals') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          let query = supabase.from('withdrawals').select('*').order('created_at',{ascending:false}).limit(200);
          if (body.status) query = query.eq('status', body.status);
          const { data, error } = await query;
          if (error) throw error;
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, withdrawals: data||[] }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
      }

      // POST /api/admin/withdrawal/update — Approve or reject withdrawal
      if (req.method === 'POST' && reqPath === '/api/admin/withdrawal/update') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { withdrawalId, status, txHash } = body;
          if (!withdrawalId || !status) throw new Error('withdrawalId and status required');
          const updates = { status, updated_at: new Date().toISOString() };
          if (txHash) updates.tx_hash = txHash;
          if (status === 'completed') updates.completed_at = new Date().toISOString();
          // If rejected, refund user
          if (status === 'rejected') {
            const { data: wd } = await supabase.from('withdrawals').select('*').eq('id', withdrawalId).maybeSingle();
            if (wd) {
              const { data: usr } = await supabase.from('users').select('*').eq('telegram_id', wd.telegram_id).maybeSingle();
              if (usr) {
                const walletField = wd.wallet_type === 'profit' ? 'profit_wallet' : wd.wallet_type === 'ref' ? 'ref_wallet' : 'withdraw_wallet';
                const curBal = parseFloat(usr[walletField] || 0);
                await supabase.from('users').update({ [walletField]: curBal + parseFloat(wd.amount||0), updated_at: new Date().toISOString() }).eq('telegram_id', wd.telegram_id);
              }
            }
          }
          const { error } = await supabase.from('withdrawals').update(updates).eq('id', withdrawalId);
          if (error) throw error;
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, message:`Withdrawal ${status}${status==='rejected'?' + refunded to user':''}` }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:false,error:e.message})); }
      }

      // POST /api/admin/deposits — Get deposit history
      if (req.method === 'POST' && reqPath === '/api/admin/deposits') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { data, error } = await supabase.from('deposits').select('*').order('created_at',{ascending:false}).limit(200);
          if (error) throw error;
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, deposits: data||[] }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
      }

      // POST /api/admin/config — Get all game/bot/wallet config
      if (req.method === 'POST' && reqPath === '/api/admin/config') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { data: cfgRow } = await supabase.from('config').select('*').eq('id',1).maybeSingle();
          const config = cfgRow?.data || {};
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, config }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
      }

      // POST /api/admin/config/update — Update a config key
      if (req.method === 'POST' && reqPath === '/api/admin/config/update') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { configKey, configValue } = body;
          if (!configKey) throw new Error('configKey required');
          // Get existing config
          const { data: cfgRow } = await supabase.from('config').select('*').eq('id',1).maybeSingle();
          const config = cfgRow?.data || {};
          config[configKey] = configValue;
          if (cfgRow) {
            await supabase.from('config').update({ data: config, updated_at: new Date().toISOString() }).eq('id',1);
          } else {
            await supabase.from('config').insert({ id:1, data: config, created_at: new Date().toISOString() });
          }
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, message:`Config "${configKey}" updated to "${configValue}"`, config }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:false,error:e.message})); }
      }

      // POST /api/admin/broadcast — Set announcement broadcast
      if (req.method === 'POST' && reqPath === '/api/admin/broadcast') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { message, title, type } = body;
          if (!message) throw new Error('message required');
          const { data: cfgRow } = await supabase.from('config').select('*').eq('id',1).maybeSingle();
          const config = cfgRow?.data || {};
          config.announcementText = (title ? `[${title}] ` : '') + message;
          config.announcementActive = true;
          config.announcementType = type || 'info';
          config.announcementTimestamp = new Date().toISOString();
          if (cfgRow) {
            await supabase.from('config').update({ data: config, updated_at: new Date().toISOString() }).eq('id',1);
          } else {
            await supabase.from('config').insert({ id:1, data: config, created_at: new Date().toISOString() });
          }
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, message:'Broadcast set successfully. All users will see it live.' }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:false,error:e.message})); }
      }

      // POST /api/admin/leaderboard — Top 50 players by profit wallet
      if (req.method === 'POST' && reqPath === '/api/admin/leaderboard') {
        let body = {};
        try { body = await parseBody(req); } catch(e) {}
        if (!isAdmin(body)) { res.writeHead(403,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Unauthorized'})); }
        try {
          const { data, error } = await supabase.from('users').select('telegram_id,username,wallet,profit_wallet,ref_wallet,friends_count,total_ref_earned').order('profit_wallet',{ascending:false}).limit(50);
          if (error) throw error;
          const leaderboard = (data||[]).map(formatUser);
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success:true, leaderboard }));
        } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
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
