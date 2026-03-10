// ══════════════════════════════════════════════
//  admin.js — Pannello amministratore
// ══════════════════════════════════════════════
import {
  auth, db, showScreen, showToast,
  DEFAULT_SINGERS, POINTS, SERATA_LABELS
} from './firebase-init.js';
import { isAdmin, signOutUser } from './auth.js';
import { onAuthStateChanged }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, getDocs,
  collection, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Stato ─────────────────────────────────────
let currentSerata = 1;
let appConfig     = {};
let singers       = { 1: [...DEFAULT_SINGERS[1]], 2: [...DEFAULT_SINGERS[2]] };

// ── Entry point ───────────────────────────────
export async function initAdminApp() {
  onAuthStateChanged(auth, async user => {
    if (!user) { showScreen('screen-admin-login'); return; }

    if (!(await isAdmin(user.uid))) {
      showToast('Accesso non autorizzato');
      setTimeout(() => window.location.href = 'index.html', 1500);
      return;
    }

    // Carica config e cantanti, poi mostra pannello
    await Promise.all([loadConfig(), loadAllSingers()]);
    renderAdminPanel(user);
    showScreen('screen-admin');
  });
}

// ── Carica config da Firestore ────────────────
async function loadConfig() {
  try {
    const snap = await getDoc(doc(db,'config','current'));
    appConfig     = snap.exists() ? snap.data() : {};
    currentSerata = appConfig.serata || 1;
  } catch(e) { currentSerata = 1; }
}

async function saveConfig(updates) {
  appConfig = { ...appConfig, ...updates };
  await setDoc(doc(db,'config','current'), appConfig);
}

// ── Cantanti ──────────────────────────────────
async function loadAllSingers() {
  try {
    const [s1, s2] = await Promise.all([
      getDoc(doc(db,'singers','s1')),
      getDoc(doc(db,'singers','s2'))
    ]);
    if (s1.exists()) singers[1] = s1.data().list;
    if (s2.exists()) singers[2] = s2.data().list;
  } catch(e) {}
}

async function saveSingers(serata) {
  const inputs = document.querySelectorAll(`#singers-editor-s${serata} .singer-edit-input`);
  const list   = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
  if (list.length === 0) { showToast('Inserisci almeno un cantante'); return; }
  await setDoc(doc(db,'singers',`s${serata}`), { list, updatedAt: serverTimestamp() });
  singers[serata] = list;
  showToast(`Cantanti Serata ${serata} salvati ✓`);
}

function renderSingersEditor(serata) {
  const container = document.getElementById(`singers-editor-s${serata}`);
  const list      = singers[serata];
  container.innerHTML = list.map((name,i) => `
    <div class="singer-edit-row">
      <span class="singer-edit-num">${i+1}</span>
      <input class="singer-edit-input" type="text" value="${name}" placeholder="Nome cantante">
    </div>`).join('') + `
    <button class="btn-save-singers" onclick="saveSingersAdmin(${serata})">
      💾 Salva cantanti Serata ${serata}
    </button>`;
}

// ── Render pannello admin ─────────────────────
function renderAdminPanel(user) {
  // Utente loggato
  const name = user.displayName || user.email || 'Admin';
  const init = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('admin-user-initials').textContent = init;
  document.getElementById('admin-user-name').textContent = name.split(' ')[0];

  // Serata switcher
  updateSerataButtons();

  // Switches
  updateSwitches();

  // Editors cantanti
  renderSingersEditor(1);
  renderSingersEditor(2);

  // Classifica
  refreshRanking();
}

function updateSerataButtons() {
  [1,2,3].forEach(i => {
    document.getElementById(`btn-s${i}`)?.classList.toggle('active', i === currentSerata);
  });
  // Mostra/nascondi pulsante svela solo in serata 3
  const revealBtn = document.getElementById('btn-reveal-wrap');
  if (revealBtn) revealBtn.style.display = currentSerata === 3 ? '' : 'none';
}

function updateSwitches() {
  setSwitchState('toggle-voto',    appConfig.votoAperto  !== false);
  setSwitchState('toggle-top5',    !!appConfig.mostraTop5);
  setSwitchState('toggle-svela',   !!appConfig.svelaClassifica);

  // top5 e svela abilitati solo se voto chiuso
  const votoAperto = appConfig.votoAperto !== false;
  document.getElementById('toggle-top5-wrap')?.classList.toggle('disabled', votoAperto);
  document.getElementById('toggle-svela-wrap')?.classList.toggle('disabled', votoAperto || currentSerata !== 3);
}

function setSwitchState(id, state) {
  const input = document.getElementById(id);
  if (input) input.checked = state;
}

// ── Switch handlers ───────────────────────────
async function toggleVoto(checked) {
  await saveConfig({ votoAperto: checked });
  if (checked) {
    // Se si riapre il voto, disabilita top5 e svela
    await saveConfig({ mostraTop5: false, svelaClassifica: false });
  }
  updateSwitches();
  showToast(checked ? '🟢 Votazioni aperte' : '🔴 Votazioni chiuse');
}

