// ============================================================
// TURBO TEAM BATTLE - GAME ENGINE, DUAL WALLETS & BACKEND SYNC
// STRICT NETWORK: BINANCE SMART CHAIN (BSC BEP-20)
// ============================================================

// 0. BASIC PROTECTION (No debugger trap - it freezes Telegram WebView)
(function installBasicProtection() {
  'use strict';
  
  // A. Block Right-Click Context Menu
  window.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
  }, { capture: true });

  // B. Anti-Dragging of Protected Media
  window.addEventListener('dragstart', function(e) {
    if (e.target && e.target.nodeName === 'IMG') {
      e.preventDefault();
    }
  });

  // C. Catch and show JS errors (helps debug in production)
  window.addEventListener('error', function(event) {
    var msg = event.message || 'Unknown error';
    var src = (event.filename || '').split('/').pop();
    var line = event.lineno || '?';
    console.error('[APP ERROR]', msg, 'at', src + ':' + line);
    // Show toast if available
    try {
      var toast = document.getElementById('appToast');
      if (toast && msg) {
        toast.textContent = '⚠️ ' + msg.substring(0, 60);
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 4000);
      }
    } catch(e) {}
  });

  // D. Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    console.error('[PROMISE ERROR]', event.reason);
  });
})();

// 1. Initialize Telegram WebApp SDK
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
}

// 1b. Parse tg.initData string as fallback to get user info
function parseTgInitData() {
  try {
    const raw = tg?.initData || '';
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const userStr = params.get('user');
    if (userStr) return JSON.parse(decodeURIComponent(userStr));
  } catch(e) {}
  return null;
}
const tgUser = tg?.initDataUnsafe?.user || parseTgInitData() || {};

// 2. Deterministic BSC BEP-20 (EVM) Wallet Address Generator from User ID
function generateBscAddress(userId) {
  const hex1 = ((userId * 2654435761) >>> 0).toString(16).padStart(8, '7');
  const hex2 = ((userId * 1597334677) >>> 0).toString(16).padStart(8, 'a');
  const hex3 = ((userId * 3829104711) >>> 0).toString(16).padStart(8, 'c');
  const hex4 = ((userId * 2147483647) >>> 0).toString(16).padStart(8, 'e');
  const hex5 = ((userId * 1234567891) >>> 0).toString(16).padStart(8, 'f');
  return `0x${hex1}${hex2}${hex3}${hex4}${hex5}`;
}

// 3. User Identity & State Management
const urlParams = new URLSearchParams(window.location.search);
const rawStartParam = tg?.initDataUnsafe?.start_param || 
                      urlParams.get('startapp') || 
                      urlParams.get('tgWebAppStartParam') || 
                      urlParams.get('ref') || 
                      urlParams.get('start') || 
                      localStorage.getItem('turbo_ref_id') || '';

if (rawStartParam) {
  const cleanRef = rawStartParam.replace('ref_', '').trim();
  if (cleanRef) localStorage.setItem('turbo_ref_id', cleanRef);
}

const rawUserId = tgUser?.id 
  ? parseInt(tgUser.id)
  : (parseInt(localStorage.getItem('turbo_uid') || '0') || Math.floor(100000 + Math.random() * 900000));
localStorage.setItem('turbo_uid', String(rawUserId));

const userBscAddress = generateBscAddress(rawUserId);

// Clean migration: Zero starting balance for game, profit, withdraw and ref wallets
if (localStorage.getItem('turbo_wallet_v4_zero') !== 'true') {
  localStorage.setItem('turbo_wallet_v4_zero', 'true');
  localStorage.setItem('turbo_wallet', '0.00');
  localStorage.setItem('turbo_profit_wallet', '0.00');
  localStorage.setItem('turbo_withdraw_wallet', '0.00');
  localStorage.setItem('turbo_ref_wallet', '0.00');
}

const STATE = {
  user: {
    id: rawUserId,
    bscAddress: userBscAddress,
    // Priority: Telegram live data → localStorage cache → fallback
    firstName: tgUser?.first_name 
               || localStorage.getItem('turbo_firstName') 
               || '',
    username: tgUser?.username 
              ? '@' + tgUser.username 
              : (localStorage.getItem('turbo_username') || ''),
    email: '',
    photoUrl: tgUser?.photo_url 
              || localStorage.getItem('turbo_photoUrl') 
              || `https://api.dicebear.com/7.x/bottts/svg?seed=${rawUserId}`,
    startParam: rawStartParam
  },
  isRegistered: false,
  wallet: parseFloat(localStorage.getItem('turbo_wallet') || '0.00'), // Game Wallet: 0.00 (credits on deposit)
  profitWallet: parseFloat(localStorage.getItem('turbo_profit_wallet') || '0.00'), // Profit Wallet: 0.00 (credits on battle wins)
  withdrawWallet: parseFloat(localStorage.getItem('turbo_withdraw_wallet') || '0.00'), // Withdrawal Wallet
  refWallet: parseFloat(localStorage.getItem('turbo_ref_wallet') || '0.00'), // Referral Wallet: 0.00
  friendsCount: parseInt(localStorage.getItem('turbo_friends_count') || '0'),
  totalRefEarned: parseFloat(localStorage.getItem('turbo_total_ref_earned') || '0.00'),
  transactions: JSON.parse(localStorage.getItem('turbo_txs') || '[]'),

  withdrawSource: 'profit',
  qrCodeInstance: null,

  soundEnabled: localStorage.getItem('turbo_sound') !== 'false',
  hapticEnabled: localStorage.getItem('turbo_haptic') !== 'false',
  fastImgEnabled: localStorage.getItem('turbo_fast_img') !== 'false',
  effectsEnabled: localStorage.getItem('turbo_effects') !== 'false',

  currentRoom: null,
  matchmakingInterval: null,
  searchTimerSeconds: 0,
  playersInRoom: [],
  battleTimer: 15,
  battleTimerInterval: null,
  opponentsInterval: null,
  userTaps: 0,
  userDollarScore: 0,
  activeGameMode: 'tap',
  crashInterval: null,
  royaleSpawnInterval: null,
  boostMeter: 0,
  isBoostActive: false,
  boostTimeout: null
};

// 4. Audio Synthesizer
class SoundFX {
  constructor() { this.ctx = null; }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  playTap() {
    if (!STATE.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }
  playBoostTap() {
    if (!STATE.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(250, now + 0.12);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }
  playMatchFound() {
    if (!STATE.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.2, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.25);
    });
  }
  playCountdownBeep() {
    if (!STATE.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }
  playVictory() {
    if (!STATE.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.3, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.5);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.55);
    });
  }
}

const sounds = new SoundFX();

function triggerHaptic(type = 'light') {
  if (STATE.hapticEnabled === false) return;
  if (tg?.HapticFeedback) {
    if (type === 'impact') tg.HapticFeedback.impactOccurred('medium');
    else if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
    else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
    else if (type === 'warning') tg.HapticFeedback.notificationOccurred('warning');
    else tg.HapticFeedback.impactOccurred('light');
  } else if (navigator.vibrate) {
    navigator.vibrate(type === 'heavy' ? 40 : 15);
  }
}

// 5. Global Realistic Opponents Generator (World Countries + Authentic Indian Names)
const GLOBAL_OPPONENTS_POOL = [
  // 🇮🇳 INDIA (Authentic Indian Names)
  { flag: '🇮🇳', country: 'IN', name: 'Aarav_Kumar' },
  { flag: '🇮🇳', country: 'IN', name: 'Rohit_Sharma' },
  { flag: '🇮🇳', country: 'IN', name: 'Priya_Verma' },
  { flag: '🇮🇳', country: 'IN', name: 'Vikram_Patel' },
  { flag: '🇮🇳', country: 'IN', name: 'Raj_Malhotra' },
  { flag: '🇮🇳', country: 'IN', name: 'Ananya_Singh' },
  { flag: '🇮🇳', country: 'IN', name: 'Arjun_Reddy' },
  { flag: '🇮🇳', country: 'IN', name: 'Kavita_Nair' },
  { flag: '🇮🇳', country: 'IN', name: 'Dev_Choudhary' },
  { flag: '🇮🇳', country: 'IN', name: 'Sneha_Gupta' },
  { flag: '🇮🇳', country: 'IN', name: 'Aditya_Joshi' },
  { flag: '🇮🇳', country: 'IN', name: 'Pooja_Mishra' },
  { flag: '🇮🇳', country: 'IN', name: 'Kabir_Verma' },
  { flag: '🇮🇳', country: 'IN', name: 'Sanjay_Yadav' },
  { flag: '🇮🇳', country: 'IN', name: 'Deepak_Patil' },
  { flag: '🇮🇳', country: 'IN', name: 'Rohan_Bose' },

  // 🇺🇸 USA
  { flag: '🇺🇸', country: 'US', name: 'Alex_NYC' },
  { flag: '🇺🇸', country: 'US', name: 'Jake_Texas' },
  { flag: '🇺🇸', country: 'US', name: 'Mason_Crypto' },
  { flag: '🇺🇸', country: 'US', name: 'Emily_Vegas' },
  { flag: '🇺🇸', country: 'US', name: 'Hunter_USA' },
  { flag: '🇺🇸', country: 'US', name: 'Brad_Miami' },

  // 🇷🇺 RUSSIA
  { flag: '🇷🇺', country: 'RU', name: 'Ivan_Moscow' },
  { flag: '🇷🇺', country: 'RU', name: 'Dmitry_Rus' },
  { flag: '🇷🇺', country: 'RU', name: 'Nikita_Cyber' },
  { flag: '🇷🇺', country: 'RU', name: 'Elena_Vostok' },
  { flag: '🇷🇺', country: 'RU', name: 'Sergei_Pro' },

  // 🇬🇧 UK
  { flag: '🇬🇧', country: 'GB', name: 'Oliver_London' },
  { flag: '🇬🇧', country: 'GB', name: 'Harry_UK' },
  { flag: '🇬🇧', country: 'GB', name: 'George_Fintech' },
  { flag: '🇬🇧', country: 'GB', name: 'Chloe_Brit' },

  // 🇦🇪 UAE / DUBAI
  { flag: '🇦🇪', country: 'AE', name: 'Zaid_Dubai' },
  { flag: '🇦🇪', country: 'AE', name: 'Hamdan_UAE' },
  { flag: '🇦🇪', country: 'AE', name: 'Tariq_Crypto' },
  { flag: '🇦🇪', country: 'AE', name: 'Rashid_Gold' },

  // 🇧🇷 BRAZIL
  { flag: '🇧🇷', country: 'BR', name: 'Lucas_Rio' },
  { flag: '🇧🇷', country: 'BR', name: 'Mateo_Brasil' },
  { flag: '🇧🇷', country: 'BR', name: 'Thiago_Santos' },

  // 🇩🇪 GERMANY
  { flag: '🇩🇪', country: 'DE', name: 'Felix_Berlin' },
  { flag: '🇩🇪', country: 'DE', name: 'Max_Munich' },
  { flag: '🇩🇪', country: 'DE', name: 'Lukas_Crypto' },

  // 🇫🇷 FRANCE
  { flag: '🇫🇷', country: 'FR', name: 'Antoine_Paris' },
  { flag: '🇫🇷', country: 'FR', name: 'Julien_Crypto' },

  // 🇯🇵 JAPAN
  { flag: '🇯🇵', country: 'JP', name: 'Kenji_Tokyo' },
  { flag: '🇯🇵', country: 'JP', name: 'Ryota_Crypto' },
  { flag: '🇯🇵', country: 'JP', name: 'Hana_Nippon' },

  // 🇹🇷 TURKEY
  { flag: '🇹🇷', country: 'TR', name: 'Emre_Istanbul' },
  { flag: '🇹🇷', country: 'TR', name: 'Burak_Trader' },

  // 🇳🇬 NIGERIA
  { flag: '🇳🇬', country: 'NG', name: 'Chidi_Lagos' },
  { flag: '🇳🇬', country: 'NG', name: 'Emeka_Cash' },

  // 🇨🇦 CANADA
  { flag: '🇨🇦', country: 'CA', name: 'Liam_Toronto' },

  // 🇦🇺 AUSTRALIA
  { flag: '🇦🇺', country: 'AU', name: 'Jack_Sydney' },

  // 🇸🇬 SINGAPORE
  { flag: '🇸🇬', country: 'SG', name: 'Darren_SG' }
];

