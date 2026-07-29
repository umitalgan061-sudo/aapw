/* ════════ FIREBASE ════════ */
firebase.initializeApp({
  apiKey: "AIzaSyBBhbil5iHbMSkq8tPjoQ1rlSFqM8JfyhY",
  authDomain: "gameofthrones-06.firebaseapp.com",
  projectId: "gameofthrones-06",
  storageBucket: "gameofthrones-06.firebasestorage.app",
  messagingSenderId: "490086122361",
  appId: "1:490086122361:web:4603437d56b76ea6afe5a8",
});
const db = firebase.firestore();

/* ════════ PWA INSTALLATION PROMPT ════════ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('✅ PWA installation prompt ready');
});

/* ════════ MULTIPLAYER - GLOBAL GAME ════════ */
// Oyuncu kimliği (unique)
let benimID;
try {
  benimID = localStorage.getItem('playerID');
  if (!benimID) {
    benimID = 'player_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('playerID', benimID);
  }
} catch (e) {
  // Safari özel gezinme / depolama devre dışı: localStorage erişimi hata fırlatabilir.
  // Oturum boyunca geçerli geçici bir ID ile devam et.
  benimID = 'player_' + Math.random().toString(36).substr(2, 9);
}

const rtdb = firebase.database();
let multiplayerAktif = false;

console.log('🎮 Oyuncu ID:', benimID);

// MULTIPLAYER BAŞLAT
function multiplayerBaslat() {
  if (multiplayerAktif) return;
  multiplayerAktif = true;
  
  // Tüm krallıkları Firebase'e gönder
  const krallıkVerileri = {};
  kingdoms.forEach(k => {
    krallıkVerileri[k.id] = {
      x: k.x,
      y: k.y,
      owner: k.owner || benimID,
      orda: k.army,
      altin: k.gold,
      moral: k.morale,
      guncelmeTarihi: Date.now()
    };
  });
  
  rtdb.ref('game/krallıklar').set(krallıkVerileri).catch(e => {
    console.error('❌ Firebase yazma hatası:', e);
  });
  
  // SÜREKLI DİNLE (Real-time)
  rtdb.ref('game/krallıklar').on('value', snapshot => {
    const veri = snapshot.val();
    if (!veri) return;
    
    kingdoms.forEach(k => {
      if (veri[k.id]) {
        // Sadece değişen VE tanımlı değerleri apply et
        if (veri[k.id].x !== undefined && k.x !== veri[k.id].x) k.x = veri[k.id].x;
        if (veri[k.id].y !== undefined && k.y !== veri[k.id].y) k.y = veri[k.id].y;
        if (veri[k.id].orda !== undefined && k.army !== veri[k.id].orda) k.army = veri[k.id].orda;
        if (veri[k.id].altin !== undefined && k.gold !== veri[k.id].altin) k.gold = veri[k.id].altin;
        if (veri[k.id].moral !== undefined && k.morale !== veri[k.id].moral) k.morale = veri[k.id].moral;
        if (veri[k.id].navy !== undefined && k.navy !== veri[k.id].navy) k.navy = veri[k.id].navy;
        
        if (veri[k.id].owner !== undefined && veri[k.id].owner !== k.owner) {
          k.owner = veri[k.id].owner;
        }
      }
    });
    
    renderAll();
    
    // ✅ FIX: Panel açık mı? Detail'i yeniden aç
    if (currentDetailId && !document.getElementById('panel').classList.contains('off')) {
      const k = findKingdom(currentDetailId);
      if (k) setTimeout(() => openDetail(currentDetailId), 10);  // Panel refresh et!
    }
  }, err => {
    console.error('❌ Firebase okuma hatası:', err);
  });
  
  console.log('✅ Multiplayer aktif! Oyuncu:', benimID);
}

// KRALLIKI GÜNCELLE (Sende bir değişiklik olunca)
function krallığıGuncelleMultiplayer(krallıkID) {
  if (!multiplayerAktif) return;
  
  const k = findKingdom(krallıkID);
  if (!k) return;
  
  rtdb.ref(`game/krallıklar/${krallıkID}`).update({
    x: k.x || 0,
    y: k.y || 0,
    orda: k.army || 0,
    altin: k.gold || 0,
    moral: k.morale || 80,
    navy: k.navy || 0,  // ✅ Navy güvenli
    owner: k.owner || '',
    guncelmeTarihi: Date.now()
  }).catch(e => {
    console.error('❌ Krallık güncellemesi başarısız:', e);
  });
}

/* ════════ AUDIO ════════ */
let audioCtx = null;
let audioSources={};

function ensureAudio(){ 
  if(!audioCtx) try{ 
    audioCtx = new (window.AudioContext||window.webkitAudioContext)(); 
  }catch(e){} 
}

function playTone(freq, dur=0.12, type='square', vol=0.06){
  ensureAudio(); if(!audioCtx) return;
  try{
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+dur);
    o.start(); o.stop(audioCtx.currentTime+dur);
  }catch(e){}
}

// ✓ Procedural SFX Library (MP3 quality, no downloads)
const audioLibrary = {
  // 🎵 Ambient/Background Music (loopable 8 sec)
  ambience: () => {
    ensureAudio(); if(!audioCtx) return;
    // Deep, mysterious Game of Thrones vibe
    const now = audioCtx.currentTime;
    const env = audioCtx.createGain();
    const bass = audioCtx.createOscillator();
    const mid = audioCtx.createOscillator();
    
    bass.type = 'sine';
    bass.frequency.value = 55; // Deep note
    bass.frequency.setValueAtTime(55, now);
    bass.frequency.exponentialRampToValueAtTime(48, now + 8);
    
    mid.type = 'sine';
    mid.frequency.value = 110; // Harmony
    
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.08, now + 1);
    env.gain.linearRampToValueAtTime(0.08, now + 7);
    env.gain.linearRampToValueAtTime(0, now + 8);
    
    bass.connect(env);
    mid.connect(env);
    env.connect(audioCtx.destination);
    
    bass.start(now);
    mid.start(now);
    
    bass.stop(now + 8);
    mid.stop(now + 8);
  },

  // ⚔️ Battle Start (dramatic, tense)
  battleStart: () => {
    ensureAudio(); if(!audioCtx) return;
    const now = audioCtx.currentTime;
    
    // Descending tension
    const tones = [880, 700, 550, 440];
    tones.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.frequency.value = freq;
      osc.type = 'square';
      
      gain.gain.setValueAtTime(0.06, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.15);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.15);
    });
  },

  // 🏆 Victory! (triumphant, ascending)
  victory: () => {
    ensureAudio(); if(!audioCtx) return;
    const now = audioCtx.currentTime;
    
    // Triumphant ascending tones
    const tones = [
      {freq: 523, dur: 0.2},   // C5
      {freq: 659, dur: 0.2},   // E5
      {freq: 784, dur: 0.2},   // G5
      {freq: 1047, dur: 0.4}   // C6 (hold)
    ];
    
    tones.forEach((t, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const startTime = now + idx * 0.25;
      
      osc.frequency.value = t.freq;
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + t.dur);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + t.dur);
    });
  },

  // 💔 Defeat (sad, descending)
  defeat: () => {
    ensureAudio(); if(!audioCtx) return;
    const now = audioCtx.currentTime;
    
    // Sad descending tones
    const tones = [
      {freq: 523, dur: 0.3},   // C5
      {freq: 466, dur: 0.3},   // A#4
      {freq: 415, dur: 0.3},   // G#4
      {freq: 370, dur: 0.5}    // F#4 (hold)
    ];
    
    tones.forEach((t, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const startTime = now + idx * 0.35;
      
      osc.frequency.value = t.freq;
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0.08, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + t.dur);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + t.dur);
    });
  },

  // 🎯 Click SFX (UI feedback)
  click: () => {
    ensureAudio(); if(!audioCtx) return;
    playTone(880, 0.08, 'sine', 0.05);
  },

  // 📣 Notification (alert tone)
  notification: () => {
    ensureAudio(); if(!audioCtx) return;
    const tones = [550, 600, 550];
    tones.forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 0.08, 'sine', 0.06), idx * 100);
    });
  },

  // 💰 Gold/Resource (sparkly, high pitch)
  goldEarned: () => {
    ensureAudio(); if(!audioCtx) return;
    const now = audioCtx.currentTime;
    const tones = [1320, 1480, 1320];
    
    tones.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const startTime = now + idx * 0.08;
      
      osc.frequency.value = freq;
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0.05, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    });
  },

  // 🏰 Conquest (powerful, authoritative)
  conquest: () => {
    ensureAudio(); if(!audioCtx) return;
    const now = audioCtx.currentTime;
    
    // Power chord feel
    const freqs = [
      {f: 110, dur: 0.15},  // A2 (bass)
      {f: 220, dur: 0.15},  // A3
      {f: 330, dur: 0.3}    // A4 (hold)
    ];
    
    freqs.forEach((item, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const startTime = now + idx * 0.1;
      
      osc.frequency.value = item.f;
      osc.type = 'square';
      
      gain.gain.setValueAtTime(0.06, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + item.dur);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + item.dur);
    });
  },

  // 🕊️ Peace/Alliance (soft, harmonious)
  alliance: () => {
    ensureAudio(); if(!audioCtx) return;
    const now = audioCtx.currentTime;
    
    const harmony = [
      {f: 264, dur: 0.4},   // C4
      {f: 330, dur: 0.4},   // E4
      {f: 396, dur: 0.8}    // G4
    ];
    
    harmony.forEach((item, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const startTime = now + idx * 0.15;
      
      osc.frequency.value = item.f;
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0.04, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + item.dur);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + item.dur);
    });
  }
};

// ✓ Play SFX with fallback
async function playSFX(type, fallbackTones=[]) {
  // Check if procedural audio exists
  if(audioLibrary[type]) {
    try {
      audioLibrary[type]();
      return;
    } catch(e) {
      console.warn(`⚠️ SFX play failed: ${type}`, e);
    }
  }
  
  // Fallback: basic tones
  if(fallbackTones.length > 0) {
    fallbackTones.forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 0.12, 'sine', 0.08), idx * 80);
    });
  }
}

// ✓ Initialize audio system on first user gesture
function initAudioSystem() {
  if(audioCtx && audioCtx.state === 'running') return;
  
  ensureAudio();
  if(audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      console.log('✓ AudioContext resumed - Procedural SFX ready');
    });
  }
}

// Call init on first interaction
document.addEventListener('click', () => { initAudioSystem(); }, {once: true});
document.addEventListener('touchstart', () => { initAudioSystem(); }, {once: true});

function sfxClick(){ 
  playSFX('click', [440]); 
}

/* ════════ PERFORMANCE TRACKING ════════ */
const pageStartTime = performance.now();
window.addEventListener('load', () => {
  const loadTime = performance.now() - pageStartTime;
  if (window.WesterosAnalytics) {
    WesterosAnalytics.track('page_load_complete', { loadTime });
  }
  console.log(`📊 Page load time: ${loadTime.toFixed(0)}ms`);
  // Performance tracking removed as part of caching/PWA removal
});

/* ════════ SCRIPT HELPER FUNCTIONS ════════ */
// Debounce utility
function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

// Throttle utility
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Deep clone
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Query helpers
const QueryHelpers = {
  byId: (id) => document.getElementById(id),
  byClass: (cls, parent = document) => parent.querySelectorAll(`.${cls}`),
  byTag: (tag, parent = document) => parent.querySelectorAll(tag),
  bySelector: (sel, parent = document) => parent.querySelector(sel)
};

// Event delegation helper
function delegateEvent(parent, selector, event, callback) {
  parent.addEventListener(event, (e) => {
    if (e.target.matches(selector)) {
      callback.call(e.target, e);
    }
  });
}

// Animation frame queue
const FrameQueue = {
  queue: [],
  isRunning: false,
  add(callback) {
    this.queue.push(callback);
    if (!this.isRunning) this.process();
  },
  process() {
    this.isRunning = true;
    const processNext = () => {
      if (this.queue.length === 0) {
        this.isRunning = false;
        return;
      }
      const callback = this.queue.shift();
      callback();
      requestAnimationFrame(processNext);
    };
    processNext();
  }
};

