// ============================================================
// TURBO TEAM BATTLE - GAME ENGINE, DUAL WALLETS & BACKEND SYNC
// STRICT NETWORK: BINANCE SMART CHAIN (BSC BEP-20)
// ============================================================

// 0. ADVANCED ANTI-TAMPER & ANTI-REVERSE ENGINEERING ARMOR
(function installAntiTamperArmor() {
  'use strict';
  
  // A. Block Right-Click Context Menu
  window.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
  }, { capture: true });

  // B. Block Inspection & DevTools Keyboard Shortcuts
  window.addEventListener('keydown', function(e) {
    // F12
    if (e.keyCode === 123 || e.key === 'F12') {
      e.preventDefault();
      return false;
    }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (DevTools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      return false;
    }
    // Ctrl+U (View Source) & Ctrl+S (Save Page)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U' || e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      return false;
    }
  }, { capture: true });

  // C. Anti-Dragging of Protected Media
  window.addEventListener('dragstart', function(e) {
    if (e.target && e.target.nodeName === 'IMG') {
      e.preventDefault();
    }
  });

  // D. Anti-Debugger / DevTools Timing Trap
  setInterval(function() {
    var before = performance.now();
    /* eslint-disable no-debugger */
    debugger;
    /* eslint-enable no-debugger */
    var after = performance.now();
    if (after - before > 100) {
      try {
        console.clear();
      } catch (err) {}
    }
  }, 2500);

  // E. Silence Console Output in Production
  if (!window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')) {
    try {
      console.log = function() {};
      console.warn = function() {};
      console.info = function() {};
      console.debug = function() {};
    } catch (e) {}
  }
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
  || parseInt(localStorage.getItem('turbo_uid') || '0') 
  || Math.floor(100000 + Math.random() * 900000);
localStorage.setItem('turbo_uid', rawUserId.toString());

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

// 5. Opponents Generator
const OPPONENT_NAMES = [
  'ApexWolf', 'ShadowBlade', 'CryptoNova', 'ViperX', 
  'HyperStriker', 'TitanGamer', 'CyberPhantom', 'ElectroKnight',
  'QuantumZero', 'IronFist', 'SolarFlare', 'ZenithKing',
  'PixelSamurai', 'FrostBite', 'BlazeRider', 'SonicPulse'
];

