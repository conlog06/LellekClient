// LellekClient 3.2 – Benachrichtigungen einstellbar, neues Log-Fenster
const NOTIF_CATS = [
  ['game', '🎮 Spiel', 'Absturz-Meldungen', true],
  ['ready', '⏱️ Spiel bereit', '„… ist bereit – Start in 14 s“', false],
  ['friends', '👋 Freunde', 'Freund online, Freundschaftsanfragen, Einladungen', true],
  ['chat', '💬 Chat', 'Neue Nachrichten von Freunden', true],
  ['party', '🥳 Party', 'Party-Einladungen und Countdown', true],
  ['ach', '🏆 Erfolge', 'Freigeschaltete Erfolge', true],
  ['updates', '⬆️ Updates', 'Neue Launcher-Version, Mod-Updates', true],
  ['downloads', '📦 Downloads', 'Modpack fertig installiert', true],
  ['pause', '⏸️ Pausen-Erinnerung', 'Hinweis nach langer Spielzeit', true],
  ['shots', '📸 Screenshots', 'Meldung bei neuem Screenshot', false],
  ['confirm', '✔️ Bestätigungen', '„Gespeichert“, „Profil kopiert“ und ähnliche kurze Meldungen', false],
  ['errors', '⚠️ Fehlermeldungen', 'Fehler im Launcher (landen immer auch im Protokoll)', false],
  ['tips', '🩹 Hinweise', 'Selbstheilung, Wiederherstellung und Tipps', false],
];
const NOTIF_DEF = { game: 'all', friends: 'all', chat: 'all', party: 'all', ach: 'app', updates: 'all', downloads: 'all', pause: 'all', shots: 'app', ready: 'app', confirm: 'app', errors: 'app', tips: 'app' };
const NOTIF_DND_OK = new Set(['game', 'party', 'pause', 'important']);
let notifSet = { notif: {}, notifDnd: true };
api.settings.get().then(s => { notifSet = { notif: s.notif || {}, notifDnd: s.notifDnd !== false, friendNotify: s.friendNotify, chatNotify: s.chatNotify }; }).catch(() => {});
function notifLevel(cat) { if (notifSet.notif[cat]) return notifSet.notif[cat]; if (cat === 'friends' && notifSet.friendNotify === false) return 'app'; if (cat === 'chat' && notifSet.chatNotify === false) return 'app'; return NOTIF_DEF[cat] || 'app'; }
{
  const _ft = floatToast;
  floatToast = function (title, sub, opts = {}) {
    const cat = opts.cat || (opts.err ? 'errors' : 'confirm');
    if (cat !== 'important') {
      if (notifLevel(cat) === 'off') return;
      if (notifSet.notifDnd && typeof V31 !== 'undefined' && V31.game && !NOTIF_DND_OK.has(cat) && !(opts.err && document.hasFocus())) return;
    }
    return _ft(title, sub, opts);
  };
}