// Toast notification system
const Toast = {
  container: null,
  init() {
    this.container = document.getElementById('toasts') || document.createElement('div');
    this.container.id = 'toasts';
  },
  show(message, type = 'info', duration = 3000) {
    if (!this.container) this.init();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      padding: 12px 16px;
      margin: 8px;
      background: ${type === 'error' ? '#c02020' : type === 'success' ? '#2d7d2d' : '#333'};
      color: #fff;
      border-radius: 4px;
      animation: slideIn 0.3s ease-out;
      font-family: 'Cinzel', serif;
      font-size: 12px;
    `;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};
Toast.init();

// Request queue for network requests
const RequestQueue = {
  queue: [],
  processing: false,
  maxConcurrent: 3,
  activeRequests: 0,
  
  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn: requestFn, resolve, reject });
      this.process();
    });
  },
  
  async process() {
    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      const { fn, resolve, reject } = this.queue.shift();
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this.activeRequests--;
        if (this.queue.length > 0) this.process();
      }
    }
  }
};

// Validation helpers
const Validators = {
  isEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  isNumber: (val) => !isNaN(val) && isFinite(val),
  isEmpty: (val) => !val || (typeof val === 'string' && val.trim() === ''),
  isUrl: (url) => {
    try { new URL(url); return true; } catch { return false; }
  }
};

// Export helpers globally
window.ScriptHelpers = {
  debounce, throttle, deepClone, QueryHelpers, FrameQueue, Toast,
  RequestQueue, Validators, delegateEvent
};

console.log('✅ Script utilities loaded - Use window.ScriptHelpers for utilities');
function sfxBattle(){ playSFX('battleStart', [200,180,160,150]); }
function sfxVictory(){ playSFX('victory', [523,659,784,1047]); }
function sfxDefeat(){ playSFX('defeat', [392,370,349,330]); }
function sfxAlly(){ playSFX('alliance', [440,554,659]); }
function sfxSeason(){ playTone(330,0.4,'sine',0.04); setTimeout(()=>playTone(440,0.3,'sine',0.04),300); }
function sfxGold(){ [880,1100].forEach((f,i)=>setTimeout(()=>playTone(f,0.12,'sine',0.05),i*80)); }
function sfxSpy(){ [220,200,180,160].forEach((f,i)=>setTimeout(()=>playTone(f,0.14,'sine',0.04),i*60)); }
function sfxTrade(){ [440,528,659].forEach((f,i)=>setTimeout(()=>playTone(f,0.15,'sine',0.04),i*90)); }
function sfxSabotage(){ [200,150,100,80].forEach((f,i)=>setTimeout(()=>playTone(f,0.2,'sawtooth',0.06),i*100)); }
function sfxAchievement(){ [660,880,1100,1320].forEach((f,i)=>setTimeout(()=>playTone(f,0.18,'sine',0.06),i*90)); }
function sfxEvent(){ [330,440,330].forEach((f,i)=>setTimeout(()=>playTone(f,0.2,'sine',0.05),i*120)); }
function sfxNK(){ [100,90,80,70,100].forEach((f,i)=>setTimeout(()=>playTone(f,0.3,'sawtooth',0.08),i*150)); }
function sfxTech(){ playSFX('goldEarned', [523,659,784,880]); }
function sfxMarriage(){ [440,550,659,880].forEach((f,i)=>setTimeout(()=>playTone(f,0.2,'sine',0.05),i*120)); }
function sfxVictoryFanfare(){
  const seq=[[523,.25],[659,.25],[784,.25],[659,.2],[784,.3],[1047,.5]];
  let t=0; seq.forEach(([f,d])=>{setTimeout(()=>playTone(f,d,'sine',0.08),t*1000);t+=d;});
}

/* ════════ CONSTANTS ════════ */
const MAP_W = 5000, MAP_H = 7000;
const COLORS=['#c8960a','#c8430a','#8faabb','#4a9c30','#c8386a','#4a88c8','#9c6ab0','#20c8a0','#e8e0c0','#e8784a','#60c890','#e06090','#80a8d8','#d4a060','#a060d0'];
const SIGILS=['🐉','🐺','🦁','🦌','🐙','🌹','🦅','⚔️','🐍','🦊','🐻','☀️','🌙','⚡','🔱','🏹','🛡️','👑','🗡️','🌊','🔥','❄️','🌿','🏔️'];

const SEASONS=[
  {id:'spring',name:'İlkbahar',icon:'🌸',color:'#4a9c30',glow:'rgba(74,156,48,.3)',powerMod:{default:1.0,stark:1.0},desc:'Kış geçti, yeni başlangıçlar.',weather:null,goldMod:1.1,armyMod:1.0},
  {id:'summer',name:'Yaz',icon:'☀️',color:'#e8b420',glow:'rgba(232,180,32,.3)',powerMod:{default:1.1,stark:1.05},desc:'Verimli topraklar, büyüyen ordular.',weather:null,goldMod:1.2,armyMod:1.1},
  {id:'autumn',name:'Sonbahar',icon:'🍂',color:'#c8430a',glow:'rgba(200,67,10,.3)',powerMod:{default:0.95,stark:1.0},desc:'Kış yaklaşıyor. Hazırlık zamanı.',weather:'rain',goldMod:0.9,armyMod:1.05},
  {id:'winter',name:'Kış',icon:'❄️',color:'#8faabb',glow:'rgba(143,170,187,.3)',powerMod:{default:0.85,stark:1.2},desc:'Kış Geldi. Kuzeyliler güçleniyor.',weather:'snow',goldMod:0.7,armyMod:0.85},
];

const RANDOM_EVENTS = [
  {id:'harvest',icon:'🌾',title:'Bereketli Hasat',color:'#4a9c30',desc:'Topraklar bu yıl bol ürün verdi.',effect:(k)=>{const g=Math.floor(50+Math.random()*40);k.gold+=g;k.morale=Math.min(100,(k.morale||80)+8);return `+${g} Altın, +8 Moral`;}},
  {id:'plague',icon:'🐀',title:'Kara Veba',color:'#a06020',desc:'Hastalık ordular arasında yayıldı.',effect:(k)=>{const l=Math.floor(15+Math.random()*20);k.army=Math.max(5,(k.army||50)-l);k.morale=Math.max(0,(k.morale||80)-15);return `-${l} Asker, -15 Moral`;}},
  {id:'goldmine',icon:'💎',title:'Altın Madeni',color:'#c8960a',desc:'Topraklarda zengin altın damarı keşfedildi!',effect:(k)=>{const g=Math.floor(100+Math.random()*80);k.gold+=g;k.territory=(k.territory||60)+8;return `+${g} Altın, +8 Toprak`;}},
  {id:'storm',icon:'🌊',title:'Büyük Fırtına',color:'#4a88c8',desc:'Deniz fırtınası donanmaya zarar verdi.',effect:(k)=>{const l=Math.floor(10+Math.random()*15);k.navy=Math.max(0,(k.navy||0)-l);k.gold=Math.max(0,(k.gold||0)-20);return `-${l} Gemi, -20 Altın`;}},
  {id:'royal_heir',icon:'👶',title:'Kraliyet Varisi Doğdu',color:'#c8386a',desc:'Hanedanlığa yeni bir varis katıldı!',effect:(k)=>{if ((k.marriageAlliances || []).length === 0) return 'Evlilik ittifakı yok, etki yok.';const gold = Math.floor(50 + Math.random() * 50);const morale = Math.min(100, (k.morale || 80) + 15);const territory = (k.territory || 60) + 3;k.gold += gold;k.morale = morale;k.territory = territory;return `+${gold} Altın, +15 Moral, +3 Toprak`;}},
  {id:'festival',icon:'🎭',title:'Işık Festivali',color:'#e8784a',desc:'Büyük şenlik. Halk neşeli, askerler şevkli.',effect:(k)=>{k.morale=Math.min(100,(k.morale||80)+25);return `+25 Moral`;}},
  {id:'wildfire',icon:'🔥',title:'Yeşil Ateş',color:'#4a9c30',desc:'Sızan Yeşil Ateş büyük tahribat!',effect:(k)=>{k.army=Math.max(5,(k.army||50)-25);k.gold=Math.max(0,(k.gold||0)-60);return `-25 Asker, -60 Altın`;}},
  {id:'knight',icon:'⚔️',title:'Ünlü Şövalye',color:'#c8960a',desc:'Efsanevi savaşçı hizmete katıldı!',effect:(k)=>{k.army=(k.army||50)+20;k.morale=Math.min(100,(k.morale||80)+10);return `+20 Asker, +10 Moral`;}},
  {id:'prophecy',icon:'🔮',title:'Kırmızı Rahibenin Kehaneti',color:'#c8430a',desc:'Azor Ahai yeniden doğdu.',effect:(k)=>{k.morale=Math.min(100,(k.morale||80)+20);return `+20 Moral`;}},
  {id:'drought',icon:'☀️',title:'Kuraklık',color:'#d4a060',desc:'Uzun kuraklık geliri vurdu.',effect:(k)=>{const l=Math.floor(30+Math.random()*30);k.gold=Math.max(0,(k.gold||0)-l);return `-${l} Altın`;}},
  {id:'rebellion',icon:'✊',title:'İç Kargaşa',color:'#e85050',desc:'Lordların fısıltıları köylüleri karıştırdı.',effect:(k)=>{k.territory=Math.max(10,(k.territory||60)-10);k.morale=Math.max(0,(k.morale||80)-20);return `-10 Toprak, -20 Moral`;}},
  {id:'trade_wind',icon:'⛵',title:'Ticaret Rüzgarı',color:'#20c8a0',desc:'Deniz yolları beklenmedik canlandı.',effect:(k)=>{const bonus=((k.trades||[]).length+1)*30;k.gold+=bonus;return `+${bonus} Altın`;}},
  {id:'dragon_sighting',icon:'🐉',title:'Ejderha Görüldü',color:'#c8430a',desc:'Ufuklarda ejderha gölgesi.',effect:(k)=>{k.morale=Math.max(0,(k.morale||80)-15);return `-15 Moral`;}},
  {id:'royal_wedding',icon:'💍',title:'Nişan Haberi',color:'#c8386a',desc:'Komşu haneden nişan teklifi!',effect:(k)=>{k.gold+=50;k.territory=(k.territory||60)+5;return `+50 Altın, +5 Toprak`;}},
  {id:'winter_stores',icon:'🧊',title:'Kış Hazırlığı',color:'#8faabb',desc:'Verimli kış hazırlıkları.',effect:(k)=>{k.gold+=40;k.army=(k.army||50)+10;return `+40 Altın, +10 Asker`;}},
];

const TECHNOLOGIES = {
  military:[
    {id:'iron_weapons',name:'Demir Silahlar',icon:'⚔️',desc:'+15% Savaş gücü',cost:150,turns:1,color:'#e85050',bonus:{battleMod:0.15}},
    {id:'cavalry',name:'Süvari Birlikleri',icon:'🐎',desc:'+20% Saldırı gücü',cost:200,turns:2,color:'#e85050',bonus:{attackMod:0.20}},
    {id:'siege_weapons',name:'Kuşatma Makineleri',icon:'🏰',desc:'+25% Kuşatma avantajı',cost:250,turns:2,color:'#e85050',bonus:{siegeMod:0.25}},
    {id:'dragonbone_armor',name:'Ejderha Zırhı',icon:'🐉',desc:'+30% Savunma',cost:350,turns:3,color:'#c8430a',bonus:{defenseMod:0.30}},
  ],
  economy:[
    {id:'farming',name:'Gelişmiş Çiftçilik',icon:'🌾',desc:'+25% Vergi geliri',cost:120,turns:1,color:'#4a9c30',bonus:{goldMod:0.25}},
    {id:'harbors',name:'Büyük Limanlar',icon:'⚓',desc:'+30% Donanma',cost:180,turns:2,color:'#4a88c8',bonus:{navyMod:0.30,tradeIncome:10}},
    {id:'trade_network',name:'Ticaret Ağı',icon:'🛤️',desc:'+15 Altın/tur',cost:200,turns:2,color:'#20c8a0',bonus:{tradeIncome:15}},
    {id:'banking',name:'Lannister Bankacılığı',icon:'💰',desc:'+40% Vergi geliri',cost:300,turns:3,color:'#c8960a',bonus:{goldMod:0.40}},
  ],
  diplomacy:[
    {id:'spy_network',name:'Casus Ağı',icon:'🕵️',desc:'+25% Casusluk başarısı',cost:130,turns:1,color:'#9040c0',bonus:{spyMod:0.25}},
    {id:'marriage_law',name:'Evlilik Yasaları',icon:'💍',desc:'Evlilik ücreti -50%',cost:160,turns:1,color:'#c8386a',bonus:{marriageCostMod:0.5}},
    {id:'ravens',name:'Kuzgun Ağı',icon:'🐦‍⬛',desc:'Erken uyarı sistemi',cost:200,turns:2,color:'#8faabb',bonus:{earlyWarning:true}},
    {id:'grand_council',name:'Büyük Konsey',icon:'👑',desc:'+15% ilişki puanları',cost:280,turns:3,color:'#c8960a',bonus:{relationMod:0.15}},
  ],
};

const MERCENARY_COMPANIES = [
  {id:'golden_company',name:'Altın Şirket',icon:'💛',desc:'Westeros\'un en disiplinli paralı askerleri',troops:60,bonus:'Savaşta +25% güç',cost:200,duration:3,color:'#c8960a',battleBonus:0.25},
  {id:'second_sons',name:'İkinci Oğullar',icon:'⚔️',desc:'Essos\'un deneyimli savaşçıları',troops:40,bonus:'Savunmada +20% güç',cost:140,duration:2,color:'#4a88c8',battleBonus:0.20},
  {id:'stormcrows',name:'Fırtına Kargaları',icon:'🐦',desc:'Hızlı baskın uzmanları',troops:30,bonus:'Saldırıda +30% güç',cost:120,duration:2,color:'#9040c0',battleBonus:0.30},
  {id:'unsullied',name:'Kirlilememiş',icon:'🛡️',desc:'Astapor\'un seçkin piyadeleri',troops:50,bonus:'Savunmada +35% güç',cost:250,duration:4,color:'#4a9c30',battleBonus:0.35},
  {id:'dothraki',name:'Dothrak Süvarileri',icon:'🏇',desc:'Kalabalık bozkır savaşçıları',troops:80,bonus:'Savaşta +15% güç',cost:180,duration:2,color:'#c8430a',battleBonus:0.15},
];

const ACHIEVEMENTS_DEF = [
  {id:'first_battle',icon:'⚔️',name:'İlk Kan',desc:'İlk savaşı başlat',check:(gs,ks)=>gs.totalBattles>=1},
  {id:'conqueror',icon:'♛',name:'Fatih',desc:'3 krallık fethet',check:(gs,ks)=>ks.some(k=>(k.conquests||0)>=3)},
  {id:'iron_throne',icon:'🏰',name:'Demir Taht',desc:'Demir Taht\'ı kazan',check:(gs,ks)=>ks.some(k=>calculateThroneScore(k)>=6)},
  {id:'rich',icon:'💰',name:'Lannister',desc:'500+ Altın biriktir',check:(gs,ks)=>ks.some(k=>(k.gold||0)>=500)},
  {id:'diplomat',icon:'🤝',name:'Diplomat',desc:'5 ittifak kur',check:(gs,ks)=>gs.totalAlliances>=5},
  {id:'trader',icon:'📦',name:'Tüccar',desc:'5 ticaret rotası kur',check:(gs,ks)=>gs.totalTrades>=5},
  {id:'spymaster',icon:'🕵️',name:'Gölge Lordu',desc:'5 casusluk yap',check:(gs,ks)=>gs.totalSpyOps>=5},
  {id:'tech_master',icon:'🔬',name:'Bilge Efendi',desc:'10 teknoloji araştır',check:(gs,ks)=>gs.totalTechs>=10},
  {id:'winter_king',icon:'❄️',name:'Kış Efendisi',desc:'Kış\'ta 5 savaş kazan',check:(gs,ks)=>gs.winterWins>=5},
  {id:'night_king_slayer',icon:'🧊',name:'Gece Baskını',desc:'Gece Kralı tehdidini azalt',check:(gs,ks)=>gs.nkRepelled>=1},
  {id:'great_house',icon:'👑',name:'Büyük Hane',desc:'3 evlilik ittifakı kur',check:(gs,ks)=>gs.totalMarriages>=3},
  {id:'married_well',icon:'💍',name:'İyi Evlilik',desc:'Evlilik ittifakı kur',check:(gs,ks)=>gs.totalMarriages>=1},
  {id:'mercenary_lord',icon:'⚔️',name:'Paralı Lord',desc:'Paralı asker kirala',check:(gs,ks)=>gs.totalMercs>=1},
  {id:'turn_50',icon:'📜',name:'Tarih Yazılıyor',desc:'50 tur oyna',check:(gs,ks)=>gs.turn>=50},
];

function calculateThroneScore(k){ return (k.conquests||0)+Math.floor(((k.alliances||[]).length)*0.5)+Math.floor(((k.trades||[]).length)*0.3); }

const COUNCIL_SEATS=[
  {id:'hand',role:'El',icon:'✋',desc:'Krallık yönetimi',colorVar:'#c8960a',bonus:'+15% Vergi'},
  {id:'master_coin',role:'Altın Ustası',icon:'🪙',desc:'Hazine kontrolü',colorVar:'#e8b420',bonus:'+20% Altın Geliri'},
  {id:'master_war',role:'Savaş Ustası',icon:'⚔️',desc:'Askeri strateji',colorVar:'#e85050',bonus:'+15% Savaş Gücü'},
  {id:'master_whisperers',role:'Fısıltı Ustası',icon:'🕵️',desc:'İstihbarat',colorVar:'#c080e8',bonus:'+20% Casusluk'},
  {id:'kingsguard',role:'Kral Muhafızı',icon:'🛡️',desc:'Koruma',colorVar:'#4acc88',bonus:'+20% Savunma'},
];

const SPY_OPS=[
  {id:'recon',name:'Keşif',icon:'🔭',desc:'Tüm kaynakları gör',cost:30,successRate:0.9},
  {id:'steal_gold',name:'Hazine Hırsızlığı',icon:'💰',desc:'Altın çal (10-40)',cost:50,successRate:0.65},
  {id:'sabotage_army',name:'Ordu Sabotajı',icon:'💣',desc:'Orduyu zayıflat',cost:70,successRate:0.55},
  {id:'assassinate',name:'Suikast',icon:'🗡️',desc:'Gücü kalıcı düşür',cost:120,successRate:0.40},
  {id:'incite_revolt',name:'İsyan Kışkırtma',icon:'🔥',desc:'Vasıl isyanı tetikle',cost:100,successRate:0.45},
  {id:'forge_treaty',name:'Anlaşma Sabotajı',icon:'📜',desc:'Düşman ittifaklarını çökert',cost:80,successRate:0.50},
];

const TRADE_GOODS=['Tahıl 🌾','Şarap 🍷','Silah ⚔️','Kumaş 🧶','Baharat 🌶️','Demir ⛏️','Ahşap 🌲','Porselen 🏺'];

const INIT_KINGDOMS=[
  {id:'umit',name:'Ümit Targeryan',house:':Targeryan',title:'Ejderhanın Varisi, Demir Taht Hâkimi',sigil:'🐉',color:'#c8430a',photo:'resimler/umit.jpg',x:3885,y:5370,territory:90,army:100,navy:45,gold:80,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'berkalp',name:'Berkalp Stark',house:':Stark',title:'Kuzey Lordu, Winterfell Muhafızı',sigil:'🐺',color:'#8faabb',photo:'resimler/berkalp.jpg',x:1525,y:1750,territory:40,army:400,navy:15,gold:30,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'ziya',name:'Ziya Tyrell',house:':Tyrell',title:'The Reach Lordu',sigil:'🌹',color:'#4a9c30',photo:'resimler/ziya.jpg',x:1185,y:4040,territory:75,army:100,navy:30,gold:100,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'berk',name:'Berk Tyrell',house:':Tyrell',title:'The Reach Şövalyesi',sigil:'🌹',color:'#20c8a0',photo:'resimler/berk.jpg',x:1095,y:4040,territory:65,army:90,navy:20,gold:100,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'olena',name:'Olena Tyrell',house:':Tyrell',title:'Çiçekler Kraliçesi',sigil:'🌹',color:'#c8386a',photo:'resimler/olena.jpg',x:1145,y:3990,territory:70,army:90,navy:10,gold:100,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'cersei',name:'Cersei Lannister',house:':Lannister',title:'Westerland Kraliçesi',sigil:'🦁',color:'#c8960a',photo:'resimler/cercei.jpg',x:1750,y:3580,territory:85,army:130,navy:40,gold:70,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'stannis',name:'Stannis Baratheon',house:':Baratheon',title:'Fırtınaların Efendisi',sigil:'🦌',color:'#e8b050',photo:'resimler/stannis.png',x:2100,y:3270,territory:72,army:100,navy:50,gold:25,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'doran',name:'Doran Martell',house:':Martell',title:'Dorne Prensi',sigil:'☀️',color:'#e06090',photo:'resimler/martell.jpg',x:1610,y:4560,territory:78,army:95,navy:25,gold:45,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'balon',name:'Balon Greyjoy',house:':Greyjoy',title:'Demir Adaların Lordu',sigil:'🐙',color:'#888888',photo:'resimler/balon.jpg',x:920,y:2900,territory:60,army:70,navy:80,gold:30,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'robin',name:'Robin Arryn',house:':Arryn',title:'Vadi Lordu',sigil:'🦅',color:'#4a88c8',photo:'resimler/robin.jpg',x:1850,y:2790,territory:68,army:85,navy:20,gold:50,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'jon',name:'Jon Snow',house:':Stark',title:'Duvar Muhafızı',sigil:'🦅',color:'#5a78aa',photo:'resimler/jon.jpg',x:1650,y:1060,territory:55,army:55,navy:5,gold:20,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'twin',name:'Twin Lannister',house:':Lannister',title:'Kraliçenin Eli',sigil:'🦁',color:'#d4a060',photo:'resimler/twin.jpg',x:1050,y:3360,territory:68,army:85,navy:15,gold:80,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'Xaro',name:'Xaro Xhoan Daxos',house:':Qarth',title:'Qarth Kralı',sigil:'🏔️',color:'#d4a060',photo:'resimler/xaro.jpg',x:6190,y:5140,territory:68,army:85,navy:15,gold:75,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
  {id:'Night King',name:'Night King',house:'Night King',title:'Dünyayı sonsuz geceye hapsetmek',sigil:'❄️',color:'#88bbdd',photo:'resimler/night.jpg',x:1400,y:300,territory:0,army:9999,navy:0,gold:0,conquests:0,conquered:null,pts:[],showT:true,alliances:[],trades:[],spies:[],spiedBy:[],morale:100,council:{},status:'neutral'},
];

const INIT_MARKERS = [
  {id: 'hotpie',name: 'Hotpie',type: 'npc',icon: '🍞',x: 1700,y: 3100,color: '#d4a060',description: 'Nehir Topraklarında Aşçı',photo: 'resimler/hotpie.jpg'}, 
  
  {id: 'demir_taht_fig', name: 'Demir Taht', type: 'figure', icon: '', x: 1660, y: 3552, color: 'transparent', description: '', photo: 'resimler/taht.png', noPopup: true, size: 170},
  
  {id: 'ejderha1_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 3485, y: 5570, color: 'transparent', description: '', photo: 'resimler/ejderha1.png', noPopup: true, size: 135},
  {id: 'ejderha2_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 4155, y: 5370, color: 'transparent', description: '', photo: 'resimler/ejderha2.png', noPopup: true, size: 70},
  {id: 'ejder1_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 4155, y: 5059, color: 'transparent', description: '', photo: 'resimler/ejder1.png', noPopup: true, size: 110},
  {id: 'ejder2_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 3905, y: 5655, color: 'transparent', description: '', photo: 'resimler/ejder2.png', noPopup: true, size: 90}, 
  {id: 'ejder3_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 3670, y: 5370, color: 'transparent', description: '', photo: 'resimler/ejder3.png', noPopup: true, size: 100},
  {id: 'ejder4_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 3705, y: 5000, color: 'transparent', description: '', photo: 'resimler/ejder4.png', noPopup: true, size: 80},
  {id: 'ejder5_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 3600, y: 5200, color: 'transparent', description: '', photo: 'resimler/ejder5.png', noPopup: true, size: 135},
  {id: 'ejder6_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 4145, y: 4869, color: 'transparent', description: '', photo: 'resimler/ejder6.png', noPopup: true, size: 95}, 
  {id: 'ejderha3_fig', name: 'Büyük Ejderha', type: 'figure', icon: '', x: 4125, y: 5483, color: 'transparent', description: '', photo: 'resimler/ejderha3.png', noPopup: true, size: 55}, 


  {id: 'olu1_fig', name: 'Ordu1', type: 'figure', icon: '', x: 1665, y: 236, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu2_fig', name: 'Ordu2', type: 'figure', icon: '', x: 1322, y: 250, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu3_fig', name: 'Ordu3', type: 'figure', icon: '', x: 1070, y: 324, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu4_fig', name: 'Ordu4', type: 'figure', icon: '', x: 985, y: 324, color: 'transparent', description: '', photo: 'resimler/yarım2.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu5_fig', name: 'Ordu5', type: 'figure', icon: '', x: 1155, y: 324, color: 'transparent', description: '', photo: 'resimler/yarım.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu6_fig', name: 'Ordu6', type: 'figure', icon: '', x: 1575, y: 394, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu7_fig', name: 'Ordu7', type: 'figure', icon: '', x: 830, y: 412, color: 'transparent', description: '', photo: 'resimler/yarım2.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu8_fig', name: 'Ordu8', type: 'figure', icon: '', x: 915, y: 412, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu9_fig', name: 'Ordu9', type: 'figure', icon: '', x: 1000, y: 412, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu10_fig', name: 'Ordu10', type: 'figure', icon: '', x: 1085, y: 412, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu11_fig', name: 'Ordu11', type: 'figure', icon: '', x: 1090, y: 500, color: 'transparent', description: '', photo: 'resimler/yarım.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu12_fig', name: 'Ordu12', type: 'figure', icon: '', x: 1005, y: 500, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu13_fig', name: 'Ordu13', type: 'figure', icon: '', x: 920, y: 500, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu14_fig', name: 'Ordu14', type: 'figure', icon: '', x: 835, y: 500, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu15_fig', name: 'Ordu15', type: 'figure', icon: '', x: 1590, y: 615, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu16_fig', name: 'Ordu16', type: 'figure', icon: '', x: 585, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu17_fig', name: 'Ordu17', type: 'figure', icon: '', x: 670, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu18_fig', name: 'Ordu18', type: 'figure', icon: '', x: 755, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu19_fig', name: 'Ordu19', type: 'figure', icon: '', x: 840, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu20_fig', name: 'Ordu20', type: 'figure', icon: '', x: 925, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu21_fig', name: 'Ordu21', type: 'figure', icon: '', x: 1010, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu22_fig', name: 'Ordu22', type: 'figure', icon: '', x: 1095, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu23_fig', name: 'Ordu23', type: 'figure', icon: '', x: 1180, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu24_fig', name: 'Ordu24', type: 'figure', icon: '', x: 1265, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu25_fig', name: 'Ordu25', type: 'figure', icon: '', x: 1350, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu26_fig', name: 'Ordu26', type: 'figure', icon: '', x: 1435, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu27_fig', name: 'Ordu27', type: 'figure', icon: '', x: 1520, y: 40, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu28_fig', name: 'Ordu28', type: 'figure', icon: '', x: 645, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu29_fig', name: 'Ordu29', type: 'figure', icon: '', x: 730, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu30_fig', name: 'Ordu30', type: 'figure', icon: '', x: 815, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu31_fig', name: 'Ordu31', type: 'figure', icon: '', x: 900, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu32_fig', name: 'Ordu32', type: 'figure', icon: '', x: 985, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu33_fig', name: 'Ordu33', type: 'figure', icon: '', x: 1070, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu34_fig', name: 'Ordu34', type: 'figure', icon: '', x: 1155, y: 125, color: 'transparent', description: '', photo: 'resimler/olu1.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'olu35_fig', name: 'Ordu35', type: 'figure', icon: '', x: 1230, y: 250, color: 'transparent', description: '', photo: 'resimler/yarım2.png', noPopup: true, size: 90, isGlowing: false },

  {id: 'gemi1_fig', name: 'Gemi', type: 'figure', icon: '', x: 2040, y: 3480, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 130, isGlowing: false },
  {id: 'gemi2_fig', name: 'Gemi', type: 'figure', icon: '', x: 2130, y: 3390, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi3_fig', name: 'Gemi', type: 'figure', icon: '', x: 2000, y: 3400, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi4_fig', name: 'Gemi', type: 'figure', icon: '', x: 2030, y: 3560, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi5_fig', name: 'Gemi', type: 'figure', icon: '', x: 2160, y: 3555, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi6_fig', name: 'Gemi', type: 'figure', icon: '', x: 2190, y: 3660, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi7_fig', name: 'Gemi', type: 'figure', icon: '', x: 2160, y: 3555, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi8_fig', name: 'Gemi', type: 'figure', icon: '', x: 2190, y: 3690, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi9_fig', name: 'Gemi', type: 'figure', icon: '', x: 2160, y: 3505, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi10_fig', name: 'Gemi', type: 'figure', icon: '', x: 2190, y: 3610, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi11_fig', name: 'Gemi', type: 'figure', icon: '', x: 2160, y: 3585, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi12_fig', name: 'Gemi', type: 'figure', icon: '', x: 2090, y: 3640, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi13_fig', name: 'Gemi', type: 'figure', icon: '', x: 2290, y: 3690, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi14_fig', name: 'Gemi', type: 'figure', icon: '', x: 2260, y: 3505, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi15_fig', name: 'Gemi', type: 'figure', icon: '', x: 2290, y: 3610, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi16_fig', name: 'Gemi', type: 'figure', icon: '', x: 2260, y: 3585, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi17_fig', name: 'Gemi', type: 'figure', icon: '', x: 2290, y: 3640, color: 'transparent', description: '', photo: 'resimler/gemi.png', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi18_fig', name: 'Gemi', type: 'figure', icon: '', x: 2390, y: 3760, color: 'transparent', description: '', photo: 'resimler/gemis.png', noPopup: true, size: 282, isGlowing: false },
  {id: 'gemi19_fig', name: 'Gemi', type: 'figure', icon: '', x: 2190, y: 3760, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi20_fig', name: 'Gemi', type: 'figure', icon: '', x: 2320, y: 3420, color: 'transparent', description: '', photo: 'resimler/gemis.png', noPopup: true, size: 282, isGlowing: false },
  {id: 'gemi21_fig', name: 'Gemi', type: 'figure', icon: '', x: 2390, y: 3500, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi22_fig', name: 'Gemi', type: 'figure', icon: '', x: 2400, y: 3540, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi23_fig', name: 'Gemi', type: 'figure', icon: '', x: 2420, y: 3575, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi24_fig', name: 'Gemi', type: 'figure', icon: '', x: 2380, y: 3660, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi25_fig', name: 'Gemi', type: 'figure', icon: '', x: 2450, y: 3800, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  {id: 'gemi26_fig', name: 'Gemi', type: 'figure', icon: '', x: 2480, y: 3850, color: 'transparent', description: '', photo: 'resimler/gemi0.PNG', noPopup: true, size: 90, isGlowing: false },
  
  {id: 'bravos1_fig', name: 'Bravos', type: 'figure', icon: '', x: 2610, y: 2620, color: 'transparent', description: '', photo: 'resimler/bravos.png', noPopup: true, size: 145, isGlowing: false },

];

/**
 * Parlamayı Yöneten Fonksiyonlar
 */

// Belirli bir marker'ın parlamasını aç/kapat
function toggleMarkerGlow(markerId, status) {
  const marker = INIT_MARKERS.find(m => m.id === markerId);
  if (marker) {
    marker.isGlowing = status;
    console.log(`${marker.name} parlaması ${status ? 'AKTİF' : 'KAPALI'}`);
    // Uygulama mantığında marker'ı güncelleyen render fonksiyonunu buraya ekleyebilirsin
  }
}

// Tüm markerların parlamasını toplu aktifleştir
function activateAllGlows() {
  INIT_MARKERS.forEach(m => m.isGlowing = true);
  console.log("Tüm parlamalar aktifleştirildi.");
}

// Tüm parlamaları kapat
function deactivateAllGlows() {
  INIT_MARKERS.forEach(m => m.isGlowing = false);
  console.log("Tüm parlamalar kapatıldı.");
}

let markers = [];
let kingdoms=[];
let chronicles=[];
let globalState={
  season:0,turn:1,totalBattles:0,totalAlliances:0,totalTrades:0,
  totalSpyOps:0,totalTechs:0,totalMercs:0,totalMarriages:0,
  winterWins:0,nkRepelled:0,
  researchedTechs:{},researchQueue:{},
  unlockedAchievements:[],
  powerHistory:{},
  throneKingdomId: null,
};
let nightKingThreat=0;
// FİX: powerHistory artık sadece globalState içinde tutuluyor (önceden duplicate vardı)
// globalState.powerHistory kullanılıyor
let sc=1,tx=0,ty=0;
let dragging=false,didDrag=false,lastX=0,lastY=0;
let lastPinchDist=0;
let mode=null,modeKid=null;
let terrPts=[];
let addColor=COLORS[0],addSigil=SIGILS[0];
let editColor=COLORS[0],editSigil=SIGILS[0];
let sbOpen=false;
let confCb=null;
let allySourceId=null,allyTargetId=null;
let currentDetailId=null;
let battleState={};
let spyState={sourceId:null,targetId:null};
let techModalKid=null;
let mercModalKid=null;
let initialSc=1,initialTx=0,initialTy=0;
let pendingRender=false;
let eventQueue=[];
let showingEvent=false;
let victoryShown=false;
let autoTurnActive=false;
let autoTurnInterval=null;
let autoTurnSpeed=3000;
let fabOpen=false;
let longPressTimer=null;
let ctxMenuKid=null;
let touchStartX=0, touchStartY=0;
let touchLastX=0, touchLastY=0;
let isTouchDragging=false;
let touchDidDrag=false;

// ── Hızlı kingdom lookup map (O(1) erişim)
let _kingdomMap = new Map();
function rebuildKingdomMap() {
  _kingdomMap.clear();
  kingdoms.forEach(k => _kingdomMap.set(k.id, k));
}
function findKingdom(id) { return _kingdomMap.get(id) || null; }

/* ════════ FIREBASE DATA ════════ */
async function loadData(){
  try{
    const s=await db.collection('got3').doc('kingdoms').get();
    kingdoms=s.exists?(s.data().list||cloneInit()):cloneInit();
    kingdoms.forEach(ensureKingdomDefaults);
    rebuildKingdomMap();
    
    const m=await db.collection('got3').doc('markers').get();
    let loadedMarkers = m.exists ? (m.data().list || []) : [];
    
    const loadedIds = new Set(loadedMarkers.map(lm => lm.id));
    INIT_MARKERS.forEach(initM => {
      if(!loadedIds.has(initM.id)) loadedMarkers.push(initM);
    });
    markers = loadedMarkers;
    
    const gs=await db.collection('got3').doc('global').get();
    if(gs.exists) globalState={...globalState,...gs.data()};
    nightKingThreat=globalState.nightKingThreat||0;
    const cr=await db.collection('got3').doc('chronicles').get();
    chronicles=cr.exists?(cr.data().events||[]):[];
    if(!s.exists) await saveData();
  }catch(e){
    console.error(e);
    kingdoms=cloneInit();
    kingdoms.forEach(ensureKingdomDefaults);
    rebuildKingdomMap();
    markers=[...INIT_MARKERS];
    toast('⚠️ Yerel veri kullanılıyor');
    chronicles=[];
  }
}


function ensureKingdomDefaults(k){
  if(!k.pts) k.pts=[];
  if(k.showT===undefined) k.showT=true;
  if(!k.territory) k.territory=60;
  if(!k.army) k.army=80;
  if(!k.navy) k.navy=20;
  if(!k.gold) k.gold=200;
  if(!k.alliances) k.alliances=[];
  if(!k.trades) k.trades=[];
  if(!k.spies) k.spies=[];
  if(!k.spiedBy) k.spiedBy=[];
  if(k.morale===undefined) k.morale=100;
  if(!k.council) k.council={};
  if(!k.status) k.status='neutral';
  if(!k.blockades) k.blockades=[];
  if(!k.marriageAlliances) k.marriageAlliances=[];
  if(!k.mercenaries) k.mercenaries=[];
}

async function saveData(){
  try{
    globalState.nightKingThreat=nightKingThreat;
    await Promise.all([
      db.collection('got3').doc('kingdoms').set({list:kingdoms}),
      db.collection('got3').doc('markers').set({list:markers}),
      db.collection('got3').doc('global').set(globalState),
      db.collection('got3').doc('chronicles').set({events:chronicles.slice(-100)}),
    ]);
  }catch(e){ toast('⚠️ Kayıt hatası'); }
}

async function saveChronicles(){
  try{ await db.collection('got3').doc('chronicles').set({events:chronicles.slice(-100)}); }catch(e){ console.error("Kronoloji kaydetme hatası:", e); toast('⚠️ Kronoloji kaydetme hatası!'); }
}
const cloneInit=()=>JSON.parse(JSON.stringify(INIT_KINGDOMS));

/* ════════ IRON THRONE SELECTOR ════════ */
function openThroneSelector(){
  const selector=document.getElementById('throne-selector');
  const list=document.getElementById('throne-kingdom-list');
  const currentLeader=getThroneLeader();
  
  const sorted=[...kingdoms].filter(k=>!k.conquered).sort((a,b)=>power(b)-power(a));
  
  list.innerHTML=sorted.map(k=>{
    const hasPhoto=k.photo&&k.photo.trim();
    const pw=power(k);
    const isCurrent=currentLeader&&currentLeader.id===k.id;
    const isManual=globalState.throneKingdomId===k.id;
    return `
      <div class="throne-k-row${isCurrent?' current':''}" style="--kc:${k.color}" onclick="setThroneKingdom('${k.id}')">
        <div class="throne-k-av" style="border-color:${k.color};color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;background-color:#1a1208;`:''};background:#1a1208;">
          ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`${k.name.charAt(0)}`}
        </div>
        <div class="throne-k-info">
          <div class="throne-k-name">${k.sigil} ${k.name}</div>
          <div class="throne-k-house">${k.house} · Güç: ${pw}</div>
        </div>
        <div class="throne-k-pwr">${isManual?'♛':pw}</div>
        ${isCurrent?`<div class="throne-current-badge">MEVCUT</div>`:''}
      </div>
    `;
  }).join('');
  
  // Add auto option
  list.innerHTML=`
    <div class="throne-k-row${!globalState.throneKingdomId?' current':''}" onclick="setThroneKingdom(null)" style="--kc:#c8960a;margin-bottom:8px;border-color:rgba(200,150,10,.3);">
      <div style="font-size:28px;flex-shrink:0;">🤖</div>
      <div class="throne-k-info">
        <div class="throne-k-name">Otomatik Seçim</div>
        <div class="throne-k-house">En güçlü krallık hükümdar olur</div>
      </div>
      ${!globalState.throneKingdomId?`<div class="throne-current-badge">AKTİF</div>`:''}
    </div>
    ${sorted.map(k=>{
      const hasPhoto=k.photo&&k.photo.trim();
      const pw=power(k);
      const isCurrent=(globalState.throneKingdomId===k.id);
      return `
        <div class="throne-k-row${isCurrent?' current':''}" style="--kc:${k.color}" onclick="setThroneKingdom('${k.id}')">
          <div class="throne-k-av" style="border-color:${k.color};color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;background-color:#1a1208;`:''}background:#1a1208;">
            ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`${k.name.charAt(0)}`}
          </div>
          <div class="throne-k-info">
            <div class="throne-k-name">${k.sigil} ${k.name}</div>
            <div class="throne-k-house">${k.house} · Güç: ${pw}</div>
          </div>
          <div class="throne-k-pwr" style="color:${k.color}">${pw}</div>
          ${isCurrent?`<div class="throne-current-badge">♛ SEÇİLİ</div>`:''}
        </div>
      `;
    }).join('')}
  `;
  
  selector.classList.add('open');
}

function closeThroneSelector(e){
  if(!e||e.target===document.getElementById('throne-selector'))
    document.getElementById('throne-selector').classList.remove('open');
}

/* ════════ VASSAL MANAGEMENT ════════ */
async function integrateVassal(vassalId) {
  const vassal = findKingdom(vassalId);
  if (!vassal || !vassal.conquered) return;
  const master = findKingdom(vassal.conquered);
  if (!master) return;

  const cost = 150;
  if (master.gold < cost) {
    toast(`⚠️ Vasil entegrasyonu için ${cost} Altın gerekli!`, 'error');
    return;
  }

  master.gold -= cost;
  master.territory += vassal.territory;
  master.morale = Math.min(100, (master.morale||80) + 10);
  vassal.conquered = null;
  vassal.status = 'integrated';

  addChronicle('🤝', `${vassal.name} Entegre Edildi`, `${master.name}, ${vassal.name} topraklarını kendi bünyesine kattı.`, master.color);
  await saveData();
  renderAll();
  openDetail(master.id);
}

/* ════════ CHRONICLE ════════ */
async function setThroneKingdom(kid){
  globalState.throneKingdomId=kid;
  document.getElementById('throne-selector').classList.remove('open');
  updateThroneWidget();
  await saveData();
  const k=kid?findKingdom(kid):null;
  if(k) toast(`♛ ${k.name} Demir Taht'a çıktı!`,'achievement');
  else toast('🤖 Otomatik lider seçimi aktif');
}

function getThroneLeader(){
  if(globalState.throneKingdomId){
    const manual=findKingdom(globalState.throneKingdomId);
    if(manual&&!manual.conquered) return manual;
  }
  const sorted=[...kingdoms].sort((a,b)=>power(b)-power(a));
  return sorted[0]||null;
}

/* ════════ CHRONICLE ════════ */
function addChronicle(icon,title,desc,color='var(--gold)'){
  const season=SEASONS[globalState.season];
  chronicles.unshift({icon,title,desc,color,turn:globalState.turn,season:season.name,time:new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})});
  if(chronicles.length>100) chronicles.pop();
  saveChronicles();
}

