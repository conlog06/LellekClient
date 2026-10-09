// LellekClient 2.5 – neue Oberfläche (Seitenleiste, Optionen, Startseite, schwebende Hinweise)
// und neue Funktionen: Party, Chat, Profil-Codes, Zeitmaschine, Session-Rückblick, Level & Erfolge,
// Server-Radar, Performance-Autopilot. Läuft nach app.js, features.js und features2.js.

const V25 = { radar: {}, radarAt: 0, party: null, ach: null, chatWith: null, pollT: null, countdownT: null };
const LS = { get(k, d) { try { const v = localStorage.getItem('lellek.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('lellek.' + k, JSON.stringify(v)); } catch {} } };
const esc = (t) => String(t ?? '');
const timeShort = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (t) => { const d = new Date(t), n = new Date(); const y = new Date(); y.setDate(n.getDate() - 1); return d.toDateString() === n.toDateString() ? 'Heute' : d.toDateString() === y.toDateString() ? 'Gestern' : d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }); };

// =====================================================================
// Navigation: Titel, Reihenfolge, Kürzel, eingeklappte Leiste
// =====================================================================
const VIEW_META = {
  play: ['Startseite', ''], profiles: ['Profile', 'Instanzen mit eigenen Mods, Welten und Einstellungen'], content: ['Mods & Packs', 'Installieren, aktualisieren, Sets und Konflikte'],
  worlds: ['Welten', 'Welten, Backups und Screenshots'], skins: ['Skins', 'Bibliothek mit 3D-Vorschau'], friends: ['Freunde', 'Status, Anfragen und Chat'],
  party: ['Party', 'Gemeinsam starten – gleiche Mods, gleicher Server'], radar: ['Server-Radar', 'Ping, Spieler und Freunde auf deinen Servern'],
  stats: ['Statistik & Erfolge', 'Level, Erfolge und Spielzeit'], server: ['Server hosten', 'Vanilla, Paper oder Fabric auf deinem PC'], design: ['Design', 'Farben, Hintergrund, Skin-Animation'], settings: ['Optionen', ''],
};
const VIEW_GROUP = { profiles: 'Bibliothek', content: 'Bibliothek', worlds: 'Bibliothek', skins: 'Bibliothek', friends: 'Community', party: 'Community', radar: 'Community', stats: 'Fortschritt', server: 'Werkzeuge', design: 'Werkzeuge', settings: 'Einstellungen' };
VIEWS.splice(0, VIEWS.length, ['play', 'Startseite'], ['profiles', 'Profile'], ['content', 'Mods & Packs'], ['worlds', 'Welten'], ['skins', 'Skins'], ['friends', 'Freunde'], ['party', 'Party'], ['radar', 'Server-Radar'], ['stats', 'Statistik & Erfolge'], ['server', 'Server hosten'], ['design', 'Design'], ['settings', 'Optionen']);
{
  const _sv = showView;
  showView = function (view) {
    const prev = state.view;
    _sv(view);
    const m = VIEW_META[view] || [view, '']; const g = VIEW_GROUP[view];
    $('#viewTitle').textContent = view === 'play' ? (state.account?.name ? `Willkommen zurück, ${state.account.name}` : 'Willkommen bei LellekClient') : m[0];
    $('#viewSub').textContent = view === 'play' ? '' : g || ''; $('.crumb').classList.toggle('sub', view !== 'play');
    if (typeof viewer !== 'undefined' && viewer) viewer.renderPaused = view !== 'play';
    if (prev === 'friends' && view !== 'friends') api.chat.close();
    if (view === 'play') renderHome();
    if (view === 'radar') renderRadar(true);
    if (view === 'party') renderParty(true);
    if (view === 'friends' && ftab === 'chat') renderChat();
    startFastPoll();
  };
}
// Strg+1–9 folgt der neuen Reihenfolge (die alte Belegung in features.js liest VIEWS); Strg+0 = Optionen
$('.palette-hint').textContent = '↑ ↓ auswählen · Enter ausführen · Esc schließen · Strg+Enter spielt · Strg+1–9 / 0 wechselt die Ansicht';
function setSideMini(on, save = true) { document.body.classList.toggle('side-mini', on); if (save) LS.set('sideMini', on); }
$('#sideCollapse').onclick = () => setSideMini(!document.body.classList.contains('side-mini'));
setSideMini(LS.get('sideMini', innerWidth < 1100), false);
document.addEventListener('visibilitychange', () => { if (typeof viewer !== 'undefined' && viewer) viewer.renderPaused = document.hidden || state.view !== 'play'; });

// =====================================================================
// Schwebende Hinweise (zusätzlich zur Statuszeile)
// =====================================================================
const toastBox = el('div', 'toasts'); document.body.append(toastBox);
let lastToast = { t: '', at: 0 };
function floatToast(title, sub, opts = {}) {
  if (!opts.force && title === lastToast.t && Date.now() - lastToast.at < 2500) return;
  lastToast = { t: title, at: Date.now() };
  const t = el('div', 'toast' + (opts.err ? ' err' : '') + (opts.cls ? ' ' + opts.cls : ''));
  if (opts.icon) t.append(el('span', 'ti', opts.icon));
  const b = el('div'); b.append(el('b', '', title)); if (sub) b.append(el('span', '', sub)); t.append(b);
  if (opts.action) { const a = el('button', 'ghost small', opts.action[0]); a.onclick = () => { opts.action[1](); close(); }; t.append(a); }
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 220); };
  t.onclick = (e) => { if (e.target.tagName !== 'BUTTON') close(); };
  toastBox.append(t); while (toastBox.children.length > 4) toastBox.firstChild.remove();
  setTimeout(close, opts.ms || (opts.err ? 7000 : 3800));
}
{
  const _toast = toast;
  toast = function (msg, isError) {
    msg = String(msg || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^TypeError: fetch failed$/, 'Keine Verbindung – Internet prüfen und gleich nochmal versuchen');
    _toast(msg, isError);
    const m = msg;
    if (!m || /\d+\s?%|^Bereit$|^Lade |^Starte |…$|Optionen gespeichert/.test(m)) return; // Fortschritt bleibt in der Statuszeile
    floatToast(m, '', { err: !!isError });
  };
}

// =====================================================================
// Leistungsmodus & Design-Hooks
// =====================================================================
{
  const _au = applyUi;
  applyUi = function () { _au(); document.body.classList.toggle('perf', !!ui.perf); if (ui.perf && typeof viewer !== 'undefined' && viewer) { viewer.animation = null; viewer.autoRotate = false; } };
}