function generateOpponent(index) {
  const bot = GLOBAL_OPPONENTS_POOL[Math.floor(Math.random() * GLOBAL_OPPONENTS_POOL.length)];
  const tagNum = Math.floor(10 + Math.random() * 89);
  const fullName = `${bot.flag} @${bot.name}_${tagNum}`;
  const seed = bot.name.replace(/[^a-zA-Z0-9]/g, '') + tagNum;
  return {
    id: 'oppo_' + index + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    name: fullName,
    flag: bot.flag,
    country: bot.country,
    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`,
    score: 0,
    speed: 3 + Math.random() * 4
  };
}

// 6. Navigation
function showScreen(screenId) {
  document.querySelectorAll('.view-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateTo(screenId) {
  triggerHaptic('light');
  showScreen(screenId);
  document.querySelectorAll('.bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
  if (screenId === 'screenLobby') {
    document.getElementById('navArenaBtn')?.classList.add('active');
    if (typeof loadDynamicRooms === 'function') loadDynamicRooms();
  }
  else if (screenId === 'screenReferral') document.getElementById('navReferralBtn')?.classList.add('active');
  else if (screenId === 'screenWallet') document.getElementById('navWalletBtn')?.classList.add('active');
}

// 7. Initialize User and Backend Authentication
async function initApp() {
  const cleanRef = (STATE.user.startParam || localStorage.getItem('turbo_ref_id') || '').replace('ref_', '').trim();
  const validReferrer = (cleanRef && cleanRef !== String(STATE.user.id)) ? cleanRef : null;

  try {
    const res = await fetch(`/api/user?telegramId=${STATE.user.id}`);
    const data = await res.json();

    if (data.exists && data.user) {
      // User already signed up previously!
      STATE.isRegistered = true;
      // Update username/firstName from DB if available
      if (data.user.username) {
        STATE.user.username = data.user.username.startsWith('@') ? data.user.username : '@' + data.user.username;
        localStorage.setItem('turbo_username', STATE.user.username);
      }
      if (data.user.firstName || data.user.first_name) {
        STATE.user.firstName = data.user.firstName || data.user.first_name;
        localStorage.setItem('turbo_firstName', STATE.user.firstName);
      }
      STATE.user.email = data.user.email || STATE.user.email;
      STATE.user.bscAddress = data.user.bscAddress || STATE.user.bscAddress;
      STATE.wallet = parseFloat(data.user.wallet || 0);
      STATE.profitWallet = parseFloat(data.user.profitWallet || 0);
      STATE.withdrawWallet = parseFloat(data.user.withdrawWallet || 0);
      STATE.refWallet = parseFloat(data.user.refWallet || 0);
      STATE.friendsCount = data.user.friendsCount || 0;
      STATE.totalRefEarned = parseFloat(data.user.totalRefEarned || 0);
      localStorage.setItem(`turbo_reg_${STATE.user.id}`, 'true');

      // Seed latest deposit ID on initial load so past historical deposits never pop up on launch/refresh
      if (data.latestDeposit && data.latestDeposit.id) {
        const lastSeen = localStorage.getItem('turbo_last_seen_deposit_id');
        if (!lastSeen) {
          localStorage.setItem('turbo_last_seen_deposit_id', data.latestDeposit.id);
        }
      }

      // If user had no referrer yet, but opened via referral link now, link and credit bonus!
      if (!data.user.referredBy && validReferrer) {
        try {
          const linkRes = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              telegramId: STATE.user.id,
              username: STATE.user.username,
              email: STATE.user.email,
              referrerId: validReferrer
            })
          });
          const linkData = await linkRes.json();
          if (linkData.success && linkData.user) {
            STATE.refWallet = parseFloat(linkData.user.refWallet || 0);
            STATE.friendsCount = linkData.user.friendsCount || 0;
            STATE.totalRefEarned = parseFloat(linkData.user.totalRefEarned || 0);
            showToast('🎁 Referral link activated! +$25.00 added to your Referral Wallet!');
            createConfetti();
          }
        } catch (e) {}
      }
    } else {
      // 1st time user! Auto-register immediately on backend with referral parameter
      try {
        const regRes = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: STATE.user.id,
            firstName: STATE.user.firstName || tg?.initDataUnsafe?.user?.first_name || '',
            username: STATE.user.username?.replace('@', '') || STATE.user.firstName || `Player_${STATE.user.id}`,
            email: STATE.user.email || `user_${STATE.user.id}@telegram.org`,
            referrerId: validReferrer
          })
        });
        const regData = await regRes.json();
        if (regData.success && regData.user) {
          STATE.isRegistered = true;
          STATE.user.bscAddress = regData.user.bscAddress || STATE.user.bscAddress;
          // Cache name from registration response
          if (regData.user.username) {
            STATE.user.username = regData.user.username.startsWith('@') ? regData.user.username : '@' + regData.user.username;
            localStorage.setItem('turbo_username', STATE.user.username);
          }
          if (regData.user.firstName || regData.user.first_name) {
            STATE.user.firstName = regData.user.firstName || regData.user.first_name;
            localStorage.setItem('turbo_firstName', STATE.user.firstName);
          }
          STATE.wallet = parseFloat(regData.user.wallet || 0);
          STATE.profitWallet = parseFloat(regData.user.profitWallet || 0);
          STATE.withdrawWallet = parseFloat(regData.user.withdrawWallet || 0);
          STATE.refWallet = parseFloat(regData.user.refWallet || 0);
          STATE.friendsCount = regData.user.friendsCount || 0;
          STATE.totalRefEarned = parseFloat(regData.user.totalRefEarned || 0);
          localStorage.setItem(`turbo_reg_${STATE.user.id}`, 'true');

          if (validReferrer && STATE.refWallet >= 25.00) {
            setTimeout(() => {
              showToast('🎁 Welcome! +$25.00 Referral Bonus added to your Referral Wallet!');
              createConfetti();
              sounds.playVictory();
            }, 600);
          }
        }
      } catch (err) {
        console.warn('[Auto-reg] Error, falling back to local modal:', err.message);
        showSignupModal();
      }
    }
  } catch (err) {
    console.warn('[Init] Offline / local mode:', err.message);
    const localReg = localStorage.getItem(`turbo_reg_${STATE.user.id}`);
    if (localReg) {
      STATE.isRegistered = true;
      // Still show whatever data we have from Telegram/localStorage
    } else if (tgUser?.id) {
      // We have Telegram data but no server — auto-register silently
      try {
        await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: STATE.user.id,
            firstName: STATE.user.firstName,
            username: STATE.user.username?.replace('@', '') || STATE.user.firstName || `Player_${STATE.user.id}`,
            email: `user_${STATE.user.id}@telegram.org`
          })
        });
        localStorage.setItem(`turbo_reg_${STATE.user.id}`, 'true');
        STATE.isRegistered = true;
      } catch(e) {}
    } else {
      showSignupModal();
    }
  }

  updateHeaderAndDisplays();
  updateAllBalances();
  renderHistoryList();
  if (typeof loadDynamicRooms === 'function') loadDynamicRooms();

  // Live Background Deposit Monitor (pops up centered modal ONLY when a genuine new deposit arrives)
  setInterval(async () => {
    if (!STATE.user?.id) return;
    try {
      const res = await fetch(`/api/user?telegramId=${STATE.user.id}`);
      const data = await res.json();
      if (data.exists && data.user) {
        STATE.wallet = parseFloat(data.user.wallet || 0);
        STATE.profitWallet = parseFloat(data.user.profitWallet || STATE.profitWallet);
        STATE.withdrawWallet = parseFloat(data.user.withdrawWallet || STATE.withdrawWallet);
        STATE.refWallet = parseFloat(data.user.refWallet || STATE.refWallet);
        updateAllBalances();

        // Accurately show deposit success popup ONLY when a brand new deposit event occurs
        if (data.latestDeposit && data.latestDeposit.id) {
          const lastSeen = localStorage.getItem('turbo_last_seen_deposit_id');
          if (lastSeen && lastSeen !== data.latestDeposit.id) {
            // New deposit detected!
            localStorage.setItem('turbo_last_seen_deposit_id', data.latestDeposit.id);
            const depAmt = parseFloat(data.latestDeposit.amount || 0);
            addTransaction(`Deposit (USDT BSC BEP-20)`, `+$${depAmt.toFixed(2)}`, 'text-green');
            showDepositSuccessModal(depAmt);
          } else if (!lastSeen) {
            localStorage.setItem('turbo_last_seen_deposit_id', data.latestDeposit.id);
          }
        }
      }
    } catch (e) {}
  }, 8000);
}

function updateHeaderAndDisplays() {
  // Display Name Priority: firstName (real name) → username (@handle) → 'Player'
  const displayName = STATE.user.firstName 
    || (STATE.user.username && STATE.user.username !== '@You' ? STATE.user.username : null)
    || 'Player';
  document.getElementById('userName').textContent = displayName;
  document.getElementById('userAvatar').src = STATE.user.photoUrl;
  
  // Show real Telegram ID (not hardcoded #1001)
  const displayId = STATE.user.id ? `#${STATE.user.id}` : '';
  document.getElementById('userIdDisplay').textContent = displayId;
  
  // Cache firstName and username to localStorage for persistence
  if (STATE.user.firstName && STATE.user.firstName !== 'Player') {
    localStorage.setItem('turbo_firstName', STATE.user.firstName);
  }
  if (STATE.user.username && STATE.user.username !== '@You') {
    localStorage.setItem('turbo_username', STATE.user.username);
  }
  if (STATE.user.photoUrl) {
    localStorage.setItem('turbo_photoUrl', STATE.user.photoUrl);
  }
  
  const botUsername = 'TurboTapgame_bot';
  const myRefLink = `https://t.me/${botUsername}/Play?startapp=ref_${STATE.user.id}`;
  const linkInput = document.getElementById('referralLinkInput');
  if (linkInput) linkInput.value = myRefLink;

  const bscAddr = STATE.user.bscAddress;
  const shortAddr = `${bscAddr.substring(0, 6)}...${bscAddr.substring(bscAddr.length - 4)}`;
  const addrEl = document.getElementById('userDedicatedAddress');
  if (addrEl) addrEl.textContent = shortAddr;
}

// ================= PROFILE DETAILS MODAL FUNCTIONS =================
function openProfileModal() {
  triggerHaptic('impact');
  
  const displayUsername = STATE.user.username || STATE.user.firstName || 'turbogame';
  const displayEmail = STATE.user.email || 'player@gmail.com';
  const tgUsername = tg?.initDataUnsafe?.user?.username ? '@' + tg.initDataUnsafe.user.username : (displayUsername.startsWith('@') ? displayUsername : '@' + displayUsername);

  const largeAvatar = document.getElementById('profLargeAvatar');
  if (largeAvatar) largeAvatar.src = STATE.user.photoUrl;
  
  const heroUser = document.getElementById('profHeroUsername');
  if (heroUser) heroUser.textContent = displayUsername;

  const profUser = document.getElementById('profUsername');
  if (profUser) profUser.textContent = displayUsername;

  const profEmail = document.getElementById('profEmail');
  if (profEmail) profEmail.textContent = displayEmail;

  const profTgId = document.getElementById('profTelegramId');
  if (profTgId) profTgId.textContent = `#${STATE.user.id}`;

  const profTgUser = document.getElementById('profTelegramUser');
  if (profTgUser) profTgUser.textContent = tgUsername;

  const fullAddr = STATE.user.bscAddress || generateBscAddress(STATE.user.id);
  const profBsc = document.getElementById('profBscAddress');
  if (profBsc) profBsc.textContent = `${fullAddr.slice(0, 8)}...${fullAddr.slice(-6)}`;

  const profGame = document.getElementById('profGameBal');
  if (profGame) profGame.textContent = `$${STATE.wallet.toFixed(2)}`;

  const profProfit = document.getElementById('profProfitBal');
  if (profProfit) profProfit.textContent = `$${STATE.profitWallet.toFixed(2)}`;

  const profWithdraw = document.getElementById('profWithdrawBal');
  if (profWithdraw) profWithdraw.textContent = `$${STATE.withdrawWallet.toFixed(2)}`;

  const profRef = document.getElementById('profRefBal');
  if (profRef) profRef.textContent = `$${STATE.refWallet.toFixed(2)}`;

  const profFriends = document.getElementById('profFriendsCount');
  if (profFriends) profFriends.textContent = `${STATE.friendsCount || 0} Friends`;

  const profEarned = document.getElementById('profRefEarned');
  if (profEarned) profEarned.textContent = `$${(STATE.totalRefEarned || 0).toFixed(2)}`;

  document.getElementById('profileModal')?.classList.add('active');
}

function closeProfileModal() {
  document.getElementById('profileModal')?.classList.remove('active');
}

// ================= ADMIN PANEL ACCESS =================
function openAdminPanel(e) {
  if (e) {
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }
  const ADMIN_ID = '8291758870';
  if (String(STATE.user.id) === ADMIN_ID) {
    // Open admin.html in same window
    window.location.href = '/admin.html';
  } else {
    showToast('⛔ Access Denied: Admin Only');
  }
}

function copyProfileAddress() {
  const addr = STATE.user.bscAddress || generateBscAddress(STATE.user.id);
  navigator.clipboard.writeText(addr);
  triggerHaptic('success');
  showToast('✅ Dedicated BSC BEP-20 Address Copied!');
}

function copyUserId() {
  navigator.clipboard.writeText(String(STATE.user.id));
  triggerHaptic('success');
  showToast(`✅ Copied User ID: #${STATE.user.id}`);
}

// ================= LOGOUT & SESSION RESET =================
function handleLogout(e) {
  if (e) {
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  triggerHaptic('warning');

  try {
    // Clear all game-specific storage and cached keys
    const keysToRemove = [
      'turbo_uid',
      'turbo_wallet',
      'turbo_profit_wallet',
      'turbo_withdraw_wallet',
      'turbo_ref_wallet',
      'turbo_friends_count',
      'turbo_total_ref_earned',
      'turbo_txs',
      'turbo_ref_id',
      'turbo_wallet_v4_zero',
      'turbo_reserved_locked_amt'
    ];
    keysToRemove.forEach(k => {
      try { localStorage.removeItem(k); } catch (err) {}
    });

    // Also remove any turbo_reg_ keys
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('turbo_reg_') || k.startsWith('turbo_'))) {
        try { localStorage.removeItem(k); } catch (err) {}
      }
    }
    
    sessionStorage.clear();
  } catch (err) {
    console.warn('[Logout] Storage clear error:', err);
  }

  showToast('👋 Logged out successfully!');

  // If inside Telegram WebApp, attempt to close the mini app
  if (window.Telegram?.WebApp && typeof window.Telegram.WebApp.close === 'function') {
    try {
      window.Telegram.WebApp.close();
    } catch (err) {}
  }

  // Reload page to reset state immediately
  setTimeout(() => {
    window.location.reload();
  }, 350);
}
window.handleLogout = handleLogout;

