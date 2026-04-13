import "./style.css";
import { db, model } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, onSnapshot, addDoc, writeBatch
} from "firebase/firestore";

// ── Shortcuts ────────────────────────────────────────────────
const usersCol      = collection(db, 'users');
const betsCol       = collection(db, 'bets');
const placedBetsCol = collection(db, 'placedBets');
const peopleCol     = collection(db, 'people');
const subjectsCol   = collection(db, 'subjects');

// ── State in memoria ─────────────────────────────────────────
const state = { users: {}, bets: [], placedBets: [], people: [], subjects: [], currentUser: null };

// ── Helpers Firestore ────────────────────────────────────────
const uDoc  = u  => doc(db, 'users', u);
const pDoc  = id => doc(db, 'people', id);
const bDoc  = id => doc(db, 'bets', id);
const pbDoc = id => doc(db, 'placedBets', id);

async function fsGetAllUsers() {
  const s = await getDocs(usersCol);
  const o = {};
  s.forEach(d => { o[d.id] = d.data(); });
  return o;
}
async function fsGetAllBets() {
  const s = await getDocs(betsCol);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fsGetAllPlacedBets() {
  const s = await getDocs(placedBetsCol);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fsGetAllPeople() {
  const s = await getDocs(peopleCol);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fsGetAllSubjects() {
  const s = await getDocs(subjectsCol);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Listener in tempo reale ──────────────────────────────────
function startListeners() {
  onSnapshot(betsCol, snap => {
    state.bets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome(); updateStats();
    if (state.currentUser && state.users[state.currentUser]?.isAdmin) refreshAdminSelects();
  });
  onSnapshot(usersCol, snap => {
    snap.forEach(d => { state.users[d.id] = d.data(); });
    updateHeaderCredits(); updateStats();
  });
  onSnapshot(placedBetsCol, snap => {
    state.placedBets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMyBets(); updateStats();
  });
  onSnapshot(peopleCol, snap => {
    state.people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
    if (state.currentUser && state.users[state.currentUser]?.isAdmin) refreshAdminSelects();
  });
  onSnapshot(subjectsCol, snap => {
    state.subjects = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>a.name.localeCompare(b.name,'it'));
    renderSubjectsList();
    if (state.currentUser && state.users[state.currentUser]?.isAdmin) refreshAdminSelects();
  });
}

// ── Avatar picker ────────────────────────────────────────────
const AVATARS = ['😎','🤑','🎲','🃏','🏆','🦁','🐯','🦊','🐺','🐸','🦄','🐉','👾','🤖','👻','💀','🎭','🧠','🔥','⚡','🌟','💎','🎯','🚀'];
let selectedAvatar = AVATARS[0];
function initAvatarPicker() {
  document.getElementById('avatar-picker').innerHTML = AVATARS.map((a, i) =>
    `<div class="avatar-option${i===0?' selected':''}" onclick="selectAvatar(this,'${a}')">${a}</div>`
  ).join('');
}
window.selectAvatar = (el, emoji) => {
  document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); selectedAvatar = emoji;
};

// ── Badge ────────────────────────────────────────────────────
const BADGES = [
  { min:0,     emoji:'🥚', label:'Principiante',  cls:'badge-egg'    },
  { min:2000,  emoji:'🎯', label:'Scommettitore', cls:'badge-target' },
  { min:5000,  emoji:'🔥', label:'Esperto',        cls:'badge-fire'   },
  { min:10000, emoji:'💎', label:'Campione',        cls:'badge-gem'    },
  { min:25000, emoji:'👑', label:'Leggenda',        cls:'badge-crown'  },
];
function getBadge(c) { let b=BADGES[0]; for(const x of BADGES){if(c>=x.min)b=x;} return b; }
function badgeHTML(c) { const b=getBadge(c); return `<span class="badge-pill ${b.cls}">${b.emoji} ${b.label}</span>`; }

// ── Util ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showAuthError(msg) { const e=document.getElementById('auth-error'); e.textContent=msg; e.style.display='block'; }
function clearAuthError()   { document.getElementById('auth-error').style.display='none'; }

// ── Auth ─────────────────────────────────────────────────────
window.switchAuthTab = tab => {
  document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active',(i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('login-form').style.display    = tab==='login'    ? 'block':'none';
  document.getElementById('register-form').style.display = tab==='register' ? 'block':'none';
  clearAuthError();
};

window.doLogin = async () => {
  const u = document.getElementById('login-user').value.trim().toLowerCase().replace(/\s+/g,'_');
  const p = document.getElementById('login-pass').value;
  if (!u||!p) { showAuthError('Compila tutti i campi!'); return; }
  const snap = await getDoc(uDoc(u));
  if (!snap.exists())     { showAuthError('Utente non trovato.'); return; }
  const data = snap.data();
  if (data.pass !== p)    { showAuthError('Password errata!'); return; }
  state.users[u] = data;
  login(u);
};

window.doRegister = async () => {
  const raw = document.getElementById('reg-user').value.trim();
  const u   = raw.toLowerCase().replace(/\s+/g,'_');
  const p   = document.getElementById('reg-pass').value;
  if (!raw||!p)  { showAuthError('Compila tutti i campi!'); return; }
  if (u.length<3){ showAuthError('Username troppo corto (min. 3 caratteri)'); return; }
  if (p.length<4){ showAuthError('Password troppo corta (min. 4 caratteri)'); return; }
  const existing = await getDoc(uDoc(u));
  if (existing.exists()) { showAuthError('Username già in uso!'); return; }
  const newUser = { pass:p, credits:1000, isAdmin:false, avatar:selectedAvatar, displayName:raw };
  await setDoc(uDoc(u), newUser);
  state.users[u] = newUser;
  login(u);
};

function login(u) {
  state.currentUser = u;
  localStorage.setItem('scuolabet_user', u);
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  const displayName = state.users[u]?.displayName || u;
  document.getElementById('header-username').textContent = displayName;
  document.getElementById('header-avatar').textContent   = state.users[u]?.avatar || '😎';
  updateHeaderCredits();
  document.getElementById('tab-admin').style.display = state.users[u]?.isAdmin ? 'flex':'none';
  initSettingsAvatarGrid();
  showView('home');
  notify('Benvenuto, ' + displayName + '! 🎰', 'success');
}

window.doLogout = () => {
  state.currentUser = null;
  localStorage.removeItem('scuolabet_user');
  document.getElementById('main-screen').classList.remove('active');
  document.getElementById('auth-screen').classList.add('active');
  closeSettings();
  slip=[]; updateSlip();
};

// ── Settings dropdown ─────────────────────────────────────────
function initSettingsAvatarGrid() {
  const u = state.currentUser;
  const current = state.users[u]?.avatar || '😎';
  document.getElementById('settings-avatar-grid').innerHTML = AVATARS.map(a =>
    `<div class="settings-avatar-opt${a===current?' selected':''}" onclick="changeAvatar('${a}')">${a}</div>`
  ).join('');
}

window.toggleSettings = () => {
  const dd = document.getElementById('settings-dropdown');
  const open = dd.classList.toggle('open');
  document.getElementById('settings-caret').textContent = open ? '▴' : '▾';
  if (open) setTimeout(() => document.addEventListener('click', outsideSettingsClick), 0);
};

function outsideSettingsClick(e) {
  if (!document.getElementById('settings-wrap').contains(e.target)) closeSettings();
}

function closeSettings() {
  document.getElementById('settings-dropdown').classList.remove('open');
  document.getElementById('settings-caret').textContent = '▾';
  document.removeEventListener('click', outsideSettingsClick);
}

window.changeAvatar = async (emoji) => {
  const u = state.currentUser; if (!u) return;
  await updateDoc(uDoc(u), { avatar: emoji });
  state.users[u].avatar = emoji;
  document.getElementById('header-avatar').textContent = emoji;
  document.querySelectorAll('.settings-avatar-opt').forEach(el => {
    el.classList.toggle('selected', el.textContent === emoji);
  });
  notify('Avatar aggiornato! ' + emoji, 'success');
};

// ── Nav ──────────────────────────────────────────────────────
window.switchAdminTab = (tab, btn) => {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('admin-tab-' + tab).classList.add('active');
};

window.showView = name => {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
  if(name==='mybets')      renderMyBets();
  if(name==='leaderboard') renderLeaderboard();
  if(name==='admin')       refreshAdminSelects();
};

function updateHeaderCredits() {
  const u = state.currentUser;
  if (u && state.users[u]) {
    document.getElementById('header-credits').textContent = state.users[u].credits.toLocaleString('it');
    document.getElementById('header-badge').innerHTML     = badgeHTML(state.users[u].credits);
  }
}

// ── Home ─────────────────────────────────────────────────────
const catMap = {
  voti:    { label:'📊 Voti',    cls:'cat-voti'    },
  prof:    { label:'🧑‍🏫 Prof',   cls:'cat-prof'    },
  compiti: { label:'📝 Compiti', cls:'cat-compiti' },
  eventi:  { label:'🎉 Evento',  cls:'cat-eventi'  }
};

let currentHomeTab = 'voti';

window.switchHomeTab = (tab, btn) => {
  currentHomeTab = tab;
  document.querySelectorAll('.home-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const searchEl = document.getElementById('people-search');
  if (searchEl) searchEl.value = '';
  document.getElementById('people-search-wrap').style.display = tab === 'altro' ? 'none' : 'block';
  renderHome();
};

window.filterPeople = () => {
  const grid = document.getElementById('home-people-grid');
  if (!grid || grid.style.display === 'none') return;
  const query  = (document.getElementById('people-search')?.value || '').toLowerCase().trim();
  const type   = currentHomeTab === 'voti' ? 'compagno' : 'prof';
  const people = state.people
    .filter(p => p.type === type)
    .filter(p => !query || p.name.toLowerCase().split(' ').some(w => w.startsWith(query)))
    .sort((a,b) => a.name.localeCompare(b.name, 'it', {sensitivity:'base'}));
  if (!people.length) {
    grid.innerHTML = query
      ? `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔍</div><p>Nessun risultato per "<strong>${escHtml(query)}</strong>".</p></div>`
      : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">${type==='compagno'?'🎒':'🧑‍🏫'}</div><p>Nessuna persona aggiunta.</p></div>`;
    return;
  }
  grid.innerHTML = people.map(p => `
    <div class="person-card" onclick="showPersonBets('${p.id}')">
      <div class="person-card-name">${escHtml(p.name)}</div>
      <div class="person-card-arrow">→</div>
    </div>`).join('');
};

function renderHome() {
  const grid    = document.getElementById('home-people-grid');
  const personV = document.getElementById('home-person-bets');
  const altroV  = document.getElementById('home-altro-bets');
  if (personV.style.display === 'block') return;
  personV.style.display = 'none';
  if (currentHomeTab === 'altro') {
    grid.style.display   = 'none';
    altroV.style.display = 'block';
    renderAltroBets();
    return;
  }
  altroV.style.display = 'none';
  grid.style.display   = 'grid';
  const query  = (document.getElementById('people-search')?.value || '').toLowerCase().trim();
  const type   = currentHomeTab === 'voti' ? 'compagno' : 'prof';
  const people = state.people
    .filter(p => p.type === type)
    .filter(p => !query || p.name.toLowerCase().split(' ').some(w => w.startsWith(query)))
    .sort((a,b) => a.name.localeCompare(b.name, 'it', {sensitivity:'base'}));
  if (!people.length) {
    grid.innerHTML = query
      ? `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔍</div><p>Nessun risultato per "<strong>${escHtml(query)}</strong>".</p></div>`
      : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">${type==='compagno'?'🎒':'🧑‍🏫'}</div><p>Nessun ${type==='compagno'?'compagno':'professore'} ancora aggiunto.<br>L'admin può aggiungerli dal pannello.</p></div>`;
    return;
  }
  grid.innerHTML = people.map(p => `
    <div class="person-card" onclick="showPersonBets('${p.id}')">
      <div class="person-card-name">${escHtml(p.name)}</div>
      <div class="person-card-arrow">→</div>
    </div>`).join('');
}

window.switchPersonTab = (tab, btn) => {
  document.querySelectorAll('#person-tabs .home-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('person-tab-stats').style.display = tab === 'stats' ? 'block' : 'none';
  document.getElementById('person-tab-bets').style.display  = tab === 'bets'  ? 'block' : 'none';
};

window.showPersonBets = (personId) => {
  const person = state.people.find(p => p.id === personId); if (!person) return;
  const bets   = state.bets.filter(b => b.status === 'open' && b.personId === personId);
  const cat    = person.type === 'compagno' ? 'voti' : 'prof';
  const cm     = catMap[cat];

  document.getElementById('home-people-grid').style.display = 'none';
  document.getElementById('home-person-bets').style.display = 'block';
  document.querySelectorAll('#person-tabs .home-tab').forEach((b,i) => b.classList.toggle('active', i===0));
  document.getElementById('person-tab-stats').style.display = 'block';
  document.getElementById('person-tab-bets').style.display  = 'none';

  const stats    = person.stats || {};
  const mediaGen = calcMediaGenerale(person);
  document.getElementById('home-person-header').innerHTML = `
    <div class="person-header-name">${escHtml(person.name)}</div>
    <div class="person-header-sub">${person.type==='compagno'?'🎒 Compagno':'🧑‍🏫 Professore'}</div>
    <div class="person-quick-stats">
      ${person.type==='compagno' ? `
        <div class="quick-stat"><span class="qs-val">${mediaGen !== null ? mediaGen.toFixed(1) : '—'}</span><span class="qs-label">Media generale</span></div>
        <div class="quick-stat"><span class="qs-val">${stats.comportamento ?? '—'}</span><span class="qs-label">Comportamento</span></div>
        <div class="quick-stat"><span class="qs-val">${stats.assenze ?? '—'}</span><span class="qs-label">Assenze</span></div>
      ` : ''}
    </div>`;

  renderPersonStats(person);

  const list = document.getElementById('home-person-bets-list');
  if (!bets.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Nessuna scommessa aperta per questa persona.</p></div>';
  } else {
    list.innerHTML = `<div class="bets-grid">${bets.map(b => {
      const subjName = b.subjectId ? (state.subjects.find(s=>s.id===b.subjectId)?.name || '') : '';
      const optHtml  = b.options.map(o => `
        <button class="bet-option-btn" onclick="addToSlip('${b.id}','${escHtml(o.label)}',${o.odd})">
          <span class="odd">${o.odd.toFixed(2)}</span>${escHtml(o.label)}
        </button>`).join('');
      return `
        <div class="bet-card">
          <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
            <div class="bet-category ${cm.cls}">${cm.label}</div>
            ${subjName ? `<div class="bet-category cat-subject">📚 ${escHtml(subjName)}</div>` : ''}
          </div>
          <h3>${escHtml(b.title)}</h3>
          ${b.desc?`<div class="bet-desc">${escHtml(b.desc)}</div>`:''}
          <div class="bet-options">${optHtml}</div>
          <div class="bet-pool">
            <span>Montepremi: <span class="pool-num">🪙 ${(b.pool||0).toLocaleString('it')}</span></span>
            <span>${b.placed||0} scommesse</span>
          </div>
        </div>`;
    }).join('')}</div>`;
  }
};

window.backToPeople = () => {
  document.getElementById('home-person-bets').style.display  = 'none';
  document.getElementById('home-people-grid').style.display  = 'grid';
};

function calcMediaGenerale(person) {
  const stats = person.stats || {};
  const subjectStats = stats.materie || {};
  const medie = Object.values(subjectStats).map(m => {
    const voti = m.voti || [];
    return voti.length ? voti.reduce((a,v)=>a+v,0)/voti.length : null;
  }).filter(v => v !== null);
  return medie.length ? medie.reduce((a,v)=>a+v,0)/medie.length : null;
}

function calcMedia(voti) {
  if (!voti || !voti.length) return null;
  return voti.reduce((a,v)=>a+v,0)/voti.length;
}

function votoColor(v) {
  if (v >= 8) return 'var(--green)';
  if (v >= 6) return 'var(--gold)';
  return 'var(--red)';
}

function renderPersonStats(person) {
  const el    = document.getElementById('home-person-stats');
  const stats = person.stats || {};
  if (person.type !== 'compagno') {
    el.innerHTML = '<div class="empty-state"><div class="icon">🧑‍🏫</div><p>Le statistiche sono disponibili solo per i compagni.</p></div>';
    return;
  }
  if (!state.subjects.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📚</div><p>Nessuna materia aggiunta dall\'admin.</p></div>';
    return;
  }
  const subjectStats = stats.materie || {};
  const hasAny = state.subjects.some(s => (subjectStats[s.id]?.voti || []).length > 0);
  if (!hasAny && !stats.comportamento && !stats.assenze) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Nessuna statistica ancora inserita dall\'admin.</p></div>';
    return;
  }
  let html = '<div class="stats-grid">';
  state.subjects.forEach(subj => {
    const m    = subjectStats[subj.id] || {};
    const voti = m.voti || [];
    const med  = calcMedia(voti);
    html += `
      <div class="stat-card">
        <div class="stat-card-title">📚 ${escHtml(subj.name)}</div>
        <div class="stat-card-media" style="color:${med !== null ? votoColor(med) : 'var(--muted)'}">
          ${med !== null ? med.toFixed(1) : '—'}
        </div>
        <div class="stat-card-label">Media</div>
        ${voti.length ? `
          <div class="stat-voti-list">
            ${voti.map(v=>`<span class="voto-chip" style="background:${votoColor(v)}22;color:${votoColor(v)};border:1px solid ${votoColor(v)}44">${v}</span>`).join('')}
          </div>` : '<div class="stat-card-label" style="margin-top:6px;">Nessun voto</div>'}
      </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

function renderAltroBets() {
  const c        = document.getElementById('bets-container');
  const openBets = state.bets.filter(b => b.status === 'open' && (b.cat === 'compiti' || b.cat === 'eventi'));
  if (!openBets.length) {
    c.innerHTML = '<div class="empty-state"><div class="icon">🎉</div><p>Nessuna scommessa in questa categoria.</p></div>';
    return;
  }
  const groups = {};
  openBets.forEach(b => { if (!groups[b.cat]) groups[b.cat] = []; groups[b.cat].push(b); });
  let html = '';
  for (const cat of ['compiti','eventi']) {
    if (!groups[cat]) continue;
    const cm = catMap[cat];
    html += `<div class="section-title">${cm.label}</div><div class="bets-grid">`;
    groups[cat].forEach(b => {
      const optHtml = b.options.map(o => `
        <button class="bet-option-btn" onclick="addToSlip('${b.id}','${escHtml(o.label)}',${o.odd})">
          <span class="odd">${o.odd.toFixed(2)}</span>${escHtml(o.label)}
        </button>`).join('');
      html += `
        <div class="bet-card">
          <div class="bet-category ${cm.cls}">${cm.label}</div>
          <h3>${escHtml(b.title)}</h3>
          ${b.desc?`<div class="bet-desc">${escHtml(b.desc)}</div>`:''}
          <div class="bet-options">${optHtml}</div>
          <div class="bet-pool">
            <span>Montepremi: <span class="pool-num">🪙 ${(b.pool||0).toLocaleString('it')}</span></span>
            <span>${b.placed||0} scommesse</span>
          </div>
        </div>`;
    });
    html += '</div>';
  }
  c.innerHTML = html;
}

function updateStats() {
  const openBetIds = new Set(state.bets.filter(b => b.status === 'open').map(b => b.id));
  document.getElementById('stat-scommesse').textContent = openBetIds.size;
  document.getElementById('stat-giocatori').textContent = Object.keys(state.users).filter(u => u !== 'admin').length;
  document.getElementById('stat-piazzate').textContent  = state.placedBets.filter(pb =>
    pb.status === 'pending' && pb.selections.some(s => openBetIds.has(s.betId))
  ).length;
}

// ── Bet Slip ─────────────────────────────────────────────────
let slip=[], slipOpen=false;

window.addToSlip = (betId, choice, odd) => {
  const bet=state.bets.find(b=>b.id===betId); if(!bet)return;
  slip=slip.filter(s=>s.betId!==betId);
  slip.push({betId, question:bet.title, choice, odd});
  updateSlip();
  if(!slipOpen){slipOpen=true; document.getElementById('bet-slip').classList.add('open');}
  notify(`Aggiunto: ${choice} @ ${odd.toFixed(2)}`,'success');
};

window.removeFromSlip = betId => {
  slip=slip.filter(s=>s.betId!==betId); updateSlip();
  if(!slip.length&&slipOpen){slipOpen=false; document.getElementById('bet-slip').classList.remove('open');}
};

function updateSlip() {
  document.getElementById('slip-badge').textContent=slip.length;
  document.getElementById('slip-toggle-btn').classList.toggle('hidden',!slip.length);
  const el=document.getElementById('slip-items');
  el.innerHTML=slip.length
    ? slip.map(s=>`
        <div class="slip-item">
          <div class="si-text"><div class="si-q">${escHtml(s.question)}</div><div class="si-choice">${escHtml(s.choice)}</div></div>
          <span class="si-odd">${s.odd.toFixed(2)}</span>
          <button class="slip-remove" onclick="removeFromSlip('${s.betId}')">✕</button>
        </div>`).join('')
    : '<div style="text-align:center;color:var(--muted);font-size:13px;padding:10px;">Nessuna selezione</div>';
  updateSlipTotals();
}

window.updateSlipTotals = () => {
  const stake=parseFloat(document.getElementById('slip-stake').value)||0;
  const totalOdd=slip.reduce((a,s)=>a*s.odd,1);
  document.getElementById('slip-total-odd').textContent='x'+totalOdd.toFixed(2);
  document.getElementById('slip-total-win').textContent='🪙 '+Math.round(stake*totalOdd).toLocaleString('it');
};

window.toggleSlip = () => {
  slipOpen=!slipOpen;
  document.getElementById('bet-slip').classList.toggle('open',slipOpen);
};

window.placeBet = async () => {
  if(!slip.length){notify('Nessuna selezione!','error');return;}
  const stake=parseInt(document.getElementById('slip-stake').value);
  if(!stake||stake<10){notify('Puntata minima: 🪙 10','error');return;}
  const u=state.currentUser, user=state.users[u];
  if(user.credits<stake){notify('Crediti insufficienti!','error');return;}
  const totalOdd=slip.reduce((a,s)=>a*s.odd,1);
  const potWin=Math.round(stake*totalOdd);
  const newCredits=user.credits-stake;
  const batch=writeBatch(db);
  batch.update(uDoc(u),{credits:newCredits});
  slip.forEach(s=>{
    const bet=state.bets.find(b=>b.id===s.betId);
    if(bet) batch.update(bDoc(s.betId),{pool:(bet.pool||0)+stake, placed:(bet.placed||0)+1});
  });
  await batch.commit();
  state.users[u].credits=newCredits;
  await addDoc(placedBetsCol,{user:u, selections:slip.map(s=>({...s})), stake, totalOdd, potWin, status:'pending', ts:new Date().toISOString()});
  slip=[]; slipOpen=false;
  document.getElementById('bet-slip').classList.remove('open');
  updateSlip(); updateHeaderCredits();
  notify(`Scommessa piazzata! 🎉 Vincita potenziale: 🪙 ${potWin.toLocaleString('it')}`,'success');
};

// ── My Bets ──────────────────────────────────────────────────
let currentFilter='all';
window.setFilter = (filter, btn) => {
  currentFilter=filter;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); renderMyBets();
};

function renderMyBets() {
  if(!state.currentUser)return;
  const u=state.currentUser;
  let myBets=state.placedBets.filter(b=>b.user===u&&b.status!=='cancelled');
  if(currentFilter!=='all') myBets=myBets.filter(b=>b.status===currentFilter);
  const c=document.getElementById('mybets-container');
  if(!myBets.length){
    const msg=currentFilter==='all'?'Non hai ancora piazzato scommesse.'
      :currentFilter==='pending'?'Nessuna scommessa in corso.'
      :currentFilter==='won'?'Non hai ancora vinto nessuna scommessa.'
      :'Non hai ancora perso nessuna scommessa.';
    c.innerHTML=`<div class="empty-state"><div class="icon">📋</div><p>${msg}</p></div>`; return;
  }
  c.innerHTML=myBets.slice().reverse().map(b=>{
    const sc=b.status==='cancelled'?'lost':b.status;
    const sl=b.status==='pending'?'⏳ In corso':b.status==='won'?'✅ Vincita!':b.status==='cancelled'?'🚫 Annullata':'❌ Persa';
    const allOpen=b.selections.every(s=>{ const bet=state.bets.find(x=>x.id===s.betId); return bet&&bet.status==='open'; });
    const canCancel=b.status==='pending'&&allOpen;
    const wonAmt=b.status==='won'?`<div class="win">+🪙 ${b.potWin.toLocaleString('it')}</div>`
      :b.status==='cancelled'?`<div class="win" style="color:var(--green);">↩️ 🪙 ${b.stake.toLocaleString('it')}</div>`
      :`<div class="win" style="color:var(--muted);">🪙 ${b.potWin.toLocaleString('it')}</div>`;
    const cancelBtn=canCancel?`<button class="btn-cancel-bet" onclick="confirmCancelBet('${b.id}')">🚫 Annulla</button>`
      :b.status==='cancelled'?`<span class="cancelled-badge">Rimborsata 🪙 ${b.stake}</span>`:'';
    return b.selections.map((s,i)=>`
      <div class="mybet-card">
        <div class="mybet-status ${sc}"></div>
        <div class="mybet-info">
          <div class="q">${escHtml(s.question)}</div>
          <div class="c">Scelta: <strong>${escHtml(s.choice)}</strong> @ ${s.odd.toFixed(2)} — ${sl}</div>
        </div>
        <div class="mybet-amount">
          <div class="stake">Puntata: 🪙 ${b.stake}</div>
          ${i===0?wonAmt:''} ${i===0?cancelBtn:''}
        </div>
      </div>`).join('');
  }).join('');
}

window.confirmCancelBet = pbId => {
  const pb=state.placedBets.find(b=>b.id===pbId); if(!pb)return;
  showModal('🚫 Annulla scommessa',
    `Vuoi annullare e ricevere un rimborso di 🪙 ${pb.stake.toLocaleString('it')} crediti?`,
    ()=>cancelBet(pbId));
};

async function cancelBet(pbId) {
  const pb=state.placedBets.find(b=>b.id===pbId);
  if(!pb||pb.status!=='pending')return;
  const allOpen=pb.selections.every(s=>{ const bet=state.bets.find(x=>x.id===s.betId); return bet&&bet.status==='open'; });
  if(!allOpen){notify('Non puoi annullare: scommessa già chiusa!','error');return;}
  const batch=writeBatch(db);
  const newC=(state.users[pb.user].credits||0)+pb.stake;
  batch.update(pbDoc(pbId),{status:'cancelled'});
  batch.update(uDoc(pb.user),{credits:newC});
  pb.selections.forEach(s=>{
    const bet=state.bets.find(b=>b.id===s.betId);
    if(bet) batch.update(bDoc(s.betId),{pool:Math.max(0,(bet.pool||0)-pb.stake), placed:Math.max(0,(bet.placed||0)-1)});
  });
  await batch.commit();
  state.users[pb.user].credits=newC;
  updateHeaderCredits();
  notify(`Scommessa annullata! Rimborsati 🪙 ${pb.stake.toLocaleString('it')} crediti.`,'success');
}

// ── Leaderboard ──────────────────────────────────────────────
function renderLeaderboard() {
  const users=Object.entries(state.users).filter(([u])=>u!=='admin').map(([u,d])=>{
    const mb=state.placedBets.filter(b=>b.user===u);
    const won=mb.filter(b=>b.status==='won').length;
    const total=mb.length;
    return {u, credits:d.credits, won, total, wr:total>0?Math.round(won/total*100):0};
  }).sort((a,b)=>b.credits-a.credits);
  const c=document.getElementById('leaderboard-container');
  if(!users.length){c.innerHTML='<div class="empty-state"><div class="icon">🏆</div><p>Nessun giocatore registrato.</p></div>';return;}
  const rc=['gold','silver','bronze'];
  c.innerHTML=`<div class="leaderboard-table">
    <div class="lb-row header"><div>#</div><div>Giocatore</div><div>Crediti</div><div>Win%</div></div>
    ${users.map((u,i)=>`
      <div class="lb-row">
        <div class="lb-rank ${rc[i]||''}">${i+1}</div>
        <div class="lb-name" style="display:flex;align-items:center;gap:10px;">
          <div class="lb-avatar">${state.users[u.u]?.avatar||'😎'}</div>
          <div>${escHtml(state.users[u.u]?.displayName||u.u)}<small style="display:flex;align-items:center;gap:6px;margin-top:3px;">${badgeHTML(u.credits)} · ${u.total} scommesse</small></div>
        </div>
        <div class="lb-credits">🪙 ${u.credits.toLocaleString('it')}</div>
        <div class="lb-winrate"><span>${u.wr}%</span></div>
      </div>`).join('')}
  </div>`;
}

// ── Admin ────────────────────────────────────────────────────
function refreshAdminSelects() {
  const open=state.bets.filter(b=>b.status==='open');

  const sel=document.getElementById('resolve-bet-select');
  sel.innerHTML='<option value="">-- Seleziona scommessa --</option>'+open.map(b=>{
    const person = b.personId ? state.people.find(p=>p.id===b.personId) : null;
    return `<option value="${b.id}">${person ? person.name+' — ' : ''}${escHtml(b.title)}</option>`;
  }).join('');
  document.getElementById('resolve-option-select').innerHTML='<option value="">-- Prima seleziona la scommessa --</option>';
  sel.onchange=()=>{
    const bet=state.bets.find(b=>b.id===sel.value);
    const os=document.getElementById('resolve-option-select');
    os.innerHTML=bet?bet.options.map(o=>`<option value="${escHtml(o.label)}">${escHtml(o.label)}</option>`).join(''):'<option value="">--</option>';
  };

  const editSel=document.getElementById('edit-bet-select');
  const prev=editSel.value;
  editSel.innerHTML='<option value="">-- Seleziona scommessa aperta --</option>'+open.map(b=>{
    const person = b.personId ? state.people.find(p=>p.id===b.personId) : null;
    return `<option value="${b.id}">${person ? person.name+' — ' : ''}${escHtml(b.title)}</option>`;
  }).join('');
  if(prev&&open.find(b=>b.id===prev)) editSel.value=prev;
  else document.getElementById('edit-bet-form').style.display='none';

  document.getElementById('gift-user-select').innerHTML=Object.keys(state.users).filter(u=>u!=='admin').map(u=>`<option value="${u}">${state.users[u]?.displayName||u}</option>`).join('');
  document.getElementById('delete-user-select').innerHTML=Object.keys(state.users).filter(u=>u!=='admin').map(u=>`<option value="${u}">${state.users[u]?.displayName||u}</option>`).join('');

  const statsSel = document.getElementById('stats-person-select');
  if (statsSel) {
    const prevS = statsSel.value;
    statsSel.innerHTML = '<option value="">-- Seleziona compagno --</option>' +
      state.people.filter(p=>p.type==='compagno')
        .sort((a,b)=>a.name.localeCompare(b.name,'it',{sensitivity:'base'}))
        .map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
    if (prevS && state.people.find(p=>p.id===prevS)) statsSel.value = prevS;
  }

  onNewCatChange();
  renderAdminPeopleList();
  renderSubjectsList();
}

window.onNewCatChange = () => {
  const cat       = document.getElementById('new-cat').value;
  const group     = document.getElementById('new-person-group');
  const subjGroup = document.getElementById('new-subject-group');
  const sel       = document.getElementById('new-person-select');
  if (cat === 'voti' || cat === 'prof') {
    const type   = cat === 'voti' ? 'compagno' : 'prof';
    const people = state.people.filter(p=>p.type===type).sort((a,b)=>a.name.localeCompare(b.name,'it',{sensitivity:'base'}));
    sel.innerHTML = '<option value="">-- Seleziona persona --</option>' +
      people.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
    group.style.display    = 'block';
    subjGroup.style.display = cat === 'voti' ? 'block' : 'none';
    if (cat === 'voti') populateSubjectSelect();
  } else {
    group.style.display    = 'none';
    subjGroup.style.display = 'none';
  }
  const wrap = document.getElementById('ai-generator-wrap');
  if (wrap) wrap.style.display = 'none';
  const box  = document.getElementById('ai-suggestion-box');
  if (box)  box.style.display  = 'none';
};

window.onNewPersonChange = () => checkShowAIButton();
window.onSubjectChange   = () => checkShowAIButton();

function checkShowAIButton() {
  const cat       = document.getElementById('new-cat').value;
  const personId  = document.getElementById('new-person-select')?.value;
  const subjectId = document.getElementById('new-subject-select')?.value;
  const wrap      = document.getElementById('ai-generator-wrap');
  if (wrap) wrap.style.display = (cat === 'voti' && personId && subjectId) ? 'block' : 'none';
}

function populateSubjectSelect() {
  const sel = document.getElementById('new-subject-select'); if (!sel) return;
  sel.innerHTML = '<option value="">-- Nessuna (generica) --</option>' +
    state.subjects.map(s=>`<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

// ── Genera scommessa ──────────────────────────────────────────
function generateBetAlgorithm(person, subject, voti, media, mediaGen, comportamento, assenze) {
  const m = media !== null ? parseFloat(media) : (mediaGen !== null ? parseFloat(mediaGen) : 6.0);
  let trend = 0;
  if (voti.length >= 3) {
    const recenti    = voti.slice(-2).reduce((a,v)=>a+v,0) / 2;
    const precedenti = voti.slice(0,-2).reduce((a,v)=>a+v,0) / Math.max(1, voti.length-2);
    trend = recenti - precedenti;
  }
  const soglia = m >= 8 ? 8 : m >= 7 ? 7 : m >= 6 ? 6 : 5;
  let probAlta = m >= soglia+1.5 ? 0.78 : m >= soglia+0.5 ? 0.65 : m >= soglia ? 0.55 : m >= soglia-0.5 ? 0.42 : 0.28;
  probAlta = Math.min(0.90, Math.max(0.10, probAlta + trend * 0.04));
  if (comportamento !== null) probAlta += (comportamento - 5) * 0.01;
  if (assenze !== null && assenze > 10) probAlta -= Math.min(0.10, (assenze - 10) * 0.005);
  probAlta = Math.min(0.90, Math.max(0.10, probAlta));
  const margin     = 1.05;
  const quotaAlta  = parseFloat((margin / probAlta).toFixed(2));
  const quotaBassa = parseFloat((margin / (1-probAlta)).toFixed(2));
  const templates  = [
    { domanda: `${person.name} prenderà almeno ${soglia} in ${subject.name}?`, desc: `Media attuale: ${m.toFixed(1)}` },
    { domanda: `${person.name} supera il ${soglia} alla prossima in ${subject.name}?`, desc: `${voti.length} voti registrati` },
    { domanda: `Interrogazione di ${subject.name}: ${person.name} va bene?`, desc: `Soglia fissata a ${soglia}` },
  ];
  const tpl    = templates[Math.floor(Math.random() * templates.length)];
  const opzioni = [
    { label: `Sì, ${soglia} o più`,   quota: quotaAlta  },
    { label: `No, meno di ${soglia}`, quota: quotaBassa },
  ];
  if (voti.length >= 3 && Math.abs(probAlta - 0.5) < 0.2)
    opzioni.push({ label: `Esattamente ${soglia}`, quota: Math.min(parseFloat((margin/0.15).toFixed(2)), 6.0) });
  return { domanda: tpl.domanda, descrizione: tpl.desc, opzioni };
}

function fillBetForm(result) {
  document.getElementById('new-title').value = result.domanda || '';
  document.getElementById('new-desc').value  = result.descrizione || '';
  document.getElementById('options-builder').innerHTML = result.opzioni.map(o => `
    <div class="option-row">
      <input type="text" value="${escHtml(o.label)}">
      <input type="number" class="odd-input" value="${parseFloat(o.quota).toFixed(1)}" step="0.1" min="1.0">
      <button class="btn-remove-opt" onclick="removeOption(this)">✕</button>
    </div>`).join('');
  document.getElementById('ai-suggestion-box').style.display = 'block';
}

window.generateWithAI = async () => {
  const personId  = document.getElementById('new-person-select').value;
  const subjectId = document.getElementById('new-subject-select').value;
  if (!personId || !subjectId) { notify('Seleziona persona e materia!', 'error'); return; }
  const person  = state.people.find(p => p.id === personId);
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!person || !subject) return;

  const stats        = person.stats || {};
  const subjectStats = (stats.materie || {})[subjectId] || {};
  const voti         = subjectStats.voti || [];
  const media        = voti.length ? (voti.reduce((a,v)=>a+v,0)/voti.length).toFixed(1) : null;
  const mediaGen     = calcMediaGenerale(person);
  const comportamento= stats.comportamento ?? null;
  const assenze      = stats.assenze ?? null;

  const btn  = document.getElementById('btn-ai-generate');
  const icon = document.getElementById('ai-btn-icon');
  const text = document.getElementById('ai-btn-text');
  btn.disabled = true; icon.textContent = '⏳'; text.textContent = 'Generando...';

  try {
    const prompt = `Sei un bookmaker scolastico italiano. Crea UNA scommessa per la prossima interrogazione di ${person.name} in ${subject.name}.
Statistiche: voti in ${subject.name}: ${voti.length ? voti.join(', ') : 'nessuno'}, media: ${media ?? 'N/D'}, media generale: ${mediaGen !== null ? parseFloat(mediaGen).toFixed(1) : 'N/D'}, comportamento: ${comportamento ?? 'N/D'}/10, assenze: ${assenze ?? 'N/D'}.
Rispondi SOLO con JSON valido senza markdown:
{"domanda":"max 80 caratteri","descrizione":"max 60 caratteri","opzioni":[{"label":"Sì, prende 7 o più","quota":1.8},{"label":"No, meno di 7","quota":2.0}]}
Quote tra 1.1 e 6.0, bilanciate. Puoi fare 2 o 3 opzioni.`;

    const geminiResult = await model.generateContent(prompt);
    const raw    = geminiResult.response.text();
    const clean  = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    fillBetForm(result);
    notify('Scommessa generata da Gemini! ✨', 'success');

  } catch(e) {
    console.warn('Gemini non disponibile, uso algoritmo:', e.message);
    const result = generateBetAlgorithm(person, subject, voti, media, mediaGen, comportamento, assenze);
    fillBetForm(result);
    notify('Scommessa generata dalle statistiche! ✨', 'success');
  } finally {
    btn.disabled = false; icon.textContent = '✨'; text.textContent = 'Genera con AI ✨';
  }
};

// ── Subjects management ───────────────────────────────────────
function renderSubjectsList() {
  const el = document.getElementById('subjects-list'); if (!el) return;
  if (!state.subjects.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">Nessuna materia aggiunta.</div>'; return; }
  el.innerHTML = state.subjects.map(s => `
    <div class="subject-chip">
      📚 ${escHtml(s.name)}
      <button onclick="confirmDeleteSubject('${s.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:0 0 0 6px;font-size:14px;line-height:1;">✕</button>
    </div>`).join('');
}

window.addSubject = async () => {
  const name = document.getElementById('new-subject-name').value.trim();
  if (!name) { notify('Inserisci il nome della materia!', 'error'); return; }
  if (state.subjects.find(s => s.name.toLowerCase() === name.toLowerCase())) { notify('Materia già esistente!', 'error'); return; }
  await addDoc(subjectsCol, { name });
  document.getElementById('new-subject-name').value = '';
  notify(`${name} aggiunta! 📚`, 'success');
};

window.confirmDeleteSubject = (id) => {
  const s = state.subjects.find(x=>x.id===id); if(!s) return;
  showModal('🗑️ Elimina materia', `Sei sicuro di voler eliminare "${s.name}"?`, () => deleteSubject(id));
};

async function deleteSubject(id) {
  await deleteDoc(doc(db, 'subjects', id));
  notify('Materia eliminata.', 'success');
}

// ── Person stats admin ────────────────────────────────────────
window.loadPersonStats = () => {
  const personId = document.getElementById('stats-person-select').value;
  const editor   = document.getElementById('stats-editor');
  if (!personId) { editor.style.display = 'none'; return; }
  const person   = state.people.find(p => p.id === personId);
  if (!person)   { editor.style.display = 'none'; return; }
  const stats        = person.stats || {};
  const subjectStats = stats.materie || {};
  document.getElementById('stats-comportamento').value = stats.comportamento ?? '';
  document.getElementById('stats-assenze').value       = stats.assenze ?? '';
  const subjEd = document.getElementById('stats-subjects-editor');
  subjEd.innerHTML = state.subjects.map(s => {
    const voti = subjectStats[s.id]?.voti || [];
    return `
      <div class="subj-stat-row">
        <div class="subj-stat-label">📚 ${escHtml(s.name)}</div>
        <input type="text" class="admin-input subj-voti-input" data-subject-id="${s.id}"
          placeholder="es. 6, 7, 8" value="${voti.join(', ')}" style="flex:1;">
        <div class="subj-media" id="media-${s.id}">${voti.length ? calcMedia(voti).toFixed(1) : '—'}</div>
      </div>`;
  }).join('');
  subjEd.querySelectorAll('.subj-voti-input').forEach(input => {
    input.addEventListener('input', () => {
      const voti = parseVoti(input.value);
      const med  = calcMedia(voti);
      const el   = document.getElementById('media-'+input.dataset.subjectId);
      if (el) { el.textContent = med !== null ? med.toFixed(1) : '—'; el.style.color = med !== null ? votoColor(med) : 'var(--muted)'; }
    });
  });
  editor.style.display = 'block';
};

function parseVoti(str) {
  return str.split(',').map(v=>parseFloat(v.trim())).filter(v=>!isNaN(v)&&v>=1&&v<=10);
}

window.savePersonStats = async () => {
  const personId = document.getElementById('stats-person-select').value; if (!personId) return;
  const comportamento = parseFloat(document.getElementById('stats-comportamento').value) || null;
  const assenze       = parseInt(document.getElementById('stats-assenze').value) || null;
  const materie = {};
  document.querySelectorAll('.subj-voti-input').forEach(input => {
    materie[input.dataset.subjectId] = { voti: parseVoti(input.value) };
  });
  await updateDoc(doc(db, 'people', personId), { stats: { comportamento, assenze, materie } });
  const person = state.people.find(p=>p.id===personId);
  if (person) person.stats = { comportamento, assenze, materie };
  notify('Statistiche salvate! 📊', 'success');
};

function renderAdminPeopleList() {
  const list = document.getElementById('people-list'); if (!list) return;
  const sorted = [...state.people].sort((a,b)=>a.name.localeCompare(b.name,'it',{sensitivity:'base'}));
  if (!sorted.length) { list.innerHTML='<div style="color:var(--muted);font-size:13px;text-align:center;padding:8px;">Nessuna persona aggiunta.</div>'; return; }
  list.innerHTML = sorted.map(p=>`
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;">
      <div>
        <div style="font-weight:600;font-size:14px;">${escHtml(p.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${p.type==='compagno'?'🎒 Compagno':'🧑‍🏫 Professore'}</div>
      </div>
      <button class="btn-remove-opt" style="font-size:18px;" onclick="confirmDeletePerson('${p.id}')">🗑️</button>
    </div>`).join('');
}

window.addPerson = async () => {
  const name = document.getElementById('new-person-name').value.trim();
  const type = document.getElementById('new-person-type').value;
  if (!name) { notify('Inserisci un nome!', 'error'); return; }
  if (state.people.find(p => p.name.toLowerCase() === name.toLowerCase() && p.type === type)) { notify('Persona già esistente!', 'error'); return; }
  await addDoc(peopleCol, { name, type });
  document.getElementById('new-person-name').value = '';
  notify(`${name} aggiunto/a! ✅`, 'success');
};

window.confirmDeletePerson = (personId) => {
  const person = state.people.find(p => p.id === personId); if (!person) return;
  const betCount = state.bets.filter(b => b.personId === personId && b.status === 'open').length;
  showModal('🗑️ Elimina persona',
    betCount > 0 ? `Eliminando "${person.name}" verranno eliminate anche ${betCount} scommesse aperte. Continuare?`
                 : `Sei sicuro di voler eliminare "${person.name}"?`,
    () => deletePerson(personId));
};

async function deletePerson(personId) {
  const batch = writeBatch(db);
  state.bets.filter(b => b.personId === personId && b.status === 'open').forEach(b => {
    state.placedBets.filter(pb => pb.status === 'pending' && pb.selections.some(s => s.betId === b.id)).forEach(pb => {
      batch.update(pbDoc(pb.id), { status: 'cancelled' });
      const newC = (state.users[pb.user]?.credits || 0) + pb.stake;
      batch.update(uDoc(pb.user), { credits: newC });
      state.users[pb.user].credits = newC;
    });
    batch.delete(bDoc(b.id));
  });
  batch.delete(pDoc(personId));
  await batch.commit();
  updateHeaderCredits();
  notify('Persona eliminata. 🗑️', 'success');
}

window.createBet = async () => {
  const title     = document.getElementById('new-title').value.trim();
  const cat       = document.getElementById('new-cat').value;
  const desc      = document.getElementById('new-desc').value.trim();
  const personId  = (cat === 'voti' || cat === 'prof') ? document.getElementById('new-person-select').value : '';
  const subjectId = cat === 'voti' ? (document.getElementById('new-subject-select')?.value || '') : '';
  const options   = [];
  document.querySelectorAll('#options-builder .option-row').forEach(row=>{
    const ins=row.querySelectorAll('input');
    const label=ins[0].value.trim(), odd=parseFloat(ins[1].value);
    if(label&&odd>=1)options.push({label,odd});
  });
  if(!title){notify('Inserisci una domanda!','error');return;}
  if((cat==='voti'||cat==='prof')&&!personId){notify('Seleziona una persona!','error');return;}
  if(options.length<2){notify('Inserisci almeno 2 opzioni!','error');return;}
  await addDoc(betsCol,{cat,title,desc,options,personId:personId||'',subjectId:subjectId||'',status:'open',pool:0,placed:0,ts:new Date().toISOString()});
  document.getElementById('new-title').value='';
  document.getElementById('new-desc').value='';
  notify('Scommessa pubblicata! 🚀','success');
};

window.addOptionRow = () => {
  const row=document.createElement('div'); row.className='option-row';
  row.innerHTML=`<input type="text" placeholder="Opzione"><input type="number" class="odd-input" value="2.0" step="0.1" min="1.0"><button class="btn-remove-opt" onclick="removeOption(this)">✕</button>`;
  document.getElementById('options-builder').appendChild(row);
};
window.removeOption = btn => {
  if(document.querySelectorAll('#options-builder .option-row').length<=2){notify('Minimo 2 opzioni!','error');return;}
  btn.parentElement.remove();
};

window.resolveBet = async () => {
  const betId=document.getElementById('resolve-bet-select').value;
  const winOpt=document.getElementById('resolve-option-select').value;
  if(!betId||!winOpt){notify('Seleziona scommessa e opzione!','error');return;}
  const batch=writeBatch(db);
  batch.update(bDoc(betId),{status:'closed',result:winOpt});
  let winners=0;
  state.placedBets.filter(pb=>pb.status==='pending'&&pb.selections.some(s=>s.betId===betId)).forEach(pb=>{
    const sel=pb.selections.find(s=>s.betId===betId);
    if(sel.choice===winOpt){
      batch.update(pbDoc(pb.id),{status:'won'});
      const newC=(state.users[pb.user]?.credits||0)+pb.potWin;
      batch.update(uDoc(pb.user),{credits:newC});
      state.users[pb.user].credits=newC; winners++;
    } else { batch.update(pbDoc(pb.id),{status:'lost'}); }
  });
  await batch.commit();
  updateHeaderCredits();
  notify(`Risultato assegnato! ${winners} vincitore/i 🏆`,'success');
};

window.giftCredits = async () => {
  const u=document.getElementById('gift-user-select').value;
  const amt=parseInt(document.getElementById('gift-amount').value);
  if(!u){notify('Seleziona un utente!','error');return;}
  if(!amt||amt<1){notify('Inserisci un importo valido!','error');return;}
  const newC=(state.users[u]?.credits||0)+amt;
  await updateDoc(uDoc(u),{credits:newC});
  state.users[u].credits=newC;
  updateHeaderCredits();
  notify(`Inviati 🪙 ${amt} a ${u}!`,'success');
};

async function deleteUser(username) {
  const batch = writeBatch(db);
  state.placedBets.filter(pb => pb.user === username && pb.status === 'pending').forEach(pb => {
    batch.update(pbDoc(pb.id), { status: 'cancelled' });
  });
  batch.delete(uDoc(username));
  await batch.commit();
  if (state.currentUser === username) {
    localStorage.removeItem('scuolabet_user');
    state.currentUser = null;
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    slip = []; updateSlip();
    notify('Account eliminato.', 'success');
  } else {
    notify(`Profilo di ${username} eliminato. 🗑️`, 'success');
  }
}

window.confirmDeleteUser = () => {
  const u = document.getElementById('delete-user-select').value;
  if (!u) { notify('Seleziona un utente!', 'error'); return; }
  const pending = state.placedBets.filter(pb => pb.user === u && pb.status === 'pending').length;
  showModal('🗑️ Elimina profilo',
    pending > 0 ? `Eliminando il profilo di "${u}" verranno annullate ${pending} scommesse. Continuare?`
                : `Sei sicuro di voler eliminare il profilo di "${u}"?`,
    () => deleteUser(u));
};

window.confirmDeleteOwnAccount = () => {
  const u = state.currentUser; if (!u) return;
  const pending = state.placedBets.filter(pb => pb.user === u && pb.status === 'pending').length;
  showModal('🗑️ Elimina account',
    pending > 0 ? `Eliminando il tuo account verranno annullate ${pending} scommesse. Sei sicuro?`
                : 'Sei sicuro di voler eliminare il tuo account?',
    () => deleteUser(u));
};

window.loadBetIntoEditor = () => {
  const betId=document.getElementById('edit-bet-select').value;
  const form=document.getElementById('edit-bet-form');
  if(!betId){form.style.display='none';return;}
  const bet=state.bets.find(b=>b.id===betId);
  if(!bet){form.style.display='none';return;}
  document.getElementById('edit-cat').value=bet.cat;
  document.getElementById('edit-title').value=bet.title;
  document.getElementById('edit-desc').value=bet.desc||'';
  document.getElementById('edit-options-builder').innerHTML=bet.options.map(o=>`
    <div class="option-row">
      <input type="text" value="${escHtml(o.label)}" placeholder="Opzione">
      <input type="number" class="odd-input" value="${o.odd.toFixed(2)}" step="0.1" min="1.0">
      <button class="btn-remove-opt" onclick="removeEditOption(this)">✕</button>
    </div>`).join('');
  const hasBets=state.placedBets.some(pb=>pb.status==='pending'&&pb.selections.some(s=>s.betId===betId));
  const warn=document.getElementById('edit-warning');
  warn.style.display=hasBets?'block':'none';
  if(hasBets) warn.textContent='⚠️ Ci sono già scommesse piazzate. Le nuove quote si applicano solo alle prossime.';
  form.style.display='block';
};

window.addEditOptionRow = () => {
  const row=document.createElement('div'); row.className='option-row';
  row.innerHTML=`<input type="text" placeholder="Opzione"><input type="number" class="odd-input" value="2.0" step="0.1" min="1.0"><button class="btn-remove-opt" onclick="removeEditOption(this)">✕</button>`;
  document.getElementById('edit-options-builder').appendChild(row);
};
window.removeEditOption = btn => {
  if(document.querySelectorAll('#edit-options-builder .option-row').length<=2){notify('Minimo 2 opzioni!','error');return;}
  btn.parentElement.remove();
};

window.saveEditBet = async () => {
  const betId=document.getElementById('edit-bet-select').value; if(!betId)return;
  const title=document.getElementById('edit-title').value.trim();
  const cat=document.getElementById('edit-cat').value;
  const desc=document.getElementById('edit-desc').value.trim();
  const options=[];
  document.querySelectorAll('#edit-options-builder .option-row').forEach(row=>{
    const ins=row.querySelectorAll('input');
    const label=ins[0].value.trim(), odd=parseFloat(ins[1].value);
    if(label&&odd>=1)options.push({label,odd});
  });
  if(!title){notify('Inserisci una domanda!','error');return;}
  if(options.length<2){notify('Inserisci almeno 2 opzioni!','error');return;}
  const batch=writeBatch(db);
  batch.update(bDoc(betId),{title,cat,desc,options});
  state.placedBets.filter(pb=>pb.status==='pending'&&pb.selections.some(s=>s.betId===betId)).forEach(pb=>{
    batch.update(pbDoc(pb.id),{selections:pb.selections.map(s=>s.betId===betId?{...s,question:title}:s)});
  });
  await batch.commit();
  slip.forEach(s=>{ if(s.betId===betId) s.question=title; });
  updateSlip();
  notify('Scommessa aggiornata! ✏️','success');
};

window.confirmDeleteBet = () => {
  const betId=document.getElementById('edit-bet-select').value; if(!betId)return;
  const pc=state.placedBets.filter(pb=>pb.status==='pending'&&pb.selections.some(s=>s.betId===betId)).length;
  showModal('🗑️ Elimina scommessa',
    pc>0?`Eliminando questa scommessa verranno rimborsate ${pc} scommesse in corso. Continuare?`
        :'Sei sicuro di voler eliminare questa scommessa?',
    ()=>deleteBet(betId));
};

async function deleteBet(betId) {
  const batch=writeBatch(db);
  state.placedBets.filter(pb=>pb.status==='pending'&&pb.selections.some(s=>s.betId===betId)).forEach(pb=>{
    batch.update(pbDoc(pb.id),{status:'cancelled'});
    const newC=(state.users[pb.user]?.credits||0)+pb.stake;
    batch.update(uDoc(pb.user),{credits:newC});
    state.users[pb.user].credits=newC;
  });
  batch.delete(bDoc(betId));
  await batch.commit();
  slip=slip.filter(s=>s.betId!==betId);
  document.getElementById('edit-bet-form').style.display='none';
  updateSlip(); updateHeaderCredits();
  notify('Scommessa eliminata e scommesse rimborsate. 🗑️','success');
}

// ── Modal / Notify ───────────────────────────────────────────
let modalCallback=null;
window.showModal = (title, body, onConfirm) => {
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').textContent=body;
  modalCallback=onConfirm;
  document.getElementById('modal-overlay').classList.add('open');
};
window.closeModal = () => {
  document.getElementById('modal-overlay').classList.remove('open');
  modalCallback=null;
};
document.getElementById('modal-confirm-btn').onclick=()=>{ if(modalCallback)modalCallback(); closeModal(); };

let notifTimer;
window.notify = (msg, type='success') => {
  const el=document.getElementById('notif');
  el.textContent=msg; el.className='notif '+type+' show';
  clearTimeout(notifTimer);
  notifTimer=setTimeout(()=>el.classList.remove('show'),3500);
};

// ── Init ─────────────────────────────────────────────────────
async function init() {
  initAvatarPicker();
  const [users, bets, placedBets, people, subjects] = await Promise.all([
    fsGetAllUsers(), fsGetAllBets(), fsGetAllPlacedBets(), fsGetAllPeople(), fsGetAllSubjects()
  ]);
  state.users=users; state.bets=bets; state.placedBets=placedBets; state.people=people; state.subjects=subjects;

  if (!users['admin']) {
    const adminData={pass:'admin123',credits:99999,isAdmin:true,avatar:'👑'};
    await setDoc(uDoc('admin'), adminData);
    state.users['admin']=adminData;
  }

  if (!bets.length) {
    const defaults=[
      {cat:'voti',    title:"Qualcuno prenderà 10 all'interrogazione di domani?", desc:'Scommetti se ci sarà un 10 nella prossima interrogazione orale', options:[{label:'Sì',odd:3.5},{label:'No',odd:1.3}]},
      {cat:'prof',    title:'Il prof di matematica sarà in ritardo lunedì?',       desc:'Più di 5 minuti conta come ritardo',                             options:[{label:'Sì, in ritardo',odd:1.9},{label:'No, puntuale',odd:1.9}]},
      {cat:'compiti', title:'Ci sarà un compito in classe di italiano?',            desc:'Il prof aveva accennato a una possibile verifica',                options:[{label:'Sì',odd:2.1},{label:'No',odd:1.7},{label:'Forse',odd:4.0}]},
      {cat:'eventi',  title:'La gita scolastica sarà confermata entro venerdì?',   desc:'Si vocifera di problemi organizzativi...',                        options:[{label:'Confermata ✅',odd:1.6},{label:'Annullata ❌',odd:2.5},{label:'Posticipata ⏳',odd:3.2}]},
    ];
    for (const d of defaults)
      await addDoc(betsCol,{...d,status:'open',pool:0,placed:0,ts:new Date().toISOString()});
  }

  startListeners();
  document.getElementById('loading-screen').classList.remove('active');
  const saved=localStorage.getItem('scuolabet_user');
  if (saved && state.users[saved]) login(saved);
  else document.getElementById('auth-screen').classList.add('active');
}

init();