// =====================================================================
// Optionen: Kategorien, Suche, automatisches Speichern
// =====================================================================
let optCat = LS.get('optCat', 'general');
function showOptCat(cat) {
  optCat = cat; LS.set('optCat', cat);
  $$('#optNav button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  if (!$('#optSearch').value.trim()) $$('.opt-sec').forEach(s => s.classList.toggle('show', s.dataset.cat === cat));
}
$$('#optNav button').forEach(b => b.onclick = () => { $('#optSearch').value = ''; filterOpts(); showOptCat(b.dataset.cat); });
function filterOpts() {
  const q = $('#optSearch').value.trim().toLowerCase(), form = $('#settingsForm');
  form.classList.toggle('searching', !!q);
  let any = false;
  for (const sec of $$('.opt-sec')) {
    let hit = false;
    for (const row of sec.querySelectorAll('.opt-row, .opt-col, details')) { const ok = !q || row.textContent.toLowerCase().includes(q); row.classList.toggle('hidden', !ok); row.classList.toggle('hit', !!q && ok); if (ok) hit = true; }
    for (const h of sec.querySelectorAll('h3, p, .row')) if (!h.closest('.opt-row')) h.classList.toggle('hidden', !!q && !h.textContent.toLowerCase().includes(q) && !h.querySelector('input'));
    sec.classList.toggle('show', q ? hit : sec.dataset.cat === optCat); if (q && hit) any = true;
  }
  $('#optEmpty').classList.toggle('hidden', !q || any);
}
$('#optSearch').oninput = filterOpts;
showOptCat(optCat);
let optT = null;
$('#settingsForm').addEventListener('change', (e) => {
  if (!e.target.name) return; // Felder ohne Namen speichern selbst
  clearTimeout(optT); optT = setTimeout(() => $('#settingsForm').requestSubmit(), 250);
});
function flashSaved() { const s = $('#optSaved'); s.textContent = '✓ Gespeichert'; s.classList.add('on'); clearTimeout(s._t); s._t = setTimeout(() => s.classList.remove('on'), 1600); }
$('#settingsForm').addEventListener('submit', flashSaved);
{
  const _ls = loadSettings;
  loadSettings = async function (...a) {
    const r = await _ls.apply(this, a); const s = await api.settings.get();
    $('#optRecap').checked = s.sessionRecap !== false; $('#optChatNotify').checked = s.chatNotify !== false; $('#optPerf').checked = !!ui.perf;
    renderBadgeSelect();
    return r;
  };
}
$('#optRecap').onchange = (e) => api.settings.save({ sessionRecap: e.target.checked }).then(flashSaved);
$('#optChatNotify').onchange = (e) => api.settings.save({ chatNotify: e.target.checked }).then(flashSaved);
$('#optPerf').onchange = (e) => { setUi({ perf: e.target.checked }); toast(e.target.checked ? 'Leistungsmodus an – keine Animationen und Effekte' : 'Leistungsmodus aus'); };
$('#perfOpen').onclick = () => openAutopilot(state.current);
async function renderBadgeSelect() {
  const sel = $('#optBadge'); let a; try { a = await api.ach.get(); } catch { return; }
  sel.innerHTML = ''; sel.add(new Option('Kein Abzeichen', ''));
  for (const x of a.list.filter(x => x.at)) { const o = new Option(`${x.icon} ${x.title}`, x.id); if (a.badge === `${x.icon} ${x.title}`) o.selected = true; sel.add(o); }
  if (sel.options.length === 1) sel.options[0].text = 'Noch keine Erfolge freigeschaltet';
}
$('#optBadge').onchange = async (e) => { const b = await api.ach.setBadge(e.target.value || null); toast(b ? `Abzeichen „${b}“ – sehen deine Freunde` : 'Abzeichen entfernt'); };

// =====================================================================
// Allgemeine Bausteine: Popup-Menü, Dialog
// =====================================================================
let openMenu = null;
function popMenu(anchor, items) {
  closeMenu();
  const m = el('div', 'pop-menu'); m.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === '-') { m.append(el('hr')); continue; }
    const b = el('button', 'pop-item' + (it.danger ? ' danger' : ''), it.label); b.type = 'button'; if (it.hint) b.append(el('span', '', it.hint));
    b.onclick = () => { closeMenu(); it.run(); }; m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(); const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(innerWidth - w - 8, Math.max(8, r.right - w)) + 'px';
  m.style.top = (r.bottom + h + 6 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  openMenu = m; setTimeout(() => document.addEventListener('mousedown', menuAway), 0);
}
function menuAway(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('mousedown', menuAway); } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
/** Mehrzweck-Dialog: liefert {d, body, foot, close} */
function v25Dialog(cls = '') {
  let d = $('#v25Dialog'); if (!d) { d = el('dialog'); d.id = 'v25Dialog'; document.body.append(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  if (d.open) d.close();
  d.className = cls; d.innerHTML = ''; const body = el('div', 'dlg-body'), foot = el('div', 'row end gap');
  d.append(body, foot); d.showModal();
  return { d, body, foot, close: () => d.close() };
}
const btn = (cls, text, fn) => { const b = el('button', cls, text); b.type = 'button'; if (fn) b.onclick = fn; return b; };

// =====================================================================
// Profile: aufgeräumte Karten mit Menü, Import per Code
// =====================================================================
{
  const _rp = renderProfiles;
  renderProfiles = async function () {
    await _rp();
    const pc = $('#profileCards'); pc.innerHTML = '';
    const q = ($('#profileSearch').value || '').toLowerCase(), sort = $('#profileSort').value;
    const list = state.profiles.filter(p => !q || p.name.toLowerCase().includes(q) || p.version.includes(q)).sort((a, b) => sort === 'played' ? (b.lastPlayed || 0) - (a.lastPlayed || 0) : sort === 'time' ? (b.playtimeMs || 0) - (a.playtimeMs || 0) : a.name.localeCompare(b.name));
    if (!state.profiles.length) { const e = el('div', 'empty-state'); e.append(el('span', 'big', '🧱'), el('b', '', 'Noch keine Profile'), el('span', '', 'Nimm oben eine Vorlage, leg ein eigenes an oder füge einen Profil-Code von einem Freund ein.')); pc.append(e); return; }
    for (const p of list) {
      const run = runningSet.has(p.id), cur = p.id === state.current;
      const c = el('div', 'card pcard' + (cur ? ' active' : '')); if (p.color) c.style.setProperty('--pc', p.color);
      const head = el('div', 'pcard-head');
      const ic = el('div', 'pcard-ic', p.icon || (p.loader ? { fabric: '🧵', forge: '⚒️', neoforge: '🦊' }[p.loader] || '📦' : '🟩'));
      const t = el('div', 'grow'); const nm = el('b', '', p.name); t.append(nm);
      const meta = el('div', 'pcard-meta'); meta.append(el('span', 'pill', p.version), el('span', 'pill', p.loader ? LOADER_NAMES[p.loader] || p.loader : 'Vanilla'), el('span', 'pill', `${p.memory || 4} GB`)); if (run) meta.append(el('span', 'pill ok', '● läuft')); if (p.accountId) meta.append(el('span', 'pill', 'eigenes Konto'));
      t.append(meta); head.append(ic, t);
      const pm = Math.round((p.playtimeMs || 0) / 60000);
      const stat = el('span', 'stat', `${pm >= 60 ? Math.floor(pm / 60) + ' h ' : ''}${pm % 60} min gespielt${p.lastPlayed ? ' · zuletzt ' + new Date(p.lastPlayed).toLocaleDateString('de-DE') : ''}`);
      const act = el('div', 'actions');
      const start = btn('primary', run ? 'Log' : 'Starten', async () => { if (run) { api.launchOpenLog(p.id); return; } start.disabled = true; await launchProfile(p.id); renderProfiles(); });
      const use = btn(cur ? 'ghost on' : 'ghost', cur ? '✓ Aktiv' : 'Auswählen', () => { state.current = p.id; renderLaunch(); renderProfiles(); });
      const edit = btn('ghost', 'Bearbeiten', () => openProfileDialog(p));
      const more = btn('ghost icon-btn', '⋯'); more.title = 'Mehr';
      more.onclick = () => popMenu(more, [
        { label: '🚀 Performance-Autopilot', run: () => openAutopilot(p.id) },
        { label: '⏪ Zeitmaschine', run: () => openTimeMachine(p.id) },
        { label: '🔗 Als Code teilen', run: () => openShareCreate(p.id) },
        { label: '🥳 Mit Party spielen', run: () => { showView('party'); setTimeout(() => partyPlanWith(p.id), 300); } },
        '-',
        { label: 'Ausstattung', run: () => openBundle(p) },
        { label: 'Duplizieren', run: async () => { try { state.profiles = await api.profiles.duplicate(p.id); renderProfiles(); renderLaunch(); toast('Profil kopiert'); } catch (e) { toast(e.message, true); } } },
        { label: 'Exportieren', run: () => exportProfile(p) },
        ...(/Mac/.test(navigator.userAgent) ? [] : [{ label: 'Desktop-Verknüpfung', run: () => createShortcut(p.id) }]),
        { label: 'Ordner öffnen', run: () => api.profiles.openFolder(p.id) },
      ]);
      act.append(start, use, edit, more);
      c.append(head, stat, act); pc.append(c);
    }
  };
}
{ // Import-Knöpfe bündeln
  const imp = btn('ghost', 'Importieren ▾'); imp.id = 'importMenuBtn';
  imp.onclick = () => popMenu(imp, [
    { label: '🔗 Profil-Code einfügen', hint: 'LC1-…', run: () => openShareImport() },
    { label: 'Profil / .mrpack-Datei', run: () => $('#importProfile').click() },
    { label: 'Aus anderem Launcher', hint: 'Prism, CurseForge, Lunar …', run: () => $('#importOther').click() },
  ]);
  $('#importOther').classList.add('hidden'); $('#importProfile').classList.add('hidden'); $('#newProfile').before(imp);
}

// =====================================================================
// Profil-Codes
// =====================================================================
async function openShareCreate(profileId) {
  const p = state.profiles.find(x => x.id === profileId); if (!p) return;
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(el('h2', '', `„${p.name}“ teilen`), el('p', 'muted', 'Erstelle den Code … Mods, Resourcepacks und Shader werden mit Modrinth abgeglichen.'));
  foot.append(btn('ghost', 'Schließen', close));
  try {
    const r = await api.share.create(profileId);
    body.innerHTML = ''; body.append(el('h2', '', `„${p.name}“ teilen`));
    body.append(el('p', 'muted', `Wer diesen Code in LellekClient einfügt (Profile → Importieren → Profil-Code), bekommt dasselbe Profil: ${r.version}${r.loader ? ' ' + (LOADER_NAMES[r.loader] || r.loader) : ''} mit ${r.matched} Dateien.`));
    const ta = el('textarea', 'input code-box'); ta.readOnly = true; ta.value = r.code; body.append(ta);
    if (r.missing.length) { const w = el('p', 'muted small-note', `Nicht dabei (nicht auf Modrinth): ${r.missing.slice(0, 8).join(', ')}${r.missing.length > 8 ? ` und ${r.missing.length - 8} weitere` : ''}. Diese Dateien muss dein Freund selbst hinzufügen.`); body.append(w); }
    foot.innerHTML = '';
    foot.append(btn('ghost', 'Schließen', close), btn('ghost', 'An Freund schicken …', () => { close(); pickFriend('Profil an wen schicken?', (f) => chatSendProfile(f.uuid, profileId)); }), btn('primary', 'Code kopieren', () => { navigator.clipboard.writeText(r.code); toast('Code kopiert – einfach an Freunde schicken'); }));
    ta.focus(); ta.select();
  } catch (e) { body.append(el('p', 'danger', e.message)); }
}
async function openShareImport(code) {
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(el('h2', '', 'Profil-Code einfügen'), el('p', 'muted', 'Ein Freund hat dir einen Code geschickt (beginnt mit „LC1-“)? Einfügen – LellekClient richtet dasselbe Profil mit allen Mods ein.'));
  const ta = el('textarea', 'input code-box'); ta.placeholder = 'LC1-…'; ta.value = code || ''; body.append(ta);
  const prev = el('div'); body.append(prev);
  const go = btn('primary', 'Vorschau', () => preview()); go.disabled = !code;
  foot.append(btn('ghost', 'Abbrechen', close), go);
  ta.oninput = () => { go.disabled = !ta.value.trim(); go.textContent = 'Vorschau'; go.onclick = preview; };
  async function preview() {
    go.disabled = true; prev.innerHTML = ''; prev.append(el('p', 'muted', 'Lade Vorschau …'));
    try {
      const v = await api.share.preview(ta.value.trim());
      prev.innerHTML = '';
      const h = el('div', 'row gap'); h.append(el('b', '', `${v.icon ? v.icon + ' ' : ''}${v.name}`), el('span', 'pill', v.version), el('span', 'pill', v.loader ? LOADER_NAMES[v.loader] || v.loader : 'Vanilla'), el('span', 'pill', `${v.items.length} Dateien · ${fmtSize(v.size || 1)}`)); prev.append(h);
      const list = el('div', 'share-items'); for (const it of v.items) { const r = el('div', 'share-item'); if (it.icon) { const i = el('img'); i.src = it.icon; i.alt = ''; r.append(i); } else r.append(el('i')); r.append(el('span', '', `${it.title}${it.kind !== 'mods' ? ' (' + (it.kind === 'resourcepacks' ? 'Resourcepack' : 'Shader') + ')' : ''}`)); list.append(r); } prev.append(list);
      if (v.existing) prev.append(el('p', 'muted small-note', `Schon eingerichtet als „${v.existing.name}“ – ein neuer Import legt eine Kopie an.`));
      const nameIn = el('input', 'input'); nameIn.value = v.name; const lab = el('label', 'form-label', 'Name des neuen Profils'); lab.append(nameIn); prev.append(lab);
      go.disabled = false; go.textContent = 'Profil einrichten';
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'Wird eingerichtet …';
        try { const r = await api.share.import({ code: ta.value.trim(), name: nameIn.value.trim() || v.name }); close(); state.profiles = r.profiles; state.current = r.id; renderLaunch(); if (state.view === 'profiles') renderProfiles(); toast(`„${r.name}“ ist bereit${r.failed ? ` – ${r.failed} Dateien fehlen (siehe Log)` : ''}`, !!r.failed); await loadProfiles(); }
        catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Erneut versuchen'; }
      };
    } catch (e) { prev.innerHTML = ''; prev.append(el('p', 'danger', e.message)); go.disabled = false; }
  }
  if (code) preview(); else ta.focus();
}

// =====================================================================
// Zeitmaschine
// =====================================================================
async function openTimeMachine(profileId) {
  const p = state.profiles.find(x => x.id === profileId); if (!p) return;
  const { body, foot, close } = v25Dialog('wide-dlg');
  const render = async () => {
    body.innerHTML = ''; body.append(el('h2', '', `Zeitmaschine – ${p.name}`), el('p', 'muted', 'LellekClient sichert Mods und Configs automatisch vor jedem Start, Update und jeder Installation. Mit einem Klick zurück auf einen früheren Stand – nichts geht verloren.'));
    let d; try { d = await api.tm.list(profileId); } catch (e) { body.append(el('p', 'danger', e.message)); return; }
    if (d.pending) { const b = el('div', 'banner'); b.append(el('span', 'grow', `Ungesicherte Änderungen seit dem letzten Stand: ${diffText(d.pending)}`), btn('ghost small', 'Jetzt sichern', async () => { await api.tm.snapshot({ profileId }); render(); })); body.append(b); }
    if (!d.snaps.length) { const e = el('div', 'empty-state'); e.append(el('span', 'big', '⏪'), el('b', '', 'Noch keine Schnappschüsse'), el('span', '', 'Der erste entsteht beim nächsten Spielstart – oder jetzt von Hand.')); body.append(e); }
    const list = el('div', 'tm-list');
    for (const s of d.snaps) {
      const it = el('div', 'tm-item'); const info = el('div');
      info.append(el('b', '', s.reason), el('div', 'd', `${fmtDate(s.at)} · ${s.mods} Mods`));
      const chg = el('div', 'chg'); const df = s.diff;
      if (s.first) chg.append(el('span', 'pill', 'erster Stand'));
      for (const n of df.added.slice(0, 4)) chg.append(el('span', 'pill ok', '+ ' + n.replace(/\.jar$/, '')));
      for (const n of df.removed.slice(0, 4)) chg.append(el('span', 'pill bad', '− ' + n.replace(/\.jar$/, '')));
      for (const n of df.changed.slice(0, 3)) chg.append(el('span', 'pill acc', '↻ ' + n.replace(/\.jar$/, '')));
      for (const n of df.disabled.slice(0, 3)) chg.append(el('span', 'pill', '⏸ ' + n.replace(/\.jar$/, '')));
      const more = df.added.length + df.removed.length + df.changed.length + df.disabled.length - Math.min(4, df.added.length) - Math.min(4, df.removed.length) - Math.min(3, df.changed.length) - Math.min(3, df.disabled.length);
      if (more > 0) chg.append(el('span', 'pill', `+${more} weitere`)); if (df.config && !s.first) chg.append(el('span', 'pill', `${df.config} Config-Dateien`));
      info.append(chg);
      const acts = el('div', 'actions');
      acts.append(btn('ghost', 'Zurück auf diesen Stand', async (e) => {
        if (!confirm(`„${p.name}“ auf den Stand vom ${fmtDate(s.at)} zurücksetzen? Der aktuelle Stand wird vorher gesichert.`)) return;
        e.target.disabled = true; try { const r = await api.tm.restore({ profileId, id: s.id }); toast(`Zurückgesetzt – ${r.written} Dateien wiederhergestellt, ${r.removed} entfernt${r.missing ? `, ${r.missing} fehlen` : ''}`); render(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
      }));
      acts.append(btn('ghost icon-btn', '✕', async () => { if (confirm('Diesen Schnappschuss löschen?')) { await api.tm.remove({ profileId, id: s.id }); render(); } }));
      it.append(el('span', 'dot'), info, acts); list.append(it);
    }
    body.append(list);
    body.append(el('p', 'muted small-note', `Speicher der Zeitmaschine (alle Profile): ${fmtSize(d.size || 0)} · gleiche Dateien werden nur einmal gespeichert · je Profil bleiben ${20} Stände`));
  };
  foot.append(btn('ghost', 'Schließen', close), btn('primary', 'Jetzt sichern', async () => { const ok = await api.tm.snapshot({ profileId }); toast(ok ? 'Stand gesichert' : 'Nichts zu sichern'); render(); }));
  render();
}
function diffText(d) { const parts = []; if (d.added.length) parts.push(`${d.added.length} neu`); if (d.removed.length) parts.push(`${d.removed.length} entfernt`); if (d.changed.length) parts.push(`${d.changed.length} geändert`); if (d.disabled.length) parts.push(`${d.disabled.length} deaktiviert`); if (d.enabled.length) parts.push(`${d.enabled.length} aktiviert`); if (d.config) parts.push(`${d.config} Configs`); return parts.join(', ') || 'kleine Änderungen'; }

// =====================================================================
// Performance-Autopilot
// =====================================================================
async function openAutopilot(profileId) {
  const p = state.profiles.find(x => x.id === (profileId || state.current)); if (!p) { toast('Erst ein Profil wählen', true); return; }
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(el('h2', '', '🚀 Performance-Autopilot'));
  const sel = el('select', 'select'); for (const x of state.profiles) sel.add(new Option(`${x.name} (${x.version}${x.loader ? ' ' + (LOADER_NAMES[x.loader] || x.loader) : ''})`, x.id)); sel.value = p.id;
  const top = el('div', 'row gap'); top.append(el('span', 'muted', 'Profil'), sel); body.append(top);
  const box = el('div'); body.append(box);
  const apply = btn('primary', 'Alles anwenden'); apply.disabled = true;
  foot.append(btn('ghost', 'Abbrechen', close), apply);
  const load = async () => {
    box.innerHTML = ''; box.append(el('p', 'muted', 'Analysiere PC und Profil, suche passende Mods …')); apply.disabled = true;
    let plan; try { plan = await api.perf.plan(sel.value); } catch (e) { box.innerHTML = ''; box.append(el('p', 'danger', e.message)); return; }
    box.innerHTML = '';
    box.append(el('p', 'muted', `${plan.ramGb} GB RAM · ${plan.threads} CPU-Threads · ${plan.modCount} Mods im Profil`));
    const cmp = el('div', 'perf-cmp');
    const memIn = el('input', 'input'); memIn.type = 'number'; memIn.min = 1; memIn.max = plan.memory.max; memIn.value = plan.memory.recommended; memIn.style.width = '80px';
    const jvmChk = el('input'); jvmChk.type = 'checkbox'; jvmChk.className = 'sw'; jvmChk.checked = plan.jvm.changed;
    cmp.append(el('b', '', 'Arbeitsspeicher'), el('span', '', `${plan.memory.current} GB`), el('span', 'arrow', '→'), (() => { const r = el('div', 'row gap'); r.append(memIn, el('span', 'muted', `GB (max. ${plan.memory.max})`)); return r; })());
    cmp.append(el('b', '', 'Java-Einstellungen'), el('span', '', plan.jvm.current ? 'eigene' : 'Standard'), el('span', 'arrow', '→'), (() => { const r = el('label', 'row gap'); r.append(jvmChk, el('span', 'muted', plan.jvm.changed ? 'optimierte G1-Garbage-Collection' : 'schon optimal')); return r; })());
    box.append(cmp);
    const chosen = new Set();
    if (plan.mods.length) {
      box.append(el('h3', '', 'Performance-Mods'));
      const list = el('div', 'perf-list');
      for (const m of plan.mods) {
        const it = el('label', 'perf-item'); const cb = el('input'); cb.type = 'checkbox'; cb.className = 'sw';
        cb.checked = m.available && !m.installed && !m.clash; cb.disabled = !m.available || m.installed || !!m.clash; if (cb.checked) chosen.add(m.slug);
        cb.onchange = () => cb.checked ? chosen.add(m.slug) : chosen.delete(m.slug);
        const t = el('div'); t.append(el('b', '', m.title), el('span', '', m.why));
        const st = m.installed ? el('span', 'pill ok', 'installiert') : m.clash ? el('span', 'pill warn', `nicht mit ${m.clash.replace(/\.jar$/, '')}`) : m.available ? el('span', 'pill acc', m.version || 'verfügbar') : el('span', 'pill', `nicht für ${plan.profile.version}`);
        it.append(cb, t, st); list.append(it);
      }
      box.append(list);
    }
    for (const t of plan.tips) box.append(el('p', 'muted small-note', '💡 ' + t));
    box.append(el('p', 'muted small-note', 'Vorher wird automatisch ein Zeitmaschinen-Stand gesichert – du kannst alles mit einem Klick rückgängig machen.'));
    apply.disabled = false;
    apply.onclick = async () => {
      apply.disabled = true; apply.textContent = 'Wird angewendet …';
      try { const r = await api.perf.apply({ profileId: sel.value, memory: Number(memIn.value), jvm: jvmChk.checked ? plan.jvm.recommended : undefined, mods: [...chosen] }); state.profiles = r.profiles; close(); toast(`Autopilot fertig: ${r.memory} GB${r.done.length ? `, ${r.done.length} Mods installiert` : ''}${r.failed.length ? ` – ${r.failed.length} fehlgeschlagen` : ''}`, !!r.failed.length); if (state.view === 'profiles') renderProfiles(); }
      catch (e) { toast(e.message, true); apply.disabled = false; apply.textContent = 'Alles anwenden'; }
    };
  };
  sel.onchange = load; load();
}

// =====================================================================
// Session-Rückblick
// =====================================================================
function showRecap(s, extra = {}) {
  const r = s.recap || {}; const ms = s.end - s.start;
  const { body, foot, close } = v25Dialog('wide-dlg recap-dlg');
  const top = el('div', 'recap-top'); top.append(el('span', 'big', s.code === 0 ? '🏁' : '💥'));
  const t = el('div'); t.append(el('h2', '', s.code === 0 ? 'Session-Rückblick' : 'Session-Rückblick (abgestürzt)'), el('p', 'muted', `${s.name} · ${s.version}${s.loader ? ' ' + (LOADER_NAMES[s.loader] || s.loader) : ''} · ${fmtDate(s.start)}`)); top.append(t); body.append(top);
  const g = el('div', 'recap-grid'); const cell = (v, l) => { const c = el('div'); c.append(el('b', '', v), el('span', '', l)); g.append(c); };
  cell(fmtDur(ms), 'gespielt'); cell(String(r.advancements?.length || 0), 'Fortschritte'); cell(String(r.deaths || 0), 'Tode'); cell(String(r.kills || 0), 'Kills');
  cell(String(r.screenshots || 0), 'Screenshots'); cell(String(r.chats || 0), 'Chat-Nachrichten'); cell(String((s.servers || []).length || (s.worlds || []).length), s.servers?.length ? 'Server' : 'Welten'); cell(extra.level ? `Lv ${extra.level.level}` : '–', 'Level');
  body.append(g);
  if (s.servers?.length || s.worlds?.length) body.append(el('p', 'muted', `Gespielt auf: ${[...(s.servers || []), ...(s.worlds || [])].join(', ')}`));
  if (r.topDeath) body.append(el('p', 'muted', `Häufigste Todesursache: ${r.topDeath}`));
  if (r.topVictim) body.append(el('p', 'muted', `Lieblingsgegner: ${r.topVictim}`));
  if (r.advancements?.length) { body.append(el('h3', '', 'Neue Fortschritte')); const a = el('div', 'adv-list'); for (const x of r.advancements) a.append(el('span', 'pill acc', '🏆 ' + x)); body.append(a); }
  if (extra.unlocked?.length) { body.append(el('h3', '', 'Erfolge freigeschaltet')); const a = el('div', 'adv-list'); for (const x of extra.unlocked) a.append(el('span', 'pill ok', `${x.icon} ${x.title}`)); body.append(a); }
  if (extra.level) { const lv = extra.level; const x = el('div', 'xpbar'); const i = el('i'); i.style.width = `${Math.round(lv.progress * 100)}%`; x.append(i); body.append(el('p', 'muted small-note', `Level ${lv.level} – noch ${lv.next - lv.xp} XP bis Level ${lv.level + 1}`), x); }
  const share = `🎮 ${s.name} (${s.version}) – ${fmtDur(ms)} gespielt${r.advancements?.length ? `, ${r.advancements.length} Fortschritte` : ''}${r.deaths ? `, ${r.deaths} Tode` : ''}${r.kills ? `, ${r.kills} Kills` : ''} · LellekClient`;
  foot.append(btn('ghost', 'Als Text kopieren', () => { navigator.clipboard.writeText(share); toast('Rückblick kopiert'); }));
  if (r.screenshots) foot.append(btn('ghost', 'Screenshots ansehen', () => { close(); showView('worlds'); setTimeout(() => $('#worldsSeg [data-wtab="shots"]')?.click(), 200); }));
  foot.append(btn('primary', 'Weiter', close));
}
api.onRecap((s) => { if (document.hidden || !document.hasFocus()) { V25.pendingRecap = s; } else showRecap(s, s); renderHome(); });
window.addEventListener('focus', () => { if (V25.pendingRecap) { const s = V25.pendingRecap; V25.pendingRecap = null; setTimeout(() => showRecap(s, s), 400); } });

// =====================================================================
// Level & Erfolge
// =====================================================================
function ring(lv, size) { const r = el('div', 'lvl-ring'); r.style.setProperty('--p', Math.round((lv.progress || 0) * 100)); if (size) { r.style.width = r.style.height = size + 'px'; } r.append(el('b', '', String(lv.level))); return r; }
async function renderAch() {
  const box = $('#achBox'); let a; try { a = await api.ach.get(); } catch { return; }
  V25.ach = a; box.innerHTML = '';
  const h = el('div', 'lvl-head'); const mid = el('div');
  mid.append(el('h3', '', `Level ${a.level}${a.badge ? ' · ' + a.badge : ''}`), el('p', '', `${a.xp} XP · noch ${a.next - a.xp} XP bis Level ${a.level + 1} · ${a.unlocked} von ${a.total} Erfolgen`));
  const x = el('div', 'xpbar'); const i = el('i'); i.style.width = `${Math.round(a.progress * 100)}%`; x.append(i); mid.append(x);
  mid.append(el('p', 'small-note', 'XP gibt es für jede Minute Spielzeit und 100 XP pro Erfolg. Dein Level sehen deine Freunde neben deinem Namen.'));
  h.append(ring(a), mid, btn('ghost', 'Abzeichen wählen', () => { showView('settings'); showOptCat('social'); }));
  box.append(h);
  const grid = el('div', 'ach-grid');
  for (const it of [...a.list].sort((p, q) => (!!q.at - !!p.at) || (q.progress || 0) - (p.progress || 0))) {
    const c = el('div', 'ach ' + (it.at ? 'got' : 'locked')); c.title = it.at ? `Freigeschaltet am ${new Date(it.at).toLocaleDateString('de-DE')}` : it.desc;
    const t = el('div'); t.append(el('b', '', it.title), el('span', '', it.at ? it.desc : `${it.desc}${it.value ? ' · ' + it.value : ''}`));
    if (!it.at && it.progress != null && it.progress > 0) { const xb = el('div', 'xpbar'); const xi = el('i'); xi.style.width = `${Math.round(it.progress * 100)}%`; xb.append(xi); t.append(xb); }
    c.append(el('div', 'ai', it.icon), t); grid.append(c);
  }
  box.append(grid);
}
{
  const _rs = renderStats;
  renderStats = async function () {
    await _rs(); renderAch();
    let s; try { s = await api.stats.get(); } catch { return; }
    $$('#statsRecent li').forEach((li, i) => { const r = s.recent[i]; if (!r) return; if (r.recap) { const x = r.recap; const bits = [x.advancements?.length ? `🏆 ${x.advancements.length}` : '', x.deaths ? `💀 ${x.deaths}` : '', x.kills ? `⚔️ ${x.kills}` : '', x.screenshots ? `📸 ${x.screenshots}` : ''].filter(Boolean).join('  '); if (bits) li.children[1]?.append(el('span', 'sess-recap', '  ' + bits)); } li.title = 'Rückblick anzeigen'; li.onclick = () => showRecap(r); });
  };
}
api.ach.onUnlocked((a) => { floatToast(`Erfolg: ${a.title}`, a.desc, { icon: a.icon, cls: 'ach', ms: 6000, force: true }); renderLevelPill(a.level); if (state.view === 'stats') renderAch(); renderHome(); });
function renderLevelPill(lv) {
  const b = $('.account-btn'); if (!b || !lv) return;
  let p = b.querySelector('.lvl-pill'); if (!p) { p = el('span', 'lvl-pill'); b.prepend(p); } p.textContent = String(lv.level); p.title = `Level ${lv.level}`;
}
{ const _ra = renderAccount; renderAccount = async function (...a) { const r = await _ra.apply(this, a); try { renderLevelPill((await api.ach.get())); } catch {} addWindowItem(); return r; }; }
// ---------- Mehrere Fenster (zwei Konten gleichzeitig) ----------
let windowNo = 1;
api.settings.get().then(s => { windowNo = s.windowNo || 1; if (windowNo > 1) { document.body.classList.add('win-extra'); const c = el('span', 'chip win-chip', `Fenster ${windowNo}`); c.title = 'Zusätzliches LellekClient-Fenster – eigene Konto-Wahl, Freunde und Chat; Profile und Mods kommen vom Hauptfenster'; $('#paletteBtn').before(c); $('#clientVersion').textContent += ` · Fenster ${windowNo}`; } addWindowItem(); });
async function openAnotherWindow() { try { const n = await api.windows.openAnother(); toast(`Fenster ${n} öffnet sich – dort oben rechts das andere Konto wählen`); } catch (e) { toast(e.message, true); } }
function addWindowItem() {
  const menu = $('.account-menu'); if (!menu || menu.querySelector('.win-item') || windowNo >= 4) return;
  const it = el('div', 'item win-item', windowNo === 1 ? '⧉ Zweites Fenster (anderes Konto)' : `⧉ Weiteres Fenster (${windowNo + 1})`);
  it.title = 'Öffnet LellekClient ein weiteres Mal – z. B. um mit zwei Konten gleichzeitig zu spielen';
  it.onclick = (e) => { e.stopPropagation(); menu.classList.add('hidden'); openAnotherWindow(); };
  menu.prepend(it, el('hr'));
}

// =====================================================================
// Startseite: Level, Party, Freunde, letzte Session, Server, News
// =====================================================================
async function renderHome() {
  let h; try { h = await api.home.summary(); } catch { return; }
  // Level
  const L = $('#homeLevel'); L.classList.remove('hidden'); L.innerHTML = '';
  const t = el('div', 'lvl-txt'); t.append(el('b', '', `Level ${h.level.level}`), el('span', '', `${h.level.unlocked}/${h.level.total} Erfolge · ${h.level.next - h.level.xp} XP bis Lv ${h.level.level + 1}`));
  const x = el('div', 'xpbar'); const xi = el('i'); xi.style.width = `${Math.round(h.level.progress * 100)}%`; x.append(xi); t.append(x);
  L.append(ring(h.level), t); L.onclick = () => showView('stats'); L.title = 'Statistik & Erfolge öffnen';
  // Party
  renderHomeParty(h.party || V25.party);
  // letzte Session
  const R = $('#homeRecap'); const s = h.lastSession;
  R.classList.toggle('hidden', !s); R.innerHTML = '';
  if (s) {
    const hd = el('h4'); hd.append(el('span', '', 'Letzte Session'), btn('link-btn', 'Rückblick', () => showRecap(s))); R.append(hd);
    R.append(el('div', 'mini-row', `${s.name} · ${fmtDur(s.end - s.start)} · ${ago(s.end)}`));
    const r = s.recap || {}; const g = el('div', 'recap-mini'); for (const [v, l] of [[r.advancements?.length || 0, 'Fortschritte'], [r.deaths || 0, 'Tode'], [r.screenshots || 0, 'Screenshots']]) { const c = el('div'); c.append(el('b', '', String(v)), el('span', '', l)); g.append(c); } R.append(g);
  }
  renderHomeRadar();
}
function renderHomeParty(v) {
  const P = $('#homeParty'); const party = v?.party, inv = v?.invites || [];
  P.classList.toggle('hidden', !party && !inv.length); P.innerHTML = '';
  if (inv.length && !party) { const i = inv[0]; const hd = el('h4'); hd.append(el('span', '', '🥳 Party-Einladung')); P.append(hd, el('div', 'mini-row', `${i.byName} lädt dich ein${i.plan?.server ? ' – ' + i.plan.server : ''}`)); const r = el('div', 'row gap'); r.append(btn('primary small', 'Beitreten', () => partyJoin(i.id)), btn('ghost small', 'Ansehen', () => showView('party'))); P.append(r); return; }
  if (!party) return;
  const hd = el('h4'); hd.append(el('span', '', `🥳 Party · ${party.members.length}`), btn('link-btn', 'Öffnen', () => showView('party'))); P.append(hd);
  const row = el('div', 'row gap'); for (const m of party.members.slice(0, 8)) { const i = el('img'); i.alt = ''; i.title = m.name; i.style.cssText = 'width:24px;height:24px;border-radius:5px;image-rendering:pixelated;' + (m.ready ? '' : 'opacity:.5'); setHead(i, m.uuid); row.append(i); } P.append(row);
  if (party.plan) P.append(el('div', 'mini-row muted', `${party.plan.name} · ${party.plan.version}${party.plan.server ? ' · ' + party.plan.server : ''}`));
}
async function renderHomeRadar() {
  const box = $('#homeRadar'); let favs = []; try { favs = await api.favorites.list(); } catch {}
  box.classList.toggle('hidden', !favs.length); if (!favs.length) return;
  if (Date.now() - V25.radarAt > 60000) { try { Object.assign(V25.radar, await api.radar.scan(favs.slice(0, 5).map(f => f.ip))); V25.radarAt = Date.now(); } catch {} }
  box.innerHTML = ''; const hd = el('h4'); hd.append(el('span', '', 'Server-Radar'), btn('link-btn', 'Alle', () => showView('radar'))); box.append(hd);
  for (const f of favs.slice(0, 4)) {
    const r = V25.radar[f.ip] || {}; const row = el('div', 'mini-row');
    if (r.icon) { const i = el('img'); i.src = r.icon; i.alt = ''; row.append(i); }
    row.append(el('span', 'grow', f.name || f.ip), el('span', 'muted', r.online ? `${r.players}/${r.max}` : ''), pingEl(r));
    row.style.cursor = 'pointer'; row.title = 'Beitreten'; row.onclick = () => joinFav(f); box.append(row);
  }
}
function pingEl(r) { const p = !r || r.online === undefined ? el('span', 'ping off', '…') : !r.online ? el('span', 'ping off', 'offline') : el('span', 'ping ' + (r.ping < 80 ? 'g' : r.ping < 160 ? 'y' : 'r'), `${r.ping} ms`); return p; }
{ // Neuigkeiten kürzen
  $('#newsList').classList.add('short');
  $('#newsMore').onclick = () => { const s = $('#newsList').classList.toggle('short'); $('#newsMore').textContent = s ? 'Alle anzeigen' : 'Weniger'; };
}

// =====================================================================
// Server-Radar
// =====================================================================
const DISCOVER = [['Hypixel', 'mc.hypixel.net'], ['GommeHD', 'gommehd.net'], ['GrieferGames', 'griefergames.net'], ['Cytooxien', 'cytooxien.de'], ['CubeCraft', 'play.cubecraft.net'], ['Minemen Club', 'minemen.club'], ['BedWarsPractice', 'bedwarspractice.club']];
renderFavorites = async function () { if (state.view === 'radar') renderRadar(false); else if (state.view === 'play') renderHomeRadar(); };
let radarTimer = null;
async function renderRadar(rescan) {
  const box = $('#radarList'); let favs = []; try { favs = await api.favorites.list(); } catch {}
  const draw = () => {
    box.innerHTML = '';
    if (!favs.length) { const e = el('div', 'empty-state'); e.append(el('span', 'big', '📡'), el('b', '', 'Noch keine Server im Radar'), el('span', '', 'Füg oben eine Adresse hinzu, übernimm die Serverliste eines Profils oder wähl unten einen bekannten Server.')); box.append(e); }
    const friendsOn = (lastFriends?.friends || []).filter(f => f.online && f.server);
    favs.forEach((f, idx) => {
      const r = V25.radar[f.ip]; const c = el('div', 'srv' + (r && !r.online ? ' offline' : ''));
      if (r?.icon) { const i = el('img'); i.src = r.icon; i.alt = ''; c.append(i); } else c.append(el('div', 'noicon', '⛏'));
      const b = el('div'); const t = el('div', 't'); t.append(el('b', '', f.name || f.ip), pingEl(r)); b.append(t, el('div', 'ip ver', f.ip));
      if (r?.motd) b.append(el('div', 'motd', r.motd));
      const meta = el('div', 'meta'); if (r?.online) { meta.append(el('span', 'pill ok', `${r.players.toLocaleString('de-DE')} / ${r.max.toLocaleString('de-DE')} Spieler`)); if (r.version) meta.append(el('span', 'pill', r.version.slice(0, 28))); }
      const host = f.ip.split(':')[0].toLowerCase().replace(/^mc\.|^play\./, '');
      const here = friendsOn.filter(x => String(x.server).toLowerCase().includes(host));
      if (here.length) { const w = el('span', 'who'); for (const x of here.slice(0, 5)) { const i = el('img'); i.alt = ''; i.title = fname(x); setHead(i, x.uuid); w.append(i); } w.append(el('span', 'pill acc', `${here.length} ${here.length === 1 ? 'Freund' : 'Freunde'} hier`)); meta.append(w); }
      b.append(meta);
      const acts = el('div', 'actions');
      const ps = el('select', 'select'); ps.add(new Option('Aktuelles Profil', '')); for (const p of state.profiles) ps.add(new Option(`${p.name} (${p.version})`, p.id)); ps.value = f.profileId || ''; ps.title = 'Mit welchem Profil beitreten';
      ps.onchange = async () => { favs[idx] = { ...f, profileId: ps.value || undefined }; await api.favorites.save(favs); };
      acts.append(btn('primary', 'Beitreten', () => joinFav(favs[idx])), ps);
      const more = btn('ghost icon-btn', '⋯'); more.onclick = () => popMenu(more, [
        { label: 'Adresse kopieren', run: () => { navigator.clipboard.writeText(f.ip); toast('Adresse kopiert'); } },
        { label: 'An Freund schicken', run: () => pickFriend('Server an wen schicken?', (fr) => chatSend(fr.uuid, '', 'server', { ip: f.ip, name: f.name || f.ip })) },
        ...(V25.party?.party && V25.party.party.leader === V25.party.party.me ? [{ label: 'Als Party-Server festlegen', run: () => { showView('party'); setTimeout(() => { const i = $('#partyServer'); if (i) i.value = f.ip; }, 300); } }] : []),
        { label: 'Umbenennen', run: async () => { const n = await askText('Name:', f.name || ''); if (n) { favs[idx] = { ...f, name: n }; await api.favorites.save(favs); draw(); } } },
        ...(idx > 0 ? [{ label: 'Nach oben', run: async () => { favs.splice(idx - 1, 0, favs.splice(idx, 1)[0]); await api.favorites.save(favs); draw(); } }] : []),
        '-', { label: 'Entfernen', danger: true, run: async () => { favs.splice(idx, 1); await api.favorites.save(favs); draw(); } },
      ]);
      acts.append(more); b.append(acts); c.append(b); box.append(c);
    });
    const dc = $('#radarDiscover'); dc.innerHTML = '';
    for (const [n, ip] of DISCOVER) { if (favs.some(f => f.ip === ip)) continue; dc.append(btn('ghost', `+ ${n}`, async () => { favs.push({ name: n, ip }); await api.favorites.save(favs); renderRadar(true); })); }
    if (!dc.children.length) dc.append(el('span', 'muted', 'Alle Vorschläge sind schon im Radar.'));
  };
  draw();
  if (rescan || Date.now() - V25.radarAt > 30000) {
    $('#radarStamp').textContent = 'Pinge Server …';
    try { Object.assign(V25.radar, await api.radar.scan(favs.map(f => f.ip))); V25.radarAt = Date.now(); } catch {}
    $('#radarStamp').textContent = `Stand ${timeShort(Date.now())}`; if (state.view === 'radar') draw();
  }
  clearInterval(radarTimer); radarTimer = setInterval(() => { if (state.view === 'radar' && !document.hidden) renderRadar(true); else clearInterval(radarTimer); }, 30000);
}
$('#radarRefresh').onclick = () => renderRadar(true);
async function joinFav(f) {
  const id = f.profileId && state.profiles.some(p => p.id === f.profileId) ? f.profileId : state.current;
  if (!id) { toast('Erst ein Profil wählen', true); return; }
  launchProfile(id, f.ip);
}

// =====================================================================
// Chat
// =====================================================================
async function renderChat() {
  const L = lastFriends; if (!L) return;
  const threads = await api.chat.threads().catch(() => []);
  const by = Object.fromEntries(threads.map(t => [t.uuid, t]));
  const friends = L.friends.filter(f => !f.pending);
  const order = [...friends].sort((a, b) => (by[b.uuid]?.last?.at || 0) - (by[a.uuid]?.last?.at || 0) || (b.online - a.online) || fname(a).localeCompare(fname(b)));
  const box = $('#chatThreads'); box.innerHTML = '';
  if (!friends.length) box.append(el('p', 'muted', '  Noch keine Freunde.'));
  for (const f of order) {
    const th = by[f.uuid]; const r = el('div', 'thread' + (V25.chatWith === f.uuid ? ' active' : ''));
    const t = el('div'); t.append(el('b', '', fname(f)), el('span', '', th?.last ? (th.last.in ? '' : 'Du: ') + (th.last.kind === 'profile' ? '🔗 Profil' : th.last.kind === 'server' ? '📡 Server' : th.last.text) : friendText(f)));
    const right = el('div', 'row gap'); if (th?.unread) right.append(el('span', 'badge-n', String(th.unread))); right.append(el('span', 'sdot ' + dotClass(f)));
    r.append(headImg(f.uuid, ''), t, right); r.onclick = () => openChat(f.uuid, true); box.append(r);
  }
  if (V25.chatWith) await renderThread();
}
async function openChat(uuid, inPlace) {
  V25.chatWith = uuid;
  if (!inPlace) { ftab = 'chat'; if (state.view !== 'friends') showView('friends'); }
  renderFriends(); startFastPoll();
}
async function renderThread() {
  const f = lastFriends?.friends.find(x => x.uuid === V25.chatWith); if (!f) return;
  const head = $('#chatHead'); head.innerHTML = '';
  const t = el('div', 'grow'); t.append(el('b', '', fname(f)), el('span', 'muted', '  ' + friendText(f)));
  head.append(headImg(f.uuid, ''), t);
  if (f.online && f.server) head.append(btn('primary small', 'Beitreten', () => joinFriend(f)));
  head.append(btn('ghost small', 'In Party einladen', () => partyInviteFriend(f)));
  const msgs = await api.chat.thread(f.uuid).catch(() => []);
  const log = $('#chatLog'); const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60; log.innerHTML = '';
  if (!msgs.length) log.append(el('div', 'day-sep', `Schreib ${fname(f)} die erste Nachricht – sie kommt auch an, wenn ${fname(f)} gerade offline ist.`));
  let lastDay = '';
  for (const m of msgs) { const d = dayLabel(m.at); if (d !== lastDay) { log.append(el('div', 'day-sep', d)); lastDay = d; } log.append(msgEl(m)); }
  if (atBottom || log.dataset.with !== f.uuid) log.scrollTop = log.scrollHeight; log.dataset.with = f.uuid;
  $('#chatForm').classList.remove('hidden');
  updateChatBadge();
}
function msgEl(m) {
  const b = el('div', 'msg' + (m.in ? '' : ' me'));
  if (m.kind === 'profile' && m.data?.code) {
    b.classList.add('card-msg'); b.append(el('span', 'kind', '🔗 Profil'), el('b', '', m.data.name || 'Profil'), el('span', 'muted', `${m.data.version || ''}${m.data.loader ? ' ' + (LOADER_NAMES[m.data.loader] || m.data.loader) : ''}${m.data.mods ? ' · ' + m.data.mods + ' Mods' : ''}`));
    if (m.in) b.append(btn('primary small', 'Profil übernehmen', () => openShareImport(m.data.code)));
    else b.append(btn('ghost small', 'Code kopieren', () => { navigator.clipboard.writeText(m.data.code); toast('Code kopiert'); }));
  } else if (m.kind === 'server' && m.data?.ip) {
    b.classList.add('card-msg'); b.append(el('span', 'kind', '📡 Server'), el('b', '', m.data.name || m.data.ip), el('span', 'muted', m.data.ip));
    const r = el('div', 'row gap'); r.append(btn('primary small', 'Beitreten', () => joinFav({ ip: m.data.ip })), btn('ghost small', 'Ins Radar', async () => { const favs = await api.favorites.list(); if (!favs.some(x => x.ip === m.data.ip)) { favs.push({ name: m.data.name || m.data.ip, ip: m.data.ip }); await api.favorites.save(favs); } toast('Im Server-Radar gespeichert'); })); b.append(r);
  }
  if (m.text) b.append(document.createTextNode(m.text));
  b.append(el('time', '', timeShort(m.at)));
  return b;
}
async function chatSend(to, text, kind, data) {
  try { await api.chat.send({ to, text, kind, data }); if (state.view === 'friends' && ftab === 'chat' && V25.chatWith === to) renderThread(); else toast(kind === 'profile' ? 'Profil geschickt' : kind === 'server' ? 'Server geschickt' : 'Nachricht gesendet'); }
  catch (e) { toast(e.message, true); }
}
async function chatSendProfile(to, profileId) {
  const send = async (pid) => {
    toast('Erstelle Profil-Code …');
    try { const r = await api.share.create(pid); await chatSend(to, '', 'profile', { code: r.code, name: r.name, version: r.version, loader: r.loader, mods: r.mods }); } catch (e) { toast(e.message, true); }
  };
  if (profileId) return send(profileId);
  pickProfile('Welches Profil schicken?', send);
}
$('#chatForm').onsubmit = async (e) => {
  e.preventDefault(); const inp = $('#chatInput'); const text = inp.value.trim(); if (!text || !V25.chatWith) return;
  inp.value = ''; await chatSend(V25.chatWith, text); inp.focus();
};
$('#chatExtra').onclick = () => popMenu($('#chatExtra'), [
  { label: '🔗 Profil schicken', run: () => chatSendProfile(V25.chatWith) },
  { label: '📡 Server aus dem Radar schicken', run: async () => { const favs = await api.favorites.list(); if (!favs.length) { toast('Noch keine Server im Radar', true); return; } pickFrom('Welchen Server?', favs.map(f => ({ label: f.name || f.ip, hint: f.ip, value: f })), (f) => chatSend(V25.chatWith, '', 'server', { ip: f.ip, name: f.name || f.ip })); } },
  { label: '🥳 In Party einladen', run: () => { const f = lastFriends?.friends.find(x => x.uuid === V25.chatWith); if (f) partyInviteFriend(f); } },
]);
api.chat.onMessage((m) => {
  if (state.view === 'friends' && ftab === 'chat') { if (V25.chatWith === m.from) renderThread(); renderChat(); }
  else floatToast(m.name, m.kind === 'profile' ? 'hat dir ein Profil geschickt' : m.kind === 'server' ? `Server: ${m.data?.ip || ''}` : m.text, { icon: '💬', action: ['Antworten', () => openChat(m.from)] });
});
api.chat.onUnread(() => updateChatBadge());
async function updateChatBadge() {
  const n = await api.chat.unread().catch(() => 0); V25.unread = n;
  $('#cntChat').textContent = String(n); $('#cntChat').classList.toggle('hidden', !n);
  railBadge(lastFriends?.incoming?.length || 0);
}
{ const _rb = railBadge; railBadge = function (n) { _rb((n || 0) + (V25.unread || 0)); }; }
function pickFrom(title, items, cb) {
  const { body, foot, close } = v25Dialog(); body.append(el('h2', '', title));
  const list = el('div', 'pick-list'); for (const it of items) { const b = btn('pick-item', ''); b.append(el('b', '', it.label)); if (it.hint) b.append(el('span', '', it.hint)); b.onclick = () => { close(); cb(it.value); }; list.append(b); }
  if (!items.length) list.append(el('p', 'muted', 'Nichts zur Auswahl.'));
  body.append(list); foot.append(btn('ghost', 'Abbrechen', close));
}
function pickFriend(title, cb, onlyOnline) { const fr = (lastFriends?.friends || []).filter(f => !f.pending && (!onlyOnline || f.online)); pickFrom(title, fr.map(f => ({ label: fname(f), hint: friendText(f), value: f })), cb); }
function pickProfile(title, cb) { pickFrom(title, state.profiles.map(p => ({ label: `${p.icon ? p.icon + ' ' : ''}${p.name}`, hint: `${p.version}${p.loader ? ' · ' + (LOADER_NAMES[p.loader] || p.loader) : ''}`, value: p.id })), cb); }

// =====================================================================
// Party
// =====================================================================
async function partyCall(fn, ok) { try { const v = await fn(); applyPartyView(v); if (ok) toast(ok); return v; } catch (e) { toast(e.message, true); return null; } }
function applyPartyView(v) {
  if (!v) return; V25.party = v; V25.partyRecv = Date.now();
  const P = v.party, chip = $('#partyChip');
  chip.classList.toggle('hidden', !P && !v.invites?.length);
  chip.textContent = P ? `🥳 Party · ${P.members.length}${P.launchAt && P.launchAt > P.serverTime ? ' · Start!' : ''}` : `🥳 ${v.invites.length} Party-Einladung${v.invites.length === 1 ? '' : 'en'}`;
  const pb = $('.rail-btn[data-view="party"]'); let b = pb.querySelector('.rail-badge'); if (!b) { b = el('i', 'rail-badge'); pb.append(b); }
  b.textContent = P ? String(P.members.length) : String(v.invites?.length || ''); b.classList.toggle('hidden', !P && !v.invites?.length); b.style.background = P ? '#9B5CFF' : '';
  if (state.view === 'party') renderParty(false); if (state.view === 'play') renderHomeParty(v);
}
$('#partyChip').onclick = () => showView('party');
const partyJoin = (id) => partyCall(() => api.party.join(id), 'Du bist in der Party');
function partyInviteFriend(f) { partyCall(() => api.party.invite(f.uuid), `${fname(f)} eingeladen`); }
async function partyPlanWith(profileId) { const i = $('#partyProfile'); if (i) { i.value = profileId; } }
async function renderParty(poll) {
  if (poll) { try { applyPartyView(await api.party.poll()); return; } catch {} }
  const v = V25.party || await api.party.get().catch(() => null); if (!v) return;
  const body = $('#partyBody'), head = $('#partyHeadActions'); body.innerHTML = ''; head.innerHTML = '';
  if (!state.account) { const e = el('div', 'empty-state'); e.append(el('span', 'big', '🔒'), el('b', '', 'Melde dich an'), el('span', '', 'Party braucht dein Microsoft-Konto und Freunde in LellekClient.')); body.append(e); return; }
  for (const i of v.invites || []) {
    const r = el('div', 'party-invite'); r.append(headImg(i.by, ''));
    const t = el('div', 'grow'); t.append(el('b', '', `${i.byName} lädt dich in eine Party ein`), el('div', 'muted', `${i.members} ${i.members === 1 ? 'Spieler' : 'Spieler'}${i.plan ? ` · ${i.plan.name} (${i.plan.version})${i.plan.server ? ' auf ' + i.plan.server : ''}` : ''}`));
    r.append(t, btn('primary', 'Beitreten', () => partyJoin(i.id)), btn('ghost', 'Ablehnen', () => partyCall(() => api.party.decline(i.id)))); body.append(r);
  }
  const P = v.party;
  if (!P) {
    const e = el('div', 'empty-state'); e.append(el('span', 'big', '🥳'), el('b', '', 'Spielt zusammen – ohne Mod-Chaos'), el('span', '', '1. Party starten und Freunde einladen  ·  2. Profil und Server festlegen  ·  3. Alle drücken „Bereit“ – fehlende Mods werden automatisch geladen  ·  4. Gemeinsam starten'));
    e.append(btn('primary', 'Party starten', () => partyCall(() => api.party.create(), 'Party gestartet – lade Freunde ein'))); body.append(e); return;
  }
  const leader = P.leader === P.me, me = P.members.find(m => m.uuid === P.me);
  head.append(btn('ghost danger', 'Party verlassen', () => { if (confirm('Party verlassen?')) partyCall(() => api.party.leave(), 'Party verlassen'); }));
  const grid = el('div', 'party-grid');
  // Mitglieder
  const left = el('div', 'party-hero card'); left.append(el('h3', '', `Mitglieder (${P.members.length}/10)`));
  const mem = el('div', 'party-members');
  for (const m of P.members) {
    const c = el('div', 'pm' + (m.ready ? ' ready' : '') + (m.online ? '' : ' off')); if (m.leader) c.append(el('span', 'crown', '👑'));
    c.append(headImg(m.uuid, ''), el('b', '', m.name + (m.uuid === P.me ? ' (du)' : '')), el('span', m.ready ? 'pill ok' : 'pill', m.ready ? 'bereit' : m.online ? 'nicht bereit' : 'offline'));
    if (m.level) c.append(el('span', 'lvl-pill', String(m.level)));
    if (leader && m.uuid !== P.me) { const x = btn('x', '⋯'); x.onclick = () => popMenu(x, [{ label: '👑 Zum Leiter machen', run: () => partyCall(() => api.party.promote(m.uuid)) }, { label: 'Entfernen', danger: true, run: () => partyCall(() => api.party.kick(m.uuid)) }]); c.append(x); }
    mem.append(c);
  }
  for (const i of P.invited) { const c = el('div', 'pm off'); c.append(headImg(i.uuid, ''), el('b', '', i.name || '…'), el('span', 'pill', 'eingeladen')); mem.append(c); }
  if (P.members.length < 10) { const add = el('div', 'pm add'); add.append(el('span', 'big', '＋'), el('b', '', 'Freund einladen')); add.onclick = () => { const inP = new Set([...P.members.map(m => m.uuid), ...P.invited.map(i => i.uuid)]); const fr = (lastFriends?.friends || []).filter(f => !f.pending && !inP.has(f.uuid)).sort((a, b) => b.online - a.online); pickFrom('Wen einladen?', fr.map(f => ({ label: fname(f), hint: friendText(f), value: f })), (f) => partyInviteFriend(f)); }; mem.append(add); }
  left.append(mem); grid.append(left);
  // Plan
  const right = el('div', 'card plan-box'); right.append(el('h3', '', 'Plan'));
  if (P.launchAt && P.launchAt > P.serverTime - 2000) {
    const cd = el('div', 'countdown'); right.append(el('p', 'muted', 'Alle starten gleich …'), cd);
    const tick = () => { const left = Math.max(0, Math.ceil((P.launchAt - (P.serverTime + (Date.now() - V25.partyRecv))) / 1000)); cd.textContent = left > 0 ? String(left) : 'Los!'; if (left > 0 && state.view === 'party') requestAnimationFrame(() => setTimeout(tick, 250)); };
    V25.partyRecv = V25.partyRecv || Date.now(); tick();
    if (leader) right.append(btn('ghost', 'Abbrechen', () => partyCall(() => api.party.cancel())));
  }
  if (leader) {
    const ps = el('select', 'select'); ps.id = 'partyProfile'; for (const p of state.profiles) ps.add(new Option(`${p.name} (${p.version}${p.loader ? ' ' + (LOADER_NAMES[p.loader] || p.loader) : ''})`, p.id));
    ps.value = v.profileId && state.profiles.some(p => p.id === v.profileId) ? v.profileId : state.current || '';
    const sv = el('input', 'input'); sv.id = 'partyServer'; sv.placeholder = 'Server, z. B. gommehd.net (leer = nur Spiel starten)'; sv.value = P.plan?.server || ''; sv.setAttribute('list', 'partyServers');
    const dl = el('datalist'); dl.id = 'partyServers'; api.favorites.list().then(f => { for (const x of f) dl.append(new Option(x.name || x.ip, x.ip)); });
    const l1 = el('label', 'form-label', 'Profil (Mods werden an alle verteilt)'); l1.append(ps); const l2 = el('label', 'form-label', 'Server'); l2.append(sv, dl);
    right.append(l1, l2, btn('ghost', P.plan ? 'Plan aktualisieren' : 'Plan festlegen', async (e) => { e.target.disabled = true; const r = await partyCall(() => api.party.plan({ profileId: ps.value, server: sv.value }), null); if (r) { if (r.warning) floatToast('Plan festgelegt – mit Hinweis', r.warning, { icon: '⚠️', ms: 9000, force: true }); else toast('Plan festgelegt – alle anderen müssen „Bereit“ drücken'); } e.target.disabled = false; }));
  }
  if (P.plan) {
    const sum = el('div', 'plan-sum'); sum.append(el('span', '', 'Profil'), el('b', '', P.plan.name), el('span', '', 'Version'), el('span', '', `${P.plan.version}${P.plan.loader ? ' ' + (LOADER_NAMES[P.plan.loader] || P.plan.loader) : ''}${P.plan.mods ? ' · ' + P.plan.mods + ' Mods' : ''}`), el('span', '', 'Server'), el('span', '', P.plan.server || '– (nur starten)'));
    if (!leader) sum.append(el('span', '', 'Bei dir'), el('span', '', v.profileName ? `„${v.profileName}“` : P.plan.code ? 'wird beim „Bereit“ automatisch eingerichtet' : 'passendes Vanilla-Profil wählen'));
    right.append(sum);
    const ready = P.members.filter(m => m.ready).length;
    if (!leader) {
      if (!v.profileName && !P.plan.code) { const ps = el('select', 'select'); ps.add(new Option('Profil wählen …', '')); for (const p of state.profiles.filter(p => p.version === P.plan.version)) ps.add(new Option(p.name, p.id)); ps.onchange = () => partyCall(() => api.party.choose(ps.value)); right.append(ps); }
      right.append(btn(me?.ready ? 'ghost' : 'primary', me?.ready ? 'Doch nicht bereit' : 'Bereit', async (e) => { e.target.disabled = true; e.target.textContent = me?.ready ? '…' : 'Richte Profil ein …'; await partyCall(() => api.party.ready(!me?.ready), me?.ready ? null : 'Bereit!'); }));
    } else {
      const go = btn('primary', `Gemeinsam starten (${ready}/${P.members.length} bereit)`, () => partyCall(() => api.party.launch(10), 'Countdown läuft')); go.disabled = !!(P.launchAt && P.launchAt > P.serverTime);
      right.append(go, el('p', 'muted small-note', 'Wer nicht bereit ist, startet nicht mit. Der Start kommt nach 10 Sekunden Countdown bei allen gleichzeitig.'));
    }
  } else if (!leader) right.append(el('p', 'muted', 'Der Party-Leiter legt gleich Profil und Server fest.'));
  grid.append(right); body.append(grid);
}
api.party.onUpdate((v) => { V25.partyRecv = Date.now(); applyPartyView(v); });
api.party.onInvite((i) => floatToast(`${i.byName} lädt dich in eine Party ein`, i.plan?.server || 'Gemeinsam spielen', { icon: '🥳', ms: 12000, action: ['Beitreten', () => partyJoin(i.id)] }));
api.party.onCountdown(({ inMs, server }) => { const s = Math.round(inMs / 1000); floatToast(`Party startet in ${s} s`, server ? `auf ${server}` : 'Minecraft startet gleich', { icon: '🚀', ms: Math.max(3000, inMs), force: true }); $('#partyChip').classList.add('go'); setTimeout(() => $('#partyChip').classList.remove('go'), inMs + 2000); });
api.party.onLaunched((r) => { if (r.ok) { runningSet.add(r.profileId); updatePlayButton?.(); renderRunning?.(); toast('Party-Start: Minecraft läuft'); } else toast(`Party-Start fehlgeschlagen: ${r.error}`, true); });
function startFastPoll() {
  clearInterval(V25.pollT);
  const need = () => !document.hidden && (state.view === 'party' || (state.view === 'friends' && ftab === 'chat'));
  if (!need()) return;
  V25.pollT = setInterval(() => { if (!need()) { clearInterval(V25.pollT); return; } api.party.poll().then(applyPartyView).catch(() => {}); }, 3000);
}
$$('#friendsSeg button').forEach(b => b.addEventListener('click', () => { if (b.dataset.ftab !== 'chat') api.chat.close(); startFastPoll(); }));

// =====================================================================
// Befehlspalette: neue Einträge
// =====================================================================
{
  const _pi = paletteItems;
  paletteItems = function () {
    const items = _pi(), cur = currentProfile();
    items.push({ group: 'Aktion', label: 'Zweites LellekClient-Fenster öffnen', hint: 'anderes Konto', run: () => openAnotherWindow() });
    items.push({ group: 'Aktion', label: 'Profil-Code einfügen', hint: 'LC1-…', run: () => openShareImport() });
    if (cur) {
      items.push({ group: 'Aktion', label: 'Performance-Autopilot', hint: cur.name, run: () => openAutopilot(cur.id) });
      items.push({ group: 'Aktion', label: 'Zeitmaschine', hint: cur.name, run: () => openTimeMachine(cur.id) });
      items.push({ group: 'Aktion', label: 'Profil als Code teilen', hint: cur.name, run: () => openShareCreate(cur.id) });
    }
    items.push({ group: 'Aktion', label: V25.party?.party ? 'Party öffnen' : 'Party starten', hint: '', run: () => { showView('party'); if (!V25.party?.party) partyCall(() => api.party.create(), 'Party gestartet'); } });
    items.push({ group: 'Aktion', label: 'Leistungsmodus umschalten', hint: ui.perf ? 'an' : 'aus', run: () => { setUi({ perf: !ui.perf }); toast(ui.perf ? 'Leistungsmodus an' : 'Leistungsmodus aus'); } });
    for (const f of (lastFriends?.friends || []).filter(f => !f.pending).slice(0, 30)) items.push({ group: 'Chat', label: `Nachricht an ${fname(f)}`, hint: f.online ? 'online' : '', run: () => openChat(f.uuid) });
    return items;
  };
}

// =====================================================================
// „Was ist neu“ nach dem Update
// =====================================================================
async function whatsNew() {
  const s = await api.settings.get(); const v = s.clientVersion; if (!v || !/^2\.5/.test(v) || LS.get('seen25', false)) return;
  LS.set('seen25', true);
  const { body, foot, close } = v25Dialog('whatsnew');
  body.append(el('h2', '', `Willkommen bei LellekClient ${v}`), el('p', 'muted', 'Neue Oberfläche – alles geordnet in der Seitenleiste – und Funktionen, die es so in keinem anderen Launcher gibt:'));
  const g = el('div', 'wn-grid');
  for (const [i, t, d] of [['🥳', 'Party-Modus', 'Freunde einladen – alle bekommen dieselben Mods und starten gemeinsam auf denselben Server.'], ['💬', 'Chat', 'Nachrichten, Profile und Server direkt im Launcher an Freunde schicken.'], ['🔗', 'Profil-Codes', 'Ein ganzes Modpack als kurzer Text – einfügen, fertig.'], ['⏪', 'Zeitmaschine', 'Automatische Sicherung von Mods & Configs. Ein Klick zurück.'], ['🏁', 'Session-Rückblick', 'Nach jeder Runde: Fortschritte, Tode, Kills, Screenshots.'], ['🏆', 'Level & Erfolge', '25 Erfolge, Level für Freunde sichtbar, eigenes Abzeichen.'], ['📡', 'Server-Radar', 'Live-Ping, Spielerzahl – und welche Freunde gerade drauf sind.'], ['🚀', 'Performance-Autopilot', 'RAM, Java und Performance-Mods mit einem Klick.']]) { const c = el('div', 'wn'); c.append(el('i', '', i), el('b', '', t), el('span', '', d)); g.append(c); }
  body.append(g);
  foot.append(btn('ghost', 'Party ausprobieren', () => { close(); showView('party'); }), btn('primary', 'Los geht’s', close));
}

// ---------- Start ----------
(async () => {
  showView(state.view || 'play');
  setTimeout(() => api.party.get().then(applyPartyView).catch(() => {}), 1500);
  setTimeout(updateChatBadge, 3000);
  setTimeout(() => whatsNew().catch(() => {}), 2500);
})();