// ================= SETTINGS & PREFERENCES FUNCTIONS =================
function openSettingsModal() {
  triggerHaptic('impact');

  const unameEl = document.getElementById('settingUsernameVal');
  if (unameEl) unameEl.textContent = STATE.user.username || STATE.user.firstName || 'turbogame';

  const tgIdEl = document.getElementById('settingTgIdVal');
  if (tgIdEl) tgIdEl.textContent = `#${STATE.user.id}`;

  const soundToggle = document.getElementById('settingSoundToggle');
  if (soundToggle) soundToggle.checked = STATE.soundEnabled !== false;

  const hapticToggle = document.getElementById('settingHapticToggle');
  if (hapticToggle) hapticToggle.checked = STATE.hapticEnabled !== false;

  const fastImgToggle = document.getElementById('settingFastImgToggle');
  if (fastImgToggle) fastImgToggle.checked = STATE.fastImgEnabled !== false;

  const effectsToggle = document.getElementById('settingEffectsToggle');
  if (effectsToggle) effectsToggle.checked = STATE.effectsEnabled !== false;

  document.getElementById('settingsModal')?.classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('settingsModal')?.classList.remove('active');
}

function handleSettingChange(key, isChecked) {
  if (key === 'sound') {
    STATE.soundEnabled = isChecked;
    localStorage.setItem('turbo_sound', isChecked ? 'true' : 'false');
    if (isChecked) sounds.playTap();
    showToast(isChecked ? '🔊 Sound: ON' : '🔇 Sound: OFF');
  } else if (key === 'haptic') {
    STATE.hapticEnabled = isChecked;
    localStorage.setItem('turbo_haptic', isChecked ? 'true' : 'false');
    if (isChecked) triggerHaptic('impact');
    showToast(isChecked ? '📳 Haptic: ON' : '📳 Haptic: OFF');
  } else if (key === 'fastImg') {
    STATE.fastImgEnabled = isChecked;
    localStorage.setItem('turbo_fast_img', isChecked ? 'true' : 'false');
    showToast(isChecked ? '⚡ Fast Preload: ON' : '⚡ Fast Preload: OFF');
  } else if (key === 'effects') {
    STATE.effectsEnabled = isChecked;
    localStorage.setItem('turbo_effects', isChecked ? 'true' : 'false');
    showToast(isChecked ? '✨ Cyber Glow: ON' : '✨ Cyber Glow: OFF');
  }
}

async function refreshAppSync() {
  triggerHaptic('impact');
  showToast('🔄 Re-syncing balance & wallet data...');
  try {
    const res = await fetch(`/api/user?telegramId=${STATE.user.id}`);
    const data = await res.json();
    if (data.exists && data.user) {
      STATE.wallet = parseFloat(data.user.wallet || 0);
      STATE.profitWallet = parseFloat(data.user.profitWallet || 0);
      STATE.withdrawWallet = parseFloat(data.user.withdrawWallet || 0);
      STATE.refWallet = parseFloat(data.user.refWallet || 0);
      STATE.friendsCount = data.user.friendsCount || 0;
      STATE.totalRefEarned = parseFloat(data.user.totalRefEarned || 0);
      updateAllBalances();
      updateHeaderAndDisplays();
      showToast('✅ Turbo Data synced with Backend!');
    } else {
      showToast('✅ Turbo Engine Active!');
    }
  } catch (e) {
    showToast('✅ State Refreshed!');
  }
}

function clearAndReloadCache() {
  triggerHaptic('success');
  showToast('⚡ Preloading all artwork into memory...');
  const assets = [
    'images/logo.png',
    'images/hero_bg.jpg',
    'images/stats_bg.jpg',
    'images/card_trio.jpg',
    'images/card_squad.jpg',
    'images/card_elite.jpg',
    'images/card_royale.jpg',
    'images/deposit_bg_4d.jpg',
    'images/deposit_amt_4d.jpg',
    'images/deposit_meta_4d.jpg'
  ];
  assets.forEach(src => {
    const im = new Image();
    im.src = `${src}?v=${Date.now()}`;
  });
  setTimeout(() => {
    showToast('⚡ All Game Images 100% Preloaded!');
  }, 350);
}

// 8. First-Time Sign Up Flow
function showSignupModal() {
  const modal = document.getElementById('signupModal');
  if (!modal) return;

  // Pre-fill default suggested username
  const defName = STATE.user.username.replace('@', '') || STATE.user.firstName || 'Warrior';
  const userField = document.getElementById('regUsername');
  if (userField && !userField.value) userField.value = defName;

  modal.classList.add('active');
}

async function handleRegistrationSubmit(e) {
  if (e) e.preventDefault();
  const usernameInput = document.getElementById('regUsername');
  const emailInput = document.getElementById('regEmail');

  const username = usernameInput.value.trim();
  const email = emailInput.value.trim();

  if (!username || username.length < 3) {
    showToast('⚠️ Username must be at least 3 characters!');
    return;
  }
  if (!email || !email.includes('@')) {
    showToast('⚠️ Please enter a valid email address!');
    return;
  }

  // Extract referral param if any (e.g. startapp=ref_12345)
  let refId = null;
  if (STATE.user.startParam && STATE.user.startParam.startsWith('ref_')) {
    refId = STATE.user.startParam.replace('ref_', '');
  }

  // Send registration to backend
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: STATE.user.id,
        username,
        email,
        referrerId: refId
      })
    });
    const result = await res.json();
    if (result.success) {
      STATE.user.bscAddress = result.user.bscAddress || STATE.user.bscAddress;
      STATE.wallet = result.user.wallet || 25.00;
    }
  } catch (err) {
    console.log('Registered locally');
  }

  // Save registration state so user NEVER sees modal again!
  STATE.isRegistered = true;
  STATE.user.username = username;
  STATE.user.email = email;
  localStorage.setItem(`turbo_reg_${STATE.user.id}`, 'true');
  localStorage.setItem('turbo_username', username);
  localStorage.setItem('turbo_email', email);

  // Close modal and celebrate
  document.getElementById('signupModal').classList.remove('active');
  sounds.playVictory();
  triggerHaptic('success');
  createConfetti();
  updateHeaderAndDisplays();
  updateAllBalances();
  showToast(`🎉 Welcome ${username}! Account activated on BSC BEP-20!`);
}

function updateAllBalances() {
  const gameFormatted = (STATE.wallet || 0).toFixed(2);
  const refFormatted = (STATE.refWallet || 0).toFixed(2);
  const profitFormatted = (STATE.profitWallet || 0).toFixed(2);
  const withdrawFormatted = (STATE.withdrawWallet || 0).toFixed(2);

  const walletBalEl = document.getElementById('walletBalance');
  if (walletBalEl) walletBalEl.textContent = gameFormatted;

  const refBalEl = document.getElementById('headerRefBalance');
  if (refBalEl) refBalEl.textContent = refFormatted;

  const battleRefBalEl = document.getElementById('battleRefBal');
  if (battleRefBalEl) battleRefBalEl.textContent = `$${refFormatted}`;

  const profitBalEl = document.getElementById('profitBalance');
  if (profitBalEl) profitBalEl.textContent = profitFormatted;

  const withdrawBalEl = document.getElementById('withdrawWalletBalance');
  if (withdrawBalEl) withdrawBalEl.textContent = withdrawFormatted;

  const refScreenBal = document.getElementById('refWalletBalance');
  if (refScreenBal) refScreenBal.textContent = refFormatted;

  const friendsCountEl = document.getElementById('totalFriendsCount');
  if (friendsCountEl) friendsCountEl.textContent = STATE.friendsCount;

  const totalEarnedRefEl = document.getElementById('totalEarnedRef');
  if (totalEarnedRefEl) totalEarnedRefEl.textContent = `$${(STATE.totalRefEarned || 0).toFixed(2)}`;

  const finWalletEl = document.getElementById('financeWalletVal');
  if (finWalletEl) finWalletEl.textContent = gameFormatted;

  const wAvailGame = document.getElementById('withdrawAvailGame');
  if (wAvailGame) wAvailGame.textContent = gameFormatted;

  const wAvailRef = document.getElementById('withdrawAvailRef');
  if (wAvailRef) wAvailRef.textContent = refFormatted;

  const wAvailProfit = document.getElementById('withdrawAvailProfit');
  if (wAvailProfit) wAvailProfit.textContent = profitFormatted;

  const wAvailWithdraw = document.getElementById('withdrawAvailWithdraw');
  if (wAvailWithdraw) wAvailWithdraw.textContent = withdrawFormatted;

  const profGame = document.getElementById('profGameBal');
  if (profGame) profGame.textContent = `$${gameFormatted}`;

  const profProfit = document.getElementById('profProfitBal');
  if (profProfit) profProfit.textContent = `$${profitFormatted}`;

  const profWithdraw = document.getElementById('profWithdrawBal');
  if (profWithdraw) profWithdraw.textContent = `$${withdrawFormatted}`;

  const profRef = document.getElementById('profRefBal');
  if (profRef) profRef.textContent = `$${refFormatted}`;

  localStorage.setItem('turbo_wallet', (STATE.wallet || 0).toString());
  localStorage.setItem('turbo_profit_wallet', (STATE.profitWallet || 0).toString());
  localStorage.setItem('turbo_withdraw_wallet', (STATE.withdrawWallet || 0).toString());
  localStorage.setItem('turbo_ref_wallet', (STATE.refWallet || 0).toString());
  localStorage.setItem('turbo_friends_count', (STATE.friendsCount || 0).toString());
  localStorage.setItem('turbo_total_ref_earned', (STATE.totalRefEarned || 0).toString());
}