/* ════════ SEASON + TURN ════════ */
function triggerSeasonAdvance(){
  const season=SEASONS[(globalState.season+1)%4];
  const overlay=document.getElementById('season-transition');
  document.getElementById('st-icon').textContent=season.icon;
  document.getElementById('st-name').textContent=season.name;
  overlay.style.setProperty('--st-color', season.color);
  overlay.classList.add('show');
  sfxSeason();
  setTimeout(()=>overlay.classList.remove('show'),1800);
  setTimeout(()=>advanceSeason(),400);
}

function advanceSeason(){
  globalState.season=(globalState.season+1)%4;
  globalState.turn++;
  playSFX('notification');  // ✓ Tur başlangıcı ses
  processTurnIncome();
  processResearchQueue();
  processMercenaryDuration();
  triggerRandomEvents();
  updateNightKing();
  checkAllAchievements();
  updateSeasonUI();
  applyWeather();
  // renderAll'ı bir sonraki frame'e ertele — main thread'i bloke etmez
  requestAnimationFrame(()=>renderAll());
  saveData();
  const s=SEASONS[globalState.season];
  addChronicle(s.icon,`${s.name} Başladı`,s.desc,'var(--gold)');
  updateTurnProgress();
  updateGlobalBar();
  updateThroneWidget();
  checkVictory();
}

function processTurnIncome(){
  const season=SEASONS[globalState.season];
  kingdoms.forEach(k=>{
    if(k.conquered) return;
    const councilBonus=k.council&&(k.council.master_coin||k.council.hand)?1.2:1;
    const techBonus=getTechBonus(k,'goldMod');
    const tradeCount=(k.trades||[]).length;
    const techTradeIncome=getTechBonus(k,'tradeIncome');
    const tradeBonus=1+tradeCount*(0.05+techTradeIncome*0.01);
    const blockadePenalty=(k.blockades||[]).length>0?0.7:1;
    const baseIncome=Math.round((20+(k.territory||0)*.1+(k.conquests||0)*8)*season.goldMod*councilBonus*(1+techBonus)*tradeBonus*blockadePenalty);
    k.gold=(k.gold||0)+baseIncome;
    // Ticaret geliri: her rota için ayrıca
    const tradeInc=15+getTechBonus(k,'tradeIncome');
    k.gold+=tradeCount*tradeInc;
    k.morale=Math.min(100,(k.morale||80)+3);
    if(!globalState.powerHistory) globalState.powerHistory={};
    if(!globalState.powerHistory[k.id]) globalState.powerHistory[k.id]=[];
    globalState.powerHistory[k.id].push({turn:globalState.turn,power:power(k)});
    if(globalState.powerHistory[k.id].length>20) globalState.powerHistory[k.id].shift();
  });
}

function processResearchQueue(){
  if(!globalState.researchQueue) return;
  const completed=[];
  Object.entries(globalState.researchQueue).forEach(([key,data])=>{
    data.turnsLeft--;
    if(data.turnsLeft<=0){
      completed.push(key);
      if(!globalState.researchedTechs) globalState.researchedTechs={};
      globalState.researchedTechs[data.techId]=true;
      globalState.totalTechs=(globalState.totalTechs||0)+1;
      invalidateTechCache();
      const tech=ALL_TECHNOLOGIES.find(t=>t.id===data.techId);
      const k=findKingdom(data.kingdomId);
      if(tech&&k){ sfxTech(); toast(`🔬 ${k.name}: "${tech.name}" tamamlandı!`); addChronicle('🔬',`Araştırma: ${tech.name}`,`${k.name}, ${tech.name} geliştirdi.`,k.color); }
    }
  });
  completed.forEach(k=>delete globalState.researchQueue[k]);
}

function processMercenaryDuration(){
  kingdoms.forEach(k=>{
    if(!k.mercenaries||!k.mercenaries.length) return;
    k.mercenaries=k.mercenaries.filter(m=>{
      m.turnsLeft--;
      if(m.turnsLeft<=0){
        const comp=MERCENARY_COMPANIES.find(c=>c.id===m.id);
        k.army=Math.max(5,(k.army||50)-(comp?comp.troops:0));
        toast(`${k.name}: "${comp?.name||'Paralı Asker'}" sözleşmesi bitti.`);
        return false;
      }
      return true;
    });
  });
}

// ── Tüm teknolojileri tek seferde oluştur (performans optimizasyonu)
const ALL_TECHNOLOGIES = [...TECHNOLOGIES.military, ...TECHNOLOGIES.economy, ...TECHNOLOGIES.diplomacy];

// Tech bonus cache: researchedTechs değişince temizlenir
let _techBonusCache = null;
let _techBonusCacheKey = null;

function getTechBonus(k, bonusKey) {
  if (!k || !globalState.researchedTechs) return 0;
  const cacheKey = Object.keys(globalState.researchedTechs).sort().join(',');
  if (_techBonusCacheKey !== cacheKey) {
    _techBonusCache = {};
    _techBonusCacheKey = cacheKey;
  }
  if (_techBonusCache[bonusKey] !== undefined) return _techBonusCache[bonusKey];
  let total = 0;
  ALL_TECHNOLOGIES.forEach(tech => {
    if (globalState.researchedTechs[tech.id] && tech.bonus && tech.bonus[bonusKey]) total += tech.bonus[bonusKey];
  });
  _techBonusCache[bonusKey] = total;
  return total;
}

function invalidateTechCache() { _techBonusCache = null; _techBonusCacheKey = null; }

/* ════════ AUTO-TURN ════════ */
function toggleAutoTurn(){
  autoTurnActive=!autoTurnActive;
  const indicator=document.getElementById('auto-indicator');
  const btn=document.getElementById('auto-btn');
  if(autoTurnActive){
    indicator.classList.add('active');
    btn.textContent='⏸ DURDUR';
    autoTurnInterval=setInterval(()=>{if(autoTurnActive) triggerSeasonAdvance();},autoTurnSpeed);
    toast('⏯ Oto-tur aktif!');
  } else {
    indicator.classList.remove('active');
    btn.textContent='⏯ OTO-TUR';
    clearInterval(autoTurnInterval);
    autoTurnInterval=null;
    toast('⏸ Oto-tur durduruldu');
  }
}
function setAutoSpeed(ms,el){
  autoTurnSpeed=ms;
  document.querySelectorAll('.auto-spd').forEach(s=>s.classList.remove('sel'));
  el.classList.add('sel');
  if(autoTurnActive){
    clearInterval(autoTurnInterval);
    autoTurnInterval=setInterval(()=>{if(autoTurnActive) triggerSeasonAdvance();},ms);
  }
}

/* ════════ CONTEXT MENU ════════ */
function showContextMenu(e,kid){
  e.preventDefault(); e.stopPropagation();
  const k=findKingdom(kid); if(!k) return;
  const menu=document.getElementById('ctx-menu');
  menu.style.display='block';
  const x=e.clientX||e.touches?.[0]?.clientX||0;
  const y=e.clientY||e.touches?.[0]?.clientY||0;
  menu.style.left=Math.min(x,window.innerWidth-200)+'px';
  menu.style.top=Math.min(y,window.innerHeight-300)+'px';
  ctxMenuKid=kid;
  menu.innerHTML=`
    <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);padding:6px 14px 4px;text-transform:uppercase;">${k.sigil} ${k.name}</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="openDetail('${kid}');closeCtx()">🏰 Detay Görüntüle</div>
    <div class="ctx-item" onclick="startConquer('${kid}');closeCtx()">⚔️ Savaş Başlat</div>
    <div class="ctx-item" onclick="openAllyMgr('${kid}');closeCtx()">🤝 İttifak</div>
    <div class="ctx-item" onclick="startTrade('${kid}');closeCtx()">📦 Ticaret</div>
    <div class="ctx-item" onclick="startSpy('${kid}');closeCtx()">🕵️ Casusluk</div>
    <div class="ctx-item" onclick="openCompare('${kid}');closeCtx()">⚖️ Karşılaştır</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="flyTo(${k.x},${k.y},0.32);closeCtx()">🗺️ Haritada Bul</div>
    <div class="ctx-item" onclick="startRepos('${kid}');closeCtx()">📍 Yeniden Konumlandır</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger" onclick="confirmDel('${kid}');closeCtx()">🗑️ Sil</div>
  `;
}
function closeCtx(){document.getElementById('ctx-menu').style.display='none';ctxMenuKid=null;}
document.addEventListener('click',e=>{if(!e.target.closest('.ctx-menu')) closeCtx();});

/* ════════ LONG-PRESS ════════ */
function startLongPress(e, kid){
  if(e.touches && e.touches.length > 1) return; // Multi-touch'u engelle
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    sfxClick();
    const touch = e.touches?.[0] || e;
    showContextMenu({
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => {},
      stopPropagation: () => {}
    }, kid);
  }, 600);
}
function cancelLongPress(){if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}}

/* ════════ COMPARISON ════════ */
function openCompare(kid){
  const k=findKingdom(kid); if(!k) return;
  const others=[...kingdoms].filter(k2=>k2.id!==kid&&!k2.conquered).sort((a,b)=>power(b)-power(a));
  const rival=others[0];
  if(!rival){toast('⚠️ Karşılaştırılacak başka krallık yok');return;}
  renderCompareModal(k,rival);
  document.getElementById('mo-compare').classList.add('open');
}

