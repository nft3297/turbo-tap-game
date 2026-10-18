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

const server = http.createServer(async (req, res) => {
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

  // Lightweight Ping / Health Check for Keep-Alive Monitors
  if (reqPath === '/health' || reqPath === '/ping' || reqPath === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', database: 'supabase_connected', time: new Date().toISOString() }));
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

    // 2. NOWPAYMENTS: GET /api/nowpayments/deposit-address?telegramId=123
    if (req.method === 'GET' && reqPath === '/api/nowpayments/deposit-address') {
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

      // Check if user already has an active deposit waiting in Supabase
      try {
        const { data: activeDep } = await supabase
          .from('deposits')
          .select('*')
          .eq('telegram_id', String(telegramId))
          .eq('status', 'waiting')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeDep && activeDep.pay_address) {
          const createdAt = new Date(activeDep.created_at).getTime();
          // Valid for 24 hours
          if (Date.now() - createdAt < 86400000) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              pay_address: activeDep.pay_address,
              payment_id: activeDep.payment_id,
              currency: 'USDT',
              network: 'BSC (BEP-20)',
              min_amount: 1,
              valid_until: new Date(createdAt + 86400000).toISOString()
            }));
          }
        }
      } catch (e) {
        console.warn('[Supabase] Active deposit lookup warning:', e.message);
      }

      // Generate real BEP-20 address via NOWPayments API
      fetch(`${NOWPAYMENTS.baseUrl}/payment`, {
        method: 'POST',
        headers: {
          'x-api-key': NOWPAYMENTS.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          price_amount: 1,
          price_currency: 'usd',
          pay_currency: NOWPAYMENTS.payCurrency, // 'usdtbsc' strictly BEP-20
          ipn_callback_url: NOWPAYMENTS.ipnUrl,
          order_id: `dep_${telegramId}_${Date.now()}`,
          order_description: `Turbo Tap BEP-20 Deposit user ${telegramId}`
        })
      })
      .then(r => r.json())
      .then(async payment => {
        if (!payment || !payment.pay_address) {
          console.error('[NOWPayments] Create payment failed:', payment);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Could not generate NOWPayments address', details: payment }));
        }

        // Save deposit in Supabase
        await supabase.from('deposits').upsert({
          id: 'dep_' + payment.payment_id,
          payment_id: String(payment.payment_id),
          telegram_id: String(telegramId),
          amount: 1,
          network: 'BSC-BEP20',
          pay_address: payment.pay_address,
          status: 'waiting',
          created_at: new Date().toISOString()
        });

        // Also sync local backup
        const localDB = readDB();
        localDB.users[telegramId] = localDB.users[telegramId] || formatUser(userRow);
        localDB.users[telegramId].nowpaymentsDeposit = {
          payment_id: String(payment.payment_id),
          pay_address: payment.pay_address,
          valid_until: payment.valid_until || new Date(Date.now() + 7 * 86400000).toISOString(),
          created_at: new Date().toISOString()
        };
        writeDB(localDB);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          pay_address: payment.pay_address,
          payment_id: payment.payment_id,
          currency: 'USDT',
          network: 'BSC (BEP-20)',
          min_amount: 1,
          valid_until: payment.valid_until || new Date(Date.now() + 7 * 86400000).toISOString()
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

      if (!paymentId) {
        // Lookup latest waiting deposit for user
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

      fetch(`${NOWPAYMENTS.baseUrl}/payment/${paymentId}`, {
        headers: { 'x-api-key': NOWPAYMENTS.apiKey }
      })
      .then(r => r.json())
      .then(async data => {
        const isPaid = ['finished', 'confirmed', 'partially_paid'].includes(data.payment_status);
        const paidAmount = parseFloat(data.actually_paid || data.outcome_amount || 0);

        if (isPaid && paidAmount > 0) {
          // Check if already finished in Supabase
          const { data: depRecord } = await supabase
            .from('deposits')
            .select('status')
            .eq('payment_id', String(paymentId))
            .maybeSingle();

          let userRow = await getSupabaseUser(telegramId);

          if (depRecord?.status !== 'finished') {
            // Update deposit record to finished in Supabase
            await supabase.from('deposits').upsert({
              id: 'dep_' + paymentId,
              payment_id: String(paymentId),
              telegram_id: String(telegramId),
              amount: paidAmount,
              network: 'BSC-BEP20',
              tx_hash: data.payin_hash || null,
              status: 'finished',
              created_at: new Date().toISOString()
            });

            // Credit directly to Game Wallet in Supabase
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

            console.log(`[NOWPayments Check] Successfully credited $${paidAmount} to user ${telegramId} in Supabase!`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              status: data.payment_status,
              credited: true,
              amount: paidAmount,
              wallet: updatedWallet,
              message: `Deposit of $${paidAmount.toFixed(2)} USDT credited to Game Wallet!`
            }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: data.payment_status,
            credited: true,
            amount: paidAmount,
            wallet: parseFloat(userRow?.wallet || 0),
            message: `Deposit already credited!`
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
    req.on('end', async () => {
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

        let targetTelegramId = null;
        if (orderId && orderId.startsWith('dep_')) {
          const parts = orderId.split('_');
          targetTelegramId = parts[1];
        }

        if (!targetTelegramId && payAddress) {
          const { data: u } = await supabase.from('users').select('telegram_id').eq('bsc_address', payAddress).maybeSingle();
          if (u) targetTelegramId = u.telegram_id;
        }

        const isPaid = ['finished', 'confirmed', 'partially_paid', 'sending'].includes(status);
        if (isPaid && actuallyPaid > 0 && targetTelegramId) {
          const { data: depRecord } = await supabase
            .from('deposits')
            .select('status')
            .eq('payment_id', String(paymentId))
            .maybeSingle();

          if (depRecord?.status !== 'finished') {
            await supabase.from('deposits').upsert({
              id: 'dep_' + paymentId,
              payment_id: String(paymentId),
              telegram_id: String(targetTelegramId),
              amount: actuallyPaid,
              network: 'BSC-BEP20',
              tx_hash: data.payin_hash || null,
              status: 'finished',
              created_at: new Date().toISOString()
            });

            const userRow = await getSupabaseUser(targetTelegramId);
            const newBal = parseFloat(userRow?.wallet || 0) + actuallyPaid;
            await supabase.from('users').update({
              wallet: newBal,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(targetTelegramId));

            console.log(`[NOWPayments IPN] Auto-credited $${actuallyPaid} USDT to Game Wallet of user ${targetTelegramId} in Supabase!`);
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

        // Check if user already exists in Supabase
        const existing = await getSupabaseUser(telegramId);
        if (existing) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, user: formatUser(existing), message: 'User already exists' }));
        }

        const bscAddress = generateBscAddress(telegramId);
        const newUserRow = {
          telegram_id: String(telegramId),
          username: username.trim(),
          email: email.trim().toLowerCase(),
          bsc_address: bscAddress,
          wallet: 0.00,
          profit_wallet: 0.00,
          withdraw_wallet: 0.00,
          ref_wallet: 0.00,
          friends_count: 0,
          total_ref_earned: 0.00,
          referred_by: referrerId ? String(referrerId) : null,
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

        // If joined via a valid Referrer: Award +$25 to the Referrer in Supabase!
        if (referrerId) {
          const referrer = await getSupabaseUser(referrerId);
          if (referrer) {
            await supabase.from('users').update({
              ref_wallet: parseFloat(referrer.ref_wallet || 0) + 25.00,
              total_ref_earned: parseFloat(referrer.total_ref_earned || 0) + 25.00,
              friends_count: parseInt(referrer.friends_count || 0) + 1,
              updated_at: new Date().toISOString()
            }).eq('telegram_id', String(referrerId));
          }
        }

        // Sync local DB backup
        const localDB = readDB();
        localDB.users[telegramId] = formatUser(createdUser || newUserRow);
        writeDB(localDB);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, user: formatUser(createdUser || newUserRow) }));
      }

      // 3. Update Balance / Win / Entry Fee: POST /api/wallet/update
      if (req.method === 'POST' && reqPath === '/api/wallet/update') {
        const { telegramId, amount, type } = data;
        let userRow = await getSupabaseUser(telegramId);

        if (!userRow) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const delta = parseFloat(amount);
        let updateField = 'wallet';
        let newVal = 0;

        if (type === 'ref') {
          updateField = 'ref_wallet';
          newVal = Math.max(0, parseFloat(userRow.ref_wallet || 0) + delta);
        } else if (type === 'profit') {
          updateField = 'profit_wallet';
          newVal = Math.max(0, parseFloat(userRow.profit_wallet || 0) + delta);
        } else if (type === 'withdraw') {
          updateField = 'withdraw_wallet';
          newVal = Math.max(0, parseFloat(userRow.withdraw_wallet || 0) + delta);
        } else {
          updateField = 'wallet';
          newVal = Math.max(0, parseFloat(userRow.wallet || 0) + delta);
        }

        const { data: updatedUser, error: updErr } = await supabase
          .from('users')
          .update({
            [updateField]: newVal,
            updated_at: new Date().toISOString()
          })
          .eq('telegram_id', String(telegramId))
          .select()
          .single();

        if (updErr) {
          console.error('[Supabase] Wallet update error:', updErr);
        }

        // Sync local DB backup
        const localDB = readDB();
        if (localDB.users[telegramId]) {
          localDB.users[telegramId] = formatUser(updatedUser || userRow);
          writeDB(localDB);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, user: formatUser(updatedUser || userRow) }));
      }

      // 4. Request Withdrawal: POST /api/withdraw
      if (req.method === 'POST' && reqPath === '/api/withdraw') {
        const { telegramId, address, amount, source } = data;
        let userRow = await getSupabaseUser(telegramId);

        if (!userRow) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'User not found' }));
        }

        const amt = parseFloat(amount);
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