// ---------- Optionen → Benachrichtigungen ----------
safe('opts-notif', () => {
  const nav = $('#optNav'); const anchor = $('.opt-sec[data-cat="game"]'); if (!nav || !anchor) return;
  const navBtn = nav.querySelector('[data-cat="social"]') || nav.querySelector('[data-cat="game"]');
  const b = navBtn.cloneNode(false); b.dataset.cat = 'notif'; b.textContent = 'Benachrichtigungen'; b.classList.remove('active'); navBtn.after(b);
  b.onclick = () => showOptCat('notif');
  const sec = h('section.opt-sec', { dataset: { cat: 'notif' } }); anchor.after(sec);
  const dnd = h('input.sw', { type: 'checkbox', checked: true, onchange: () => save({ notifDnd: dnd.checked }) });
  const save = (patch) => api.settings.save(patch).then(() => { Object.assign(notifSet, patch); flashSaved(); });
  sec.append(h('h3', 'Benachrichtigungen'), h('p.muted', { style: { margin: '0 0 10px' } }, 'Lege fest, was dir LellekClient meldet: gar nicht, nur unten rechts im Launcher, oder zusätzlich als Windows-Benachrichtigung.'),
    h('label.opt-row', h('div', h('b', 'Nicht stören, während Minecraft läuft'), h('span', 'Nur Abstürze, Party und Pausen-Erinnerung kommen durch – alles andere wartet')), dnd));
  const rows = h('div.notif-rows'); sec.append(rows);
  const segs = [];
  for (const [cat, title, sub, sys] of NOTIF_CATS) {
    const seg = h('div.seg.notif-seg', { dataset: { cat } });
    const opts = sys ? [['off', 'Aus'], ['app', 'Launcher'], ['all', 'Launcher + Windows']] : [['off', 'Aus'], ['app', 'Anzeigen']];
    for (const [v, t] of opts) seg.append(h('button', { dataset: { v }, onclick: () => { notifSet.notif = { ...notifSet.notif, [cat]: v }; save({ notif: notifSet.notif }); drawSeg(seg, cat); } }, t));
    segs.push([seg, cat]); rows.append(h('div.opt-row', h('div', h('b', title), h('span', sub)), seg));
  }
  const drawSeg = (seg, cat) => { let lv = notifLevel(cat); if (lv === 'all' && seg.children.length === 2) lv = 'app'; for (const x of seg.children) x.classList.toggle('active', x.dataset.v === lv); };
  sec.append(h('div.row.gap', { style: { marginTop: '12px' } },
    h('button.ghost', { onclick: () => { floatToast('So sieht eine Meldung im Launcher aus', 'Unten rechts, verschwindet von selbst', { icon: '🔔', cat: 'important', force: true }); api.v32.notifTest(); } }, 'Test-Benachrichtigung'),
    h('button.ghost', { onclick: () => { const all = Object.fromEntries(NOTIF_CATS.map(([c, , , sys]) => [c, ['game', 'party', 'pause'].includes(c) ? (sys ? 'all' : 'app') : 'off'])); notifSet.notif = all; save({ notif: all }); for (const [s, c] of segs) drawSeg(s, c); } }, 'Nur das Wichtigste'),
    h('button.ghost', { onclick: () => { notifSet.notif = {}; save({ notif: {} }); for (const [s, c] of segs) drawSeg(s, c); } }, 'Standard')));
  const _ls = loadSettings;
  loadSettings = async function (...a) { const r = await _ls.apply(this, a); try { const s = await api.settings.get(); notifSet = { notif: s.notif || {}, notifDnd: s.notifDnd !== false, friendNotify: s.friendNotify, chatNotify: s.chatNotify }; dnd.checked = notifSet.notifDnd; for (const [sg, c] of segs) drawSeg(sg, c); } catch {} return r; };
});
// Kategorien nachrüsten, wo Meldungen schon gebaut werden (Schnell-Schalter in der Glocke)
safe('bell-notif', () => {
  const bell = $('#bellBtn'); if (!bell) return;
  bell.addEventListener('contextmenu', (e) => { e.preventDefault(); showView('settings'); setTimeout(() => showOptCat('notif'), 50); });
  bell.title = (bell.title || 'Benachrichtigungen') + ' – Rechtsklick: einstellen';
});

// ---------- Log-Fenster ----------
safe('logwin-btn', () => { const b = $('#logFile'); if (!b) return; b.textContent = 'Log-Fenster'; b.title = 'Minecraft-Logs aller Instanzen (mit Filter und Hinweisen)'; b.onclick = () => api.launchOpenLog(state.current || ''); });
api.v32.onGoto(({ view, profileId }) => {
  if (!profileId) return;
  if (view === 'detective') { openInstance(profileId, 'overview'); setTimeout(() => openBisect(profileId), 300); }
  else if (view === 'mods') openInstance(profileId, 'mods');
  else if (view === 'settings') openInstance(profileId, 'settings');
  else openInstance(profileId);
});