// 9. Referral System ($25 Bonus per Friend)
function copyReferralLink() {
  const linkInput = document.getElementById('referralLinkInput');
  if (linkInput) {
    navigator.clipboard.writeText(linkInput.value).then(() => {
      triggerHaptic('success');
      showToast('✅ Referral Link Copied! Share with friends!');
    }).catch(() => {
      showToast('Link copied to clipboard!');
    });
  }
}

function shareInviteToTelegram() {
  triggerHaptic('impact');
  const myRefLink = `https://t.me/TurboTapgame_bot/Play?startapp=ref_${STATE.user.id}`;
  const text = encodeURIComponent(`🔥 Join Turbo Team Battle with me! Choose 3, 5, 8, or 12 team rooms, match online and win cash pools!\n\nUse my invite link to claim a $25 starter bonus:`);
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(myRefLink)}&text=${text}`;

  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
  else window.open(shareUrl, '_blank');
}

async function simulateFriendJoined() {
  sounds.playVictory();
  triggerHaptic('success');

  const bonus = 25.00;
  STATE.friendsCount += 1;
  STATE.refWallet += bonus;
  STATE.totalRefEarned += bonus;

  // Sync with backend
  try {
    const res = await fetch('/api/wallet/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: STATE.user.id,
        amount: bonus,
        type: 'ref'
      })
    });
    const result = await res.json();
    if (result.success && result.user) {
      STATE.refWallet = parseFloat(result.user.refWallet || STATE.refWallet);
      STATE.friendsCount = result.user.friendsCount || STATE.friendsCount;
      STATE.totalRefEarned = parseFloat(result.user.totalRefEarned || STATE.totalRefEarned);
    }
  } catch (err) {}

  addTransaction(`Referral Bonus (Friend #${STATE.friendsCount})`, `+$${bonus.toFixed(2)}`, 'text-gold');
  updateAllBalances();
  createConfetti();
  showToast(`🎉 New friend joined! +$25.00 added to Referral Wallet!`);
}

// 10. Deposit & Dedicated Address System with QR Code (Plisio Strictly BSC BEP-20)
let currentDepositPaymentId = null;
let depositPollInterval = null;
let isFetchingDepositAddress = false;

async function openDepositModal() {
  triggerHaptic('impact');
  document.getElementById('depositModal').classList.add('active');
  
  // Clear any existing polling
  if (depositPollInterval) {
    clearInterval(depositPollInterval);
    depositPollInterval = null;
  }

  // Initial loader state in QR box
  const qrBox = document.getElementById('depositQRCode');
  qrBox.innerHTML = `
    <div class="qr-loader-placeholder">
      <i class="fa-solid fa-circle-notch fa-spin text-cyan"></i>
      <span>Loading BEP-20 QR...</span>
    </div>`;
  const addrInput = document.getElementById('modalDepositAddressInput');
  if (addrInput) addrInput.value = 'Connecting to Plisio gateway...';
  const statusTxt = document.getElementById('depositStatusText');
  if (statusTxt) statusTxt.textContent = 'Fetching dedicated BEP-20 address...';

  await fetchAndRenderDepositAddress();

  // Start automatic polling every 7 seconds while modal is open
  depositPollInterval = setInterval(() => {
    checkCurrentDepositStatus(false);
  }, 7000);
}

function closeDepositModal() {
  document.getElementById('depositModal').classList.remove('active');
  if (depositPollInterval) {
    clearInterval(depositPollInterval);
    depositPollInterval = null;
  }
}

async function fetchAndRenderDepositAddress() {
  if (isFetchingDepositAddress) return;
  isFetchingDepositAddress = true;

  try {
    const res = await fetch(`/api/plisio/deposit-address?telegramId=${STATE.user.id}`);
    const data = await res.json();

    if (data.success && data.pay_address) {
      currentDepositPaymentId = data.payment_id;
      STATE.user.bscAddress = data.pay_address;

      const addrInput = document.getElementById('modalDepositAddressInput');
      if (addrInput) addrInput.value = data.pay_address;

      const dedicatedBox = document.getElementById('userDedicatedAddress');
      if (dedicatedBox) dedicatedBox.textContent = data.pay_address;

      // Render live QR Code
      const qrBox = document.getElementById('depositQRCode');
      qrBox.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrBox, {
          text: data.pay_address,
          width: 140,
          height: 140,
          colorDark: '#0a0c14',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }

      const statusTxt = document.getElementById('depositStatusText');
      if (statusTxt) statusTxt.textContent = 'Listening for incoming BEP-20 transfer...';
    } else {
      renderDepositAddressAndQR(STATE.user.bscAddress);
    }
  } catch (err) {
    console.error('Failed to fetch Plisio address:', err);
    renderDepositAddressAndQR(STATE.user.bscAddress);
  } finally {
    isFetchingDepositAddress = false;
  }
}

function renderDepositAddressAndQR(fallbackAddress) {
  const address = fallbackAddress || STATE.user.bscAddress;
  const input = document.getElementById('modalDepositAddressInput');
  if (input) input.value = address;

  const qrBox = document.getElementById('depositQRCode');
  qrBox.innerHTML = '';
  if (window.QRCode) {
    new QRCode(qrBox, {
      text: address,
      width: 140,
      height: 140,
      colorDark: '#0a0c14',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

async function checkCurrentDepositStatus(isManual = false) {
  if (!currentDepositPaymentId && !STATE.user.id) return;

  const btn = document.getElementById('checkDepositStatusBtn');
  const statusTxt = document.getElementById('depositStatusText');

  if (isManual && btn) {
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Checking...`;
    btn.disabled = true;
  }

  try {
    const res = await fetch(`/api/plisio/check?telegramId=${STATE.user.id}&paymentId=${currentDepositPaymentId || ''}`);
    const data = await res.json();

    if (data.credited) {
      if (depositPollInterval) {
        clearInterval(depositPollInterval);
        depositPollInterval = null;
      }

      const depId = data.depositId || `dep_${data.amount}`;
      const lastSeen = localStorage.getItem('turbo_last_seen_deposit_id');

      STATE.wallet = data.wallet;
      updateAllBalances();

      if (lastSeen !== depId) {
        localStorage.setItem('turbo_last_seen_deposit_id', depId);
        sounds.playVictory();
        triggerHaptic('success');
        createConfetti();
        addTransaction(`Deposit (USDT BSC BEP-20)`, `+$${parseFloat(data.amount).toFixed(2)}`, 'text-green');
        closeDepositModal();
        showDepositSuccessModal(data.amount);
      } else {
        closeDepositModal();
      }
      return;
    }

    if (isManual) {
      if (data.status === 'waiting') {
        if (statusTxt) statusTxt.textContent = 'Waiting for BEP-20 blockchain transfer...';
        showToast('⏳ No transfer detected yet. Send USDT BEP-20 to the QR/Address.');
      } else {
        if (statusTxt) statusTxt.textContent = `Status: ${data.status.toUpperCase()} (Processing...)`;
        showToast(`Transaction Status: ${data.status.toUpperCase()}`);
      }
    }
  } catch (err) {
    console.error('Check status error:', err);
    if (isManual) showToast('Network check error. Retrying...');
  } finally {
    if (isManual && btn) {
      btn.innerHTML = `<i class="fa-solid fa-rotate"></i> Check Status`;
      btn.disabled = false;
    }
  }
}

// ================= CENTERED DEPOSIT SUCCESSFUL MODAL =================
function showDepositSuccessModal(amount) {
  const num = parseFloat(amount || 0);
  const amtEl = document.getElementById('depositSuccessAmount');
  if (amtEl) amtEl.textContent = num.toFixed(2);

  const modal = document.getElementById('depositSuccessModal');
  if (modal) {
    modal.classList.add('active');
    triggerHaptic('success');
    sounds.playVictory();
    createConfetti();
  }
}

function closeDepositSuccessModal() {
  const modal = document.getElementById('depositSuccessModal');
  if (modal) modal.classList.remove('active');
  if (typeof switchTab === 'function') switchTab('home');
}

function copyDepositAddress() {
  navigator.clipboard.writeText(STATE.user.bscAddress);
  triggerHaptic('success');
  showToast('Copied BSC BEP-20 Address!');
}

function copyDepositAddressModal() {
  const input = document.getElementById('modalDepositAddressInput');
  const btn = document.getElementById('copyDepositBtn');
  if (input && input.value && !input.value.includes('...')) {
    navigator.clipboard.writeText(input.value);
    triggerHaptic('success');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> COPIED!`;
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
    showToast('Copied BSC BEP-20 Address to clipboard!');
  }
}

async function testInstantDeposit(amount) {
  sounds.playVictory();
  triggerHaptic('success');
  STATE.wallet += amount;

  try {
    await fetch('/api/wallet/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: STATE.user.id,
        amount,
        type: 'game'
      })
    });
  } catch (err) {}

  updateAllBalances();
  addTransaction(`Deposit (USDT BSC BEP-20)`, `+$${amount.toFixed(2)}`, 'text-green');
  closeDepositModal();
  showToast(`✅ Deposit confirmed! +$${amount.toFixed(2)} USDT (BEP-20) credited!`);
}

// 11. Withdrawal System (Strictly BSC BEP-20 from Withdraw Wallet)
function openWithdrawModal() {
  triggerHaptic('impact');
  STATE.withdrawSource = 'withdraw';
  document.getElementById('withdrawModal').classList.add('active');
  updateWithdrawCalculation();
}

function closeWithdrawModal() {
  document.getElementById('withdrawModal').classList.remove('active');
}

function setMaxWithdraw() {
  triggerHaptic('light');
  const maxBal = STATE.withdrawWallet || 0;
  document.getElementById('withdrawAmountInput').value = Math.floor(maxBal);
  updateWithdrawCalculation();
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'withdrawAmountInput') {
    updateWithdrawCalculation();
  }
});

function updateWithdrawCalculation() {
  const inputVal = parseFloat(document.getElementById('withdrawAmountInput')?.value || '0');
  const feeDisplay = document.getElementById('feeAmountDisplay');
  const feeDeductDisplay = document.getElementById('feeDeductDisplay');
  const receiveDisplay = document.getElementById('feeReceiveDisplay');

  const fee = inputVal > 0 ? (inputVal * 0.03) : 0;
  const receiveAmount = Math.max(0, inputVal - fee);

  if (feeDisplay) feeDisplay.textContent = `$${inputVal.toFixed(2)}`;
  if (feeDeductDisplay) feeDeductDisplay.textContent = `-$${fee.toFixed(2)}`;
  if (receiveDisplay) receiveDisplay.textContent = `$${receiveAmount.toFixed(2)}`;
}