function renderCompareModal(k1,k2){
  const pw1=power(k1), pw2=power(k2);
  const rows=[
    {key:'Güç',v1:pw1,v2:pw2,icon:'👑'},{key:'Ordu',v1:k1.army||0,v2:k2.army||0,icon:'⚔️'},
    {key:'Donanma',v1:k1.navy||0,v2:k2.navy||0,icon:'⚓'},{key:'Altın',v1:k1.gold||0,v2:k2.gold||0,icon:'🥇'},
    {key:'Toprak',v1:k1.territory||60,v2:k2.territory||60,icon:'🗺️'},{key:'Fetih',v1:k1.conquests||0,v2:k2.conquests||0,icon:'⚔️'},
    {key:'İttifak',v1:(k1.alliances||[]).length,v2:(k2.alliances||[]).length,icon:'🤝'},
    {key:'Moral',v1:k1.morale||80,v2:k2.morale||80,icon:'💪'},
  ];
  const hasPhoto1=k1.photo&&k1.photo.trim();
  const hasPhoto2=k2.photo&&k2.photo.trim();
  document.getElementById('mo-compare').innerHTML=`
    <div class="mo-box">
      <div class="mo-handle" onclick="document.getElementById('mo-compare').classList.remove('open')"></div>
      <div class="mo-ttl">⚔️ KARŞILAŞTIRMA</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div style="text-align:center;background:rgba(200,150,10,.03);border:1px solid rgba(200,150,10,.1);border-radius:var(--radius-md);padding:14px;">
          <div style="width:60px;height:60px;border-radius:50%;margin:0 auto 10px;border:3px solid ${k1.color};overflow:hidden;display:grid;place-items:center;background:#1a1208;${hasPhoto1?`background-image:url('${k1.photo}');background-size:cover;background-position:center;`:''}">
            ${hasPhoto1?`<img src="${k1.photo}" onerror="this.style.display='none'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:`<span style="font-size:24px;color:${k1.color};font-weight:700">${k1.name.charAt(0)}</span>`}
          </div>
          <div style="font-family:'Cinzel',serif;font-size:12px;font-weight:700;color:var(--text);">${k1.name}</div>
          <div style="font-family:'Cinzel',serif;font-size:18px;color:${k1.color};font-weight:700;margin-top:6px;">${pw1}</div>
        </div>
        <div style="text-align:center;background:rgba(200,150,10,.03);border:1px solid rgba(200,150,10,.1);border-radius:var(--radius-md);padding:14px;">
          <div style="width:60px;height:60px;border-radius:50%;margin:0 auto 10px;border:3px solid ${k2.color};overflow:hidden;display:grid;place-items:center;background:#1a1208;${hasPhoto2?`background-image:url('${k2.photo}');background-size:cover;background-position:center;`:''}">
            ${hasPhoto2?`<img src="${k2.photo}" onerror="this.style.display='none'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`:`<span style="font-size:24px;color:${k2.color};font-weight:700">${k2.name.charAt(0)}</span>`}
          </div>
          <div style="font-family:'Cinzel',serif;font-size:12px;font-weight:700;color:var(--text);">${k2.name}</div>
          <div style="font-family:'Cinzel',serif;font-size:18px;color:${k2.color};font-weight:700;margin-top:6px;">${pw2}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${rows.map(r=>{
          const pct1=Math.round(r.v1/Math.max(r.v1,r.v2,1)*100);
          const pct2=Math.round(r.v2/Math.max(r.v1,r.v2,1)*100);
          const winner=r.v1>r.v2?'k1':r.v2>r.v1?'k2':'tie';
          return `<div style="background:rgba(200,150,10,.02);border:1px solid rgba(200,150,10,.08);border-radius:var(--radius-sm);padding:10px;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:1px;color:var(--text-dim);flex:1;">${r.icon} ${r.key}</div>
              <div style="font-family:'Cinzel',serif;font-size:10px;font-weight:700;color:${winner==='k1'?k1.color:'var(--text-dim)'};margin:0 8px;">${r.v1}</div>
              <div style="font-family:'Cinzel',serif;font-size:10px;font-weight:700;color:${winner==='k2'?k2.color:'var(--text-dim)'};">${r.v2}</div>
            </div>
            <div style="display:grid;grid-template-columns:${pct1}fr ${pct2}fr;gap:2px;height:6px;border-radius:3px;overflow:hidden;">
              <div style="background:${k1.color};opacity:.8;border-radius:3px;"></div>
              <div style="background:${k2.color};opacity:.8;border-radius:3px;"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:10px;">
        <button class="f-cancel" onclick="document.getElementById('mo-compare').classList.remove('open')">Kapat</button>
      </div>
    </div>
  `;
}

/* ════════ RANDOM EVENTS ════════ */
function triggerRandomEvents(){
  if(kingdoms.length===0) return;
  const eventCount=1+Math.floor(Math.random()*2);
  const available=kingdoms.filter(k=>!k.conquered);
  if(available.length===0) return;
  for(let i=0;i<eventCount;i++){
    const k=available[Math.floor(Math.random()*available.length)];
    const ev=RANDOM_EVENTS[Math.floor(Math.random()*RANDOM_EVENTS.length)];
    const effectDesc=ev.effect(k);
    addChronicle(ev.icon,`${ev.title} — ${k.name}`,`${ev.desc} Etki: ${effectDesc}`,ev.color);
    eventQueue.push({ev,k,effectDesc});
  }
  showNextEvent();
}

function showNextEvent(){
  if(showingEvent||eventQueue.length===0) return;
  showingEvent=true;
  const {ev,k,effectDesc}=eventQueue.shift();
  const overlay=document.getElementById('event-overlay');
  document.getElementById('event-icon').textContent=ev.icon;
  document.getElementById('event-name').textContent=ev.title;
  document.getElementById('event-kingdom').textContent=`${k.sigil} ${k.name}`;
  document.getElementById('event-effect').textContent=effectDesc;
  document.getElementById('event-card').style.setProperty('--ec',ev.color);
  overlay.classList.add('show');
  sfxEvent();
  setTimeout(()=>{
    overlay.classList.remove('show');
    setTimeout(()=>{showingEvent=false;if(eventQueue.length>0) setTimeout(showNextEvent,500);},400);
  },3200);
}

document.getElementById('event-overlay').addEventListener('click',()=>{
  document.getElementById('event-overlay').classList.remove('show');
  setTimeout(()=>{showingEvent=false;if(eventQueue.length>0) setTimeout(showNextEvent,400);},300);
});

/* ════════ NIGHT KING ════════ */
function updateNightKing(){
  const base=2+(globalState.season===3?4:1);
  nightKingThreat=Math.min(100,nightKingThreat+base);
  const northernKingdoms=kingdoms.filter(k=>k.y<2000&&!k.conquered);
  if(northernKingdoms.length>0&&nightKingThreat>30){
    northernKingdoms.forEach(k=>{
      k.morale=Math.max(0,(k.morale||80)-3);
      if(nightKingThreat>60) k.army=Math.max(5,(k.army||50)-5);
    });
  }
  if(nightKingThreat>=50&&nightKingThreat-base<50) showNKBanner('⚠️ Ak Gezenler Duvar\'a yaklaşıyor.');
  if(nightKingThreat>=80&&nightKingThreat-base<80){
    showNKBanner('🧟 Duvar yıkıldı! Gece Kralı güneye iniyor!');
    kingdoms.forEach(k=>{if(!k.conquered) k.morale=Math.max(0,(k.morale||80)-10);});
    sfxNK();
  }
  updateNKUI();
}

function updateNKUI(){
  const fill=document.getElementById('nk-fill');
  const pct=document.getElementById('nk-pct');
  const widget=document.getElementById('nk-widget');
  const overlay=document.getElementById('nk-overlay');
  if(fill) fill.style.width=nightKingThreat+'%';
  if(pct) pct.textContent=Math.round(nightKingThreat)+'%';
  widget.classList.toggle('danger',nightKingThreat>60);
  const op=nightKingThreat/100*0.12;
  if(overlay) overlay.style.background=`radial-gradient(ellipse at 50% 0%,rgba(136,187,221,${op}) 0%,transparent 60%)`;
}

function showNKBanner(desc){document.getElementById('nk-banner-desc').textContent=desc;document.getElementById('nk-banner').classList.add('show');}
function closeNKBanner(){document.getElementById('nk-banner').classList.remove('show');}

function showNKInfo(){
  currentDetailId=null;
  setTabs([{id:'nk',label:'Gece Kralı',icon:'🧊'}],'nk');
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:#88ddff">🧊 GECE KRALI TEHDİDİ</div>
    <div style="background:rgba(4,12,24,.8);border:1px solid rgba(136,187,221,.2);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;text-align:center;">
      <div style="font-size:52px;margin-bottom:8px;">🧊</div>
      <div style="font-family:'Cinzel',serif;font-size:11px;letter-spacing:2px;color:rgba(136,187,221,.8);text-transform:uppercase;margin-bottom:12px;">Mevcut Tehdit Seviyesi</div>
      <div style="font-family:'Cinzel',serif;font-size:36px;font-weight:700;color:#88ddff;">${Math.round(nightKingThreat)}%</div>
      <div style="height:8px;background:rgba(136,187,221,.1);border-radius:4px;overflow:hidden;margin-top:12px;">
        <div style="height:100%;width:${nightKingThreat}%;background:linear-gradient(90deg,#224466,#88ddff);border-radius:4px;transition:width 1s;"></div>
      </div>
    </div>
    <button onclick="rallAgainstNK()" style="width:100%;padding:14px;background:rgba(136,187,221,.08);border:1px solid rgba(136,187,221,.25);border-radius:var(--radius-sm);font-family:'Cinzel',serif;font-size:10px;color:#88ddff;cursor:pointer;letter-spacing:2px;transition:all .2s;margin-bottom:8px;">
      ⚔️ TOPLUCA SAVAŞ (500 Altın)
    </button>
    <div style="font-size:9px;color:var(--text-dim);text-align:center;">Tüm krallıklar havuzlanır, tehdit -30% azalır</div>
  `;
  openPanel();
}

async function rallAgainstNK(){
  const totalGold=kingdoms.reduce((s,k)=>(k.gold||0)+s,0);
  if(totalGold<500){toast('⚠️ Yeterli toplam altın yok (500 gerekli)');return;}
  const share=Math.ceil(500/kingdoms.filter(k=>!k.conquered).length);
  kingdoms.filter(k=>!k.conquered).forEach(k=>{k.gold=Math.max(0,(k.gold||0)-share);});
  nightKingThreat=Math.max(0,nightKingThreat-30);
  globalState.nkRepelled=(globalState.nkRepelled||0)+1;
  sfxAlly();updateNKUI();
  addChronicle('⚔️','Tüm Krallıklar Birleşti',`Gece Kralı\'na karşı ortak savunma. Tehdit 30 azaldı.`,'#88ddff');
  await saveData();renderAll();
  toast('🧊 Gece Kralı tehdidi -30 azaldı!','nk');
  checkAllAchievements();
}

/* ════════ ACHIEVEMENTS ════════ */
function checkAllAchievements(){
  if(!globalState.unlockedAchievements) globalState.unlockedAchievements=[];
  ACHIEVEMENTS_DEF.forEach(ach=>{
    if(!globalState.unlockedAchievements.includes(ach.id)){
      try{if(ach.check(globalState,kingdoms)){globalState.unlockedAchievements.push(ach.id);showAchievement(ach);}}catch(e){}
    }
  });
}

function showAchievement(ach){
  sfxAchievement();
  const popup=document.getElementById('achievement-popup');
  const card=document.createElement('div');
  card.className='achievement-card';
  card.innerHTML=`<div class="ach-icon">${ach.icon}</div><div class="ach-info"><div class="ach-header">🏆 BAŞARIM KAZANILDI</div><div class="ach-name">${ach.name}</div><div class="ach-desc">${ach.desc}</div></div>`;
  popup.appendChild(card);
  toast(`🏆 Başarım: ${ach.name}!`,'achievement');
  setTimeout(()=>{card.style.animation='achieveOut .4s ease forwards';setTimeout(()=>card.remove(),400);},4000);
}

/* ════════ POWER + THRONE ════════ */
// Vassal sayısı cache (renderAll sonrası güncellenir)
let _vassalCountCache = new Map();
function rebuildVassalCache() {
  _vassalCountCache.clear();
  kingdoms.forEach(k => {
    if(k.conquered) {
      _vassalCountCache.set(k.conquered, (_vassalCountCache.get(k.conquered)||0)+1);
    }
  });
}

function power(k){
  const vassals=_vassalCountCache.get(k.id)||0;
  const base=(k.territory||60)+(k.army||0)*0.6+(k.navy||0)*0.3+(k.gold||0)*0.05+(k.conquests||0)*25+vassals*20;
  const season=SEASONS[globalState.season];
  const isStark=k.house.toLowerCase().includes('stark');
  let mod=isStark?season.powerMod.stark:season.powerMod.default;
  if(k.council&&k.council.master_war) mod+=0.08;
  mod+=((k.alliances||[]).length)*0.02;
  mod+=((k.trades||[]).length)*0.01;
  mod+=getTechBonus(k,'battleMod')*0.5;
  const moraleMod=(k.morale||80)/100*0.2+0.8;
  const mercBonus=1+(k.mercenaries||[]).reduce((s,m)=>{
    const comp=MERCENARY_COMPANIES.find(c=>c.id===m.id);
    return s+(comp?comp.battleBonus:0);
  },0);
  return Math.round(base*mod*moraleMod*mercBonus);
}

function updateThroneWidget(){
  const leader=getThroneLeader();
  const el=document.getElementById('throne-leader');
  if(el&&leader) el.textContent=`${leader.sigil} ${leader.name.split(' ').slice(0,2).join(' ')}`;
  else if(el) el.textContent='—';
}

function showThroneInfo(){ openThroneSelector(); }

function checkVictory(){
  if(victoryShown) return;
  const winner=kingdoms.find(k=>calculateThroneScore(k)>=6);
  if(winner){ victoryShown=true; setTimeout(()=>showVictoryScreen(winner),1000); }
}

function showVictoryScreen(k){
  sfxVictoryFanfare();
  const pw=power(k);
  // FİX: O(n) filter yerine O(1) cache kullanıldı
  const vassalCount=_vassalCountCache.get(k.id)||0;
  document.getElementById('victory-name').textContent=`${k.sigil} ${k.name}`;
  document.getElementById('victory-house').textContent=`${k.house} Hanesi`;
  document.getElementById('victory-stats').innerHTML=`
    <div class="victory-stat"><div class="victory-stat-val">${pw}</div><div class="victory-stat-lbl">Güç</div></div>
    <div class="victory-stat"><div class="victory-stat-val">${k.conquests||0}</div><div class="victory-stat-lbl">Fetih</div></div>
    <div class="victory-stat"><div class="victory-stat-val">${vassalCount}</div><div class="victory-stat-lbl">Vasil</div></div>
  `;
  document.getElementById('victory-screen').classList.add('open');
}
function closeVictory(){document.getElementById('victory-screen').classList.remove('open');}

/* ════════════════════════════════════════
   TECHNOLOGY
════════════════════════════════════════ */
function openTechModal(kid){
  techModalKid=kid;
  const k=findKingdom(kid);
  if(!k) return;
  renderTechContent(k,'military');
  closePanel();
  document.getElementById('mo-tech').classList.add('open');
}
function closeTech(){document.getElementById('mo-tech').classList.remove('open');}

function renderTechContent(k, category){
  const cats={military:{label:'Askeri',icon:'⚔️'},economy:{label:'Ekonomi',icon:'💰'},diplomacy:{label:'Diplomasi',icon:'🤝'}};
  document.getElementById('tech-content').innerHTML=`
    <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;color:var(--text-dim);text-align:center;margin-bottom:12px;">
      Altın: <span style="color:var(--gold);font-size:11px;">${k.gold||0}</span> · Araştırılan: <span style="color:#20c860">${globalState.totalTechs||0}</span>
    </div>
    <div class="tech-nav">
      ${Object.entries(cats).map(([id,{label,icon}])=>`
        <button class="tech-nav-btn${id===category?' active':''}" onclick="renderTechContent(findKingdom('${k.id}'),'${id}')">${icon} ${label}</button>
      `).join('')}
    </div>
    <div class="tech-grid">
      ${TECHNOLOGIES[category].map(tech=>{
        const researched=globalState.researchedTechs&&globalState.researchedTechs[tech.id];
        const queueKey=`${k.id}_${tech.id}`;
        const inQueue=globalState.researchQueue&&globalState.researchQueue[queueKey];
        let statusHTML='';
        if(researched){statusHTML=`<div class="tech-status done">✓ Tamamlandı</div>`;}
        else if(inQueue){
          const left=inQueue.turnsLeft;
          statusHTML=`<div class="tech-status progress">⏳ ${left} tur kaldı</div><div class="tech-progress-bar"><div class="tech-progress-fill" style="width:${Math.round((1-left/tech.turns)*100)}%"></div></div>`;
        }
        return `<div class="tech-card${researched?' researched':inQueue?' researching':''}" style="--tc:${tech.color}" onclick="${!researched&&!inQueue?`startResearch('${k.id}','${tech.id}','${category}')`:''}" title="${tech.name}">
          <div class="tech-icon">${tech.icon}</div>
          <div class="tech-name">${tech.name}</div>
          <div class="tech-desc">${tech.desc}</div>
          ${!researched&&!inQueue?`<div class="tech-cost">💰 ${tech.cost} Altın · ⏰ ${tech.turns} tur</div>`:''}
          ${statusHTML}
        </div>`;
      }).join('')}
    </div>
  `;
}

async function startResearch(kid, techId, category){
  const k=findKingdom(kid);
  if(!k) return;
  const tech=ALL_TECHNOLOGIES.find(t=>t.id===techId);
  if(!tech) return;
  if((k.gold||0)<tech.cost){toast(`⚠️ Araştırma için ${tech.cost} Altın gerekli`);return;}
  k.gold-=tech.cost;
  if(!globalState.researchQueue) globalState.researchQueue={};
  globalState.researchQueue[`${kid}_${techId}`]={techId,kingdomId:kid,turnsLeft:tech.turns};
  sfxGold();
  toast(`🔬 "${tech.name}" araştırması başladı! ${tech.turns} tur sürer.`);
  addChronicle('🔬',`Araştırma Başladı: ${tech.name}`,`${k.name}, ${tech.name} üzerine araştırma başlattı.`,k.color);
  await saveData(); renderAll();
  renderTechContent(k, category);
}

/* ════════════════════════════════════════
   MERCENARIES
════════════════════════════════════════ */
function openMercModal(kid){
  mercModalKid=kid;
  const k=findKingdom(kid);
  if(!k) return;
  document.getElementById('merc-content').innerHTML=`
    <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:1.5px;color:var(--text-dim);text-align:center;margin-bottom:16px;">
      Altın: <span style="color:var(--gold);font-size:11px;">${k.gold||0}</span>
      <div style="font-size:10px;color:var(--text-dim);margin-top:4px;line-height:1.6;">Paralı askerler geçici olarak ordunuzu güçlendirir.<br>Sözleşme bitince ayrılırlar.</div>
    </div>
    <div class="merc-grid">
      ${MERCENARY_COMPANIES.map(comp=>{
        const hired=(k.mercenaries||[]).find(m=>m.id===comp.id);
        return `<div class="merc-card${hired?' hired':''}" style="--mc:${comp.color}" onclick="${!hired?`hireMercenary('${k.id}','${comp.id}')`:''}" >
          <div class="merc-icon">${comp.icon}</div>
          <div class="merc-info">
            <div class="merc-name">${comp && comp.name}</div>
            <div class="merc-desc">${comp.desc}</div>
            <div class="merc-stats">
              <span class="merc-stat">⚔️ +${comp.troops} asker</span>
              <span class="merc-stat">⏰ ${comp.duration} tur</span>
            </div>
            <div style="font-size:8px;color:${comp.color};margin-top:3px;">${comp.bonus}</div>
          </div>
          <div class="merc-cost">
            ${hired?`<div style="color:#4acc88;font-family:'Cinzel',serif;font-size:11px;">AKTİF<br><span style="font-size:8px;color:var(--text-dim)">${hired.turnsLeft} tur</span></div>`
              :`<div class="merc-cost-val">${comp.cost}</div><div class="merc-cost-lbl">Altın</div>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  closePanel();
  document.getElementById('mo-merc').classList.add('open');
}

function closeMerc(){
  document.getElementById('mo-merc').classList.remove('open');
}

async function hireMercenary(kid, compId){
  const k=findKingdom(kid);
  const comp=MERCENARY_COMPANIES.find(c=>c.id===compId);
  if(!k || !comp) return;
  
  if((k.gold||0)<comp.cost){
    toast('⚠️ Yeterli altın yok!', 'error');
    return;
  }
  
  k.gold-=comp.cost;
  if(!k.mercenaries) k.mercenaries=[];
  
  k.mercenaries.push({
    id:compId,
    turnsLeft:comp.duration,
    troops:comp.troops
  });
  k.army=(k.army||0)+comp.troops;
  
  globalState.totalMercs=(globalState.totalMercs||0)+1;
  sfxGold();
  addChronicle('⚔️',`${k.name} Paralı Asker Kiraladı`,`${comp && comp.name} (${comp.troops} asker, ${comp.duration} tur). Maliyet: ${comp.cost} Altın.`,k.color);
  await saveData(); renderAll();
  openMercModal(kid);
  toast(`⚔️ ${comp && comp.name} işe alındı! +${comp.troops} asker`,'achievement');
}

// FİX: updateMercenaries kaldırıldı — processMercenaryDuration() ile tamamen aynı işi yapıyordu
// ve hiçbir yerde çağrılmıyordu. advanceSeason() zaten processMercenaryDuration() çağırıyor.

/* ════════════════════════════════════════
   STATUS BADGES
════════════════════════════════════════ */
function getKingdomBadges(k){
  const badges=[];
  if(k.gold>=300) badges.push({cls:'kd-badge-rich',label:'💰 Zengin'});
  else if(k.gold<40) badges.push({cls:'kd-badge-poor',label:'💸 Yoksul'});
  if(k.army>=150) badges.push({cls:'kd-badge-strong',label:'⚔️ Güçlü'});
  if((k.alliances||[]).length>0) badges.push({cls:'kd-badge-trade',label:`🤝 ${(k.alliances||[]).length} İttifak`});
  if((k.trades||[]).length>0) badges.push({cls:'kd-badge-trade',label:`📦 ${(k.trades||[]).length} Ticaret`});
  if((k.spiedBy||[]).length>0) badges.push({cls:'kd-badge-spy',label:'🕵️ Casusluk'});
  if((k.marriageAlliances||[]).length>0) badges.push({cls:'kd-badge-marriage',label:`💍 ${(k.marriageAlliances||[]).length} Evlilik`});
  if(k.morale<50) badges.push({cls:'kd-badge-war',label:'😞 Moral Düşük'});
  if(k.conquests>0) badges.push({cls:'kd-badge-strong',label:`♛ ${k.conquests} Fetih`});
  return badges;
}

/* ════════════════════════════════════════
   RENDER ALL
════════════════════════════════════════ */
function renderAll(){
  rebuildKingdomMap();
  rebuildVassalCache();
  renderTerritories();
  renderTradeRoutes();
  renderAllianceLines();
  renderMarriageLines();
  renderMarkers();
  renderSB();
  updateMiniMap();
  document.getElementById('k-count').textContent=kingdoms.length;
  updateGlobalBar();
}

/* ════════════════════════════════════════
   TERRITORIES
════════════════════════════════════════ */
function renderTerritories(){
  const svg=document.getElementById('terr-svg');
  svg.innerHTML='';
  const drawnGroups={};
  kingdoms.forEach(k=>{
    const rootId=getRootConqueror(k.id);
    if(!drawnGroups[rootId]) drawnGroups[rootId]=[];
    drawnGroups[rootId].push(k);
  });
  Object.entries(drawnGroups).forEach(([rootId,group])=>{
    const root=findKingdom(rootId); if(!root) return;
    group.forEach(k=>{
      if(!k.showT) return;
      const col=root.color;
      if(k.pts&&k.pts.length>=3) drawPolygonTerritory(svg,k.pts,col,k.id===rootId);
    });
  });
}

function getRootConqueror(id){
  let current=findKingdom(id);
  let visited=new Set();
  while(current&&current.conquered&&!visited.has(current.id)){
    visited.add(current.id);
    const parent=findKingdom(current.conquered);
    if(!parent) break;
    current=parent;
  }
  return current?current.id:id;
}

function drawPolygonTerritory(svg,pts,color,isRoot){
  const points=pts.map(p=>`${p.x},${p.y}`).join(' ');
  svg.appendChild(makeSVG('polygon',{points,fill:color,'fill-opacity':'0','stroke':color,'stroke-width':isRoot?'18':'12','stroke-opacity':'0.06','stroke-linejoin':'round'}));
  svg.appendChild(makeSVG('polygon',{points,fill:color,'fill-opacity':isRoot?'0.11':'0.06'}));
  const border=makeSVG('polygon',{points,fill:'none',stroke:color,'stroke-width':isRoot?'3':'2','stroke-opacity':'0.9','stroke-dasharray':isRoot?'20 9':'14 8','stroke-linejoin':'round','stroke-linecap':'round'});
  addPulse(border,isRoot); svg.appendChild(border);
  pts.forEach(p=>{
    svg.appendChild(makeSVG('circle',{cx:p.x,cy:p.y,r:5,fill:color,'fill-opacity':'0.75','stroke':'rgba(0,0,0,0.5)','stroke-width':'1'}));
    svg.appendChild(makeSVG('circle',{cx:p.x,cy:p.y,r:9,fill:color,'fill-opacity':'0.12'}));
  });
}
function makeSVG(tag,attrs){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el;}
function addPulse(el,isRoot){const a=document.createElementNS('http://www.w3.org/2000/svg','animate');a.setAttribute('attributeName','stroke-opacity');a.setAttribute('values',isRoot?'0.55;1;0.55':'0.35;0.72;0.35');a.setAttribute('dur',isRoot?'2.8s':'3.8s');a.setAttribute('repeatCount','indefinite');el.appendChild(a);}

/* ════════════════════════════════════════
   TRADE ROUTES
════════════════════════════════════════ */
function renderTradeRoutes(){
  const svg=document.getElementById('trade-svg');
  svg.innerHTML='';
  const drawn=new Set();
  kingdoms.forEach(k=>{
    (k.trades||[]).forEach(tid=>{
      const key=[k.id,tid].sort().join('-');
      if(drawn.has(key)) return;
      drawn.add(key);
      const target=findKingdom(tid); if(!target) return;
      const glow=makeSVG('line',{x1:k.x,y1:k.y,x2:target.x,y2:target.y,stroke:'rgba(32,176,96,.1)','stroke-width':'14','stroke-linecap':'round'});
      svg.appendChild(glow);
      const line=makeSVG('line',{x1:k.x,y1:k.y,x2:target.x,y2:target.y,stroke:'rgba(32,176,96,.45)','stroke-width':'2','stroke-dasharray':'12 8','stroke-linecap':'round'});
      const dashAnim=document.createElementNS('http://www.w3.org/2000/svg','animate');
      dashAnim.setAttribute('attributeName','stroke-dashoffset');
      dashAnim.setAttribute('from','0');
      dashAnim.setAttribute('to','40');
      dashAnim.setAttribute('dur','2s');
      dashAnim.setAttribute('repeatCount','indefinite');
      line.appendChild(dashAnim);
      svg.appendChild(line);
      const mx=(k.x+target.x)/2, my=(k.y+target.y)/2;
      const dot=makeSVG('circle',{cx:mx,cy:my,r:6,fill:'rgba(32,176,96,.7)','stroke':'rgba(0,0,0,.4)','stroke-width':'1.5'});
      svg.appendChild(dot);
    });
  });
}

/* ════════════════════════════════════════
   ALLIANCE LINES
════════════════════════════════════════ */
function renderAllianceLines(){
  const svg=document.getElementById('alliance-svg');
  svg.innerHTML='';
  const drawn=new Set();
  kingdoms.forEach(k=>{
    (k.alliances||[]).forEach(aid=>{
      const key=[k.id,aid].sort().join('-');
      if(drawn.has(key)) return;
      drawn.add(key);
      const ally=findKingdom(aid); if(!ally) return;
      const glow=makeSVG('line',{x1:k.x,y1:k.y,x2:ally.x,y2:ally.y,stroke:'rgba(74,136,200,.12)','stroke-width':'18','stroke-linecap':'round'});
      svg.appendChild(glow);
      const line=makeSVG('line',{x1:k.x,y1:k.y,x2:ally.x,y2:ally.y,stroke:'rgba(74,136,200,.55)','stroke-width':'2.5','stroke-dasharray':'18 10','stroke-linecap':'round'});
      const dashAnim=document.createElementNS('http://www.w3.org/2000/svg','animate');
      dashAnim.setAttribute('attributeName','stroke-opacity');
      dashAnim.setAttribute('values','0.4;0.8;0.4');
      dashAnim.setAttribute('dur','3s');
      dashAnim.setAttribute('repeatCount','indefinite');
      line.appendChild(dashAnim);
      svg.appendChild(line);
      const mx=(k.x+ally.x)/2, my=(k.y+ally.y)/2;
      const dot=makeSVG('circle',{cx:mx,cy:my,r:7,fill:'rgba(74,136,200,.65)','stroke':'rgba(0,0,0,.5)','stroke-width':'1.5'});
      svg.appendChild(dot);
      const dotAnim=document.createElementNS('http://www.w3.org/2000/svg','animate');
      dotAnim.setAttribute('attributeName','r');
      dotAnim.setAttribute('values','6;9;6');
      dotAnim.setAttribute('dur','2.5s');
      dotAnim.setAttribute('repeatCount','indefinite');
      dot.appendChild(dotAnim);
    });
  });
}

/* ════════════════════════════════════════
   MARRIAGE LINES
════════════════════════════════════════ */
function renderMarriageLines(){
  const svg = document.getElementById('marriage-svg');
  if(!svg) return; 
  svg.innerHTML='';
  const drawn=new Set();
  kingdoms.forEach(k=>{
    (k.marriageAlliances||[]).forEach(mid=>{
      const key=[k.id,mid].sort().join('-');
      if(drawn.has(key)) return;
      drawn.add(key);
      const partner=findKingdom(mid); if(!partner) return;
      
      const glow=makeSVG('line',{x1:k.x,y1:k.y,x2:partner.x,y2:partner.y,stroke:'rgba(200,56,106,.15)','stroke-width':'22','stroke-linecap':'round'});
      svg.appendChild(glow);
      const line=makeSVG('line',{x1:k.x,y1:k.y,x2:partner.x,y2:partner.y,stroke:'rgba(200,56,106,.6)','stroke-width':'3','stroke-dasharray':'10 6','stroke-linecap':'round'});
      svg.appendChild(line);
      
      const mx=(k.x+partner.x)/2, my=(k.y+partner.y)/2;
      const heart=makeSVG('text',{x:mx,y:my+5,'font-size':'24','text-anchor':'middle'});
      heart.textContent='💍';
      svg.appendChild(heart);
    });
  });
}

/* ════════════════════════════════════════
   MARKERS
════════════════════════════════════════ */
function renderMarkers(){
  const layer=document.getElementById('markers-layer');
  layer.innerHTML='';
  
  // ═══ SIRADAM POI MARKERLERİ ═══
  markers.forEach(m=>{
    
    const el=document.createElement('div');
    const isFig = m.type === 'figure';
    el.className='km poi-marker' + (isFig ? ' km-type-figure' : '');
    el.id='marker-'+m.id;
    el.style.cssText=`left:${m.x}px;top:${m.y}px;--c:${m.color};${m.noPopup?'pointer-events:none;cursor:default;':''} z-index:100;`;
    if(isFig && m.size) el.style.setProperty('--fig-size', m.size + 'px');
    const hasPhoto=m.photo&&m.photo.trim();
    const blendStyle = 'mix-blend-mode: multiply; filter: brightness(1.02) contrast(1.05);';

    el.innerHTML=`
      <div class="km-wrap">
        <div class="km-av" style="${isFig?'border:none;background:transparent !important;box-shadow:none;':`border-color:${m.color};background-color:#1a1208;${hasPhoto?`background-image:url('${m.photo}');background-size:cover;background-position:center;`:''}`}">
          ${hasPhoto?`<img src="${m.photo}" 
          onerror="this.style.display='none'" 
          alt="" 
          style="width:100%;height:100%;object-fit:contain;${isFig?'border-radius:0;':'border-radius:50%;'} ${blendStyle} display:block; background-color:transparent !important;"/>`:''}
          ${isFig?'':'<div class="km-av-shine"></div>'}
        </div>
        ${isFig?'':`<div class="km-sigil">${m.icon}</div>`}
        ${isFig?'':`<div class="km-tag">${m.name}</div>`}
      </div>
    `;
    if(!m.noPopup) el.addEventListener('click',e=>{e.stopPropagation();sfxClick();openMarkerInfo(m);});
    layer.appendChild(el);
  });

  // ═══ KRALLIK MARKERLERİ ═══
  kingdoms.forEach(k=>{
    
    const el=document.createElement('div');
    const allyCount=(k.alliances||[]).length;
    const hasAllies=allyCount>0;
    const isSpied=(k.spiedBy||[]).length>0;
    const hasTradeRoutes=(k.trades||[]).length>0;
    let classList='km';
    if(k.conquered) classList+=' conquered-km';
    if(hasAllies) classList+=' allied-km';
    if(isSpied) classList+=' spied-km';
    if(hasTradeRoutes) classList+=' trading-km';
    el.className=classList;
    el.id='km-'+k.id;
    el.style.cssText=`left:${k.x}px;top:${k.y}px;--c:${k.color}; z-index:200;`;
    const hasPhoto=k.photo&&k.photo.trim();
    const vassalCount=_vassalCountCache.get(k.id)||0;
    const letter=k.name.charAt(0).toUpperCase();
    const goldColor=k.gold>=300?'#c8960a':k.gold>=150?'#e8a030':'#a06020';
    
    // Status icons
    let statusIcons='';
    if((k.trades||[]).length>0) statusIcons+=`<div class="km-status-icon" title="Ticaret Rotası">📦</div>`;
    if(isSpied) statusIcons+=`<div class="km-status-icon" title="Casusluk Altında">🕵️</div>`;
    if(k.morale<50) statusIcons+=`<div class="km-status-icon" title="Moral Düşük">😞</div>`;

    el.innerHTML=`
      <div class="km-wrap">
        ${k.conquests>0?`<div class="km-crown-float" style="color:${k.color};">♛</div>`:''}
        <div class="km-av">
          <div class="km-av-inner">
            ${hasPhoto?`<img src="${k.photo}" 
            onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='grid');" 
            alt="" 
            style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`:''}
            <span class="km-av-letter" style="${hasPhoto?'display:none;':''}">${letter}</span>
          </div>
          <div class="km-av-shine"></div>
          ${vassalCount>0?`<div class="km-vassal-badge">${vassalCount}</div>`:''}
          ${hasAllies?`<div class="km-ally-badge">${allyCount}</div>`:''}
          ${isSpied?`<div class="km-spy-badge">🕵</div>`:''}
        </div>
        <div class="km-sigil">${k.sigil||'⚔️'}</div>
        <div class="km-tag">${k.name.split(' ')[0]}</div>
        <div class="km-res-bar">
          <div class="km-res-dot" style="background:#e85050" title="Ordu: ${k.army}"></div>
          <div class="km-res-dot" style="background:#4a88c8" title="Donanma: ${k.navy}"></div>
          <div class="km-res-dot" style="background:${goldColor}" title="Altın: ${k.gold}"></div>
        </div>
        ${statusIcons?`<div class="km-status-row">${statusIcons}</div>`:''}
      </div>`;
    // Marker tıklama ve long-press
el.addEventListener('mousedown', e => {
  if(e.button === 2) return; // Sağ tık
  startLongPress(e, k.id);
});

el.addEventListener('mouseup', cancelLongPress);
el.addEventListener('mouseleave', cancelLongPress);

el.addEventListener('touchstart', e => {
  startLongPress(e, k.id);
}, {passive: true});

el.addEventListener('touchend', cancelLongPress, {passive: true});

el.addEventListener('click', e => {
  e.stopPropagation();
  if(!longPressTimer) { // Long press değilse
    sfxClick();
    onMarkerClick(k.id);
  }
});

// Sağ tık context menu
el.addEventListener('contextmenu', e => {
  showContextMenu(e, k.id);
});

    layer.appendChild(el);
  });

  updateMarkerSizes();
}

let _markerSizePending = false;
function updateMarkerSizes(){
  if(_markerSizePending) return;
  _markerSizePending = true;
  requestAnimationFrame(()=>{
    _markerSizePending = false;
    const s=Math.max(sc,0.1);
  const AV=42,SIGIL=16,TAG=8,CROWN=14,BADGE=20,BDR=2.5;
  const avSize=AV/s, sigilSz=SIGIL/s, tagSz=TAG/s, tagPad=4/s;
  const crownSz=CROWN/s, badgeSz=BADGE/s, letterSz=avSize*.40, bdrW=BDR/s;
  const maxTagW=110/s, dotSz=5/s;
  document.querySelectorAll('.km-av').forEach(el=>{el.style.width=avSize+'px';el.style.height=avSize+'px';el.style.borderWidth=bdrW+'px';});
  document.querySelectorAll('.km-av-letter').forEach(el=>{el.style.fontSize=letterSz+'px';});
  document.querySelectorAll('.km-sigil').forEach(el=>{el.style.fontSize=sigilSz+'px';});
  document.querySelectorAll('.km-tag').forEach(el=>{el.style.fontSize=tagSz+'px';el.style.padding=`${tagPad*.5}px ${tagPad*2.2}px ${tagPad}px`;el.style.maxWidth=maxTagW+'px';el.style.marginTop=(3/s)+'px';});
  document.querySelectorAll('.km-crown-float').forEach(el=>{el.style.fontSize=crownSz+'px';});
  document.querySelectorAll('.km-vassal-badge,.km-ally-badge,.km-spy-badge').forEach(el=>{el.style.width=badgeSz+'px';el.style.height=badgeSz+'px';el.style.fontSize=Math.max(7,9/s)+'px';el.style.borderWidth=(2/s)+'px';el.style.top=(-4/s)+'px';});
  document.querySelectorAll('.km-vassal-badge').forEach(el=>{el.style.right=(-4/s)+'px';});
  document.querySelectorAll('.km-ally-badge').forEach(el=>{el.style.left=(-4/s)+'px';});
  document.querySelectorAll('.km-spy-badge').forEach(el=>{el.style.right=(-4/s)+'px';el.style.bottom=(-4/s)+'px';el.style.top='auto';});
  document.querySelectorAll('.km-res-dot').forEach(el=>{el.style.width=dotSz+'px';el.style.height=dotSz+'px';});
  });
}

function openMarkerInfo(marker){
  currentDetailId=null;
  setTabs([{id:'marker',label:marker.name,icon:marker.icon}],'marker');
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:${marker.color}">${marker.icon} ${marker.name}</div>
    <div style="text-align:center;margin:20px 0;">
      <img src="${marker.photo}" style="width:100px;height:100px;border-radius:50%;border:3px solid ${marker.color};object-fit:cover;"/>
    </div>
    <div style="font-size:12px;color:var(--text-mid);text-align:center;margin-bottom:20px;line-height:1.6;">
      ${marker.description}
    </div>
    <button class="ka-map" onclick="flyTo(${marker.x},${marker.y},0.32)">
      <i class="fa-solid fa-map-location-dot"></i> Haritada Göster
    </button>
  `;
  openPanel();
}

/* ════════════════════════════════════════
   MINI-MAP
════════════════════════════════════════ */
function updateMiniMap(){
  const overlay=document.getElementById('mini-overlay');
  overlay.innerHTML='';
  const mm=document.getElementById('mini-map');
  const mw=mm.clientWidth, mh=mm.clientHeight;
  const sx=mw/MAP_W, sy=mh/MAP_H;
  kingdoms.forEach(k=>{
    const dot=document.createElement('div');
    dot.className='mini-map-dot';
    dot.style.cssText=`left:${k.x*sx}px;top:${k.y*sy}px;width:6px;height:6px;background:${k.color};color:${k.color};`;
    overlay.appendChild(dot);
  });
  updateMiniViewport();
}

function updateMiniViewport(){
  const vp=document.getElementById('mini-viewport');
  const mm=document.getElementById('mini-map');
  const wrap=document.getElementById('map-wrap');
  const ww=wrap.clientWidth, wh=wrap.clientHeight;
  const mw=mm.clientWidth, mh=mm.clientHeight;
  const sx=mw/MAP_W, sy=mh/MAP_H;
  const vx=-tx/sc*sx, vy=-ty/sc*sy;
  const vW=ww/sc*sx, vH=wh/sc*sy;
  vp.style.left=Math.max(0,vx)+'px';
  vp.style.top=Math.max(0,vy)+'px';
  vp.style.width=Math.min(mw,vW)+'px';
  vp.style.height=Math.min(mh,vH)+'px';
}

function miniMapClick(e){
  const mm=document.getElementById('mini-map');
  const r=mm.getBoundingClientRect();
  const mx=(e.clientX-r.left)/mm.clientWidth*MAP_W;
  const my=(e.clientY-r.top)/mm.clientHeight*MAP_H;
  flyTo(mx,my,sc);
}

/* ════════════════════════════════════════
   PAN & ZOOM
════════════════════════════════════════ */
const mapWrap=document.getElementById('map-wrap');
const mapCanvas=document.getElementById('map-canvas');

function applyT(smooth){
  mapCanvas.style.transition=smooth?'transform .46s cubic-bezier(.25,.46,.45,.94)':'none';
  mapCanvas.style.transform=`translate(${tx}px,${ty}px) scale(${sc})`;
  document.getElementById('z-pct').textContent=Math.round(sc*100)+'%';
  // FİX: updateMiniViewport her iki durumda da bir kez çağrılıyor (önceden smooth modda 2 kez çağrılıyordu)
  if(smooth) updateMarkerSizes();
  updateMiniViewport();
}

function zm(factor,cx,cy){
  const wrap=mapWrap.getBoundingClientRect();
  const px=cx!==undefined?cx:wrap.width/2;
  const py=cy!==undefined?cy:wrap.height/2;
  const newSc=Math.min(Math.max(sc*factor,0.1),30);
  tx=px-(px-tx)*(newSc/sc);
  ty=py-(py-ty)*(newSc/sc);
  sc=newSc;
  // applyT(false) zaten updateMiniViewport çağırıyor; updateMarkerSizes zoom'da gerekli
  applyT(false);
  updateMarkerSizes();
}

function resetView(){
  sc=initialSc; tx=initialTx; ty=initialTy;
  applyT(true);
}

function fitAll(){
  if(!kingdoms.length){resetView();return;}
  const xs=kingdoms.map(k=>k.x), ys=kingdoms.map(k=>k.y);
  
  // Mobilde daha küçük margin kullan
  const isMobile = window.innerWidth < 768;
  const margin = isMobile ? 150 : 400;
  
  const minX=Math.min(...xs)-margin, maxX=Math.max(...xs)+margin;
  const minY=Math.min(...ys)-margin, maxY=Math.max(...ys)+margin;
  
  const ww=mapWrap.clientWidth, wh=mapWrap.clientHeight;
  
  // Harita boyutlarını doğru hesapla
  const mapWidth = maxX - minX;
  const mapHeight = maxY - minY;
  
  // Padding ekle (harita kenarlarında boşluk)
  const padding = isMobile ? 0.85 : 0.92;
  
  sc = Math.max(0.1, Math.min( // fitAll fonksiyonu için de minimum sınırı %10 yaptık
    (ww * padding) / mapWidth,
    (wh * padding) / mapHeight,
    isMobile ? 2 : 5  // Mobilde max zoom daha düşük
  ));
  
  // Merkeze al
  tx = ww/2 - (minX + maxX)/2 * sc;
  ty = wh/2 - (minY + maxY)/2 * sc;
  
  applyT(true);
}

function flyTo(x,y,targetSc){
  const ww=mapWrap.clientWidth, wh=mapWrap.clientHeight;
  sc=targetSc||Math.max(sc,.22);
  tx=ww/2-x*sc; ty=wh/2-y*sc-60;
  applyT(true);
}

/* ── Mouse ── */
let clickSX=0, clickSY=0;
mapWrap.addEventListener('mousedown',e=>{if(e.target.closest('.km')) return;dragging=true;didDrag=false;lastX=e.clientX;lastY=e.clientY;clickSX=e.clientX;clickSY=e.clientY;});

document.addEventListener('mousemove',e=>{if(!dragging) return;tx+=e.clientX-lastX;ty+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;if(Math.abs(e.clientX-clickSX)>5||Math.abs(e.clientY-clickSY)>5) didDrag=true;if(!pendingRender){pendingRender=true;requestAnimationFrame(()=>{applyT(false);updateMiniViewport();pendingRender=false;});}});
document.addEventListener('mouseup',e=>{if(dragging&&!didDrag) onMapClick(e.clientX,e.clientY);dragging=false;});
mapWrap.addEventListener('wheel',e=>{e.preventDefault();const r=mapWrap.getBoundingClientRect();zm(e.deltaY<0?1.12:.89,e.clientX-r.left,e.clientY-r.top);},{passive:false});

// Touch sürükleme düzeltmesi
mapWrap.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    if (e.target.closest('.km')) return;
    isTouchDragging = true;
    touchDidDrag = false;
    touchStartX = touchLastX = e.touches[0].clientX;
    touchStartY = touchLastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    isTouchDragging = false;
  }
}, { passive: false });

mapWrap.addEventListener('touchmove', e => {
  // Harita üzerinde tarayıcının varsayılan hareketlerini (yenileme, zoom vb.) tamamen engelle
  if (e.cancelable) e.preventDefault();

  if (e.touches.length === 2) {
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (lastPinchDist > 0) {
      const factor = dist / lastPinchDist;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const r = mapWrap.getBoundingClientRect();
      zm(factor, cx - r.left, cy - r.top);
    }
    lastPinchDist = dist;
  } else if (e.touches.length === 1 && isTouchDragging) {
    const dx = e.touches[0].clientX - touchLastX;
    const dy = e.touches[0].clientY - touchLastY;
    tx += dx; ty += dy;
    touchLastX = e.touches[0].clientX;
    touchLastY = e.touches[0].clientY;
    if (Math.abs(touchLastX - touchStartX) > 8 || Math.abs(touchLastY - touchStartY) > 8) touchDidDrag = true;
    if(!pendingRender){pendingRender=true;requestAnimationFrame(()=>{applyT(false);pendingRender=false;});}
  }
}, { passive: false });

mapWrap.addEventListener('touchend', e => {
  if (e.touches.length < 2) lastPinchDist = 0;
  if (isTouchDragging && !touchDidDrag && e.changedTouches.length === 1) {
    onMapClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }
  isTouchDragging = false;
}, { passive: false });

function onMapClick(cx,cy){
  if(!mode) return;
  const r=mapWrap.getBoundingClientRect();
  const mx=(cx-r.left-tx)/sc, my=(cy-r.top-ty)/sc;
  if(mode==='repos') finishRepos(mx,my);
  else if(mode==='terr') addTerrPt(mx,my);
}
function onMarkerClick(id){
  if(mode==='conquer'){
    if(id===modeKid){toast('⚔️ Kendi topraklarınızı fethedemezsiniz!');return;}
    openBattleScreen(modeKid,id);
  } else if(mode==='ally'){
    if(id===modeKid){toast('🤝 Kendinizle ittifak kuramazsınız!');return;}
    cancelMode();
    openAllyModal(modeKid,id);
  } else if(mode==='trade'){
    if(id===modeKid){toast('📦 Kendinizle ticaret yapamazsınız!');return;}
    cancelMode();
    initiateTradeRoute(modeKid,id);
  } else if(mode==='spy'){
    if(id===modeKid){toast('🕵️ Kendi casuslarınızı göremezsiniz!');return;}
    cancelMode();
    openSpyScreen(modeKid,id);
  } else if(mode==='marriage'){
    if(id===modeKid){toast('💍 Kendinizle evlenemezsiniz!');return;}
    cancelMode();
    openMarriageModal(modeKid,id);
  } else {
    openDetail(id);
  }
}

/* ════════════════════════════════════════
   MODES
════════════════════════════════════════ */
function setMode(m,kid){
  mode=m;modeKid=kid||null;
  const ids=['bar-conquer','bar-repos','bar-terr','bar-ally','bar-trade','bar-spy'];
  const modes=['conquer','repos','terr','ally','trade','spy'];
  ids.forEach((id,i)=>{document.getElementById(id)?.classList.toggle('on',m===modes[i]);});
  document.getElementById('bar-blockade')?.classList.toggle('on',m==='blockade');
  document.getElementById('bar-marriage')?.classList.toggle('on',m==='marriage');
  mapWrap.classList.toggle('cursor-cross',m==='repos'||m==='terr'||m==='ally'||m==='trade'||m==='spy');
}
function cancelMode(){
  if(mode==='terr'){terrPts=[];document.querySelectorAll('.terr-dot').forEach(d=>d.remove());renderTerritories();}
  setMode(null);
}

/* ════════════════════════════════════════
   EPIC BATTLE SYSTEM
════════════════════════════════════════ */
function startConquer(id){closePanel();setMode('conquer',id);toast('⚔️ Savaşılacak krallığa dokun');}

function openBattleScreen(atkId,defId){
  const atk=findKingdom(atkId);
  const def=findKingdom(defId);
  if(!atk||!def) return;

  if((atk.marriageAlliances||[]).includes(defId)){
    toast(`💔 Evlilik ittifakı olan haneler birbirine savaş açamaz!`, 'error');
    cancelMode();
    return;
  }
  cancelMode();
  sfxBattle();
  battleState={atk,def,atkId,defId,phase:'pre'};

  setupBattleSide('att',atk);
  setupBattleSide('def',def);
  document.getElementById('bs-subtitle').textContent=`${atk.name} vs ${def.name}`;
  document.getElementById('bs-rounds').innerHTML='';
  document.getElementById('bs-outcome').textContent='';
  document.getElementById('bs-outcome').className='bs-outcome';
  document.getElementById('bs-outcome-sub').textContent='';
  document.getElementById('bs-att-side').className='bs-side';
  document.getElementById('bs-def-side').className='bs-side';
  document.getElementById('bs-att-total').textContent='';
  document.getElementById('bs-def-total').textContent='';
  document.getElementById('bs-att-dice').innerHTML='';
  document.getElementById('bs-def-dice').innerHTML='';

  // Calculate advantages
  const advEl=document.getElementById('bs-advantages');
  const advs=[];
  const season=SEASONS[globalState.season];
  if(atk.house.toLowerCase().includes('stark')&&globalState.season===3) advs.push({cls:'bs-adv-atk',txt:'❄️ Kış Avantajı (Stark)'});
  if((atk.alliances||[]).length>0) advs.push({cls:'bs-adv-atk',txt:`🤝 ${(atk.alliances||[]).length} Müttefik`});
  if((def.alliances||[]).length>0) advs.push({cls:'bs-adv-def',txt:`🛡️ ${(def.alliances||[]).length} Savunma İttifakı`});
  if(atk.navy>50) advs.push({cls:'bs-adv-atk',txt:'⚓ Deniz Üstünlüğü'});
  if(atk.council&&atk.council.master_war) advs.push({cls:'bs-adv-atk',txt:'⚔️ Savaş Ustası'});
  if(def.council&&def.council.kingsguard) advs.push({cls:'bs-adv-def',txt:'🛡️ Kral Muhafızı'});
  if(def.morale>80) advs.push({cls:'bs-adv-def',txt:'💪 Yüksek Moral'});
  advEl.innerHTML=advs.map(a=>`<span class="bs-adv ${a.cls}">${a.txt}</span>`).join('');

  // Morale bars
  document.getElementById('bs-att-morale').style.width=(atk.morale||80)+'%';
  document.getElementById('bs-att-morale').style.background=moraleColor(atk.morale||80);
  document.getElementById('bs-def-morale').style.width=(def.morale||80)+'%';
  document.getElementById('bs-def-morale').style.background=moraleColor(def.morale||80);

  document.getElementById('bs-actions').innerHTML=`
    <button class="bs-btn bs-btn-charge" onclick="runBattle()">⚔️ SALDIRI BAŞLAT</button>
    <button class="bs-btn bs-btn-retreat" onclick="closeBattleScreen()">🏳️ GERİ ÇEKİL</button>
  `;
  document.getElementById('battle-screen').classList.add('open');
}

function moraleColor(val){
  if(val>70) return '#4acc88';
  if(val>40) return '#e8b420';
  return '#e85050';
}

function setupBattleSide(side,k){
  const hasPhoto=k.photo&&k.photo.trim();
  const av=document.getElementById(`bs-${side}-av`);
  av.style.borderColor=k.color;
  av.style.color=k.color;
  if(hasPhoto){av.innerHTML=`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`;av.style.backgroundImage=`url('${k.photo}')`;av.style.backgroundSize='cover';}
  else{av.textContent=k.name.charAt(0);}
  document.getElementById(`bs-${side}-name`).textContent=k.name;
  document.getElementById(`bs-${side}-house`).textContent=k.house;
  document.getElementById(`bs-${side}-army`).innerHTML=`<span>⚔️</span><span style="color:${k.color}">${k.army||0}</span> <span style="color:var(--text-dim);font-size:9px">Asker</span>`;
}

const DICE_FACES=['⚀','⚁','⚂','⚃','⚄','⚅'];
function rollDice(){ return Math.floor(Math.random()*6)+1; }

async function runBattle(){
  const {atk,def,atkId,defId}=battleState;
  document.getElementById('bs-actions').innerHTML='';

  const season=SEASONS[globalState.season];
  const atkMod=(atk.house.toLowerCase().includes('stark')?season.powerMod.stark:season.powerMod.default) * ((atk.morale||80)/100*0.3+0.7) * (atk.council&&atk.council.master_war?1.15:1);
  const defMod=(def.house.toLowerCase().includes('stark')?season.powerMod.stark:season.powerMod.default) * ((def.morale||80)/100*0.3+0.7) * (def.council&&def.council.kingsguard?1.2:1);
  const allyBonus=Math.min((atk.alliances||[]).length*0.05,0.20);
  const defAllyBonus=Math.min((def.alliances||[]).length*0.04,0.16);

  let atkTotal=0, defTotal=0;
  const roundsEl=document.getElementById('bs-rounds');
  let atkMorale=atk.morale||80;
  let defMorale=def.morale||80;

  for(let r=1;r<=3;r++){
    await sleep(r===1?600:800);
    const atkRoll=rollDice();
    const defRoll=rollDice();
    const atkScore=Math.round((atkRoll+(atk.army||50)*0.08)*(atkMod+allyBonus));
    const defScore=Math.round((defRoll+(def.army||50)*0.08)*(defMod+defAllyBonus));
    atkTotal+=atkScore; defTotal+=defScore;

    // Update morale mid-battle
    if(atkScore>defScore) { defMorale-=10; atkMorale+=3; }
    else { atkMorale-=10; defMorale+=3; }
    document.getElementById('bs-att-morale').style.width=Math.max(0,atkMorale)+'%';
    document.getElementById('bs-att-morale').style.background=moraleColor(atkMorale);
    document.getElementById('bs-def-morale').style.width=Math.max(0,defMorale)+'%';
    document.getElementById('bs-def-morale').style.background=moraleColor(defMorale);

    const attDice=document.getElementById('bs-att-dice');
    const defDiceEl=document.getElementById('bs-def-dice');
    const aDie=document.createElement('span'); aDie.className='dice-roll'; aDie.textContent=DICE_FACES[atkRoll-1];
    const dDie=document.createElement('span'); dDie.className='dice-roll'; dDie.textContent=DICE_FACES[defRoll-1];
    attDice.innerHTML=''; attDice.appendChild(aDie);
    defDiceEl.innerHTML=''; defDiceEl.appendChild(dDie);
    playTone(300+atkRoll*40,.12,'square',.05);
    setTimeout(()=>playTone(300+defRoll*40,.12,'square',.04),80);

    const row=document.createElement('div'); row.className='bs-round-row';
    const aw=atkScore>defScore, draw=atkScore===defScore;
    row.innerHTML=`
      <span class="bs-round-lbl">Tur ${r}</span>
      <div class="bs-round-scores">
        <span class="bs-rs ${aw?'win':draw?'':''}">${atkScore}</span>
        <span style="color:var(--text-dim);font-size:9px">vs</span>
        <span class="bs-rs ${draw?'':aw?'':'win'}">${defScore}</span>
      </div>
    `;
    roundsEl.appendChild(row);
    await sleep(50);
    row.classList.add('vis');
  }

  document.getElementById('bs-att-total').textContent=atkTotal;
  document.getElementById('bs-def-total').textContent=defTotal;
  await sleep(600);

  const atkWins=atkTotal>defTotal;
  globalState.totalBattles=(globalState.totalBattles||0)+1;

  if(atkWins){
    sfxVictory();
    document.getElementById('bs-att-side').classList.add('winner');
    document.getElementById('bs-def-side').classList.add('loser');
    document.getElementById('bs-outcome').className='bs-outcome victory';
    document.getElementById('bs-outcome').textContent='⚔️ ZAFER!';
    document.getElementById('bs-outcome-sub').textContent=`${atk.name} zafere ulaştı! Skor: ${atkTotal}-${defTotal}`;
    document.getElementById('bs-actions').innerHTML=`<button class="bs-btn bs-btn-close" onclick="finishBattle(true)">✓ TOPRAĞ AL</button>`;
    addChronicle('⚔️',`${atk.name} Kazandı`,`${atk.name}, ${def.name}'ı yendi. Skor: ${atkTotal}-${defTotal}. Moral hasar: Büyük.`,'#e85050');
  } else {
    sfxDefeat();
    document.getElementById('bs-def-side').classList.add('winner');
    document.getElementById('bs-att-side').classList.add('loser');
    document.getElementById('bs-outcome').className='bs-outcome defeat';
    document.getElementById('bs-outcome').textContent='🛡️ YENİLDİ!';
    document.getElementById('bs-outcome-sub').textContent=`${def.name} saldırıyı savuşturdu! Skor: ${atkTotal}-${defTotal}`;
    document.getElementById('bs-actions').innerHTML=`<button class="bs-btn bs-btn-retreat" onclick="finishBattle(false)">↩ GERİ ÇEKİL</button>`;
    addChronicle('🛡️',`${def.name} Savundu`,`${def.name}, ${atk.name}'ın saldırısını geri püskürttü. Skor: ${atkTotal}-${defTotal}`,'#4a88c8');
  }

  // Casualties
  const atkLoss=Math.round((defTotal/Math.max(atkTotal,1))*10);
  const defLoss=Math.round((atkTotal/Math.max(defTotal,1))*12);
  atk.army=Math.max(5,(atk.army||50)-atkLoss);
  def.army=Math.max(5,(def.army||50)-defLoss);
  // Morale effects
  atk.morale=Math.max(0,Math.min(100,(atk.morale||80)+(atkWins?10:-20)));
  def.morale=Math.max(0,Math.min(100,(def.morale||80)+(atkWins?-20:15)));
}

async function finishBattle(atkWins){
  const {atk,def,atkId,defId}=battleState;
  if(atkWins){
    def.conquered=atkId;
    atk.conquests=(atk.conquests||0)+1;
    atk.territory=Math.round((atk.territory||60)+(def.territory||60)*.45);
    atk.gold=Math.round((atk.gold||200)+(def.gold||0)*.3);
    // Remove alliances/trades of conquered
    (def.alliances||[]).forEach(aid=>{
      const a=findKingdom(aid);
      if(a) a.alliances=(a.alliances||[]).filter(x=>x!==defId);
    });
    (def.trades||[]).forEach(tid=>{
      const t=findKingdom(tid);
      if(t) t.trades=(t.trades||[]).filter(x=>x!==defId);
    });
    def.alliances=[];
    def.trades=[];
    const el=document.getElementById('km-'+defId);
    if(el){ el.classList.add('battle-flash'); setTimeout(()=>el.classList.remove('battle-flash'),1400); }
  }
  closeBattleScreen();
  await saveData(); renderAll();
  if(atkWins){
    playSFX('conquest');  // ✓ Conquest ses efekti
    toast(`⚔️ ${atk.name} → ${def.name} topraklarını fethetti!`,'war');
    setTimeout(()=>{openDetail(atkId);openPanel();},700);
  } else {
    toast(`🛡️ ${def.name} saldırıyı savuşturdu!`);
  }
}

function closeBattleScreen(){document.getElementById('battle-screen').classList.remove('open');}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ════════════════════════════════════════
   ALLIANCE SYSTEM
════════════════════════════════════════ */
function startAlly(id){closePanel();setMode('ally',id);toast('🤝 İttifak kurulacak krallığa dokun');}

function openAllyModal(sourceId,targetId){
  allySourceId=sourceId; allyTargetId=targetId;
  const source=findKingdom(sourceId);
  const target=findKingdom(targetId);
  if(!source||!target) return;
  const alreadyAllied=(source.alliances||[]).includes(targetId);
  if(alreadyAllied){
    showConf('💔','İttifakı Boz?',`${source.name} ile ${target.name} arasındaki ittifak sona erecek.`,()=>breakAlliance(sourceId,targetId));
    return;
  }
  showConf('🤝','İttifak Kur?',`${source.name} ile ${target.name} ittifak kuracak. Maliyet: 50 Altın.`,()=>forgeAlliance(sourceId,targetId));
}

async function forgeAlliance(sid,tid){
  const source=findKingdom(sid);
  const target=findKingdom(tid);
  if(!source||!target) return;
  if((source.gold||0)<50){toast('⚠️ Yeterli altın yok! (50 gerekli)');return;}
  source.gold=Math.max(0,(source.gold||0)-50);
  if(!source.alliances) source.alliances=[];
  if(!target.alliances) target.alliances=[];
  if(!source.alliances.includes(tid)) source.alliances.push(tid);
  if(!target.alliances.includes(sid)) target.alliances.push(sid);
  sfxAlly();
  globalState.totalAlliances=(globalState.totalAlliances||0)+1;
  await saveData(); renderAll();
  addChronicle('🤝',`İttifak: ${source.name} & ${target.name}`,`${source.name} ve ${target.name} ittifak antlaşması imzaladı.`,'#4a88c8');
  toast(`🤝 ${source.name} ↔ ${target.name} ittifak kurdu!`,'ally');
  openDetail(sid); openPanel();
}

async function breakAlliance(sid,tid){
  const source=findKingdom(sid);
  const target=findKingdom(tid);
  if(source) source.alliances=(source.alliances||[]).filter(a=>a!==tid);
  if(target) target.alliances=(target.alliances||[]).filter(a=>a!==sid);
  await saveData(); renderAll();
  addChronicle('💔',`İttifak Bozuldu: ${source?.name} & ${target?.name}`,`Antlaşma ihlal edildi. İki hane artık düşman.`,'#e85050');
  toast(`💔 ${source?.name} ↔ ${target?.name} ittifakı bitti`,'war');
  openDetail(sid); openPanel();
}

/* ════════ MARRIAGE SYSTEM ════════ */
function startMarriage(id) {
  closePanel();
  setMode('marriage', id);
  toast('💍 Evlilik teklif edilecek krallığa dokun');
}

async function openMarriageModal(sourceId, targetId) {
  const source = findKingdom(sourceId);
  const target = findKingdom(targetId);
  if (!source || !target) return;
  
  const baseCost = 100;
  const costReduction = getTechBonus(source, 'marriageCostMod') || 0;
  const finalCost = Math.max(0, baseCost * (1 - costReduction));

  if (source.gold < finalCost) {
    toast(`⚠️ Evlilik töreni için ${finalCost} Altın gerekli!`, 'error');
    cancelMode();
    return;
  }
  showConf('💍', 'Hanedan Evliliği?', 
    `${source.name} ve ${target.name} haneleri evlilikle birleşecek. Bu bağ kalıcıdır. Maliyet: ${finalCost} Altın.`, 
    () => confirmMarriage(sourceId, targetId)
  );
}

async function confirmMarriage(sid, tid) {
  const source = findKingdom(sid);
  const target = findKingdom(tid);
  if (!source || !target) return;

  const baseCost = 100;
  const costReduction = getTechBonus(source, 'marriageCostMod') || 0;
  const finalCost = Math.max(0, baseCost * (1 - costReduction));
  source.gold -= Math.round(finalCost);
  
  if (!source.marriageAlliances) source.marriageAlliances = [];
  if (!target.marriageAlliances) target.marriageAlliances = [];
  
  if(!source.marriageAlliances.includes(tid)) source.marriageAlliances.push(tid);
  if(!target.marriageAlliances.includes(sid)) target.marriageAlliances.push(sid);
  
  if (!source.alliances) source.alliances = [];
  if (!target.alliances) target.alliances = [];
  if (!source.alliances.includes(tid)) source.alliances.push(tid);
  if (!target.alliances.includes(sid)) target.alliances.push(sid);

  source.morale = Math.min(100, (source.morale || 80) + 30);
  target.morale = Math.min(100, (target.morale || 80) + 30);
  source.territory += 5;
  target.territory += 5;

  const randomGoldBonus = Math.floor(Math.random() * 50) + 20;
  const randomArmyBonus = Math.floor(Math.random() * 10) + 5;
  source.gold += randomGoldBonus;
  target.gold += randomGoldBonus;
  source.army = (source.army||0) + randomArmyBonus;
  target.army = (target.army||0) + randomArmyBonus;

  sfxMarriage();
  globalState.totalMarriages = (globalState.totalMarriages || 0) + 1;
  
  addChronicle('💍', 'Büyük Düğün', `${source.name} ve ${target.name} haneleri görkemli bir düğünle birleşti. Westeros'ta yeni bir devir başlıyor! (+${randomGoldBonus} Altın, +${randomArmyBonus} Asker)`, '#c8386a');
    
  await saveData();
  renderAll();
  toast(`💍 ${source.name} ve ${target.name} artık akraba haneler!`, 'achievement');
}

function openAllyMgr(id){
  allySourceId=id;
  const source=findKingdom(id); if(!source) return;
  const grid=document.getElementById('ally-grid');
  grid.innerHTML='';
  kingdoms.filter(k=>k.id!==id&&!k.conquered).forEach(k=>{
    const isAlly=(source.alliances||[]).includes(k.id);
    const isConq=k.conquered&&k.conquered!==id;
    const card=document.createElement('div');
    card.className='ally-k-card'+(isAlly?' sel':'')+(isConq?' already':'');
    const hasPhoto=k.photo&&k.photo.trim();
    card.innerHTML=`
      <div class="ally-k-av" style="border-color:${k.color};color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;background-color:#1a1208;`:''}background:#1a1208;">
        ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`${k.name.charAt(0)}`}
      </div>
      <div>
        <div class="ally-k-name">${k.name.split(' ')[0]}</div>
        <div class="ally-k-house">${k.sigil} ${k.house}</div>
      </div>
      <div class="ally-sel-check">✓</div>
    `;
    card.dataset.kid=k.id;
    if(!isConq) card.onclick=()=>{
      // FİX: allyTargetId güncelleniyor ki İTTİFAK KUR düğmesi de çalışsın
      allyTargetId=k.id;
      if(isAlly){ breakAlliance(id,k.id); closeAlly(); }
      else { closeAlly(); showConf('🤝','İttifak Kur?',`${source.name} ile ${k.name} ittifak kuracak. Maliyet: 50 Altın.`,()=>forgeAlliance(id,k.id)); }
    };
    grid.appendChild(card);
  });
  document.getElementById('mo-ally').classList.add('open');
}
function closeAlly(){document.getElementById('mo-ally').classList.remove('open');}

// FİX: confirmAlly artık gerçekten çalışıyor.
// Izgara içinde seçili (sel class'lı) kart yoksa uyarı, varsa ittifak kur.
function confirmAlly(){
  if(!allySourceId) return;
  const grid=document.getElementById('ally-grid');
  // Seçili kart: sel class'ı olan ama zaten mevcut ittifak olmayan kart
  const selectedCard=grid?grid.querySelector('.ally-k-card:not(.sel):not(.already)'):null;
  // Alternatif: kullanıcı karta tıklayarak zaten işlemi yapıyor.
  // Bu düğme, grid'deki son tıklanan hedefi işlemek için allyTargetId'yi kullanır.
  if(!allyTargetId){
    toast('⚠️ Önce bir krallık seçin');
    return;
  }
  const source=findKingdom(allySourceId);
  const target=findKingdom(allyTargetId);
  if(!source||!target) return;
  const isAlly=(source.alliances||[]).includes(allyTargetId);
  closeAlly();
  if(isAlly){
    showConf('💔','İttifakı Boz?',`${source.name} ile ${target.name} arasındaki ittifak sona erecek.`,()=>breakAlliance(allySourceId,allyTargetId));
  } else {
    showConf('🤝','İttifak Kur?',`${source.name} ile ${target.name} ittifak kuracak. Maliyet: 50 Altın.`,()=>forgeAlliance(allySourceId,allyTargetId));
  }
}

/* ════════════════════════════════════════
   TRADE SYSTEM
════════════════════════════════════════ */
function startTrade(id){closePanel();setMode('trade',id);toast('📦 Ticaret kurulacak krallığa dokun');}

async function initiateTradeRoute(sourceId,targetId){
  const source=findKingdom(sourceId);
  const target=findKingdom(targetId);
  if(!source||!target) return;
  const alreadyTrading=(source.trades||[]).includes(targetId);
  if(alreadyTrading){
    showConf('📦','Ticaret Rotasını Kes?',`${source.name} ile ${target.name} arasındaki ticaret rotası kapatılacak.`,()=>breakTrade(sourceId,targetId));
    return;
  }
  const cost=30;
  if((source.gold||0)<cost){toast(`⚠️ Ticaret rotası için ${cost} Altın gerekli`);return;}
  showConf('📦','Ticaret Rotası Kur?',`${source.name} ile ${target.name} arasında ticaret. Her tur +15 Altın. Maliyet: ${cost} Altın.`,async()=>{
    source.gold=Math.max(0,(source.gold||0)-cost);
    if(!source.trades) source.trades=[];
    if(!target.trades) target.trades=[];
    if(!source.trades.includes(targetId)) source.trades.push(targetId);
    if(!target.trades.includes(sourceId)) target.trades.push(sourceId);
    sfxTrade();
    globalState.totalTrades=(globalState.totalTrades||0)+1;
    const goods=TRADE_GOODS[Math.floor(Math.random()*TRADE_GOODS.length)];
    addChronicle('📦',`Ticaret: ${source.name} & ${target.name}`,`${source.name} ve ${target.name} arasında ${goods} ticareti başladı.`,'#40d080');
    await saveData(); renderAll();
    toast(`📦 ${source.name} ↔ ${target.name} ticaret rotası kuruldu!`,'trade');
    openDetail(sourceId); openPanel();
  });
}

async function breakTrade(sid,tid){
  const source=findKingdom(sid);
  const target=findKingdom(tid);
  if(source) source.trades=(source.trades||[]).filter(a=>a!==tid);
  if(target) target.trades=(target.trades||[]).filter(a=>a!==sid);
  await saveData(); renderAll();
  addChronicle('📦',`Ticaret Bitti: ${source?.name} & ${target?.name}`,`Ticaret anlaşması sona erdi.`,'#888');
  toast(`📦 ${source?.name} ↔ ${target?.name} ticareti bitti`);
}

/* ════════════════════════════════════════
   SPY SYSTEM
════════════════════════════════════════ */
function startSpy(id){closePanel();setMode('spy',id);toast('🕵️ Casusluk yapılacak krallığa dokun');}

function openSpyScreen(sourceId,targetId){
  spyState={sourceId,targetId};
  const source=findKingdom(sourceId);
  const target=findKingdom(targetId);
  if(!source||!target) return;
  sfxSpy();
  document.getElementById('spy-subtitle').textContent=`${source.name} → ${target.name}`;
  const opsEl=document.getElementById('spy-ops');
  opsEl.innerHTML=SPY_OPS.map(op=>`
    <div class="spy-op" onclick="executeSpyOp('${op.id}')">
      <div class="spy-op-icon">${op.icon}</div>
      <div class="spy-op-name">${op.name}</div>
      <div class="spy-op-desc">${op.desc}</div>
      <div class="spy-op-cost">💰 ${op.cost} Altın · %${Math.round(op.successRate*100)} Başarı</div>
    </div>
  `).join('');
  document.getElementById('spy-result').style.display='none';
  document.getElementById('spy-screen').classList.add('open');
}

async function executeSpyOp(opId){
  const source=findKingdom(spyState.sourceId);
  const target=findKingdom(spyState.targetId);
  if(!source||!target) return;
  const op=SPY_OPS.find(o=>o.id===opId);
  if(!op) return;
  
  if((source.gold||0)<op.cost){
    toast(`⚠️ ${op.name} için ${op.cost} Altın gerekli`,'spy');
    return;
  }
  source.gold-=op.cost;
  globalState.totalSpyOps=(globalState.totalSpyOps||0)+1;
  
  // Spy master bonus
  let successRate=op.successRate;
  if(source.council&&source.council.master_whisperers) successRate=Math.min(0.95,successRate+0.2);
  
  const success=Math.random()<successRate;
  const resultEl=document.getElementById('spy-result');
  resultEl.style.display='flex';

  let resultIcon,resultText,resultSub;

  if(success){
    sfxGold();
    resultIcon='✅';
    switch(opId){
      case 'recon':
        resultIcon='🔭';
        resultText='Keşif Başarılı!';
        resultSub=`${target.name}: ⚔️${target.army} 🥇${target.gold} ⚓${target.navy} 🛡️${target.territory} Bölge`;
        if(!target.spiedBy) target.spiedBy=[];
        if(!target.spiedBy.includes(source.id)) target.spiedBy.push(source.id);
        if(!source.spies) source.spies=[];
        if(!source.spies.includes(target.id)) source.spies.push(target.id);
        addChronicle('🔭',`${source.name} Keşif Yaptı`,`${source.name}'nin casusları ${target.name}'i gözetledi.`,'#c080e8');
        break;
      case 'steal_gold': {
        // FİX: switch-case içindeki const TDZ sorununu önlemek için block scope kullanıldı
        const stolen=Math.floor(Math.random()*30)+10;
        const actualStolen=Math.min(stolen,target.gold);
        target.gold=Math.max(0,target.gold-actualStolen);
        source.gold+=actualStolen;
        resultIcon='💰';
        resultText='Hazine Hırsızlığı!';
        resultSub=`${actualStolen} Altın çalındı!`;
        addChronicle('💰',`${source.name} Altın Çaldı`,`${source.name}'nin casusları ${target.name}'den ${actualStolen} Altın çaldı.`,'#c080e8');
        break;
      }
      case 'sabotage_army': {
        const sabLoss=Math.floor(Math.random()*25)+15;
        target.army=Math.max(5,target.army-sabLoss);
        target.morale=Math.max(0,(target.morale||80)-15);
        resultIcon='💣';
        resultText='Sabotaj Başarılı!';
        resultSub=`${target.name} ordusundan ${sabLoss} asker etkisiz hale getirildi!`;
        addChronicle('💣',`${source.name} Sabotaj Yaptı`,`${source.name}'nin ajanları ${target.name} ordusunu sabote etti. -${sabLoss} asker.`,'#c080e8');
        break;
      }
      case 'assassinate':
        target.territory=Math.max(10,(target.territory||60)-20);
        target.morale=Math.max(0,(target.morale||80)-30);
        resultIcon='🗡️';
        resultText='Suikast Başarılı!';
        resultSub=`${target.name}'in liderliği zayıfladı! Toprak -20, Moral -30`;
        addChronicle('🗡️',`${source.name} Suikast Düzenledi`,`${source.name}'nin bir ajanı ${target.name}'e suikast girişiminde bulundu.`,'#e85050');
        break;
      case 'incite_revolt': {
        const vassals=kingdoms.filter(v=>v.conquered===target.id);
        if(vassals.length>0){
          const revolter=vassals[Math.floor(Math.random()*vassals.length)];
          revolter.conquered=null;
          target.territory=Math.max(10,(target.territory||60)-15);
          resultIcon='🔥';
          resultText='İsyan Kışkırtıldı!';
          resultSub=`${revolter.name} ${target.name}'e karşı isyan etti!`;
          addChronicle('🔥',`${revolter.name} İsyan Etti`,`${source.name}'nin kışkırtmasıyla ${revolter.name}, ${target.name}'e karşı isyan bayrağı açtı.`,'#e85050');
        } else {
          resultIcon='😐';
          resultText='İsyan Bulunamadı';
          resultSub='Hedef krallığın vasili yok, isyan tetiklenemedi.';
        }
        break;
      }
      case 'forge_treaty': {
        const targetAllies=[...(target.alliances||[])];
        if(targetAllies.length>0){
          const brokenAlly=targetAllies[0];
          target.alliances=(target.alliances||[]).filter(a=>a!==brokenAlly);
          const ba=findKingdom(brokenAlly);
          if(ba) ba.alliances=(ba.alliances||[]).filter(a=>a!==target.id);
          resultIcon='📜';
          resultText='Anlaşma Sabotajı!';
          resultSub=`${target.name} ile ${ba?.name||'?'} ittifakı çöktürüldü!`;
          addChronicle('📜',`Anlaşma Sabotajı`,`${source.name}'nin casusları ${target.name} ile ${ba?.name||'?'} arasındaki ittifakı bozmayı başardı.`,'#c080e8');
        } else {
          resultIcon='😐';
          resultText='Sabote Edilecek Anlaşma Yok';
          resultSub='Hedef krallığın ittifakı bulunmuyor.';
        }
        break;
      }
    } // switch(opId) sonu
  } else {
    sfxSabotage();
    resultIcon='❌';
    resultText='Operasyon Başarısız';
    // Chance of counter-spy
    const discovered=Math.random()<0.3;
    if(discovered){
      resultSub=`Casus yakalandı! ${target.name} haberdar edildi.`;
      target.morale=Math.min(100,(target.morale||80)+5);
      addChronicle('🕵️',`Casus Yakalandı`,`${source.name}'nin casusunun ${target.name}'deki operasyonu başarısız oldu ve casus yakalandı.`,'#888');
    } else {
      resultSub='Operasyon başarısızlıkla sonuçlandı.';
    }
  }

  resultEl.innerHTML=`
    <div class="spy-result-icon">${resultIcon}</div>
    <div class="spy-result-text">${resultText}</div>
    <div class="spy-result-sub">${resultSub}</div>
  `;

  await saveData(); renderAll();
}

