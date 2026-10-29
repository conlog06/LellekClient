// LellekClient 2.7 – Stabilität (Fehlerschutz, Selbstheilung, Diagnose), Ordnung (Mods, Server, Profile)
// und neue Funktionen (Weiterspielen, Update-Center, Benachrichtigungen). Läuft nach v25.js.

const V27 = { notes: LS.get('notes', []), updates: null, metaReq: 0 };
const safe = (name, fn) => { try { return fn(); } catch (e) { api.app.logError(`${name}: ${e?.stack || e}`); } };

// =====================================================================
// Fehlerschutz: nichts geht still verloren, alles landet im Launcher-Protokoll
// =====================================================================
let errShown = 0;
function reportUiError(msg) {
  api.app.logError(String(msg).slice(0, 2000)).catch(() => {});
  if (Date.now() - errShown > 15000) { errShown = Date.now(); floatToast('Da ist etwas schiefgelaufen', 'Details stehen im Launcher-Protokoll (Optionen → Hilfe & Diagnose)', { err: true, icon: '⚠️', force: true }); }
}
window.addEventListener('error', (e) => reportUiError(`${e.message} @ ${e.filename?.split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => { const m = String(e.reason?.message || e.reason || ''); if (/Error invoking remote method/.test(m)) { api.app.logError('Unbehandelt: ' + m); return; } reportUiError('Unbehandelt: ' + (e.reason?.stack || m)); });
api.app.onError(({ message }) => floatToast('Fehler im Hintergrund', message, { err: true, icon: '⚠️' }));
api.app.onSelfheal(({ profile, fixed }) => floatToast(`Selbstheilung: ${profile}`, fixed.slice(0, 3).join(' · ') + (fixed.length > 3 ? ` · +${fixed.length - 3}` : ''), { icon: '🩹', ms: 8000, force: true }));
api.app.startupInfo().then(i => { if (i.recovered) floatToast('Einstellungen waren beschädigt', i.recovered === 'leer' ? 'Es gab keine lesbare Sicherung – die defekte Datei wurde aufgehoben.' : 'Sie wurden automatisch aus der letzten Sicherung wiederhergestellt.', { icon: '🛟', ms: 12000, force: true, err: i.recovered === 'leer' }); }).catch(() => {});

// =====================================================================
// Benachrichtigungen: Glocke oben rechts mit Verlauf
// =====================================================================
const bell = el('button', 'bell-btn'); bell.id = 'bellBtn'; bell.title = 'Benachrichtigungen';
bell.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
const bellBadge = el('i', 'rail-badge hidden'); bell.append(bellBadge);
$('#account').before(bell);
function saveNotes() { V27.notes = V27.notes.slice(-60); LS.set('notes', V27.notes); const n = V27.notes.filter(x => !x.read).length; bellBadge.textContent = n > 9 ? '9+' : String(n); bellBadge.classList.toggle('hidden', !n); }
saveNotes();
{
  const _ft = floatToast;
  floatToast = function (title, sub, opts = {}) {
    _ft(title, sub, opts);
    if (opts.noLog) return;
    V27.notes.push({ title: String(title).slice(0, 120), sub: String(sub || '').slice(0, 240), icon: opts.icon || (opts.err ? '⚠️' : 'ℹ️'), err: !!opts.err, at: Date.now(), read: false });
    saveNotes(); if ($('.note-panel')) renderNotes();
  };
}
function renderNotes() {
  let p = $('.note-panel'); if (!p) { p = el('div', 'note-panel'); document.body.append(p); }
  p.innerHTML = '';
  const h = el('div', 'note-head'); h.append(el('b', '', 'Benachrichtigungen'), btn('link-btn', 'Leeren', () => { V27.notes = []; saveNotes(); renderNotes(); })); p.append(h);
  if (!V27.notes.length) p.append(el('p', 'muted note-empty', 'Nichts Neues.'));
  for (const n of [...V27.notes].reverse()) { const r = el('div', 'note' + (n.read ? '' : ' unread') + (n.err ? ' err' : '')); r.append(el('span', 'ni', n.icon)); const t = el('div'); t.append(el('b', '', n.title)); if (n.sub) t.append(el('span', '', n.sub)); t.append(el('time', '', ago(n.at))); r.append(t); p.append(r); }
  const r = bell.getBoundingClientRect(); p.style.top = (r.bottom + 8) + 'px'; p.style.right = Math.max(8, innerWidth - r.right - 8) + 'px';
}
bell.onclick = (e) => {
  e.stopPropagation();
  if ($('.note-panel')) { $('.note-panel').remove(); return; }
  renderNotes(); setTimeout(() => { V27.notes.forEach(n => n.read = true); saveNotes(); }, 1200);
  const away = (ev) => { const pnl = $('.note-panel'); if (pnl && !pnl.contains(ev.target) && ev.target !== bell) { pnl.remove(); document.removeEventListener('mousedown', away); } };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
};

// =====================================================================
// Mods & Packs: Liste mit Namen, Symbol und Beschreibung, Suche, Filter, Werkzeug-Menü
// =====================================================================
safe('mods-toolbar', () => {
  const tools = btn('ghost', 'Werkzeuge ▾'); tools.id = 'modTools';
  const hideIds = ['checkConflicts', 'safeMode', 'contentFolder', 'modListCopy', 'diagnoseBtn'];
  tools.onclick = () => popMenu(tools, [
    { label: 'Konflikte prüfen', hint: 'doppelte Mods', run: () => $('#checkConflicts').click() },
    { label: 'Sicherer Start (ohne Mods)', run: () => $('#safeMode').click() },
    { label: 'Letzten Absturz analysieren', run: () => $('#diagnoseBtn').click() },
    { label: 'Mod-Liste kopieren', run: () => $('#modListCopy').click() },
    '-',
    { label: '🚀 Performance-Autopilot', run: () => openAutopilot(state.current) },
    { label: '⏪ Zeitmaschine', run: () => openTimeMachine(state.current) },
    { label: '🎒 Ausstattung', run: () => openBundle(currentProfile()) },
    { label: 'Ordner öffnen', run: () => $('#contentFolder').click() },
  ]);
  for (const id of hideIds) $('#' + id)?.classList.add('hidden-tool');
  $('#contentAdd').before(tools);
  const bar = el('div', 'mod-filter'); bar.id = 'modFilter';
  const q = el('input', 'input'); q.id = 'modSearch'; q.placeholder = 'Installierte durchsuchen …';
  const seg = el('div', 'seg'); seg.id = 'modSeg';
  for (const [k, t] of [['all', 'Alle'], ['on', 'Aktiv'], ['off', 'Aus'], ['upd', 'Updates']]) { const b = btn(k === 'all' ? 'active' : '', t, () => { $$('#modSeg button').forEach(x => x.classList.toggle('active', x === b)); V27.modFilter = k; filterMods(); }); b.dataset.f = k; seg.append(b); }
  const cnt = el('span', 'muted'); cnt.id = 'modCount';
  bar.append(q, seg, el('span', 'grow'), cnt); $('#contentList').before(bar);
  q.oninput = filterMods; V27.modFilter = 'all';
});
function filterMods() {
  const q = ($('#modSearch')?.value || '').trim().toLowerCase(), f = V27.modFilter || 'all';
  let shown = 0, total = 0;
  for (const li of $$('#contentList li')) {
    total++;
    const isOff = li.classList.contains('off'), hasUpd = !!li.querySelector('.updtag.upd');
    const ok = (!q || li.textContent.toLowerCase().includes(q)) && (f === 'all' || (f === 'on' && !isOff) || (f === 'off' && isOff) || (f === 'upd' && hasUpd));
    li.classList.toggle('hidden', !ok); if (ok) shown++;
  }
  const c = $('#modCount'); if (c) c.textContent = total ? (shown === total ? `${total} Einträge` : `${shown} von ${total}`) : '';
}
{
  const _li = loadInstalled;
  loadInstalled = async function (...a) {
    const r = await _li.apply(this, a);
    safe('mods-enhance', () => enhanceMods());
    $('#modFilter')?.classList.toggle('hidden', !$$('#contentList li').length);
    filterMods(); return r;
  };
  const _cu = checkUpdates;
  checkUpdates = async function (...a) { const r = await _cu.apply(this, a); filterMods(); return r; };
}
async function enhanceMods() {
  if (!state.current) return;
  const req = ++V27.metaReq, kind = state.kind;
  for (const li of $$('#contentList li')) {
    if (li.querySelector('.mod-ic')) continue;
    const ic = el('span', 'mod-ic'); ic.textContent = kind === 'mods' ? '🧩' : kind === 'shaderpacks' ? '🌅' : kind === 'resourcepacks' ? '🎨' : '📦';
    li.querySelector('.dot')?.after(ic);
    const acts = li.lastElementChild; acts?.querySelectorAll('button').forEach(b => b.classList.add('small'));
  }
  let meta = {}; try { meta = await api.contentMeta({ profileId: state.current, kind }); } catch { return; }
  if (req !== V27.metaReq || kind !== state.kind) return;
  for (const li of $$('#contentList li')) {
    const m = meta[li.dataset.file]; if (!m) continue;
    const ic = li.querySelector('.mod-ic'); if (m.icon && ic) { ic.textContent = ''; const img = el('img'); img.src = m.icon; img.alt = ''; img.loading = 'lazy'; ic.append(img); }
    const nb = li.querySelector('.name-btn'); if (nb && !li.querySelector('.mod-title')) {
      const file = nb.textContent; nb.textContent = ''; nb.append(el('b', 'mod-title', m.title)); nb.title = file;
      const sub = el('span', 'mod-sub', [m.version || '', file].filter(Boolean).join(' · ')); nb.after(sub);
      if (m.desc) li.title = m.desc;
    }
  }
  filterMods();
}

// =====================================================================
// Server hosten: in Reiter aufgeteilt
// =====================================================================
safe('server-tabs', () => {
  const view = $('.view[data-view="server"]'), layout = view.querySelector('.server-layout'), card = view.querySelector('.server-card');
  const tabs = el('div', 'seg srv-tabs'); const panes = {};
  const mk = (k, t) => { const b = btn('', t, () => showSrvTab(k)); b.dataset.t = k; tabs.append(b); };
  mk('main', 'Server & Konsole'); mk('props', 'Einstellungen'); mk('plugins', 'Plugins / Mods'); mk('ext', 'Freunde von außen');
  layout.before(tabs);
  panes.main = layout;
  const wrap = (k, nodes, empty) => { const d = el('div', 'srv-pane card hidden'); d.dataset.pane = k; if (empty) d.append(el('p', 'muted srv-empty', empty)); for (const n of nodes) if (n) d.append(n); layout.after(d); panes[k] = d; return d; };
  // „Freunde von außen“: Überschrift + alles danach aus der Server-Karte
  const extH = [...card.querySelectorAll('h3')].find(h => /Freunde von au/i.test(h.textContent));
  const ext = []; if (extH) { let n = extH; while (n) { const nx = n.nextElementSibling; ext.push(n); n = nx; } }
  wrap('ext', ext);
  wrap('plugins', [$('#pluginBox')], 'Plugins gibt es bei Paper, Server-Mods bei Fabric – unter „Server & Konsole“ die Server-Software wählen und einrichten.');
  wrap('props', [$('#serverPropsBox')], 'Die Einstellungen erscheinen, sobald der Server eingerichtet ist.');
  function showSrvTab(k) {
    LS.set('srvTab', k); $$('.srv-tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === k));
    for (const [key, pane] of Object.entries(panes)) pane.classList.toggle('hidden', key !== k);
    for (const pane of Object.values(panes)) { const e = pane.querySelector('.srv-empty'); if (e) { const inner = pane.querySelector('#pluginBox, #serverPropsBox'); e.classList.toggle('hidden', !!inner && !inner.classList.contains('hidden')); } }
  }
  window.showSrvTab = showSrvTab;
  showSrvTab(LS.get('srvTab', 'main'));
  const _rs = renderServer; renderServer = async function (...a) { const r = await _rs.apply(this, a); showSrvTab(LS.get('srvTab', 'main')); return r; };
});

// =====================================================================
// Profile: Anheften, Vorlagen einklappbar, Update-Center
// =====================================================================
const pinned = () => new Set(ui.pinned || []);
{
  const _rp = renderProfiles;
  renderProfiles = async function () {
    await _rp();
    safe('profiles-order', () => {
      // angeheftete Profile nach vorne
      const pc = $('#profileCards'), pins = pinned();
      const cards = [...pc.querySelectorAll('.pcard')];
      cards.forEach((c, i) => { const p = profileOfCard(c, i); if (p && pins.has(p.id)) { c.classList.add('pinned'); if (!c.querySelector('.pin-mark')) c.querySelector('.pcard-head b')?.prepend(el('span', 'pin-mark', '📌 ')); pc.prepend(c); } });
      // Vorlagen einklappen, sobald es eigene Profile gibt
      const h = [...$$('.view[data-view="profiles"] h3')].find(x => x.nextElementSibling?.id === 'presetList');
      if (h && !h.dataset.v27) {
        h.dataset.v27 = '1'; h.classList.add('fold-h');
        h.onclick = () => { const open = !LS.get('presetsOpen', !state.profiles.length); LS.set('presetsOpen', open); applyFold(); };
      }
      applyFold();
      // Update-Center-Knopf
      if (!$('#updCenterBtn')) { const b = btn('ghost', 'Mod-Updates', () => openUpdateCenter()); b.id = 'updCenterBtn'; $('#importMenuBtn')?.before(b); }
    });
  };
  function applyFold() { const h = $('.fold-h'); if (!h) return; const open = LS.get('presetsOpen', !state.profiles.length); h.classList.toggle('closed', !open); $('#presetList').classList.toggle('hidden', !open); }
}
// Karte ↔ Profil: die Karten werden in derselben Reihenfolge erzeugt wie die gefilterte Liste
function profileOfCard(card, i) {
  const name = card.querySelector('.pcard-head b')?.textContent.replace(/^📌\s*/, '');
  return state.profiles.find(p => p.name === name) || null;
}
{ // „Anheften“ ins Profil-Menü
  const _pm = popMenu;
  popMenu = function (anchor, items) {
    const card = anchor.closest?.('.pcard');
    if (card) {
      const p = profileOfCard(card); if (p) {
        const on = pinned().has(p.id);
        items = [{ label: on ? '📌 Lösen' : '📌 Anheften', run: () => { const s = pinned(); on ? s.delete(p.id) : s.add(p.id); setUi({ pinned: [...s] }); renderProfiles(); renderQuickTiles?.(); } }, ...items];
      }
    }
    return _pm(anchor, items);
  };
}
// Schnellstart-Kacheln auf der Startseite: angeheftete zuerst
{
  const _rq = typeof renderQuickTiles === 'function' ? renderQuickTiles : null;
  if (_rq) renderQuickTiles = function (...a) { const pins = pinned(); const keep = state.profiles; if (pins.size) state.profiles = [...keep.filter(p => pins.has(p.id)), ...keep.filter(p => !pins.has(p.id))]; try { return _rq.apply(this, a); } finally { state.profiles = keep; } };
}

// ---------- Update-Center ----------
async function openUpdateCenter(force) {
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(el('h2', '', 'Mod-Updates – alle Profile'), el('p', 'muted', 'Prüft jedes Mod-Profil bei Modrinth und CurseForge. Vor dem Aktualisieren sichert die Zeitmaschine den alten Stand.'));
  const box = el('div', 'upd-list'); box.append(el('p', 'muted', 'Prüfe …')); body.append(box);
  const all = btn('primary', 'Alle aktualisieren'); all.disabled = true;
  foot.append(btn('ghost', 'Neu prüfen', () => { close(); openUpdateCenter(true); }), btn('ghost', 'Schließen', close), all);
  let res; try { res = await api.updatesAll.check(!!force); } catch (e) { box.innerHTML = ''; box.append(el('p', 'danger', e.message)); return; }
  V27.updates = res; updateChip();
  box.innerHTML = '';
  if (!res.length) box.append(el('p', 'muted', 'Keine Mod-Profile vorhanden.'));
  const rows = [];
  for (const r of res) {
    const row = el('div', 'upd-row'); const t = el('div', 'grow'); t.append(el('b', '', r.name), el('span', 'muted', ` ${r.version}`));
    if (r.updates.length) { const l = el('div', 'upd-files'); for (const u of r.updates.slice(0, 6)) l.append(el('span', 'pill acc', u.newFile.replace(/\.jar$/, ''))); if (r.updates.length > 6) l.append(el('span', 'pill', `+${r.updates.length - 6}`)); t.append(l); }
    const st = r.error ? el('span', 'pill bad', 'Fehler') : r.updates.length ? el('span', 'pill warn', `${r.updates.length} Update${r.updates.length === 1 ? '' : 's'}`) : el('span', 'pill ok', 'aktuell');
    row.append(t, st);
    if (r.updates.length) { const b = btn('ghost', 'Aktualisieren', async () => { b.disabled = true; b.textContent = '…'; try { const x = await api.updatesAll.apply(r.profileId); st.className = 'pill ok'; st.textContent = `${x.ok} aktualisiert${x.fail ? `, ${x.fail} fehlgeschlagen` : ''}`; b.remove(); r.updates = []; updateChip(); } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Aktualisieren'; } }); row.append(b); rows.push(b); }
    box.append(row);
  }
  all.disabled = !rows.length; all.onclick = async () => { all.disabled = true; for (const b of rows) if (b.isConnected && !b.disabled) await b.onclick(); toast('Alle Profile aktualisiert'); };
}
function updateChip() {
  const n = (V27.updates || []).reduce((a, r) => a + r.updates.length, 0);
  let c = $('#modUpdChip'); if (!c) { c = el('button', 'upd-chip hidden'); c.id = 'modUpdChip'; c.onclick = () => openUpdateCenter(); $('#paletteBtn').before(c); }
  c.textContent = `${n} Mod-Update${n === 1 ? '' : 's'}`; c.classList.toggle('hidden', !n);
}
// einmal pro Tag im Hintergrund nachsehen
setTimeout(async () => {
  if (Date.now() - LS.get('updCheckAt', 0) < 20 * 3600000) return;
  try { const r = await api.updatesAll.check(false); LS.set('updCheckAt', Date.now()); V27.updates = r; updateChip(); const n = r.reduce((a, x) => a + x.updates.length, 0); if (n) floatToast(`${n} Mod-Updates verfügbar`, r.filter(x => x.updates.length).map(x => x.name).join(', '), { icon: '⬆️', action: ['Ansehen', () => openUpdateCenter()] }); } catch {}
}, 20000);

// =====================================================================
// Startseite: Weiterspielen
// =====================================================================
safe('continue-card', () => { const c = el('div', 'dash-card hidden'); c.id = 'homeContinue'; $('#homeLevel').after(c); });
async function renderContinue() {
  const box = $('#homeContinue'); if (!box) return;
  let list = []; try { list = await api.cont.list(); } catch {}
  box.classList.toggle('hidden', !list.length); box.innerHTML = ''; if (!list.length) return;
  const h = el('h4'); h.append(el('span', '', 'Weiterspielen')); box.append(h);
  for (const it of list.slice(0, 4)) {
    const r = el('div', 'mini-row cont-row'); r.title = it.type === 'world' && !it.direct ? `${it.profileName} starten (Welt im Menü öffnen – direktes Laden ab 1.20)` : `${it.type === 'world' ? 'Welt' : 'Server'} direkt starten`;
    r.append(el('span', 'cont-ic', it.type === 'world' ? '🌍' : '🖧'));
    const t = el('div', 'grow'); t.append(el('b', '', it.name), el('span', 'muted', `${it.profileName} · ${ago(it.at)}`)); r.append(t, el('span', 'cont-go', '▶'));
    r.onclick = () => launchProfile(it.profileId, it.type === 'world' && !it.direct ? undefined : it.target);
    box.append(r);
  }
}
{ const _rh = renderHome; renderHome = async function (...a) { const r = await _rh.apply(this, a); renderContinue(); return r; }; }

// =====================================================================
// Optionen: Hilfe & Diagnose
// =====================================================================
safe('diag-section', () => {
  const nav = el('button', '', 'Hilfe & Diagnose'); nav.dataset.cat = 'diag'; $('#optNav').append(nav);
  nav.onclick = () => { $('#optSearch').value = ''; filterOpts(); showOptCat('diag'); };
  const sec = el('section', 'opt-sec'); sec.dataset.cat = 'diag';
  sec.append(el('h3', '', 'Hilfe & Diagnose'));
  const row = (title, sub, button) => { const r = el('div', 'opt-row'); const d = el('div'); d.append(el('b', '', title), el('span', '', sub)); r.append(d, button); return r; };
  sec.append(row('Diagnose starten', 'Prüft Internet, Konto, Java, Speicher und jedes Profil – mit Reparatur auf Knopfdruck', btn('primary', 'Prüfen', () => runDiag())));
  sec.append(row('Fehlerbericht kopieren', 'System, Profile und die letzten Protokollzeilen – zum Weiterschicken', btn('ghost', 'Kopieren', async () => { try { await api.diag.report(); toast('Fehlerbericht in der Zwischenablage'); } catch (e) { toast(e.message, true); } })));
  sec.append(row('Launcher-Protokoll', 'Alle Fehler und Selbstheilungen des Launchers', btn('ghost', 'Öffnen', () => api.app.openLauncherLog())));
  sec.append(row('Spieldateien neu laden', 'Entfernt Minecraft-Client-Dateien – sie werden beim nächsten Start frisch geladen', btn('ghost', 'Neu laden', async () => { if (!confirm('Minecraft-Spieldateien aller Versionen neu laden? Welten und Mods bleiben.')) return; try { toast(await api.diag.repair('gamefiles')); } catch (e) { toast(e.message, true); } })));
  const out = el('div', 'diag-out'); out.id = 'diagOut'; sec.append(out);
  $('#optEmpty').before(sec);
});
async function runDiag() {
  const out = $('#diagOut'); out.innerHTML = ''; out.append(el('p', 'muted', 'Prüfe … (der Freunde-Server kann bis zu einer Minute zum Aufwachen brauchen)'));
  let d; try { d = await api.diag.run(); } catch (e) { out.innerHTML = ''; out.append(el('p', 'danger', e.message)); return; }
  out.innerHTML = '';
  const sum = el('div', 'diag-sum'); sum.append(el('span', 'pill ok', `${d.summary.ok} in Ordnung`)); if (d.summary.warn) sum.append(el('span', 'pill warn', `${d.summary.warn} Hinweise`)); if (d.summary.bad) sum.append(el('span', 'pill bad', `${d.summary.bad} Probleme`)); out.append(sum);
  let group = '';
  for (const c of d.checks) {
    if (c.group !== group) { group = c.group; out.append(el('h3', '', group)); }
    const r = el('div', 'diag-row ' + c.status); r.append(el('span', 'diag-dot'));
    const t = el('div', 'grow'); t.append(el('b', '', c.name), el('span', '', c.detail)); r.append(t);
    if (c.fix) r.append(btn(c.status === 'bad' ? 'primary small' : 'ghost small', c.fix === 'log' ? 'Protokoll' : 'Reparieren', async (e) => { e.target.disabled = true; try { toast(await api.diag.repair(c.fix)); runDiag(); } catch (err) { toast(err.message, true); e.target.disabled = false; } }));
    out.append(r);
  }
}

// =====================================================================
// Befehlspalette
// =====================================================================
{
  const _pi = paletteItems;
  paletteItems = function () {
    const items = _pi();
    items.push({ group: 'Aktion', label: 'Mod-Updates für alle Profile', hint: 'Update-Center', run: () => openUpdateCenter() });
    items.push({ group: 'Aktion', label: 'Diagnose starten', hint: 'Hilfe & Diagnose', run: () => { showView('settings'); showOptCat('diag'); setTimeout(runDiag, 200); } });
    items.push({ group: 'Aktion', label: 'Fehlerbericht kopieren', hint: '', run: () => api.diag.report().then(() => toast('Fehlerbericht kopiert')) });
    return items;
  };
}

// Startseite beim Laden einmal mit „Weiterspielen“ füllen
setTimeout(() => { if (state.view === 'play') renderContinue(); }, 800);