async function processWithdrawalSubmit() {
  const addressInput = document.getElementById('withdrawAddressInput');
  const amountInput = document.getElementById('withdrawAmountInput');
  const address = addressInput.value.trim();
  const amount = parseFloat(amountInput.value || '0');

  const isBscValid = /^0x[a-fA-F0-9]{40}$/.test(address);

  if (!isBscValid) {
    triggerHaptic('warning');
    showToast('⚠️ Invalid BSC BEP-20 address! Must start with 0x (42 characters).');
    return;
  }

  if (isNaN(amount) || amount < 20) {
    triggerHaptic('warning');
    showToast('⚠️ Minimum withdrawal amount is $20.00 USD!');
    return;
  }

  const currentAvailable = STATE.withdrawWallet || 0;
  if (amount > currentAvailable) {
    triggerHaptic('warning');
    showToast(`⚠️ Insufficient balance in Withdraw Wallet ($${currentAvailable.toFixed(2)})!`);
    return;
  }

  const fee = amount * 0.03;
  const netAmount = Math.max(0, amount - fee);

  // Send withdrawal request to backend
  try {
    await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: STATE.user.id,
        address,
        amount,
        fee,
        netAmount,
        source: 'withdraw'
      })
    });
  } catch (err) {}

  STATE.withdrawWallet = Math.max(0, (STATE.withdrawWallet || 0) - amount);

  updateAllBalances();
  sounds.playVictory();
  triggerHaptic('success');

  addTransaction(`Withdrawal to ${address.substring(0, 6)}... (Net: $${netAmount.toFixed(2)})`, `-$${amount.toFixed(2)}`, 'text-amber');

  addressInput.value = '';
  amountInput.value = '';
  closeWithdrawModal();

  showToast(`🚀 Withdrawal of $${amount.toFixed(2)} USDT submitted! (Net: $${netAmount.toFixed(2)} after 3% fee).`);
}

// 12. Transaction History Tracker
function addTransaction(title, amountStr, colorClass = 'text-green') {
  const now = new Date();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const record = {
    title,
    amount: amountStr,
    color: colorClass,
    time: `Today, ${timeStr}`
  };

  STATE.transactions.unshift(record);
  if (STATE.transactions.length > 20) STATE.transactions.pop();
  localStorage.setItem('turbo_txs', JSON.stringify(STATE.transactions));
  renderHistoryList();
}

function renderHistoryList() {
  const list = document.getElementById('globalHistoryList');
  if (!list) return;

  if (STATE.transactions.length === 0) {
    list.innerHTML = `
      <div class="h-row">
        <div class="h-info">
          <span class="h-title"><i class="fa-solid fa-gift text-gold"></i> Welcome Starter Pack (BSC BEP-20)</span>
          <span class="h-date">Today, 12:00</span>
        </div>
        <span class="h-amt text-green">+$25.00</span>
      </div>
    `;
    return;
  }

  list.innerHTML = STATE.transactions.map(t => `
    <div class="h-row">
      <div class="h-info">
        <span class="h-title">${t.title}</span>
        <span class="h-date">${t.time}</span>
      </div>
      <span class="h-amt ${t.color}">${t.amount}</span>
    </div>
  `).join('');
}

// ================= ARENA DYNAMIC ROOMS ENGINE =================
// ================= ARENA DYNAMIC ROOMS ENGINE (REAL-TIME LIVE SYNC) =================
window.__ARENA_ROOMS = [
  { id: 'trio', name: 'TRIO SHOWDOWN', desc: '3 Players Solo Knockout', players: 3, entryFee: 2, prize: 5, badge: 'FASTEST MATCH' },
  { id: 'squad', name: 'SQUAD DOMINATION', desc: '5-Player Rush Elimination', players: 5, entryFee: 4, prize: 16, badge: 'SQUAD BATTLE' },
  { id: 'elite', name: 'ELITE SYNDICATE', desc: '8-Player Mega Clash', players: 8, entryFee: 7, prize: 7, badge: 'HIGH STAKES' },
  { id: 'royale', name: 'CHAMPIONS ROYALE', desc: '12-Player Ultimate Showdown', players: 12, entryFee: 15, prize: 15, badge: 'GRAND JACKPOT' }
];

let __roomsSyncInterval = null;
let __roomsEventSource = null;

async function loadDynamicRooms() {
  try {
    const res = await fetch('/api/rooms?t=' + Date.now(), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.rooms) && data.rooms.length > 0) {
      window.__ARENA_ROOMS = data.rooms;
      applyDynamicRooms(data.rooms, false);
    }
  } catch (e) {
    console.warn('[Rooms] Sync error:', e);
  }
}

function initRoomsLiveSync() {
  // 1. Initial Immediate Load
  loadDynamicRooms();

  // 2. Real-Time Server-Sent Events (SSE) Stream
  if (window.EventSource && !__roomsEventSource) {
    try {
      __roomsEventSource = new EventSource('/api/live/stream');
      __roomsEventSource.addEventListener('roomsUpdated', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && Array.isArray(payload.rooms)) {
            window.__ARENA_ROOMS = payload.rooms;
            applyDynamicRooms(payload.rooms, true);
          }
        } catch (err) {}
      });
      __roomsEventSource.onerror = () => {
        // EventSource auto-reconnects; polling guarantees 100% reliability
      };
    } catch (e) {}
  }

  // 3. Fallback High-Frequency Polling (every 2.5 seconds)
  if (!__roomsSyncInterval) {
    __roomsSyncInterval = setInterval(() => {
      // Only poll when tab is visible and player is not actively inside 15s battle gameplay
      if (document.visibilityState === 'visible' && !STATE.battleTimerInterval) {
        loadDynamicRooms();
      }
    }, 2500);
  }

  // 4. Lifecycle Event Triggers
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadDynamicRooms();
  });
  window.addEventListener('focus', loadDynamicRooms);
  window.addEventListener('pageshow', loadDynamicRooms);
}

function joinArenaRoom(roomId) {
  const room = (window.__ARENA_ROOMS || []).find(r => r.id === roomId);
  const players = room?.players || (roomId === 'trio' ? 3 : roomId === 'squad' ? 5 : roomId === 'elite' ? 8 : 12);
  const fee = room?.entryFee !== undefined ? parseFloat(room.entryFee) : (roomId === 'trio' ? 2 : roomId === 'squad' ? 4 : roomId === 'elite' ? 7 : 15);
  const prize = room?.prize !== undefined ? parseFloat(room.prize) : (roomId === 'trio' ? 5 : roomId === 'squad' ? 16 : fee);
  const title = room?.name || (roomId === 'trio' ? 'Trio Showdown' : roomId === 'squad' ? 'Squad Domination' : roomId === 'elite' ? 'Elite Syndicate' : 'Champions Royale');
  startMatchmaking(players, fee, prize, title);
}

function applyDynamicRooms(rooms, isLivePush = false) {
  if (!Array.isArray(rooms)) return;
  const badgeIcons = {
    trio: 'fa-bolt',
    squad: 'fa-trophy',
    elite: 'fa-crosshairs',
    royale: 'fa-crown'
  };

  rooms.forEach((r, idx) => {
    const key = r.id || (idx === 0 ? 'trio' : idx === 1 ? 'squad' : idx === 2 ? 'elite' : 'royale');
    const card = document.getElementById(`roomCard-${key}`);
    const badgeEl = document.getElementById(`roomBadge-${key}`);
    const playersTag = document.getElementById(`roomPlayersTag-${key}`);
    const nameEl = document.getElementById(`roomName-${key}`);
    const descEl = document.getElementById(`roomDesc-${key}`);
    const prizeEl = document.getElementById(`roomPrizeValue-${key}`);
    const joinBtn = document.getElementById(`roomJoinBtn-${key}`);
    const joinText = document.getElementById(`roomJoinText-${key}`);

    const feeNum = parseFloat(r.entryFee) >= 0 ? parseFloat(r.entryFee) : 2;
    const prizeNum = parseFloat(r.prize) >= 0 ? parseFloat(r.prize) : feeNum;
    const playersNum = parseInt(r.players) || (idx === 0 ? 3 : idx === 1 ? 5 : idx === 2 ? 8 : 12);
    const roomTitle = r.name || 'Arena Battle';

    if (nameEl && nameEl.textContent !== roomTitle) nameEl.textContent = roomTitle;
    if (descEl && descEl.textContent !== (r.desc || '')) descEl.textContent = r.desc || '';
    if (badgeEl && r.badge) {
      const bIcon = badgeIcons[key] || 'fa-bolt';
      badgeEl.innerHTML = `<i class="fa-solid ${bIcon}"></i> ${r.badge}`;
    }
    if (playersTag) {
      playersTag.innerHTML = `<i class="fa-solid fa-users"></i> ${playersNum} PLAYERS`;
    }
    if (prizeEl) prizeEl.textContent = `$${prizeNum.toFixed(2)}`;
    if (joinText) joinText.textContent = `JOIN $${feeNum % 1 === 0 ? feeNum : feeNum.toFixed(2)}`;
    if (card) {
      card.setAttribute('data-prize', prizeNum);
      card.setAttribute('data-players', playersNum);
      card.setAttribute('data-fee', feeNum);
      if (isLivePush) {
        card.classList.add('card-live-pulse');
        setTimeout(() => card.classList.remove('card-live-pulse'), 1200);
      }
    }
    if (joinBtn) {
      joinBtn.onclick = function(e) {
        if (e) e.stopPropagation();
        joinArenaRoom(key);
      };
    }
  });
}

// Auto-start live synchronization engine
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRoomsLiveSync);
} else {
  initRoomsLiveSync();
}