function closeSpyScreen(){document.getElementById('spy-screen').classList.remove('open');}

/* ════════════════════════════════════════
   REPOSITION
════════════════════════════════════════ */
function startRepos(id){closePanel();setMode('repos',id);toast('📍 Yeni konuma dokun');}
async function finishRepos(x,y){
  const k=findKingdom(modeKid); if(!k){cancelMode();return;}
  k.x=Math.round(x); k.y=Math.round(y);
  cancelMode(); await saveData(); renderAll();
  toast(`📍 ${k.name} yeniden konumlandırıldı`);
}

/* ════════════════════════════════════════
   TERRITORY
════════════════════════════════════════ */
function startTerr(id){closePanel();terrPts=[];setMode('terr',id);toast('🗺️ Sınır noktaları ekle, sonra BİTTİ');}
function addTerrPt(x,y){
  terrPts.push({x:Math.round(x),y:Math.round(y)});
  const dot=document.createElement('div'); dot.className='terr-dot';
  const k=findKingdom(modeKid);
  const col=k?.color||'#c8960a';
  dot.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${14/sc}px;height:${14/sc}px;background:${col};border-radius:50%;transform:translate(-50%,-50%);z-index:25;pointer-events:none;box-shadow:0 0 ${20/sc}px ${col};border:${2/sc}px solid #fff;`;
  document.getElementById('markers-layer').appendChild(dot);
  if(k&&terrPts.length>=3){
    const saved=k.pts;
    try{k.pts=[...terrPts];renderTerritories();}finally{k.pts=saved;}
  }
  toast(`📍 ${terrPts.length} nokta`);
}
async function finishTerr(){
  const k=findKingdom(modeKid);
  if(k&&terrPts.length>=3){k.pts=[...terrPts];k.showT=true;await saveData();toast(`✅ ${k.name} toprak sınırı kaydedildi!`);}
  else if(terrPts.length<3) toast('⚠️ En az 3 nokta gerekli');
  document.querySelectorAll('.terr-dot').forEach(d=>d.remove());
  terrPts=[]; cancelMode(); renderAll();
}
async function clearTerr(id){const k=findKingdom(id);if(!k) return;k.pts=[];await saveData();renderAll();toast(`🗺️ ${k.name} toprak sınırı silindi`);}
async function toggleShowT(id){const k=findKingdom(id);if(!k) return;k.showT=!k.showT;await saveData();renderAll();toast(k.showT?'👁️ Toprak görünür':'🙈 Toprak gizlendi');}