async function toggleTop5(checked) {
  if (appConfig.votoAperto !== false) { showToast('Chiudi prima le votazioni'); return; }
  await saveConfig({ mostraTop5: checked });
  updateSwitches();
  showToast(checked ? 'Top 5 visibile al pubblico' : 'Top 5 nascosto');
}

async function toggleSvela(checked) {
  if (currentSerata !== 3) { showToast('Disponibile solo nella Finale'); return; }
  if (appConfig.votoAperto !== false) { showToast('Chiudi prima le votazioni'); return; }
  await saveConfig({ svelaClassifica: checked });
  updateSwitches();
  showToast(checked ? '🏆 Classifica svelata al pubblico' : 'Classifica nascosta');
}

// ── Serata switcher ───────────────────────────
async function setSerata(n) {
  currentSerata = n;
  await saveConfig({ serata: n });
  updateSerataButtons();
  updateSwitches();
  refreshRanking();
  showToast(`Serata ${n === 3 ? 'Finale' : n} attivata`);
}

// ── Classifica live ───────────────────────────
async function refreshRanking() {
  const rows = document.getElementById('admin-ranking-rows');
  if (!rows) return;
  rows.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">Caricamento…</div>';

  try {
    const snap     = await getDocs(collection(db, `votes_s${currentSerata}`));
    const allVotes = []; snap.forEach(d => allVotes.push(d.data()));

    const activeSingers = currentSerata === 3
      ? [...singers[1], ...singers[2]]
      : singers[currentSerata];

    const scores = {};
    activeSingers.forEach(s => scores[s] = 0);
    allVotes.forEach(({vote}) =>
      vote?.forEach((name,i) => { if (scores[name] !== undefined) scores[name] += POINTS[i]; })
    );

    const ranking = Object.entries(scores).sort((a,b) => b[1]-a[1]);
    const maxPts  = ranking[0]?.[1] || 1;

    document.getElementById('stat-votes').textContent = allVotes.length;
    document.getElementById('stat-label').textContent = `Voti — ${SERATA_LABELS[currentSerata]}`;

    rows.innerHTML = '';
    ranking.forEach(([name,pts],i) => {
      const pct = maxPts > 0 ? (pts/maxPts*100).toFixed(0) : 0;
      const r   = document.createElement('div');
      r.className = 'ranking-row';
      r.innerHTML = `
        <span class="r-pos">${i+1}</span>
        <div style="min-width:0">
          <div class="r-name">${name}</div>
          <div class="r-bar-wrap"><div class="r-bar" style="width:${pct}%"></div></div>
        </div>
        <span class="r-pts">${pts}</span>`;
      rows.appendChild(r);
    });
  } catch(e) {
    rows.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red)">Errore nel caricamento.</div>';
  }
}

// ── Export CSV ────────────────────────────────
async function exportCSV() {
  try {
    const snap = await getDocs(collection(db, `votes_s${currentSerata}`));
    if (snap.empty) { showToast('Nessun voto da esportare'); return; }
    let csv = `Serata,UID,Nome,1°,2°,3°,4°,5°,Timestamp\n`;
    snap.forEach(d => {
      const v  = d.data();
      const ts = v.timestamp?.toDate?.().toLocaleString('it-IT') || '–';
      csv += `"${SERATA_LABELS[currentSerata]}","${v.uid}","${v.name}",${v.vote.map(n=>`"${n}"`).join(',')},${ts}\n`;
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    a.download = `goro_voti_s${currentSerata}_2026.csv`;
    a.click();
  } catch(e) { showToast('Errore esportazione'); }
}

// ── Reset voti ────────────────────────────────
async function resetVotes() {
  document.getElementById('overlay-reset').style.display = 'none';
  try {
    const snap = await getDocs(collection(db, `votes_s${currentSerata}`));
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, `votes_s${currentSerata}`, d.id))));
    refreshRanking();
    showToast('Voti azzerati');
  } catch(e) { showToast('Errore durante il reset'); }
}

// ── Expose to window ──────────────────────────
window.setSerataAdmin    = setSerata;
window.toggleVoto        = e => toggleVoto(e.target.checked);
window.toggleTop5        = e => toggleTop5(e.target.checked);
window.toggleSvela       = e => toggleSvela(e.target.checked);
window.refreshRanking    = refreshRanking;
window.exportCSV         = exportCSV;
window.confirmReset      = () => document.getElementById('overlay-reset').style.display = 'flex';
window.resetVotes        = resetVotes;
window.saveSingersAdmin  = saveSingers;
window.signOutAdmin      = signOutUser;
window.cancelReset       = () => document.getElementById('overlay-reset').style.display = 'none';