// 13. Arena Matchmaking Logic (3, 5, 8, 12 Teams)
function startMatchmaking(playerCount, entryFee, prizeAmount, roomTitle) {
  // Support both 3 arguments (legacy fallback) and 4 arguments
  if (typeof roomTitle === 'undefined') {
    roomTitle = prizeAmount;
    prizeAmount = entryFee;
  }
  entryFee = parseFloat(entryFee);
  if (isNaN(entryFee)) entryFee = 2;
  prizeAmount = parseFloat(prizeAmount);
  if (isNaN(prizeAmount)) prizeAmount = entryFee;

  // Check if user has sufficient deposit in Game Wallet
  if ((STATE.wallet || 0) < entryFee) {
    triggerHaptic('warning');
    showToast(`⚠️ Insufficient Game Wallet ($${(STATE.wallet || 0).toFixed(2)})! Deposit $${entryFee.toFixed(2)} to play.`);
    openDepositModal();
    return;
  }

  // Check if user has at least $2.00 in Referral Wallet to tap
  if ((STATE.refWallet || 0) < 2.00) {
    triggerHaptic('warning');
    showToast(`⚠️ Referral Wallet is $${(STATE.refWallet || 0).toFixed(2)}! Need at least $2.00 to tap ($2/tap). Invite friends to earn bonus!`);
    navigateTo('screenReferral');
    return;
  }

  // Deduct entry fee from Game Wallet (deposited funds)
  STATE.wallet = Math.max(0, (STATE.wallet || 0) - entryFee);
  updateAllBalances();
  addTransaction(`Arena Entry: ${roomTitle}`, `-$${entryFee.toFixed(2)}`, 'text-amber');

  try {
    fetch('/api/wallet/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: STATE.user.id,
        amount: -entryFee,
        type: 'game'
      })
    });
  } catch (err) {}

  sounds.init();
  triggerHaptic('impact');

  STATE.currentRoom = {
    players: playerCount,
    entryFee: entryFee,
    prize: prizeAmount,
    title: roomTitle
  };

  document.getElementById('searchRoomTitle').textContent = `Searching ${playerCount}-Player Team...`;
  document.getElementById('searchPoolPrize').textContent = `$${prizeAmount.toFixed(2)}`;
  document.getElementById('slotsCountText').textContent = `1 / ${playerCount}`;
  document.getElementById('slotsBarFill').style.width = `${(1 / playerCount) * 100}%`;
  
  STATE.playersInRoom = [
    {
      id: STATE.user.id,
      name: STATE.user.username || STATE.user.firstName,
      avatar: STATE.user.photoUrl,
      isUser: true,
      score: 0
    }
  ];

  renderSlots(playerCount);
  showScreen('screenMatchmaking');

  STATE.searchTimerSeconds = 0;
  const timerElem = document.getElementById('searchTimer');
  const pingElem = document.getElementById('searchPing');
  const badgeEl = document.querySelector('.search-badge');
  if (timerElem) timerElem.textContent = '00:00';
  if (pingElem) pingElem.textContent = '24ms';
  if (badgeEl) {
    badgeEl.className = 'search-badge pulse';
    badgeEl.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> MATCHMAKING ACTIVE';
    badgeEl.style.background = '';
    badgeEl.style.borderColor = '';
    badgeEl.style.color = '';
  }
  
  if (STATE.matchmakingInterval) clearInterval(STATE.matchmakingInterval);
  if (STATE.searchTimerRunner) clearInterval(STATE.searchTimerRunner);
  if (STATE.matchCompleteTimeout) clearTimeout(STATE.matchCompleteTimeout);

  const TOTAL_SEARCH_SECONDS = 15;
  const opponentsNeeded = playerCount - 1;
  // Distribute opponents smoothly across the 15-second search duration
  const joinIntervalMs = opponentsNeeded > 0 ? Math.floor(14200 / opponentsNeeded) : 1000;
  let slotIndex = 1;

  // 1-second interval timer: counts every second from 00:00 up to 00:15
  STATE.searchTimerRunner = setInterval(() => {
    STATE.searchTimerSeconds++;
    const mins = String(Math.floor(STATE.searchTimerSeconds / 60)).padStart(2, '0');
    const secs = String(STATE.searchTimerSeconds % 60).padStart(2, '0');
    if (timerElem) timerElem.textContent = `${mins}:${secs}`;
    if (pingElem) pingElem.textContent = `${Math.floor(20 + Math.random() * 12)}ms`;

    // At exactly 15 seconds: Matchmaking complete!
    if (STATE.searchTimerSeconds >= TOTAL_SEARCH_SECONDS) {
      clearInterval(STATE.searchTimerRunner);
      clearInterval(STATE.matchmakingInterval);

      // Ensure all player slots are filled
      while (slotIndex < playerCount) {
        const oppo = generateOpponent(slotIndex);
        STATE.playersInRoom.push(oppo);
        slotIndex++;
      }
      renderSlots(playerCount);

      const countEl = document.getElementById('slotsCountText');
      const barEl = document.getElementById('slotsBarFill');
      if (countEl) countEl.textContent = `${playerCount} / ${playerCount}`;
      if (barEl) barEl.style.width = '100%';

      sounds.playMatchFound();
      triggerHaptic('heavy');

      const liveBadge = document.querySelector('.search-badge');
      if (liveBadge) {
        liveBadge.classList.remove('pulse');
        liveBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> ALL PLAYERS READY!';
        liveBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        liveBadge.style.borderColor = 'rgba(16, 185, 129, 0.5)';
        liveBadge.style.color = '#34d399';
      }

      STATE.matchCompleteTimeout = setTimeout(launchCountdown, 900);
    }
  }, 1000);

  // Interval to gradually connect opponents across the 15-second background search
  STATE.matchmakingInterval = setInterval(() => {
    if (slotIndex < playerCount && STATE.searchTimerSeconds < TOTAL_SEARCH_SECONDS) {
      const oppo = generateOpponent(slotIndex);
      STATE.playersInRoom.push(oppo);
      slotIndex++;

      renderSlots(playerCount);
      const countEl = document.getElementById('slotsCountText');
      const barEl = document.getElementById('slotsBarFill');
      if (countEl) countEl.textContent = `${slotIndex} / ${playerCount}`;
      if (barEl) barEl.style.width = `${(slotIndex / playerCount) * 100}%`;
      triggerHaptic('light');
    }
  }, joinIntervalMs);
}

function renderSlots(totalSlots) {
  const container = document.getElementById('playersSlotGrid');
  container.innerHTML = '';

  for (let i = 0; i < totalSlots; i++) {
    const player = STATE.playersInRoom[i];
    const card = document.createElement('div');

    if (player) {
      card.className = 'player-slot-card filled';
      card.innerHTML = `
        <img class="slot-avatar" src="${player.avatar}" alt="Player">
        <div class="slot-name">${player.isUser ? 'YOU' : player.name}</div>
        <div class="slot-status"><i class="fa-solid fa-check"></i> READY</div>
      `;
    } else {
      card.className = 'player-slot-card empty';
      card.innerHTML = `
        <div class="slot-avatar" style="display:flex;align-items:center;justify-content:center;color:#475569;">
          <i class="fa-solid fa-user-plus"></i>
        </div>
        <div class="slot-name">Waiting...</div>
        <div class="slot-status" style="color:#64748b;">SEARCHING</div>
      `;
    }
    container.appendChild(card);
  }
}

function cancelMatchmaking() {
  if (STATE.matchmakingInterval) clearInterval(STATE.matchmakingInterval);
  if (STATE.searchTimerRunner) clearInterval(STATE.searchTimerRunner);
  if (STATE.matchCompleteTimeout) clearTimeout(STATE.matchCompleteTimeout);
  triggerHaptic('warning');
  showToast('Matchmaking cancelled');
  showScreen('screenLobby');
}

// 14. Countdown Phase
function launchCountdown() {
  document.getElementById('countdownPrizeText').textContent = `$${STATE.currentRoom.prize.toFixed(2)}`;
  showScreen('screenCountdown');

  let count = 10;
  const countElem = document.getElementById('hugeCountdownNumber');
  const ringProgress = document.getElementById('countdownRingCircle');
  const circumference = 364.4;

  function updateRing(cnt) {
    if (ringProgress) {
      const progress = Math.max(0, cnt / 10);
      ringProgress.style.strokeDashoffset = (circumference * (1 - progress)).toFixed(1);
    }
  }

  countElem.textContent = count;
  countElem.classList.remove('countdown-go');
  countElem.classList.remove('pop-tick');
  void countElem.offsetWidth;
  countElem.classList.add('pop-tick');
  updateRing(count);
  sounds.playCountdownBeep();

  const cInterval = setInterval(() => {
    count--;
    if (count > 0) {
      countElem.textContent = count;
      countElem.classList.remove('pop-tick');
      void countElem.offsetWidth;
      countElem.classList.add('pop-tick');
      updateRing(count);
      sounds.playCountdownBeep();
      triggerHaptic('impact');
    } else if (count === 0) {
      countElem.textContent = 'GO!';
      countElem.classList.remove('pop-tick');
      countElem.classList.add('countdown-go');
      updateRing(0);
      sounds.playCountdownBeep();
      triggerHaptic('heavy');
    } else {
      clearInterval(cInterval);
      launchBattle();
    }
  }, 1000);
}

// 15. Battle Arena Gameplay & 4 Distinct Mini-Games
function launchBattle() {
  showScreen('screenBattle');
  document.getElementById('battlePrizeText').textContent = `$${STATE.currentRoom.prize.toFixed(2)}`;
  
  const battleRefBalEl = document.getElementById('battleRefBal');
  if (battleRefBalEl) battleRefBalEl.textContent = `$${(STATE.refWallet || 0).toFixed(2)}`;

  STATE.userDollarScore = 0.00;
  STATE.userTaps = 0;
  STATE.boostMeter = 0;
  STATE.isBoostActive = false;
  STATE.battleTimer = 15;
  document.getElementById('battleTimer').textContent = `${STATE.battleTimer}s`;

  // Determine Game Mode based on Room
  const players = STATE.currentRoom.players;
  const title = (STATE.currentRoom.title || '').toLowerCase();
  
  let activeMode = 'tap';
  if (players === 3 || title.includes('trio')) {
    activeMode = 'tap';
  } else if (players === 5 || title.includes('squad')) {
    activeMode = 'vault';
  } else if (players === 8 || title.includes('elite')) {
    activeMode = 'crash';
  } else if (players >= 12 || title.includes('royale')) {
    activeMode = 'royale';
  }
  STATE.activeGameMode = activeMode;

  // Switch Active Mode Panel
  document.querySelectorAll('.game-mode-panel').forEach(panel => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });

  const activePanel = document.getElementById(`gameMode-${activeMode}`);
  if (activePanel) {
    activePanel.classList.add('active');
    activePanel.style.display = 'flex';
  }

  // Reset all players scores in room
  STATE.playersInRoom.forEach(p => p.score = 0.00);
  renderLiveBoard();

  // Clear any existing intervals
  if (STATE.battleTimerInterval) clearInterval(STATE.battleTimerInterval);
  if (STATE.opponentsInterval) clearInterval(STATE.opponentsInterval);
  if (STATE.crashInterval) clearInterval(STATE.crashInterval);
  if (STATE.royaleSpawnInterval) clearInterval(STATE.royaleSpawnInterval);

  // Initialize specific game mode
  if (activeMode === 'tap') {
    initTapMode();
  } else if (activeMode === 'vault') {
    initVaultMode();
  } else if (activeMode === 'crash') {
    initCrashMode();
  } else if (activeMode === 'royale') {
    initRoyaleMode();
  }

  // Battle Countdown Timer
  STATE.battleTimerInterval = setInterval(() => {
    STATE.battleTimer--;
    document.getElementById('battleTimer').textContent = `${STATE.battleTimer}s`;
    
    if (STATE.battleTimer <= 3 && STATE.battleTimer > 0) {
      sounds.playCountdownBeep();
      triggerHaptic('impact');
    }

    if (STATE.battleTimer <= 0) {
      clearInterval(STATE.battleTimerInterval);
      clearInterval(STATE.opponentsInterval);
      if (STATE.crashInterval) clearInterval(STATE.crashInterval);
      if (STATE.royaleSpawnInterval) clearInterval(STATE.royaleSpawnInterval);
      finishBattle();
    }
  }, 1000);

  // Realistic Opponent AI Dollar Accumulation
  // In 15 seconds, opponents gradually gain dollar values matching the target prize pool!
  STATE.opponentsInterval = setInterval(() => {
    const prizeTarget = STATE.currentRoom.prize || 2.0;
    // 60 ticks over 15s (250ms interval)
    STATE.playersInRoom.forEach(p => {
      if (!p.isUser) {
        const speedFactor = (p.speed || 8) / 10;
        const tickBase = (prizeTarget / 60) * speedFactor;
        const gain = Math.random() * tickBase * 1.55;
        p.score = Math.round((p.score + gain) * 100) / 100;
      }
    });
    renderLiveBoard();
  }, 250);
}

// ================= REFERRAL WALLET TAP BURN SYSTEM ($2.00 / TAP) =================
let pendingRefDeduction = 0;
let refDeductSyncTimer = null;

function flushRefWalletDeduction() {
  if (pendingRefDeduction <= 0) return;
  const toSend = pendingRefDeduction;
  pendingRefDeduction = 0;

  fetch('/api/wallet/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegramId: STATE.user.id,
      type: 'ref',
      amount: -toSend
    })
  }).then(r => r.json()).then(data => {
    if (data && data.success && data.user && typeof data.user.refWallet === 'number') {
      STATE.refWallet = data.user.refWallet;
      updateAllBalances();
    }
  }).catch(e => console.error('[REF SYNC ERROR]', e));
}

function deductRefWalletTapCost(e, anchorEl) {
  const TAP_COST = 2.00;
  if ((STATE.refWallet || 0) < TAP_COST) {
    sounds.playCountdownBeep();
    triggerHaptic('warning');
    showToast('⚠️ Referral Wallet balance is low! Need $2.00/tap. Invite friends to refill!');
    return false;
  }

  // Deduct immediately in local state
  STATE.refWallet = Math.max(0, Math.round((STATE.refWallet - TAP_COST) * 100) / 100);
  pendingRefDeduction = Math.round((pendingRefDeduction + TAP_COST) * 100) / 100;
  
  updateAllBalances();

  // Floating indicator: -$2.00 REF
  spawnFloatingRefCost(e, anchorEl);

  // Debounced server sync (flush within 800ms)
  if (refDeductSyncTimer) clearTimeout(refDeductSyncTimer);
  refDeductSyncTimer = setTimeout(flushRefWalletDeduction, 800);

  return true;
}