/* ════════════════════════════════════════
   LIBERATE
════════════════════════════════════════ */
async function liberate(id){
  const k=findKingdom(id); if(!k||!k.conquered) return;
  const master=kingdoms.find(m=>m.id===k.conquered);
  if(master) master.conquests=Math.max(0,(master.conquests||1)-1);
  k.conquered=null;
  addChronicle('🕊️',`${k.name} Özgür`,`${k.name}, ${master?.name||'?'} yönetiminden bağımsızlığını kazandı.`,'#4acc88');
  await saveData(); renderAll(); closePanel();
  toast(`🕊️ ${k.name} özgürlüğüne kavuştu!`);
}

/* ════════════════════════════════════════
   ECONOMY
════════════════════════════════════════ */
async function recruitArmy(id){
  const k=findKingdom(id); if(!k) return;
  const cost=80;
  if((k.gold||0)<cost){toast(`⚠️ Asker almak için ${cost} Altın gerekli`);return;}
  k.gold-=cost; k.army=(k.army||0)+25;
  k.morale=Math.min(100,(k.morale||80)+5); // Army boost boosts morale
  addChronicle('⚔️',`${k.name} Ordusu Büyüdü`,`25 yeni asker toplandı. Maliyet: ${cost} Altın.`,k.color);
  await saveData(); 
  krallığıGuncelleMultiplayer(id); // ✅ MULTIPLAYER SYNC
  renderAll(); openDetail(id); openPanel();
  toast(`⚔️ ${k.name}: +25 asker (-${cost}🥇)`);
}
async function buildNavy(id){
  const k=findKingdom(id); if(!k) return;
  const cost=100;
  if((k.gold||0)<cost){toast(`⚠️ Gemi için ${cost} Altın gerekli`);return;}
  k.gold-=cost; k.navy=(k.navy||0)+15;
  addChronicle('⚓',`${k.name} Donanması Güçlendi`,`15 yeni gemi inşa edildi. Maliyet: ${cost} Altın.`,k.color);
  await saveData(); 
  krallığıGuncelleMultiplayer(id); // ✅ MULTIPLAYER SYNC
  renderAll(); openDetail(id); openPanel();
  toast(`⚓ ${k.name}: +15 gemi (-${cost}🥇)`);
}
async function collectTribute(id){
  const k=findKingdom(id); if(!k) return;
  const vassals=kingdoms.filter(v=>v.conquered===id);
  if(!vassals.length){toast('⚠️ Haraç alınacak vasil yok');return;}
  let total=0;
  vassals.forEach(v=>{
    const tribute=Math.round((v.gold||0)*.15);
    v.gold=Math.max(0,(v.gold||0)-tribute);
    v.morale=Math.max(0,(v.morale||80)-5); // Tribute reduces vassal morale
    k.gold=(k.gold||0)+tribute;
    total+=tribute;
  });
  addChronicle('💰',`${k.name} Haraç Topladı`,`${vassals.length} vasilden toplam ${total} Altın alındı.`,k.color);
  sfxGold();
  await saveData(); 
  krallığıGuncelleMultiplayer(id); // ✅ MULTIPLAYER SYNC
  renderAll(); openDetail(id); openPanel();
  toast(`💰 ${k.name}: +${total}🥇 haraç toplandı`);
}
async function collectGold(id){
  const k=findKingdom(id); if(!k) return;
  const season=SEASONS[globalState.season];
  const councilBonus=k.council&&(k.council.master_coin||k.council.hand)?1.2:1;
  const tradeBonus=1+((k.trades||[]).length)*0.05;
  const income=Math.round(50+(k.territory||0)*.2+(k.conquests||0)*15)*season.goldMod*councilBonus*tradeBonus;
  k.gold=(k.gold||0)+Math.round(income);
  addChronicle('💰',`${k.name} Vergi Topladı`,`${Math.round(income)} Altın vergi geliri elde edildi.`,k.color);
  sfxGold();
  await saveData(); 
  krallığıGuncelleMultiplayer(id); // ✅ MULTIPLAYER SYNC
  renderAll(); openDetail(id); openPanel();
  toast(`💰 ${k.name}: +${Math.round(income)}🥇 vergi geliri`);
}
async function trainMorale(id){
  const k=findKingdom(id); if(!k) return;
  const cost=40;
  if((k.gold||0)<cost){toast(`⚠️ Moral eğitimi için ${cost} Altın gerekli`);return;}
  k.gold-=cost;
  k.morale=Math.min(100,(k.morale||80)+20);
  addChronicle('💪',`${k.name} Moral Yükseltildi`,`Ordu morali 20 puan arttırıldı. Maliyet: ${cost} Altın.`,k.color);
  await saveData(); renderAll(); openDetail(id); openPanel();
  toast(`💪 ${k.name}: +20 Moral (-${cost}🥇)`);
}

/* ════════════════════════════════════════
   COUNCIL SYSTEM
════════════════════════════════════════ */
async function assignCouncil(kingdomId, seatId, memberName){
  const k=findKingdom(kingdomId); if(!k) return;
  if(!k.council) k.council={};
  if(k.council[seatId]===memberName){
    delete k.council[seatId];
    toast(`✂️ ${COUNCIL_SEATS.find(s=>s.id===seatId)?.role} görevi boşaltıldı`);
  } else {
    k.council[seatId]=memberName;
    const seat=COUNCIL_SEATS.find(s=>s.id===seatId);
    addChronicle('👑',`${k.name} Konseyi`,`${memberName}, ${seat?.role} olarak atandı. Bonus: ${seat?.bonus}`,k.color);
    toast(`👑 ${memberName} → ${seat?.role} atandı!`);
  }
  await saveData(); renderAll();
  openDetail(kingdomId); openPanel();
}

/* ════════════════════════════════════════
   DETAIL PANEL
════════════════════════════════════════ */
function openDetail(id){
  currentDetailId=id;
  const k=findKingdom(id); if(!k) return;
  const cb=k.conquered?findKingdom(k.conquered):null;
  const vassals=kingdoms.filter(v=>v.conquered===id);
  const hasPhoto=k.photo&&k.photo.trim();
  const pw=power(k);
  const allies=(k.alliances||[]).map(aid=>findKingdom(aid)).filter(Boolean);
  const tradePartners=(k.trades||[]).map(tid=>findKingdom(tid)).filter(Boolean);

  const tabs=[
    {id:'info',label:'Bilgi',icon:'🏰'},
    {id:'economy',label:'Ekonomi',icon:'💰'},
    {id:'council',label:'Konsey',icon:'👑'},
    allies.length>0?{id:'allies',label:'İttifaklar',icon:'🤝'}:null,
    tradePartners.length>0?{id:'trade',label:'Ticaret',icon:'📦'}:null,
    vassals.length>0?{id:'vassals',label:'Vasiller',icon:'⚔️'}:null,
    (k.spies||[]).length>0||(k.spiedBy||[]).length>0?{id:'intel',label:'İstihbarat',icon:'🕵️'}:null,
  ].filter(Boolean);

  setTabs(tabs,'info');
  renderDetailInfo(k,cb,vassals,pw,allies,tradePartners);
  openPanel();
}