function generateOpponent(index) {
  const name = OPPONENT_NAMES[Math.floor(Math.random() * OPPONENT_NAMES.length)] + '_' + Math.floor(10 + Math.random() * 89);
  return {
    id: 'oppo_' + index + '_' + Date.now(),
    name: '@' + name,
    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`,
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
  if (screenId === 'screenLobby') document.getElementById('navArenaBtn')?.classList.add('active');
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

  // Live Background Deposit Monitor (pops up centered modal whenever deposit arrives)
  setInterval(async () => {
    if (!STATE.user?.id) return;
    try {
      const res = await fetch(`/api/user?telegramId=${STATE.user.id}`);
      const data = await res.json();
      if (data.exists && data.user) {
        const newWallet = parseFloat(data.user.wallet || 0);
        const oldWallet = parseFloat(STATE.wallet || 0);
        if (newWallet > oldWallet) {
          const diff = newWallet - oldWallet;
          STATE.wallet = newWallet;
          STATE.profitWallet = parseFloat(data.user.profitWallet || STATE.profitWallet);
          STATE.withdrawWallet = parseFloat(data.user.withdrawWallet || STATE.withdrawWallet);
          STATE.refWallet = parseFloat(data.user.refWallet || STATE.refWallet);
          updateAllBalances();
          addTransaction(`Deposit (USDT BSC BEP-20)`, `+$${diff.toFixed(2)}`, 'text-green');
          showDepositSuccessModal(diff);
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
      STATE.wallet = data.user.wallet;
      STATE.refWallet = data.user.refWallet;
      STATE.friendsCount = data.user.friendsCount;
      STATE.totalRefEarned = data.user.totalRefEarned;
      updateUI();
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

      sounds.playVictory();
      triggerHaptic('success');
      createConfetti();

      STATE.wallet = data.wallet;
      updateAllBalances();
      addTransaction(`Deposit (USDT BSC BEP-20)`, `+$${parseFloat(data.amount).toFixed(2)}`, 'text-green');

      closeDepositModal();
      showDepositSuccessModal(data.amount);
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

// 13. Arena Matchmaking Logic (3, 5, 8, 12 Teams)
function startMatchmaking(playerCount, prizeAmount, roomTitle) {
  // Check if user has sufficient deposit in Game Wallet
  if ((STATE.wallet || 0) < prizeAmount) {
    triggerHaptic('warning');
    showToast(`⚠️ Insufficient Game Wallet ($${(STATE.wallet || 0).toFixed(2)})! Deposit $${prizeAmount.toFixed(2)} to play.`);
    openDepositModal();
    return;
  }

  // Deduct entry fee from Game Wallet (deposited funds)
  STATE.wallet = Math.max(0, (STATE.wallet || 0) - prizeAmount);
  updateAllBalances();
  addTransaction(`Arena Entry: ${roomTitle}`, `-$${prizeAmount.toFixed(2)}`, 'text-amber');

  try {
    fetch('/api/wallet/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: STATE.user.id,
        amount: -prizeAmount,
        type: 'game'
      })
    });
  } catch (err) {}

  sounds.init();
  triggerHaptic('impact');

  STATE.currentRoom = {
    players: playerCount,
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
  
  if (STATE.matchmakingInterval) clearInterval(STATE.matchmakingInterval);
  
  const timerRunner = setInterval(() => {
    STATE.searchTimerSeconds++;
    const mins = String(Math.floor(STATE.searchTimerSeconds / 60)).padStart(2, '0');
    const secs = String(STATE.searchTimerSeconds % 60).padStart(2, '0');
    timerElem.textContent = `${mins}:${secs}`;
    pingElem.textContent = `${Math.floor(20 + Math.random() * 12)}ms`;
  }, 1000);

  let slotIndex = 1;
  const joinIntervalDelay = playerCount > 5 ? 650 : 900;

  STATE.matchmakingInterval = setInterval(() => {
    if (slotIndex < playerCount) {
      const oppo = generateOpponent(slotIndex);
      STATE.playersInRoom.push(oppo);
      slotIndex++;

      renderSlots(playerCount);
      document.getElementById('slotsCountText').textContent = `${slotIndex} / ${playerCount}`;
      document.getElementById('slotsBarFill').style.width = `${(slotIndex / playerCount) * 100}%`;
      triggerHaptic('light');

      if (slotIndex === playerCount) {
        clearInterval(STATE.matchmakingInterval);
        clearInterval(timerRunner);
        sounds.playMatchFound();
        triggerHaptic('heavy');
        setTimeout(launchCountdown, 900);
      }
    }
  }, joinIntervalDelay);
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
  triggerHaptic('warning');
  showToast('Matchmaking cancelled');
  showScreen('screenLobby');
}

// 14. Countdown Phase
function launchCountdown() {
  document.getElementById('countdownPrizeText').textContent = `$${STATE.currentRoom.prize.toFixed(2)}`;
  showScreen('screenCountdown');

  let count = 3;
  const countElem = document.getElementById('hugeCountdownNumber');
  countElem.textContent = count;
  sounds.playCountdownBeep();

  const cInterval = setInterval(() => {
    count--;
    if (count > 0) {
      countElem.textContent = count;
      sounds.playCountdownBeep();
      triggerHaptic('impact');
    } else if (count === 0) {
      countElem.textContent = 'GO!';
      sounds.playCountdownBeep();
      triggerHaptic('heavy');
    } else {
      clearInterval(cInterval);
      launchBattle();
    }
  }, 1000);
}

// 15. Battle Arena Gameplay
function launchBattle() {
  showScreen('screenBattle');
  document.getElementById('battlePrizeText').textContent = `$${STATE.currentRoom.prize.toFixed(2)}`;
  
  STATE.userTaps = 0;
  STATE.boostMeter = 0;
  STATE.isBoostActive = false;
  STATE.battleTimer = 15;
  document.getElementById('userLiveScore').textContent = '0';
  document.getElementById('boostPercent').textContent = '0%';
  document.getElementById('boostFill').style.width = '0%';
  document.getElementById('tapOrb').classList.remove('boost-active');
  document.getElementById('battleTimer').textContent = `${STATE.battleTimer}s`;

  STATE.playersInRoom.forEach(p => p.score = 0);
  renderLiveBoard();

  if (STATE.battleTimerInterval) clearInterval(STATE.battleTimerInterval);
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
      finishBattle();
    }
  }, 1000);

  if (STATE.opponentsInterval) clearInterval(STATE.opponentsInterval);
  STATE.opponentsInterval = setInterval(() => {
    STATE.playersInRoom.forEach(p => {
      if (!p.isUser) {
        const gain = Math.floor(Math.random() * (p.speed * 2.2));
        p.score += gain;
      }
    });
    renderLiveBoard();
  }, 200);
}

function handleOrbTap(e) {
  if (e) e.preventDefault();
  if (STATE.battleTimer <= 0) return;

  const points = STATE.isBoostActive ? 30 : 10;
  STATE.userTaps += points;

  const userObj = STATE.playersInRoom.find(p => p.isUser);
  if (userObj) userObj.score = STATE.userTaps;

  document.getElementById('userLiveScore').textContent = STATE.userTaps;

  if (STATE.isBoostActive) {
    sounds.playBoostTap();
    triggerHaptic('heavy');
  } else {
    sounds.playTap();
    triggerHaptic('light');
  }

  spawnFloatingText(e, points, STATE.isBoostActive);

  if (!STATE.isBoostActive) {
    STATE.boostMeter += 4;
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
  showToast('🔥 TURBO FRENZY ACTIVATED! 3X SCORE!');

  clearTimeout(STATE.boostTimeout);
  STATE.boostTimeout = setTimeout(() => {
    STATE.isBoostActive = false;
    STATE.boostMeter = 0;
    document.getElementById('boostPercent').textContent = '0%';
    document.getElementById('boostFill').style.width = '0%';
    document.getElementById('tapOrb').classList.remove('boost-active');
  }, 4000);
}

function spawnFloatingText(e, text, isBoosted) {
  const orb = document.getElementById('tapOrb');
  const rect = orb.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floating-damage' + (isBoosted ? ' boosted' : '');
  el.textContent = `+${text}`;

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

  const sorted = [...STATE.playersInRoom].sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...sorted.map(p => p.score), 100);

  container.innerHTML = sorted.map((p, idx) => {
    const pct = Math.min(100, Math.round((p.score / maxScore) * 100));
    return `
      <div class="oppo-row ${p.isUser ? 'is-user' : ''}">
        <span class="oppo-rank">#${idx + 1}</span>
        <span class="oppo-name">${p.isUser ? 'YOU' : p.name}</span>
        <div class="oppo-bar-track">
          <div class="oppo-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="oppo-score">${p.score}</span>
      </div>
    `;
  }).join('');
}

// 16. Victory & Result Screen
async function finishBattle() {
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
    
    // Battle Winnings credit directly to PROFIT WALLET!
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
    addTransaction(`Won ${STATE.currentRoom.title} (Profit Wallet)`, `+$${STATE.currentRoom.prize.toFixed(2)}`, 'text-green');
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
      <span class="${idx === 0 ? 'text-gold' : ''}">${p.score} pts</span>
    </div>
  `).join('');
}

function returnToLobby() {
  triggerHaptic('light');
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

// 19. Start App
document.addEventListener('DOMContentLoaded', () => {
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
});