function spawnFloatingRefCost(e, fallbackEl) {
  const target = fallbackEl || document.getElementById('tapOrb') || document.body;
  const rect = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floating-ref-cost';
  el.textContent = '-$2.00 REF';

  let clientX = rect.left + rect.width / 2;
  let clientY = rect.top + rect.height / 2;

  if (e && e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else if (e && e.clientX) {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  clientX += (Math.random() - 0.5) * 50;
  clientY += 25 + Math.random() * 15;

  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

// ================= MODE 1: SPEED CASH TAP RACE (TRIO - 3P) =================
function initTapMode() {
  document.getElementById('userLiveScore').textContent = '$0.00';
  document.getElementById('boostPercent').textContent = '0%';
  document.getElementById('boostFill').style.width = '0%';
  document.getElementById('tapOrb').classList.remove('boost-active');
}

function handleOrbTap(e) {
  if (e) e.preventDefault();
  if (STATE.battleTimer <= 0) return;
  if (!deductRefWalletTapCost(e, document.getElementById('tapOrb'))) return;

  const dollarGain = STATE.isBoostActive ? 0.15 : 0.05;
  STATE.userDollarScore = Math.round((STATE.userDollarScore + dollarGain) * 100) / 100;

  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userDollarScore;

  document.getElementById('userLiveScore').textContent = `$${STATE.userDollarScore.toFixed(2)}`;

  if (STATE.isBoostActive) {
    sounds.playBoostTap();
    triggerHaptic('heavy');
  } else {
    sounds.playTap();
    triggerHaptic('light');
  }

  spawnFloatingText(e, `$${dollarGain.toFixed(2)}`, STATE.isBoostActive, document.getElementById('tapOrb'));

  if (!STATE.isBoostActive) {
    STATE.boostMeter += 5;
    if (STATE.boostMeter >= 100) {
      activateTurboBoost();
    } else {
      document.getElementById('boostPercent').textContent = `${STATE.boostMeter}%`;
      document.getElementById('boostFill').style.width = `${STATE.boostMeter}%`;
    }
  }

  renderLiveBoard();
}

function activateTurboBoost() {
  STATE.isBoostActive = true;
  STATE.boostMeter = 100;
  document.getElementById('boostPercent').textContent = 'MAX FRENZY!';
  document.getElementById('boostFill').style.width = '100%';
  document.getElementById('tapOrb').classList.add('boost-active');
  triggerHaptic('heavy');
  showToast('🔥 TURBO FRENZY ACTIVATED! 3X CASH REWARDS!');

  clearTimeout(STATE.boostTimeout);
  STATE.boostTimeout = setTimeout(() => {
    STATE.isBoostActive = false;
    STATE.boostMeter = 0;
    const boostPercentEl = document.getElementById('boostPercent');
    const boostFillEl = document.getElementById('boostFill');
    const tapOrbEl = document.getElementById('tapOrb');
    if (boostPercentEl) boostPercentEl.textContent = '0%';
    if (boostFillEl) boostFillEl.style.width = '0%';
    if (tapOrbEl) tapOrbEl.classList.remove('boost-active');
  }, 4000);
}

// ================= MODE 2: LUCKY VAULT LOOT BOX (SQUAD - 5P) =================
function initVaultMode() {
  const scoreEl = document.getElementById('userVaultLiveScore');
  if (scoreEl) scoreEl.textContent = '$0.00';
  renderVaultGrid();
}

function renderVaultGrid() {
  const grid = document.getElementById('vaultGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < 6; i++) {
    const isGolden = Math.random() < 0.28;
    const card = document.createElement('div');
    card.className = `vault-card ${isGolden ? 'golden' : ''}`;
    card.id = `vaultBox-${i}`;
    card.dataset.golden = isGolden ? '1' : '0';
    card.innerHTML = `
      <i class="fa-solid ${isGolden ? 'fa-vault' : 'fa-lock'} vault-icon"></i>
      <span class="vault-drop-label">${isGolden ? 'JACKPOT SAFE' : 'CYBER SAFE'}</span>
    `;
    card.addEventListener('pointerdown', (e) => handleVaultTap(i, e));
    grid.appendChild(card);
  }
}

function handleVaultTap(idx, e) {
  if (e) e.preventDefault();
  if (STATE.battleTimer <= 0) return;

  const card = document.getElementById(`vaultBox-${idx}`);
  if (!card || card.classList.contains('cracked')) return;
  if (!deductRefWalletTapCost(e, card)) return;

  const isGolden = card.dataset.golden === '1';
  // Golden vault drops $0.40 - $0.80, Regular drops $0.15 - $0.30
  const gain = isGolden 
    ? Math.round((0.40 + Math.random() * 0.40) * 100) / 100
    : Math.round((0.15 + Math.random() * 0.15) * 100) / 100;

  STATE.userDollarScore = Math.round((STATE.userDollarScore + gain) * 100) / 100;
  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userDollarScore;

  const scoreEl = document.getElementById('userVaultLiveScore');
  if (scoreEl) scoreEl.textContent = `$${STATE.userDollarScore.toFixed(2)}`;

  if (isGolden) {
    sounds.playBoostTap();
    triggerHaptic('heavy');
  } else {
    sounds.playTap();
    triggerHaptic('light');
  }

  spawnFloatingText(e, `$${gain.toFixed(2)}`, isGolden, card);

  card.classList.add('cracked');
  card.style.transform = 'scale(0.92)';

  // Re-arm vault box with fresh loot after 450ms
  setTimeout(() => {
    if (!card || STATE.battleTimer <= 0) return;
    const newGolden = Math.random() < 0.28;
    card.className = `vault-card ${newGolden ? 'golden' : ''}`;
    card.dataset.golden = newGolden ? '1' : '0';
    card.innerHTML = `
      <i class="fa-solid ${newGolden ? 'fa-vault' : 'fa-lock'} vault-icon"></i>
      <span class="vault-drop-label">${newGolden ? 'JACKPOT SAFE' : 'CYBER SAFE'}</span>
    `;
    card.style.transform = 'none';
  }, 450);

  renderLiveBoard();
}

// ================= MODE 3: RISING $ MULTIPLIER CRASH (ELITE - 8P) =================
let crashRoundState = {
  multiplier: 1.00,
  crashAt: 2.50,
  hasCashedOut: false,
  isFlying: false,
  baseBet: 0.50
};

function initCrashMode() {
  crashRoundState = {
    multiplier: 1.00,
    crashAt: 2.50,
    hasCashedOut: false,
    isFlying: false,
    baseBet: 0.50
  };
  startCrashRound();
}

function startCrashRound() {
  if (STATE.battleTimer <= 0) return;
  if (STATE.crashInterval) clearInterval(STATE.crashInterval);

  crashRoundState.multiplier = 1.00;
  // Dynamic crash point between 1.50x and 6.00x
  crashRoundState.crashAt = Math.round((1.50 + Math.random() * 4.20) * 100) / 100;
  crashRoundState.hasCashedOut = false;
  crashRoundState.isFlying = true;
  crashRoundState.baseBet = Math.max(0.40, Math.round((STATE.currentRoom.prize / 10) * 100) / 100);

  const stateTag = document.getElementById('crashStateLabel');
  const rocketWrap = document.getElementById('crashRocketWrap');
  const cashoutBtn = document.getElementById('crashCashoutBtn');
  const multText = document.getElementById('crashMultiplierText');
  const liveVal = document.getElementById('crashLiveValue');
  const ticker = document.getElementById('crashOppoTicker');

  if (stateTag) {
    stateTag.className = 'crash-state-tag flying';
    stateTag.innerHTML = '<i class="fa-solid fa-plane-departure"></i> FLYING 🚀';
  }
  if (rocketWrap) {
    rocketWrap.className = 'crash-rocket-wrap flying';
  }
  if (cashoutBtn) {
    cashoutBtn.disabled = false;
    document.getElementById('cashoutBtnAmt').textContent = `$${crashRoundState.baseBet.toFixed(2)}`;
  }
  if (multText) multText.textContent = '1.00x';
  if (liveVal) liveVal.textContent = `$${crashRoundState.baseBet.toFixed(2)}`;
  if (ticker) ticker.textContent = '🚀 Rocket launching! Tap Cashout before crash!';

  STATE.crashInterval = setInterval(() => {
    if (STATE.battleTimer <= 0) {
      clearInterval(STATE.crashInterval);
      return;
    }

    // Accelerating multiplier climb
    const step = crashRoundState.multiplier < 2 ? 0.04 : 0.08;
    crashRoundState.multiplier = Math.round((crashRoundState.multiplier + step) * 100) / 100;

    const currentVal = Math.round((crashRoundState.baseBet * crashRoundState.multiplier) * 100) / 100;

    if (multText) multText.textContent = `${crashRoundState.multiplier.toFixed(2)}x`;
    if (liveVal) liveVal.textContent = `$${currentVal.toFixed(2)}`;
    if (cashoutBtn && !crashRoundState.hasCashedOut) {
      document.getElementById('cashoutBtnAmt').textContent = `$${currentVal.toFixed(2)}`;
    }

    // Random rival cashout simulation in ticker
    if (Math.random() < 0.12) {
      const rivals = STATE.playersInRoom.filter(p => !p.isUser);
      if (rivals.length > 0) {
        const randRival = rivals[Math.floor(Math.random() * rivals.length)];
        if (ticker) ticker.textContent = `⚡ ${randRival.name} cashed out at ${crashRoundState.multiplier.toFixed(2)}x!`;
      }
    }

    // Check Crash
    if (crashRoundState.multiplier >= crashRoundState.crashAt) {
      clearInterval(STATE.crashInterval);
      handleCrashOccurred();
    }
  }, 90);
}

function handleCrashCashout() {
  if (STATE.battleTimer <= 0 || !crashRoundState.isFlying || crashRoundState.hasCashedOut) return;
  if (!deductRefWalletTapCost(null, document.getElementById('crashCashoutBtn'))) return;

  crashRoundState.hasCashedOut = true;
  const cashWon = Math.round((crashRoundState.baseBet * crashRoundState.multiplier) * 100) / 100;

  STATE.userDollarScore = Math.round((STATE.userDollarScore + cashWon) * 100) / 100;
  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userDollarScore;

  sounds.playBoostTap();
  triggerHaptic('success');

  const stateTag = document.getElementById('crashStateLabel');
  const cashoutBtn = document.getElementById('crashCashoutBtn');
  const ticker = document.getElementById('crashOppoTicker');

  if (stateTag) {
    stateTag.className = 'crash-state-tag cashed';
    stateTag.textContent = `CASHED $${cashWon.toFixed(2)}!`;
  }
  if (cashoutBtn) {
    cashoutBtn.disabled = true;
    document.getElementById('cashoutBtnAmt').textContent = `LOCKED!`;
  }
  if (ticker) ticker.textContent = `🎉 You secured $${cashWon.toFixed(2)} at ${crashRoundState.multiplier.toFixed(2)}x!`;

  spawnFloatingText(null, `$${cashWon.toFixed(2)}`, true, cashoutBtn);
  renderLiveBoard();
}

function handleCrashOccurred() {
  crashRoundState.isFlying = false;

  const stateTag = document.getElementById('crashStateLabel');
  const rocketWrap = document.getElementById('crashRocketWrap');
  const cashoutBtn = document.getElementById('crashCashoutBtn');
  const ticker = document.getElementById('crashOppoTicker');

  if (stateTag) {
    stateTag.className = 'crash-state-tag crashed';
    stateTag.innerHTML = `CRASHED @ ${crashRoundState.crashAt.toFixed(2)}x 💥`;
  }
  if (rocketWrap) {
    rocketWrap.className = 'crash-rocket-wrap crashed';
  }
  if (cashoutBtn) {
    cashoutBtn.disabled = true;
    document.getElementById('cashoutBtnAmt').textContent = 'CRASHED!';
  }
  if (!crashRoundState.hasCashedOut) {
    sounds.playCountdownBeep();
    triggerHaptic('warning');
    if (ticker) ticker.textContent = `💥 Rocket crashed! You didn't cash out in time!`;
  }

  // Next round launches after 1.2s if time remains
  setTimeout(() => {
    if (STATE.battleTimer > 2) {
      startCrashRound();
    }
  }, 1200);
}

// ================= MODE 4: MEGA JACKPOT ROYALE (CHAMPIONS - 12P) =================
function initRoyaleMode() {
  const scoreEl = document.getElementById('userRoyaleLiveScore');
  if (scoreEl) scoreEl.textContent = '$0.00';

  const field = document.getElementById('lightningField');
  if (field) field.innerHTML = '';

  if (STATE.royaleSpawnInterval) clearInterval(STATE.royaleSpawnInterval);

  // Spawn dynamic lightning tokens every 550ms
  STATE.royaleSpawnInterval = setInterval(() => {
    if (STATE.battleTimer <= 0) {
      clearInterval(STATE.royaleSpawnInterval);
      return;
    }
    spawnRoyaleToken();
  }, 550);
}

function spawnRoyaleToken() {
  const field = document.getElementById('lightningField');
  if (!field) return;

  const currentTokens = field.querySelectorAll('.royale-token');
  if (currentTokens.length >= 6) return;

  const rand = Math.random();
  let type = { name: 'Cash', val: 0.25, icon: 'fa-solid fa-money-bill-wave', color: '#10b981' };

  if (rand < 0.40) {
    type = { name: 'Cash', val: 0.25, icon: 'fa-solid fa-money-bill-wave', color: '#10b981' };
  } else if (rand < 0.70) {
    type = { name: 'Gold', val: 0.50, icon: 'fa-solid fa-coins', color: '#f59e0b' };
  } else if (rand < 0.90) {
    type = { name: 'Diamond', val: 1.00, icon: 'fa-solid fa-gem', color: '#00f0ff' };
  } else {
    type = { name: 'Jackpot Crown', val: 2.00, icon: 'fa-solid fa-crown', color: '#ffd700' };
  }

  const token = document.createElement('div');
  token.className = 'royale-token';
  const top = 12 + Math.random() * 62;
  const left = 8 + Math.random() * 76;
  token.style.top = `${top}%`;
  token.style.left = `${left}%`;

  token.innerHTML = `
    <i class="${type.icon} royale-token-icon" style="color: ${type.color};"></i>
    <span class="royale-token-val">+$${type.val.toFixed(2)}</span>
  `;

  token.addEventListener('pointerdown', (e) => {
    handleRoyaleTokenTap(token, type.val, e);
  });

  field.appendChild(token);

  // Auto-snatch by rivals if not tapped in 2.2 seconds!
  setTimeout(() => {
    if (token && token.parentElement) {
      token.style.opacity = '0';
      token.style.transform = 'scale(0)';
      setTimeout(() => token.remove(), 200);
    }
  }, 2200);
}

function handleRoyaleTokenTap(tokenEl, val, e) {
  if (e) e.preventDefault();
  if (STATE.battleTimer <= 0) return;
  if (!deductRefWalletTapCost(e, tokenEl)) return;

  STATE.userDollarScore = Math.round((STATE.userDollarScore + val) * 100) / 100;
  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userDollarScore;

  const scoreEl = document.getElementById('userRoyaleLiveScore');
  if (scoreEl) scoreEl.textContent = `$${STATE.userDollarScore.toFixed(2)}`;

  if (val >= 1.00) {
    sounds.playBoostTap();
    triggerHaptic('heavy');
  } else {
    sounds.playTap();
    triggerHaptic('light');
  }

  spawnFloatingText(e, `$${val.toFixed(2)}`, val >= 1.00, tokenEl);

  if (tokenEl && tokenEl.parentElement) {
    tokenEl.remove();
  }

  renderLiveBoard();
}

function spawnFloatingText(e, text, isBoosted, fallbackEl) {
  const target = fallbackEl || document.getElementById('tapOrb') || document.body;
  const rect = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floating-damage' + (isBoosted ? ' boosted' : '');
  const str = String(text);
  el.textContent = str.startsWith('$') || str.startsWith('+') ? (str.startsWith('+') ? str : `+${str}`) : `+${str}`;

  let clientX = rect.left + rect.width / 2;
  let clientY = rect.top + rect.height / 3;

  if (e && e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else if (e && e.clientX) {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  clientX += (Math.random() - 0.5) * 40;
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function renderLiveBoard() {
  const container = document.getElementById('opponentsList');
  if (!container) return;

  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userDollarScore || 0;

  const sorted = [...STATE.playersInRoom].sort((a, b) => b.score - a.score);
  const prizePool = STATE.currentRoom?.prize || 2.0;
  const maxScore = Math.max(prizePool, ...sorted.map(p => p.score), 0.5);

  container.innerHTML = sorted.map((p, idx) => {
    const pct = Math.min(100, Math.max(5, Math.round((p.score / maxScore) * 100)));
    return `
      <div class="oppo-row ${p.isUser ? 'is-user' : ''}">
        <span class="oppo-rank">#${idx + 1}</span>
        <span class="oppo-name">${p.isUser ? 'YOU' : p.name}</span>
        <div class="oppo-bar-track">
          <div class="oppo-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="oppo-score">$${p.score.toFixed(2)}</span>
      </div>
    `;
  }).join('');
}

// 16. Victory & Result Screen
async function finishBattle() {
  flushRefWalletDeduction();
  if (STATE.crashInterval) clearInterval(STATE.crashInterval);
  if (STATE.royaleSpawnInterval) clearInterval(STATE.royaleSpawnInterval);
  if (STATE.opponentsInterval) clearInterval(STATE.opponentsInterval);
  if (STATE.battleTimerInterval) clearInterval(STATE.battleTimerInterval);

  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userDollarScore || 0;

  const sorted = [...STATE.playersInRoom].sort((a, b) => b.score - a.score);
  const userRank = sorted.findIndex(p => p.isUser) + 1;
  const isWinner = userRank === 1;

  showScreen('screenResult');

  const titleEl = document.getElementById('resultTitle');
  const subEl = document.getElementById('resultSubtitle');
  const rewardAmtEl = document.getElementById('resultRewardAmt');
  const rewardBox = document.getElementById('rewardBox');
  const iconWrap = document.getElementById('resultIconWrap');

  if (isWinner) {
    sounds.playVictory();
    triggerHaptic('success');
    titleEl.textContent = 'VICTORY!';
    titleEl.style.color = '#ffd700';
    subEl.textContent = `You conquered the ${STATE.currentRoom.players}-Player room!`;
    rewardAmtEl.textContent = `$${STATE.currentRoom.prize.toFixed(2)}`;
    rewardBox.style.display = 'block';
    iconWrap.innerHTML = `<div class="result-trophy-ring"><i class="fa-solid fa-crown text-gold"></i></div>`;
    
    // Battle Winnings credit directly to PROFIT WALLET and WITHDRAWAL WALLET!
    STATE.profitWallet = (STATE.profitWallet || 0) + STATE.currentRoom.prize;
    STATE.withdrawWallet = (STATE.withdrawWallet || 0) + STATE.currentRoom.prize;

    try {
      await fetch('/api/wallet/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: STATE.user.id,
          amount: STATE.currentRoom.prize,
          type: 'profit'
        })
      });
    } catch (err) {}

    updateAllBalances();
    addTransaction(`Won ${STATE.currentRoom.title} (Profit & Withdraw Wallet)`, `+$${STATE.currentRoom.prize.toFixed(2)}`, 'text-green');
    createConfetti();
  } else {
    triggerHaptic('warning');
    titleEl.textContent = `FINISHED #${userRank}`;
    titleEl.style.color = '#cbd5e1';
    subEl.textContent = 'Good fight! You almost took 1st place.';
    rewardBox.style.display = 'none';
    iconWrap.innerHTML = `<div class="result-trophy-ring" style="border-color:#64748b;box-shadow:none;"><i class="fa-solid fa-shield-halved" style="color:#94a3b8;"></i></div>`;
  }

  const board = document.getElementById('matchSummaryBoard');
  board.innerHTML = sorted.map((p, idx) => `
    <div class="summary-row ${idx === 0 ? 'is-winner' : ''}">
      <span>#${idx + 1} ${p.isUser ? 'YOU' : p.name}</span>
      <span class="${idx === 0 ? 'text-gold' : ''}">$${p.score.toFixed(2)}</span>
    </div>
  `).join('');
}

function returnToLobby() {
  triggerHaptic('light');
  if (STATE.crashInterval) clearInterval(STATE.crashInterval);
  if (STATE.royaleSpawnInterval) clearInterval(STATE.royaleSpawnInterval);
  if (STATE.opponentsInterval) clearInterval(STATE.opponentsInterval);
  if (STATE.battleTimerInterval) clearInterval(STATE.battleTimerInterval);
  showScreen('screenLobby');
}

function shareTelegramScore() {
  triggerHaptic('impact');
  const text = encodeURIComponent(`🔥 I just won the $${STATE.currentRoom?.prize.toFixed(2) || '2.00'} Battle in Turbo Team! Can you beat my score? Play with me!`);
  const botUser = 'TurboTapgame_bot';
  const url = `https://t.me/share/url?url=https://t.me/${botUser}/Play?startapp=ref_${STATE.user.id}&text=${text}`;
  
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

// 16b. Join Official Telegram Community Group
function joinTelegramGroup(e) {
  if (e) e.preventDefault();
  triggerHaptic('impact');
  const groupUrl = 'https://t.me/turbotapgame_2nd';
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(groupUrl);
  } else {
    window.open(groupUrl, '_blank');
  }
}

// 17. Confetti Effect
function createConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#00f0ff', '#a855f7', '#ffd700', '#10b981', '#f59e0b'];
  
  for (let i = 0; i < 40; i++) {
    const bit = document.createElement('div');
    bit.style.position = 'absolute';
    bit.style.width = `${Math.random() * 8 + 6}px`;
    bit.style.height = `${Math.random() * 12 + 8}px`;
    bit.style.background = colors[Math.floor(Math.random() * colors.length)];
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.top = '-20px';
    bit.style.opacity = Math.random() + 0.5;
    bit.style.transform = `rotate(${Math.random() * 360}deg)`;
    bit.style.transition = `all ${Math.random() * 1.5 + 1.2}s cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
    container.appendChild(bit);

    setTimeout(() => {
      bit.style.top = `${Math.random() * 100 + 150}%`;
      bit.style.left = `${parseFloat(bit.style.left) + (Math.random() - 0.5) * 40}%`;
      bit.style.transform = `rotate(${Math.random() * 720}deg)`;
    }, 50);
  }
}

// 18. Utilities
function toggleAudio() {
  STATE.soundEnabled = !STATE.soundEnabled;
  const icon = document.querySelector('#soundToggleBtn i');
  if (icon) {
    icon.className = STATE.soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
  }
  showToast(STATE.soundEnabled ? 'Sound Enabled' : 'Sound Muted');
}

function showToast(message) {
  const toast = document.getElementById('appToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

// 19. updateUI alias (used in multiple places)
function updateUI() {
  updateAllBalances();
  updateHeaderAndDisplays();
  renderHistoryList();
}

// 20. Start App
function bootApp() {
  // ✅ Show user info IMMEDIATELY from Telegram/localStorage — don't wait for API
  updateHeaderAndDisplays();
  
  // Then fetch server data async
  initApp();
  
  setInterval(() => {
    const onlineEl = document.getElementById('onlineCount');
    if (onlineEl) {
      const delta = Math.floor(Math.random() * 11) - 5;
      const cur = parseInt(onlineEl.textContent.replace(',', '')) || 1840;
      onlineEl.textContent = (cur + delta).toLocaleString();
    }
  }, 4000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