function setTabs(tabs,active){
  const tabsEl=document.getElementById('panel-tabs');
  tabsEl.innerHTML='';
  tabs.forEach(t=>{
    const btn=document.createElement('button');
    btn.className='panel-tab'+(t.id===active?' active':'');
    btn.innerHTML=`${t.icon} ${t.label}`;
    btn.onclick=()=>{
      document.querySelectorAll('.panel-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const k=findKingdom(currentDetailId); if(!k) return;
      const cb=k.conquered?findKingdom(k.conquered):null;
      const vassals=kingdoms.filter(v=>v.conquered===currentDetailId);
      const pw=power(k);
      const allies=(k.alliances||[]).map(aid=>findKingdom(aid)).filter(Boolean);
      const tradePartners=(k.trades||[]).map(tid=>findKingdom(tid)).filter(Boolean);
      if(t.id==='info') renderDetailInfo(k,cb,vassals,pw,allies,tradePartners);
      else if(t.id==='economy') renderDetailEconomy(k);
      else if(t.id==='council') renderDetailCouncil(k);
      else if(t.id==='allies') renderDetailAllies(k);
      else if(t.id==='trade') renderDetailTrade(k);
      else if(t.id==='vassals') renderDetailVassals(k);
      else if(t.id==='intel') renderDetailIntel(k);
    };
    tabsEl.appendChild(btn);
  });
}

function renderDetailInfo(k,cb,vassals,pw,allies,tradePartners){
  const hasPhoto=k.photo&&k.photo.trim();
  const badges=getKingdomBadges(k);
  const moraleW=k.morale||80;
  const moraleC=moraleColor(moraleW);
  const season=SEASONS[globalState.season];
  const isStark=k.house.toLowerCase().includes('stark');
  const pwMod=isStark?season.powerMod.stark:season.powerMod.default;

  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:${k.color}">${k.sigil} ${k.house.toUpperCase()}</div>
    <div class="kd-hdr">
      <div class="kd-av" style="--kc:${k.color};border-color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;`:''}">
        ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`<span style="color:${k.color};font-family:'Cinzel',serif;font-size:26px;font-weight:700">${k.name.charAt(0)}</span>`}
      </div>
      <div class="kd-inf">
        <div class="kd-name">${k.name}</div>
        <div class="kd-title-txt">${k.title||''}</div>
        <div class="kd-house-lbl" style="color:${k.color}">${k.sigil} Hane ${k.house}</div>
        ${cb?`<div class="kd-conq-by">⚔️ ${cb.name} tarafından fethedildi</div>`:''}
        <div class="kd-status-badges">${badges.map(b=>`<span class="kd-badge ${b.cls}">${b.label}</span>`).join('')}</div>
      </div>
    </div>

    <!-- Morale bar -->
    <div style="margin-bottom:12px;background:rgba(200,150,10,.03);border:1px solid rgba(200,150,10,.1);border-radius:var(--radius-sm);padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;">Moral</div>
        <div style="font-family:'Cinzel',serif;font-size:11px;color:${moraleC};font-weight:700;">${moraleW}%</div>
      </div>
      <div style="height:5px;background:rgba(200,150,10,.08);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${moraleW}%;background:${moraleC};border-radius:3px;transition:width .5s;"></div>
      </div>
    </div>

    <div class="kd-resources">
      <div class="kd-res"><div class="kd-res-icon">👑</div><div class="kd-res-val" style="color:${k.color}">${pw}</div><div class="kd-res-lbl">Güç</div><div class="kd-res-trend" style="color:${pwMod>1?'#4acc88':'#e85050'}">${pwMod>1?'↑':'↓'} ${season.name}</div></div>
      <div class="kd-res"><div class="kd-res-icon">⚔️</div><div class="kd-res-val" style="color:#e87070">${k.army||0}</div><div class="kd-res-lbl">Ordu</div></div>
      <div class="kd-res"><div class="kd-res-icon">⚓</div><div class="kd-res-val" style="color:#7ab8e8">${k.navy||0}</div><div class="kd-res-lbl">Donanma</div></div>
      <div class="kd-res"><div class="kd-res-icon">🥇</div><div class="kd-res-val" style="color:var(--gold)">${k.gold||0}</div><div class="kd-res-lbl">Altın</div></div>
    </div>

    <div class="kd-stats">
      <div class="kd-stat"><div class="kd-sv" style="color:${k.color}">${k.territory||60}</div><div class="kd-sl">Toprak</div></div>
      <div class="kd-stat"><div class="kd-sv" style="color:#e85050">${k.conquests||0}</div><div class="kd-sl">Fetih</div></div>
      <div class="kd-stat"><div class="kd-sv" style="color:#c8960a">${vassals.length}</div><div class="kd-sl">Vasil</div></div>
    </div>

    ${allies.length>0?`
    <div class="kd-ally-list">
      <div class="kd-vassal-ttl">İttifaklar</div>
      <div>${allies.map(a=>`<div class="ally-chip" onclick="openDetail('${a.id}')"><span>${a.sigil}</span><span>${a.name.split(' ')[0]}</span><span class="break-ally" onclick="event.stopPropagation();breakAlliance('${k.id}','${a.id}')" title="İttifakı boz">✕</span></div>`).join('')}</div>
    </div>`:''}

    ${tradePartners.length>0?`
    <div class="kd-ally-list">
      <div class="kd-vassal-ttl">Ticaret Rotaları</div>
      <div>${tradePartners.map(t=>`<div class="ally-chip" style="background:rgba(32,176,96,.06);border-color:rgba(32,176,96,.2);color:#40d080;" onclick="openDetail('${t.id}')"><span>${t.sigil}</span><span>${t.name.split(' ')[0]}</span><span class="break-ally" onclick="event.stopPropagation();breakTrade('${k.id}','${t.id}')" title="Ticareti kes" style="color:rgba(200,80,80,.6)">✕</span></div>`).join('')}</div>
    </div>`:''}

    ${(k.marriageAlliances||[]).length>0?`
    <div class="kd-ally-list">
      <div class="kd-vassal-ttl">Hanedan Evlilikleri</div>
      <div>${k.marriageAlliances.map(mid=>{
        const m = kingdoms.find(x=>x.id===mid);
        return m ? `<div class="ally-chip" style="background:rgba(200,56,106,.08);border-color:rgba(200,56,106,.25);color:#e86090;" onclick="openDetail('${m.id}')"><span>💍</span><span>${m.name.split(' ')[0]}</span></div>` : '';
      }).join('')}</div>
    </div>`:''}

    <div class="kd-acts">
      <button class="ka-btn ka-edit" onclick="openEdit('${k.id}')"><i class="fa-solid fa-pen"></i> DÜZENLE</button>
      <button class="ka-btn ka-pos" onclick="startRepos('${k.id}')"><i class="fa-solid fa-location-dot"></i> KONUM</button>
      <button class="ka-btn ka-terr" onclick="startTerr('${k.id}')"><i class="fa-solid fa-draw-polygon"></i> TOPRAK</button>
    </div>
    <div class="kd-acts">
      <button class="ka-btn ka-war" onclick="startConquer('${k.id}')" style="flex:2"><i class="fa-solid fa-sword"></i> ⚔️ SAVAŞ</button>
      <button class="ka-btn ka-ally" onclick="openAllyMgr('${k.id}')" style="flex:1.5">🤝 İTTİFAK</button>
    </div>
    <div class="kd-acts">
      <button class="ka-btn ka-trade" onclick="startTrade('${k.id}')">📦 TİCARET</button>
      <button class="ka-btn ka-spy" onclick="startSpy('${k.id}')">🕵️ CASUSLUK</button>
      <button class="ka-btn ka-ally" style="background:rgba(200,56,106,0.1); border-color:rgba(200,56,106,0.3); color:#e86090;" onclick="startMarriage('${k.id}')">💍 EVLİLİK</button>
      ${k.conquered?`<button class="ka-btn ka-lib" onclick="liberate('${k.id}')"><i class="fa-solid fa-dove"></i> ÖZGÜR</button>`:''}
    </div>
    <div class="kd-acts">
      ${vassals.length>0?`<button class="ka-btn ka-tribute" onclick="collectTribute('${k.id}')">💰 HARAÇ</button>`:''}
      ${k.pts&&k.pts.length>0?`
        <button class="ka-btn ka-pos" onclick="toggleShowT('${k.id}')" style="flex:0 0 44px;padding:10px" title="${k.showT?'Gizle':'Göster'}"><i class="fa-solid fa-eye${k.showT?'':'-slash'}"></i></button>
        <button class="ka-btn ka-del" onclick="clearTerr('${k.id}')" style="flex:0 0 44px;padding:10px"><i class="fa-solid fa-eraser"></i></button>
      `:''}
      <button class="ka-btn ka-del" onclick="confirmDel('${k.id}')"><i class="fa-solid fa-trash"></i></button>
    </div>
    <button class="ka-map" onclick="flyTo(${k.x},${k.y},0.32)"><i class="fa-solid fa-map-location-dot"></i> Haritada Göster</button>
  `;
}

function renderDetailEconomy(k){
  const season=SEASONS[globalState.season];
  const councilBonus=k.council&&(k.council.master_coin||k.council.hand)?1.2:1;
  const tradeBonus=1+((k.trades||[]).length)*0.05;
  const income=Math.round((50+(k.territory||0)*.2+(k.conquests||0)*15)*season.goldMod*councilBonus*tradeBonus);
  // FİX: vassalCount bir kez hesaplanıyor - hem kontrol hem gösterim için aynı değer
  const vassalCount=_vassalCountCache.get(k.id)||0;
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:${k.color}">💰 EKONOMİ</div>
    <div class="kd-resources" style="margin-bottom:12px;">
      <div class="kd-res"><div class="kd-res-icon">⚔️</div><div class="kd-res-val" style="color:#e87070">${k.army||0}</div><div class="kd-res-lbl">Ordu</div></div>
      <div class="kd-res"><div class="kd-res-icon">⚓</div><div class="kd-res-val" style="color:#7ab8e8">${k.navy||0}</div><div class="kd-res-lbl">Donanma</div></div>
      <div class="kd-res"><div class="kd-res-icon">🥇</div><div class="kd-res-val" style="color:var(--gold)">${k.gold||0}</div><div class="kd-res-lbl">Altın</div></div>
      <div class="kd-res"><div class="kd-res-icon">💪</div><div class="kd-res-val" style="color:${moraleColor(k.morale||80)}">${k.morale||80}</div><div class="kd-res-lbl">Moral</div></div>
    </div>
    <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;margin-bottom:12px;">Eylemler</div>
    <div class="kd-economy">
      <button class="eco-btn eco-gold" onclick="collectGold('${k.id}')">💰<br>Vergi Topla<br><span style="opacity:.6;font-size:6px">+${income} Altın</span></button>
      <button class="eco-btn eco-army" onclick="recruitArmy('${k.id}')">⚔️<br>Asker Al<br><span style="opacity:.6;font-size:6px">+25 / 80🥇</span></button>
      <button class="eco-btn eco-navy" onclick="buildNavy('${k.id}')">⚓<br>Gemi İnşa<br><span style="opacity:.6;font-size:6px">+15 / 100🥇</span></button>
      <button class="eco-btn eco-spy" onclick="trainMorale('${k.id}')">💪<br>Moral Yükselt<br><span style="opacity:.6;font-size:6px">+20 / 40🥇</span></button>
    </div>
    ${vassalCount>0?`
      <button class="eco-btn eco-gold" style="width:100%;margin-top:8px" onclick="collectTribute('${k.id}')">
        💰 Vasil Haracı Al — ${vassalCount} Vasil
      </button>
    `:''}
    <div style="margin-top:16px;font-size:10px;color:var(--text-dim);line-height:1.7;padding:12px;background:rgba(200,150,10,.02);border:1px solid rgba(200,150,10,.08);border-radius:8px;">
      <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;margin-bottom:6px;">Vergi Hesabı</div>
      Toprak: +${Math.round((k.territory||0)*.2)}<br>
      Fetihler: +${(k.conquests||0)*15}<br>
      Baz Gelir: +50<br>
      Mevsim Çarpanı: ×${season.goldMod.toFixed(1)}<br>
      Konsey Bonusu: ×${councilBonus.toFixed(1)}<br>
      Ticaret Bonusu: ×${tradeBonus.toFixed(2)}<br>
      <strong style="color:var(--gold)">Toplam: +${income} / tur</strong>
    </div>
  `;
}

function renderDetailCouncil(k){
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:var(--gold)">👑 KRAL KONSEYİ</div>
    <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:16px;line-height:1.6;">
      Konseye üye atayın. Üyenin adını girin.
    </div>
    <div class="council-grid">
      ${COUNCIL_SEATS.map(seat=>{
        const member=k.council&&k.council[seat.id];
        return `<div class="council-seat" style="--sc:${seat.colorVar}40;">
          <div class="council-role">${seat.role}</div>
          <span class="council-icon">${seat.icon}</span>
          <div class="council-name">${member||'Boş'}</div>
          <div class="council-bonus" style="color:${seat.colorVar}">${seat.bonus}</div>
          <button class="council-assign" onclick="promptCouncil('${k.id}','${seat.id}','${seat.role}')">
            ${member?'✏️ Değiştir':'+ Ata'}
          </button>
          ${member?`<div onclick="assignCouncil('${k.id}','${seat.id}','')" style="margin-top:4px;font-size:8px;color:rgba(200,80,80,.6);cursor:pointer;font-family:'Cinzel',serif;letter-spacing:1px;">✕ Görevden Al</div>`:''}
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:9px;color:var(--text-dim);padding:10px;background:rgba(200,150,10,.02);border:1px solid rgba(200,150,10,.08);border-radius:8px;line-height:1.7;">
      <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;margin-bottom:6px;">Aktif Bonuslar</div>
      ${COUNCIL_SEATS.filter(s=>k.council&&k.council[s.id]).map(s=>`${s.icon} <strong>${k.council[s.id]}</strong> — ${s.bonus}`).join('<br>')||'Henüz aktif bonus yok.'}
    </div>
  `;
}

function promptCouncil(kid,seatId,role){
  const name=prompt(`${role} için isim girin:`);
  if(name&&name.trim()) assignCouncil(kid,seatId,name.trim());
}

function renderDetailAllies(k){
  const allies=(k.alliances||[]).map(aid=>findKingdom(aid)).filter(Boolean);
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:#7ab8e8">🤝 İTTİFAKLAR</div>
    ${allies.length===0?`<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:30px;">Henüz ittifak kurulmadı</div>`:''}
    <div class="k-list">
      ${allies.map(a=>{
        const pw=power(a);
        const hasPhoto=a.photo&&a.photo.trim();
        return `<div class="k-row" style="--kc:${a.color}" onclick="openDetail('${a.id}')">
          <div class="k-row-av" style="border-color:${a.color};color:${a.color};${hasPhoto?`background-image:url('${a.photo}');background-size:cover;background-color:#1a1208;`:''}background:#1a1208;">
            ${hasPhoto?`<img src="${a.photo}" onerror="this.style.display='none'" alt="">`:`${a.name.charAt(0)}`}
          </div>
          <div class="k-row-inf">
            <div class="k-row-name">${a.name}</div>
            <div class="k-row-sub">${a.sigil} ${a.house}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
            <div class="k-row-pwr" style="color:${a.color};border-color:${a.color}40;">${pw}</div>
            <button class="ka-btn ka-del" style="flex:none;min-width:32px;height:28px;font-size:9px;padding:4px 8px" onclick="event.stopPropagation();breakAlliance('${k.id}','${a.id}')">✕ Boz</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:16px">
      <button class="ka-btn ka-ally" style="width:100%" onclick="openAllyMgr('${k.id}')">🤝 YENİ İTTİFAK KUR</button>
    </div>
  `;
}

function renderDetailTrade(k){
  const tradePartners=(k.trades||[]).map(tid=>findKingdom(tid)).filter(Boolean);
  const income=tradePartners.length*15;
  // FİX: Math.random kaldırıldı, her açılışta aynı ticaret ikonunu göster (tutarlı UX)
  const TRADE_ICONS=['🌾','🍷','⚔️','🧶','🌶️','⛏️','🌲','🏺'];
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:#40d080">📦 TİCARET</div>
    <div style="background:rgba(32,176,96,.06);border:1px solid rgba(32,176,96,.15);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:11px;color:var(--text-dim);">Ticaret Geliri</div>
      <div style="font-family:'Cinzel',serif;font-size:22px;color:#40d080;font-weight:700;">+${income}</div>
      <div style="font-size:9px;color:var(--text-dim);">Altın / Tur (${tradePartners.length} rota × 15)</div>
    </div>
    <div class="k-list">
      ${tradePartners.map(t=>{
        const pw=power(t);
        const hasPhoto=t.photo&&t.photo.trim();
        const good=TRADE_GOODS[Math.floor(Math.random()*TRADE_GOODS.length)];
        return `<div class="k-row" style="--kc:${t.color}" onclick="openDetail('${t.id}')">
          <div class="k-row-av" style="border-color:${t.color};color:${t.color};${hasPhoto?`background-image:url('${t.photo}');background-size:cover;background-color:#1a1208;`:''}background:#1a1208;">
            ${hasPhoto?`<img src="${t.photo}" onerror="this.style.display='none'" alt="">`:`${t.name.charAt(0)}`}
          </div>
          <div class="k-row-inf">
            <div class="k-row-name">${t.name}</div>
            <div class="k-row-sub">${TRADE_ICONS[t.id.charCodeAt(0)%TRADE_ICONS.length]} ${TRADE_GOODS[t.id.charCodeAt(0)%TRADE_GOODS.length]}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
            <div style="font-family:'Cinzel',serif;font-size:10px;color:#40d080;border:1px solid rgba(32,176,96,.3);border-radius:5px;padding:3px 8px;">+15🥇</div>
            <button class="ka-btn ka-del" style="flex:none;min-width:32px;height:28px;font-size:9px;padding:4px 8px" onclick="event.stopPropagation();breakTrade('${k.id}','${t.id}')">✕</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:16px">
      <button class="ka-btn ka-trade" style="width:100%" onclick="startTrade('${k.id}')">📦 YENİ TİCARET ROTASI</button>
    </div>
  `;
}

function renderDetailVassals(k){
  // Not: Bu fonksiyon openDetail'den geçilen vassals listesini yeniden alıyor.
  // Buradaki filter kabul edilebilir - sadece vasaller sekmesi açıldığında çağrılıyor, render döngüsünde değil.
  const vassals=kingdoms.filter(v=>v.conquered===k.id);
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:${k.color}">⚔️ VASİLLER</div>
    <div class="k-list">
      ${vassals.map(v=>{
        const pw=power(v);
        const hasPhoto=v.photo&&v.photo.trim();
        return `<div class="k-row" style="--kc:${v.color}" onclick="openDetail('${v.id}')">
          <div class="k-row-av" style="border-color:${v.color};color:${v.color};${hasPhoto?`background-image:url('${v.photo}');background-size:cover;background-color:#1a1208;`:''}background:#1a1208;">
            ${hasPhoto?`<img src="${v.photo}" onerror="this.style.display='none'" alt="">`:`${v.name.charAt(0)}`}
          </div>
          <div class="k-row-inf">
            <div class="k-row-name">${v.name}</div>
            <div class="k-row-sub">${v.sigil} ${v.house} · ⚔️${v.army} 🥇${v.gold} 💪${v.morale||80}</div>
          </div>
          <div class="k-row-pwr" style="color:${v.color};border-color:${v.color}40;">${pw}</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderDetailIntel(k){
  const spying=(k.spies||[]).map(sid=>kingdoms.find(s=>s.id===sid)).filter(Boolean);
  const spiedBy=(k.spiedBy||[]).map(sid=>kingdoms.find(s=>s.id===sid)).filter(Boolean);
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl" style="color:#c080e8">🕵️ İSTİHBARAT</div>
    
    ${spying.length>0?`
    <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;margin-bottom:10px;">Casusluk Yaptığım</div>
    <div class="k-list" style="margin-bottom:16px;">
      ${spying.map(t=>{
        const hasPhoto=t.photo&&t.photo.trim();
        return `<div class="spy-report">
          <div class="spy-report-ttl">🔭 ${t.name} — Casuslar Aktif</div>
          <div class="spy-report-row"><span class="spy-report-key">Ordu</span><span class="spy-report-val">⚔️ ${t.army}</span></div>
          <div class="spy-report-row"><span class="spy-report-key">Altın</span><span class="spy-report-val">🥇 ${t.gold}</span></div>
          <div class="spy-report-row"><span class="spy-report-key">Donanma</span><span class="spy-report-val">⚓ ${t.navy}</span></div>
          <div class="spy-report-row"><span class="spy-report-key">Güç</span><span class="spy-report-val">👑 ${power(t)}</span></div>
          <div class="spy-report-row"><span class="spy-report-key">Moral</span><span class="spy-report-val">💪 ${t.morale||80}%</span></div>
        </div>`;
      }).join('')}
    </div>`:''}
    
    ${spiedBy.length>0?`
    <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;margin-bottom:10px;">Beni Casuslayan</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${spiedBy.map(s=>`<div style="background:rgba(200,50,50,.08);border:1px solid rgba(200,50,50,.2);border-radius:6px;padding:6px 12px;font-family:'Cinzel',serif;font-size:9px;color:#e87070;">${s.sigil} ${s.name.split(' ')[0]}</div>`).join('')}
    </div>`:''}
    
    <div style="margin-top:16px">
      <button class="ka-btn ka-spy" style="width:100%" onclick="startSpy('${k.id}')">🕵️ YENİ CASUSLUK İŞLEMİ</button>
    </div>
  `;
}

/* ════════════════════════════════════════
   DIPLOMACY PANEL
════════════════════════════════════════ */
function showDiplomacy(){
  currentDetailId=null;
  setTabs([{id:'dipl',label:'Diplomasi',icon:'🌍'}],'dipl');
  
  // Count all active relations
  const totalAlliances=kingdoms.reduce((s,k)=>(k.alliances||[]).length+s,0)/2;
  const totalTrades=kingdoms.reduce((s,k)=>(k.trades||[]).length+s,0)/2;
  const atWar=kingdoms.filter(k=>k.conquered).length;

  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl">🌍 DİPLOMASİ MERKEZİ</div>
    
    <div class="kd-resources" style="margin-bottom:20px;">
      <div class="kd-res"><div class="kd-res-icon">🤝</div><div class="kd-res-val" style="color:#7ab8e8">${Math.round(totalAlliances)}</div><div class="kd-res-lbl">İttifak</div></div>
      <div class="kd-res"><div class="kd-res-icon">📦</div><div class="kd-res-val" style="color:#40d080">${Math.round(totalTrades)}</div><div class="kd-res-lbl">Ticaret</div></div>
      <div class="kd-res"><div class="kd-res-icon">⚔️</div><div class="kd-res-val" style="color:#e85050">${atWar}</div><div class="kd-res-lbl">Fethedilen</div></div>
      <div class="kd-res"><div class="kd-res-icon">📜</div><div class="kd-res-val" style="color:var(--gold)">${globalState.totalBattles||0}</div><div class="kd-res-lbl">Savaş</div></div>
    </div>

    <div class="dipl-section">
      <div class="dipl-ttl">İttifak Ağı</div>
      <div style="font-size:10px;color:var(--text-dim);line-height:1.7;margin-bottom:10px;">Mevcut ittifaklar haritada mavi çizgilerle gösterilmektedir.</div>
      ${kingdoms.filter(k=>(k.alliances||[]).length>0).map(k=>`
        <div class="k-row" style="--kc:${k.color};margin-bottom:6px;" onclick="openDetail('${k.id}')">
          <div style="font-family:'Cinzel',serif;font-size:10px;color:${k.color};flex-shrink:0;">${k.sigil}</div>
          <div class="k-row-inf">
            <div class="k-row-name">${k.name}</div>
            <div class="k-row-sub">🤝 ${(k.alliances||[]).length} ittifak</div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="dipl-section">
      <div class="dipl-ttl">Ticaret Ağı</div>
      ${kingdoms.filter(k=>(k.trades||[]).length>0).map(k=>`
        <div class="k-row" style="--kc:${k.color};margin-bottom:6px;" onclick="openDetail('${k.id}')">
          <div style="font-family:'Cinzel',serif;font-size:10px;color:${k.color};flex-shrink:0;">${k.sigil}</div>
          <div class="k-row-inf">
            <div class="k-row-name">${k.name}</div>
            <div class="k-row-sub">📦 ${(k.trades||[]).length} ticaret rotası · +${(k.trades||[]).length*15}🥇/tur</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  openPanel();
}

/* ════════════════════════════════════════
STATISTICS PANEL
════════════════════════════════════════ */
function showStats(){
    currentDetailId = null;
    setTabs([{id:'stats', label:'İstatistikler', icon:'📊'}], 'stats');
    
    const totalAlliances = kingdoms.reduce((s,k)=>(k.alliances||[]).length+s,0)/2;
    const totalTrades    = kingdoms.reduce((s,k)=>(k.trades||[]).length+s,0)/2;
    const conqueredCount = kingdoms.filter(k=>k.conquered).length;
    const top5           = [...kingdoms].filter(k=>!k.conquered).sort((a,b)=>power(b)-power(a)).slice(0,5);
    const maxP           = top5.length ? power(top5[0]) : 1;
    const season         = SEASONS[globalState.season];

    document.getElementById('panel-body').innerHTML = `
        <div class="panel-ttl">📊 GENEL İSTATİSTİKLER</div>
        <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;color:var(--text-dim);text-align:center;margin-bottom:16px;">
            Tur ${globalState.turn} · ${season.icon} ${season.name}
        </div>

        <div class="kd-resources" style="margin-bottom:20px;">
            <div class="kd-res"><div class="kd-res-icon">🏰</div><div class="kd-res-val" style="color:var(--gold)">${kingdoms.length}</div><div class="kd-res-lbl">Hane</div></div>
            <div class="kd-res"><div class="kd-res-icon">⚔️</div><div class="kd-res-val" style="color:#e85050">${globalState.totalBattles||0}</div><div class="kd-res-lbl">Savaş</div></div>
            <div class="kd-res"><div class="kd-res-icon">🤝</div><div class="kd-res-val" style="color:#7ab8e8">${Math.round(totalAlliances)}</div><div class="kd-res-lbl">İttifak</div></div>
            <div class="kd-res"><div class="kd-res-icon">📦</div><div class="kd-res-val" style="color:#40d080">${Math.round(totalTrades)}</div><div class="kd-res-lbl">Ticaret</div></div>
            <div class="kd-res"><div class="kd-res-icon">🔬</div><div class="kd-res-val" style="color:#20c860">${globalState.totalTechs||0}</div><div class="kd-res-lbl">Teknoloji</div></div>
            <div class="kd-res"><div class="kd-res-icon">👑</div><div class="kd-res-val" style="color:var(--gold)">${conqueredCount}</div><div class="kd-res-lbl">Fetih</div></div>
        </div>

        <div style="background:rgba(136,187,221,.06);border:1px solid rgba(136,187,221,.2);border-radius:var(--radius-md);padding:14px;margin-bottom:16px;text-align:center;">
            <div style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:2px;color:rgba(136,187,221,.8);text-transform:uppercase;">Gece Kralı Tehdidi</div>
            <div style="font-family:'Cinzel',serif;font-size:28px;color:#88ddff;font-weight:700;margin-top:4px;">${Math.round(nightKingThreat)}%</div>
            <div style="height:4px;background:rgba(136,187,221,.1);border-radius:2px;margin-top:8px;overflow:hidden;">
                <div style="height:100%;width:${nightKingThreat}%;background:linear-gradient(90deg,#224466,#88ddff);border-radius:2px;"></div>
            </div>
        </div>

        <div class="dipl-ttl">🏆 En Güçlü 5 Hane</div>
        ${top5.length === 0 ? `<div style="text-align:center;color:var(--text-dim);padding:20px;font-size:11px;">Henüz krallık eklenmemiş.</div>` : `
        <div class="k-list">
            ${top5.map((k,i)=>{
                const hasPhoto = k.photo && k.photo.trim();
                const pw = power(k);
                return `
                <div class="k-row" style="--kc:${k.color}" onclick="openDetail('${k.id}')">
                    <div style="font-family:'Cinzel',serif;font-size:12px;color:var(--text-dim);width:24px;flex-shrink:0;text-align:center">${i+1}</div>
                    <div class="k-row-av" style="border-color:${k.color};color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;background-position:center;background-color:#1a1208;`:''}background:#1a1208;">
                        ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`${k.name.charAt(0)}`}
                    </div>
                    <div class="k-row-inf">
                        <div class="k-row-name">${k.name}</div>
                        <div class="k-row-sub">${k.sigil} ${k.house} · ⚔️${k.army} 🥇${k.gold}</div>
                        <div class="pwr-bar-wrap"><div class="pwr-bar" style="width:${Math.round(pw/maxP*100)}%;background:${k.color};"></div></div>
                    </div>
                    <div class="k-row-pwr" style="color:${k.color};border-color:${k.color}40;">${pw}</div>
                </div>`;
            }).join('')}
        </div>`}
    `;
    openPanel();
}
/* ════════════════════════════════════════
   LIST PANEL
════════════════════════════════════════ */
function showList(){
  currentDetailId=null;
  setTabs([
    {id:'all',label:'Tümü',icon:'🏰'},
    {id:'power',label:'Güç',icon:'⚔️'},
    {id:'rich',label:'Zenginlik',icon:'💰'},
  ],'all');
  renderKingdomList('all');
  openPanel();
}

function renderKingdomList(sortBy){
  // FİX: power() önce hesaplanıp map'e alınıyor, her satırda yeniden çağrılmıyor
  let sorted=[...kingdoms].map(k=>({k,pw:power(k)}));
  if(sortBy==='power') sorted.sort((a,b)=>b.pw-a.pw);
  else if(sortBy==='rich') sorted.sort((a,b)=>(b.k.gold||0)-(a.k.gold||0));
  else sorted.sort((a,b)=>b.pw-a.pw);
  
  const maxP=sorted[0]?.pw||1;
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl">♛ YEDİ KRALLIK</div>
    <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;color:var(--text-dim);text-align:center;margin-bottom:16px;">${kingdoms.length} BÜYÜK HANE · ${SEASONS[globalState.season].icon} ${SEASONS[globalState.season].name}</div>
    <div class="k-list">
      ${sorted.map(({k,pw},i)=>{
        const hasPhoto=k.photo&&k.photo.trim();
        return `<div class="k-row${k.conquered?' dimmed':''}" style="--kc:${k.color}" onclick="openDetail('${k.id}')">
          <div style="font-family:'Cinzel',serif;font-size:11px;color:var(--text-dim);width:16px;flex-shrink:0;text-align:center">${i+1}</div>
          <div class="k-row-av" style="border-color:${k.color};color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;background-position:center;background-color:#1a1208;`:''}background:#1a1208;">
            ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`${k.name.charAt(0)}`}
          </div>
          <div class="k-row-inf">
            <div class="k-row-name">${k.name}</div>
            <div class="k-row-sub">${k.sigil} ${k.house}${k.conquered?` · <span style="color:#e85050">Fethedildi</span>`:''}</div>
            <div class="pwr-bar-wrap"><div class="pwr-bar" style="width:${Math.round(pw/maxP*100)}%;background:${k.color};"></div></div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
            <div class="k-row-pwr" style="color:${k.color};border-color:${k.color}40;">${pw}</div>
            <div style="font-size:8px;color:var(--text-dim)">⚔️${k.army} 🥇${k.gold}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  openPanel();
}

/* ════════════════════════════════════════
   CHRONICLE
════════════════════════════════════════ */
function showChronicle(){
  currentDetailId=null;
  setTabs([{id:'chr',label:'Kronoloji',icon:'📜'}],'chr');
  document.getElementById('panel-body').innerHTML=`
    <div class="panel-ttl">📜 KRONOLOJİ</div>
    <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;color:var(--text-dim);text-align:center;margin-bottom:16px;">Westeros Tarihi</div>
    ${chronicles.length===0?`<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:30px;">Henüz kayıt yok. Bir savaş başlatın!</div>`:''}
    <div class="chronicle-list">
      ${chronicles.map(e=>`
        <div class="chr-event" style="--ec:${e.color||'var(--gold)'}">
          <div class="chr-icon">${e.icon}</div>
          <div class="chr-body">
            <div class="chr-title">${e.title}</div>
            <div class="chr-desc">${e.desc}</div>
            <div class="chr-time">⏱ Tur ${e.turn||'?'} · ${e.season||'?'} · ${e.time||''}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  openPanel();
}

/* ════════════════════════════════════════
   SCOREBOARD
════════════════════════════════════════ */
function renderSB(){
  // FİX: power() her satırda çağrılmak yerine önce hesaplanıp sıralanıyor
  const sorted=[...kingdoms].map(k=>({k,pw:power(k)})).sort((a,b)=>b.pw-a.pw);
  const maxP=sorted[0]?.pw||1;
  const medals=['🥇','🥈','🥉'];
  document.getElementById('sb-list').innerHTML=sorted.slice(0,8).map(({k,pw},i)=>{
    const hasPhoto=k.photo&&k.photo.trim();
    return `${i===3?'<div class="sb-sep"></div>':''}
    <div class="sb-row" onclick="openDetail('${k.id}');closeSB();">
      <div class="sb-rank">${medals[i]||i+1}</div>
      <div class="sb-av" style="border-color:${k.color};color:${k.color};${hasPhoto?`background-image:url('${k.photo}');background-size:cover;background-position:center;background-color:#1a1208;`:''}background:#1a1208;">
        ${hasPhoto?`<img src="${k.photo}" onerror="this.style.display='none'" alt="">`:`${k.name.charAt(0)}`}
      </div>
      <div class="sb-inf">
        <div class="sb-name">${k.name.split(' ')[0]}</div>
        <div class="sb-bar-w"><div class="sb-bar" style="width:${Math.round(pw/maxP*100)}%;background:${k.color};"></div></div>
        <div class="sb-pwr">${pw}${k.conquests>0?' · ⚔️'+k.conquests:''}${(k.alliances||[]).length>0?' · 🤝'+(k.alliances||[]).length:''}</div>
      </div>
    </div>`;
  }).join('');
}
function toggleSB(){sbOpen=!sbOpen;document.getElementById('scoreboard').classList.toggle('open',sbOpen);document.getElementById('sb-btn').classList.toggle('lit',sbOpen);}
function closeSB(){sbOpen=false;document.getElementById('scoreboard').classList.remove('open');document.getElementById('sb-btn').classList.remove('lit');}

/* ════════════════════════════════════════
   PANEL
════════════════════════════════════════ */
function openPanel(){
  document.getElementById('panel').classList.remove('off');
  document.body.style.overflowY = 'hidden';
  updateZoomPanelState();
  // Haptic feedback on mobile
  if(navigator.vibrate) navigator.vibrate(6);
}

function closePanel(){
  document.getElementById('panel').classList.add('off');
  document.body.style.overflowY = '';
  document.getElementById('panel-tabs').innerHTML='';
  updateZoomPanelState();
}
/* ════════════════════════════════════════
   ADD / EDIT
════════════════════════════════════════ */
function buildCP(id,sel,cb){const el=document.getElementById(id);el.innerHTML='';COLORS.forEach(c=>{const d=document.createElement('div');d.className='c-dot'+(c===sel?' sel':'');d.style.background=c;d.onclick=()=>{el.querySelectorAll('.c-dot').forEach(x=>x.classList.remove('sel'));d.classList.add('sel');cb(c);};el.appendChild(d);});}
function buildSP(id,sel,cb){const el=document.getElementById(id);el.innerHTML='';SIGILS.forEach(s=>{const b=document.createElement('button');b.className='s-btn'+(s===sel?' sel':'');b.textContent=s;b.onclick=()=>{el.querySelectorAll('.s-btn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');cb(s);};el.appendChild(b);});}

function openAdd(){
  closePanel();
  buildCP('cp-add',addColor,c=>addColor=c);
  buildSP('sp-add',addSigil,s=>addSigil=s);
  document.getElementById('mo-add').classList.add('open');
  setTimeout(()=>document.getElementById('n-king').focus(),200);
}
function closeAdd(){document.getElementById('mo-add').classList.remove('open');}

async function createKingdom(){
  const name=document.getElementById('n-king').value.trim();
  const house=document.getElementById('n-house').value.trim();
  if(!name){toast('⚠️ Kral adı zorunludur');return;}
  if(!house){toast('⚠️ Hane adı zorunludur');return;}
  const angle=Math.random()*Math.PI*2;
  const dist=500+Math.random()*900;
  const newK={
    id:'k_'+Date.now(), name, house,
    title:document.getElementById('n-title').value.trim()||house+' Lordu',
    sigil:addSigil, color:addColor,
    photo:document.getElementById('n-photo').value.trim(),
    x:Math.round(MAP_W/2+Math.cos(angle)*dist),
    y:Math.round(MAP_H/2+Math.sin(angle)*dist),
    territory:80,
    army:parseInt(document.getElementById('n-army').value)||80,
    navy:20,
    gold:parseInt(document.getElementById('n-gold').value)||150,
    conquests:0, conquered:null, pts:[], showT:true, alliances:[]
  };
  kingdoms.push(newK);
  rebuildKingdomMap();
  addChronicle('♛',`${newK.house} Hanesi Kuruldu`,`${newK.name}, ${newK.house} hanesi adına Westeros'a meydan okumak için yola çıktı.`,newK.color);
  await saveData(); closeAdd(); renderAll();
  toast(`${newK.sigil} ${newK.house} Hanesi kuruldu!`);
  setTimeout(()=>flyTo(newK.x,newK.y,.3),350);
  ['n-king','n-house','n-title','n-photo'].forEach(id=>document.getElementById(id).value='');
}

function openEdit(id){
  const k=findKingdom(id); if(!k) return;
  document.getElementById('e-id').value=id;
  document.getElementById('e-king').value=k.name;
  document.getElementById('e-house').value=k.house;
  document.getElementById('e-title').value=k.title||'';
  document.getElementById('e-photo').value=k.photo||'';
  document.getElementById('e-army').value=k.army||80;
  document.getElementById('e-armyv').textContent=k.army||80;
  document.getElementById('e-navy').value=k.navy||20;
  document.getElementById('e-navyv').textContent=k.navy||20;
  editColor=k.color; editSigil=k.sigil;
  buildCP('cp-edit',k.color,c=>editColor=c);
  buildSP('sp-edit',k.sigil,s=>editSigil=s);
  closePanel();
  document.getElementById('mo-edit').classList.add('open');
}
function closeEdit(){document.getElementById('mo-edit').classList.remove('open');}

async function saveEdit(){
  const id=document.getElementById('e-id').value;
  const k=findKingdom(id); if(!k) return;
  const name=document.getElementById('e-king').value.trim();
  const house=document.getElementById('e-house').value.trim();
  if(!name||!house){toast('⚠️ Ad ve hane zorunludur');return;}
  k.name=name; k.house=house;
  k.title=document.getElementById('e-title').value.trim();
  k.photo=document.getElementById('e-photo').value.trim();
  k.army=parseInt(document.getElementById('e-army').value)||80;
  k.navy=parseInt(document.getElementById('e-navy').value)||20;
  k.color=editColor; k.sigil=editSigil;
  await saveData(); closeEdit(); renderAll();
  toast(`✅ ${k.name} güncellendi`);
}

/* ════════════════════════════════════════
   DELETE
════════════════════════════════════════ */
function confirmDel(id){
  const k=findKingdom(id); if(!k) return;
  showConf('🗡️',`${k.name} Silinsin mi?`,`"${k.name}" ve tüm verileri kalıcı olarak silinecek.`,async()=>{
    kingdoms=kingdoms.filter(kk=>kk.id!==id);
    kingdoms.forEach(kk=>{
      if(kk.conquered===id) kk.conquered=null;
      if(kk.alliances) kk.alliances=kk.alliances.filter(a=>a!==id);
      if(kk.marriageAlliances) kk.marriageAlliances=kk.marriageAlliances.filter(a=>a!==id);
      if(kk.trades) kk.trades=kk.trades.filter(a=>a!==id);
    });
    rebuildKingdomMap();
    addChronicle('💀',`${k.name} Tarihe Karıştı`,`${k.house} hanesi Westeros'tan silindi.`,'#888');
    await saveData(); closePanel(); renderAll();
    toast(`🗡️ ${k.name} tarihe karıştı`);
  });
}

/* ════════════════════════════════════════
   CONFIRM DIALOG
════════════════════════════════════════ */
function showConf(icon,ttl,msg,cb){
  document.getElementById('conf-icon').textContent=icon;
  document.getElementById('conf-ttl').textContent=ttl;
  document.getElementById('conf-msg').textContent=msg;
  confCb=cb;
  document.getElementById('conf-wrap').classList.add('open');
}
function closeConf(){document.getElementById('conf-wrap').classList.remove('open');confCb=null;}
document.getElementById('conf-yes').onclick=()=>{if(confCb) confCb();closeConf();};

/* ════════════════════════════════════════
   TOAST
════════════════════════════════════════ */
function toast(msg,type='',dur=3500){
  const w=document.getElementById('toasts');
  const t=document.createElement('div');
  t.className='toast'+(type?' '+type:'');
  t.textContent=msg; w.appendChild(t);
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),350);},dur);
}

/* ════════════════════════════════════════
   PARTICLES
════════════════════════════════════════ */
function initEmbers(){
  const c=document.getElementById('embers');
  for(let i=0;i<18;i++) setTimeout(()=>{
    const e=document.createElement('div'); e.className='ember';
    const sz=Math.random()*3.5+1, dur=Math.random()*20+14, delay=Math.random()*dur;
    e.style.cssText=`width:${sz}px;height:${sz}px;left:${Math.random()*100}%;bottom:0;--drift:${(Math.random()-.5)*200}px;animation-duration:${dur}s;animation-delay:-${delay}s;opacity:${Math.random()*.45+.15};`;
    c.appendChild(e);
  },i*400);
  for(let i=0;i<30;i++) setTimeout(()=>{
    const s=document.createElement('div'); s.className='spark';
    const dur=Math.random()*14+8;
    s.style.cssText=`left:${Math.random()*100}%;bottom:0;--drift:${(Math.random()-.5)*80}px;animation-duration:${dur}s;animation-delay:-${Math.random()*dur}s;opacity:${Math.random()*.6+.3};box-shadow:0 0 3px #ffe090;`;
    c.appendChild(s);
  },i*200);
}

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function bgClick(e,id,closeFn){if(e.target.id===id) closeFn();}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(mode){cancelMode();return;}
    if(document.getElementById('battle-screen').classList.contains('open')){closeBattleScreen();return;}
    if(document.getElementById('mo-add').classList.contains('open')){closeAdd();return;}
    if(document.getElementById('mo-edit').classList.contains('open')){closeEdit();return;}
    if(document.getElementById('mo-ally').classList.contains('open')){closeAlly();return;}
    if(document.getElementById('conf-wrap').classList.contains('open')){closeConf();return;}
    closePanel();
  }
  if((e.key==='+'||e.key==='=')&&!e.target.matches('input,textarea')) zm(1.2);
  if(e.key==='-'&&!e.target.matches('input,textarea')) zm(0.8);
  if(e.key==='0'&&!e.target.matches('input,textarea')) resetView();
  if(e.key.toLowerCase()==='f'&&!e.target.matches('input,textarea')) fitAll();
  if(e.key.toLowerCase()==='s'&&!e.target.matches('input,textarea')) toggleSB();
});

/* ════════════════════════════════════════
   LOADING ANIMATION
════════════════════════════════════════ */
function animateLoading(){
  const steps=['ld1','ld2','ld3','ld4'];
  steps.forEach((id,i)=>{
    setTimeout(()=>{
      const el=document.getElementById(id); if(el) el.classList.add('vis');
    },400+i*600);
  });
}


/* ════════════════════════════════════════
   EKSİK FONKSİYONLAR - BURAYA YAPIŞTIRILACAK
════════════════════════════════════════ */

function updateKingdomUI(kid){
  const k=findKingdom(kid); if(!k) return;
  openDetail(kid);
  openPanel();
}

function showNotification(msg, type){
  toast(msg, type);
}

function updateTurnProgress(){
  const fill = document.getElementById('turn-progress-fill');
  if(fill) fill.style.width = ((globalState.turn % 4) / 4 * 100) + '%';
}

function updateGlobalBar(){
  const totalAlliances = kingdoms.reduce((s,k)=>(k.alliances||[]).length+s,0)/2;
  const totalTrades = kingdoms.reduce((s,k)=>(k.trades||[]).length+s,0)/2;
  const gb_k = document.getElementById('gb-kingdoms');
  const gb_b = document.getElementById('gb-battles');
  const gb_a = document.getElementById('gb-alliances');
  const gb_t = document.getElementById('gb-trades');
  const gb_tu = document.getElementById('gb-turn');
  const gb_te = document.getElementById('gb-techs');
  if(gb_k) gb_k.textContent = kingdoms.length;
  if(gb_b) gb_b.textContent = globalState.totalBattles || 0;
  if(gb_a) gb_a.textContent = Math.round(totalAlliances);
  if(gb_t) gb_t.textContent = Math.round(totalTrades);
  if(gb_tu) gb_tu.textContent = globalState.turn;
  if(gb_te) gb_te.textContent = globalState.totalTechs || 0;
}

function updateSeasonUI(){
  const season = SEASONS[globalState.season];
  const si=document.getElementById('season-icon'), sn=document.getElementById('season-name'), st=document.getElementById('season-turn');
  const tbl=document.getElementById('tb-season-lbl'), gbs=document.getElementById('gb-season-stat');
  if(si) si.textContent = season.icon;
  if(sn) sn.textContent = season.name;
  if(st) st.textContent = `Tur ${globalState.turn} · Sonraki için dokun`;
  if(tbl) tbl.textContent = season.name;
  if(gbs) gbs.textContent = `${season.icon} ${season.name}`;
}

function applyWeather(){
  const season = SEASONS[globalState.season];
  const snowLayer = document.getElementById('snow-layer');
  const rainLayer = document.getElementById('rain-layer');
  
  if(season.weather === 'snow'){
    rainLayer.style.display = 'none';
    if(!snowLayer._initialized){
      snowLayer._initialized = true;
      snowLayer.innerHTML = '';
      const flakes = ['❄','❅','❆','✦','*'];
      for(let i=0;i<40;i++){
        const f=document.createElement('div');
        f.className='snowflake';
        f.textContent=flakes[Math.floor(Math.random()*flakes.length)];
        const sz=Math.random()*14+6;
        const dur=Math.random()*12+8;
        const delay=Math.random()*dur;
        f.style.cssText=`left:${Math.random()*100}%;font-size:${sz}px;--drift:${(Math.random()-.5)*120}px;animation-duration:${dur}s;animation-delay:-${delay}s;opacity:${Math.random()*.6+.2};`;
        snowLayer.appendChild(f);
      }
    }
    snowLayer.style.display = 'block';
    document.body.classList.add('weather-snow');
    document.body.classList.remove('weather-rain');
  }
  else if(season.weather === 'rain'){
    snowLayer.style.display = 'none';
    if(!rainLayer._initialized){
      rainLayer._initialized = true;
      rainLayer.innerHTML = '';
      for(let i=0;i<60;i++){
        const r=document.createElement('div');
        r.className='raindrop';
        const h=Math.random()*80+40;
        const dur=Math.random()*.6+.4;
        r.style.cssText=`left:${Math.random()*100}%;height:${h}px;animation-duration:${dur}s;animation-delay:-${Math.random()*dur}s;opacity:${Math.random()*.3+.1};`;
        rainLayer.appendChild(r);
      }
    }
    rainLayer.style.display = 'block';
    document.body.classList.add('weather-rain');
    document.body.classList.remove('weather-snow');
  }
  else {
    snowLayer.style.display = 'none';
    rainLayer.style.display = 'none';
    if(snowLayer._initialized){ snowLayer.innerHTML=''; snowLayer._initialized = false; }
    if(rainLayer._initialized){ rainLayer.innerHTML=''; rainLayer._initialized = false; }
    document.body.classList.remove('weather-snow','weather-rain');
  }

  // Update season widget data attribute for CSS color syncing
  const seasonWidget = document.getElementById('season-widget');
  if(seasonWidget) seasonWidget.dataset.season = season.id;
}

/* Zoom panel modal observer */
function updateZoomPanelState(){
  const zoomPanel = document.querySelector('.zoom-panel');
  const panel = document.getElementById('panel');
  const anySysModalOpen = document.querySelector('.mo.open') || 
                          document.querySelector('.battle-screen.open') ||
                          document.querySelector('.spy-screen.open') ||
                          document.querySelector('.victory-screen.open');
  
  if(anySysModalOpen && zoomPanel){
    zoomPanel.classList.add('modal-active');
  } else if(zoomPanel){
    zoomPanel.classList.remove('modal-active');
  }
  
  // Desktop panel repositioning + body class for CSS map/bar adjustment
  const isDesktop = window.innerWidth >= 1100;
  const panelOpen = panel && !panel.classList.contains('off');

  if(isDesktop && zoomPanel){
    if(panelOpen){
      zoomPanel.classList.add('panel-open-desktop');
      document.body.classList.add('panel-visible');
    } else {
      zoomPanel.classList.remove('panel-open-desktop');
      document.body.classList.remove('panel-visible');
    }
    zoomPanel.style.right = panelOpen ? '428px' : '14px';
  } else if(zoomPanel){
    zoomPanel.classList.remove('panel-open-desktop');
    zoomPanel.style.right = '';
    document.body.classList.remove('panel-visible');
  }
}
/* ════════ PWA INSTALLATION ════════ */
// ✓ beforeinstallprompt listener: index.html'deki daha kapsamlı olanı kullan (duplicate kaldırıldı)

function showPWAInstallPrompt() {
  // Eğer uygulama zaten "standalone" (kurulu) modda açılmışsa gösterme
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  
  let promptEl = document.querySelector('.pwa-install-prompt');
  if (!promptEl) {
    promptEl = document.createElement('div');
    promptEl.className = 'pwa-install-prompt';
    promptEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
        <img src="logo.png" alt="Westeros" onerror="this.style.display='none'" style="width:48px; height:48px; border-radius:12px; border:1.5px solid var(--gold); background: #000; box-shadow: 0 0 15px rgba(200,150,10,0.3);">
        <div class="pwa-install-prompt-title" style="margin:0; font-size:15px; color:var(--gold);">Westeros Hükümdarı</div>
      </div>
      <div class="pwa-install-prompt-desc" style="font-size:11px; color:var(--text-dim); line-height:1.5;">Yedi Krallık deneyimini tam ekran yaşamak ve taht mücadelesine anında katılmak için ana ekranına ekle.</div>
      <div class="pwa-install-prompt-actions" style="margin-top:15px; display:flex; gap:10px;">
        <button class="pwa-install-btn" style="flex:2; font-weight:bold;">ANA EKRANA EKLE</button>
        <button class="pwa-dismiss-btn" style="flex:1; opacity:0.7;">SONRA</button>
      </div>
    `;
    document.body.appendChild(promptEl);
    
    promptEl.querySelector('.pwa-install-btn').onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        promptEl.classList.remove('show');
      }
    };
    
    promptEl.querySelector('.pwa-dismiss-btn').onclick = () => {
      promptEl.classList.remove('show');
    };
  }
  promptEl.classList.add('show');
}

function fixPWAViewport() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
  document.documentElement.style.setProperty('--real-vh', `${window.innerHeight}px`);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isStandalone) {
    document.body.classList.add('pwa-mode');
  }

  document.documentElement.style.setProperty('--extra-pwa-top', '0px');

  const mapWrapObj = document.getElementById('map-wrap');
  if (mapWrapObj) {
    mapWrapObj.style.removeProperty('bottom');
    mapWrapObj.style.removeProperty('height');
    mapWrapObj.style.removeProperty('min-height');
    mapWrapObj.style.removeProperty('top');
  }
}

window.addEventListener('resize', fixPWAViewport);
window.addEventListener('orientationchange', () => {
  setTimeout(fixPWAViewport, 100);
  setTimeout(fixPWAViewport, 300);
});

/* ════════ CSS ÖNERİLERİ ════════ */
// PWA modunda pull-to-refresh'i engellemek için CSS'inize aşağıdaki satırları ekleyin:
// html, body {
//   overscroll-behavior: none;
// }

// PWA modunda üst boşluk için, ana içerik kapsayıcınıza veya body'ye aşağıdaki CSS'i ekleyin:
// body {
//   padding-top: var(--extra-pwa-top, 0px);
// }
// veya
// #main-content-container { /* Ana içerik kapsayıcınızın ID'si */
//   padding-top: var(--extra-pwa-top, 0px);
// }

/* ════════════════════════════════════════
INIT
════════════════════════════════════════ */
window.addEventListener('load',async()=>{
    animateLoading();
    initEmbers();
    await loadData();
    updateSeasonUI();
    applyWeather();
    renderAll();
    multiplayerBaslat(); // ✅ MULTIPLAYER BAŞLAT
    resetView();
    fixPWAViewport();
    
    // Modal observer
    const observer = new MutationObserver(updateZoomPanelState);
    document.querySelectorAll('.mo, .battle-screen, .spy-screen, .victory-screen').forEach(el => {
        observer.observe(el, {attributes: true, attributeFilter: ['class']});
    });
    
    setTimeout(() => {
        const isMobile = window.innerWidth < 768;
        const ww = mapWrap.clientWidth;
        const wh = mapWrap.clientHeight;
        sc = 1.5;
        tx = ww / 2 - (MAP_W / 2) * sc - (isMobile ? -1111 : -1100);
        ty = wh / 2 - (MAP_H / 2) * sc - (isMobile ? 250 : 200);
        applyT(false);
        initialSc = sc;
        initialTx = tx;
        initialTy = ty;
    }, 100);
    
    // ✓ touchmove listener: index.html'deki listener kullan (duplicate kaldırıldı)
    
    const ld=document.getElementById('loading');
    ld.classList.add('out');
    setTimeout(()=>ld.remove(),800);
    setTimeout(()=>toast('♛ Westeros\'a hoş geldiniz!'),1000);
    
    if (!navigator.onLine) {
        document.body.classList.add('offline-mode');
    } else {
        document.body.classList.remove('offline-mode');
    }
    
    window.addEventListener('offline', () => {
        document.body.classList.add('offline-mode');
        toast('📡 İnternet bağlantısı kesildi!','war');
    });
    window.addEventListener('online', () => {
        document.body.classList.remove('offline-mode');
        toast('✅ Bağlantı geri geldi!');
    });
    
    // ── GELİŞTİRMELER ──
    initPanelSwipe();
  

    /* ── Panel Swipe-to-Close ── */
    function initPanelSwipe(){
        const panel = document.getElementById('panel');
        const drag = document.getElementById('panel-drag');
        if(!panel || !drag) return;
        let startY = 0, currentY = 0, isDragging = false;
        const onStart = (e) => {
            const panelRect = panel.getBoundingClientRect();
            const touchY = e.touches ? e.touches[0].clientY : e.clientY;
            if(touchY - panelRect.top > 60) return;
            startY = touchY;
            isDragging = true;
            panel.style.transition = 'none';
            drag.classList.add('dragging');
        };
        const onMove = (e) => {
            if(!isDragging) {
                return;
            }
            e.preventDefault();  // ✓ passive:false olunca bu işe yarıyor
            const touchY = e.touches ? e.touches[0].clientY : e.clientY;
            currentY = Math.max(0, touchY - startY);
            panel.style.transform = `translateY(${currentY}px)`;
            if(window.innerWidth >= 1100){
                panel.style.transform = '';
                isDragging = false;
            }
        };
        const onEnd = () => {
            if(!isDragging) return;
            isDragging = false;
            drag.classList.remove('dragging');
            panel.style.transition = '';
            panel.style.transform = '';
            if(currentY > 80) closePanel();
            currentY = 0;
        };
        panel.addEventListener('touchstart', onStart, {passive:true});
        panel.addEventListener('touchmove', onMove, {passive:false});  // ✓ FIX: passive:false
        panel.addEventListener('touchend', onEnd, {passive:true});
        drag.addEventListener('click', () => { if(!isDragging) closePanel(); });
    }


    /* ── Keyboard shortcut hints on zoom panel ── */
    (function addZoomHints(){
        const zp = document.querySelector('.zoom-panel');
        if(!zp) return;
        const hint = document.createElement('div');
        hint.className = 'kb-hint';
        hint.innerHTML = '+/- Yakınlaştır &nbsp;|&nbsp; F Tümü &nbsp;|&nbsp; 0 Sıfırla';
        zp.appendChild(hint);
    })();

    /* ── Touch haptic for battles (delayed to avoid hoisting issues) ── */
    setTimeout(function(){
        const _origSfxBattle = window.sfxBattle;
        window.sfxBattle = function(){
            if(typeof _origSfxBattle === 'function') _origSfxBattle();
            if(navigator.vibrate) navigator.vibrate([50,30,50]);
        };
    }, 100);

    /* ── Context menu: close on scroll ── */
    document.addEventListener('scroll', closeCtx, {passive:true});
    document.addEventListener('touchmove', closeCtx, {passive:true});

    /* ── Panel body: extra bottom padding for mobile keyboard ── */
    window.addEventListener('resize', () => {
        const panel = document.getElementById('panel');
        if(!panel) return;
        const panelBody = document.getElementById('panel-body');
        if(!panelBody) return;
        if(window.innerHeight < 500 && window.innerWidth < 768){
            panelBody.style.paddingBottom = '120px';
        } else {
            panelBody.style.paddingBottom = '';
        }
    });

}); // ✅ HATA DÜZELTİLDİ: load event listener'ı burada doğru şekilde kapatıldı!

/* ════════════════════════════════════════
SON - SCRIPT TAMAMLANDI
════════════════════════════════════════ */
console.log('✅ Game of Thrones Script başarıyla yüklendi!');