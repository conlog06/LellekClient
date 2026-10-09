// LellekClient 1.8 – Statistik, Befehlspalette, Tastenkürzel, Mod-Sets, Absturz-Diagnose, Server-Einstellungen
// Läuft nach app.js im selben Fenster und nutzt dessen Helfer ($, el, api, state, toast, showView …).

const fmtDur = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const fmtDate = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------- Eingabe-Dialog (ersetzt prompt(), das Electron nicht unterstützt) ----------
function askText(label, value = '') {
  return new Promise((resolve) => {
    const d = $('#askDialog'); $('#askLabel').textContent = label; const inp = $('#askInput'); inp.value = value ?? '';
    const done = (v) => { d.close(); resolve(v); };
    $('#askOk').onclick = () => done(inp.value.trim() || null);
    $('#askCancel').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value.trim() || null); } };
    d.oncancel = (e) => { e.preventDefault(); done(null); };
    d.showModal(); inp.focus(); inp.select();
  });
}

// ---------- Profil starten (gemeinsam für Palette, Statistik, Kürzel) ----------
async function launchProfile(id, server) {
  const p = state.profiles.find(x => x.id === id); if (!p) return;
  state.current = id; renderLaunch();
  if (runningSet.has(id) && !server) { api.launchOpenLog(id); return; }
  try { toast(`Starte ${p.name}…`); await api.launch(id, server); runningSet.add(id); updatePlayButton(); renderRunning(); toast(`${p.name} läuft`); }
  catch (e) { toast(e.message, true); }
}
async function createShortcut(id) {
  const p = state.profiles.find(x => x.id === id); if (!p) { toast('Kein Profil gewählt', true); return; }
  try { await api.shortcut(id); toast(`Desktop-Verknüpfung für „${p.name}“ erstellt – Doppelklick startet das Profil direkt`); } catch (e) { toast(e.message, true); }
}

// ---------- Statistik ----------
async function renderStats() {
  let s; try { s = await api.stats.get(); } catch (e) { toast(e.message, true); return; }
  const k = $('#statsKpis'); k.innerHTML = '';
  const kpi = (label, value, sub) => { const c = el('div', 'kpi'); c.append(el('span', 'kpi-label', label), el('b', 'kpi-value', value)); if (sub) c.append(el('span', 'kpi-sub', sub)); k.appendChild(c); };
  kpi('Gesamtspielzeit', fmtDur(s.totalMs), `${state.profiles.length} Profile`);
  kpi('Sitzungen', String(s.sessionCount), s.sessionCount ? `Ø ${fmtDur(s.trackedMs / s.sessionCount)}` : 'ab jetzt gezählt');
  kpi('Serie', `${s.streak} ${s.streak === 1 ? 'Tag' : 'Tage'}`, s.streak ? 'am Stück gespielt' : 'heute schon gespielt?');
  kpi('Abstürze', String(s.crashes), s.sessionCount ? `${Math.round(s.crashes / s.sessionCount * 100)} % der Starts` : '–');

  // Tage-Diagramm
  const dc = $('#statsDays'); dc.innerHTML = '';
  const max = Math.max(1, ...s.days.map(d => d.ms)); const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  for (const d of s.days) {
    const col = el('div', 'day'); col.title = `${new Date(d.key).toLocaleDateString('de-DE')}: ${fmtDur(d.ms)} in ${d.sessions} Sitzung(en)`;
    const bar = el('div', 'day-bar'); bar.style.height = `${Math.max(d.ms ? 4 : 0, Math.round(d.ms / max * 100))}%`;
    const wrap = el('div', 'day-track'); wrap.append(bar);
    col.append(el('span', 'day-val', d.ms ? fmtDur(d.ms).replace(' min', 'm').replace(' h ', 'h ') : ''), wrap, el('span', 'day-lbl', wd[new Date(d.key).getDay()]));
    dc.appendChild(col);
  }
  if (!s.days.some(d => d.ms)) dc.append(el('p', 'muted empty-note', 'In den letzten 14 Tagen noch nichts aufgezeichnet.'));

  // Profile
  const pb = $('#statsProfiles'); pb.innerHTML = '';
  const pmax = Math.max(1, ...s.profiles.map(p => p.ms));
  for (const p of s.profiles.filter(p => p.ms).slice(0, 8)) {
    const r = el('div', 'hbar'); const name = el('span', 'hbar-name', `${p.icon ? p.icon + ' ' : ''}${p.name}`);
    const track = el('div', 'hbar-track'); const fill = el('div', 'hbar-fill'); fill.style.width = `${Math.max(2, p.ms / pmax * 100)}%`; if (p.color) fill.style.background = p.color; track.append(fill);
    r.append(name, track, el('span', 'hbar-val', fmtDur(p.ms))); r.title = `${p.version} · ${p.sessions} Sitzungen`; r.onclick = () => { state.current = p.id; renderLaunch(); toast(`${p.name} ausgewählt`); };
    pb.appendChild(r);
  }
  if (!pb.children.length) pb.append(el('p', 'muted', 'Noch keine Spielzeit.'));

  // Server & Welten
  const list = (box, items, emptyText, onJoin) => { box.innerHTML = ''; if (!items.length) { box.append(el('p', 'muted', emptyText)); return; } for (const it of items) { const r = el('div', 'toprow'); r.append(el('span', 'grow', it.name), el('span', 'muted', `${it.n}×`)); if (onJoin) { const b = el('button', 'ghost small', 'Verbinden'); b.onclick = () => onJoin(it.name); r.append(b); } box.appendChild(r); } };
  list($('#statsServers'), s.servers, 'Noch keine Server besucht.', (ip) => { if (!state.current) { toast('Erst ein Profil wählen', true); return; } launchProfile(state.current, ip); });
  list($('#statsWorlds'), s.worlds, 'Noch keine Welt gespielt.');

  // Letzte Sitzungen
  const ul = $('#statsRecent'); ul.innerHTML = '';
  if (!s.recent.length) ul.append(el('li', 'empty-li', 'Noch keine Sitzungen – ab jetzt wird jeder Start mitgezählt.'));
  for (const r of s.recent) {
    const li = el('li', r.code === 0 ? '' : 'crash');
    const where = [...(r.servers || []), ...(r.worlds || [])].join(', ');
    li.append(el('span', 'dot'), el('span', '', `${fmtDate(r.start)} · ${r.name} (${r.version}${r.loader ? ' ' + r.loader : ''})${where ? ' · ' + where : ''}`), el('span', 'size', fmtDur(r.end - r.start)), el('span', r.code === 0 ? 'sess-ok' : 'sess-bad', r.code === 0 ? 'OK' : `Code ${r.code}`));
    ul.appendChild(li);
  }
}
$('#statsReset').onclick = async () => { if (!confirm('Sitzungsverlauf löschen? Die Spielzeit der Profile bleibt erhalten.')) return; await api.stats.reset(); renderStats(); toast('Verlauf geleert'); };

// ---------- Absturz-Diagnose ----------
function diagAction(action, a) {
  const close = () => $('#infoDialog').close();
  const goMods = () => { close(); state.current = a.profileId; state.kind = 'mods'; state.source = 'installed'; renderLaunch(); showView('content'); };
  const mk = (label, fn, cls = 'primary') => { const b = el('button', cls + ' small', label); b.onclick = fn; return b; };
  switch (action) {
    case 'memory': return mk('RAM um 2 GB erhöhen', async (e) => { const m = await api.diagnose.adjustMemory({ id: a.profileId, delta: 2 }); await loadProfiles(); e.target.disabled = true; e.target.textContent = `Jetzt ${m} GB`; });
    case 'memoryDown': return mk('RAM um 1 GB senken', async (e) => { const m = await api.diagnose.adjustMemory({ id: a.profileId, delta: -1 }); await loadProfiles(); e.target.disabled = true; e.target.textContent = `Jetzt ${m} GB`; });
    case 'java': return mk('Java automatisch wählen', async (e) => { await api.diagnose.clearJava(a.profileId); await loadProfiles(); e.target.disabled = true; e.target.textContent = 'Erledigt'; });
    case 'deps': case 'mods': return mk('Zu den Mods', goMods);
    case 'conflicts': return mk('Konflikte prüfen', () => { goMods(); setTimeout(() => $('#checkConflicts').click(), 400); });
    case 'safe': return mk('Sicherer Start (ohne Mods)', () => { goMods(); setTimeout(() => $('#safeMode').click(), 400); }, 'ghost');
    case 'login': return mk('Neu anmelden', async () => { close(); try { state.account = await api.auth.login(); renderAccount(); refreshSkin(); toast('Angemeldet'); } catch (e) { toast(e.message, true); } });
    default: return null;
  }
}
function showDiagnosis(a) {
  const d = $('#infoDialog'); if (d.open) d.close();
  const body = $('#infoBody'); body.innerHTML = '';
  body.append(el('h2', '', a.empty ? 'Keine Daten' : `Absturz-Diagnose · ${a.profileName}`));
  if (a.empty) { body.append(el('p', 'muted', 'Für dieses Profil gibt es noch kein Log und keinen Crash-Report.')); d.showModal(); return; }
  if (a.description) body.append(el('p', 'muted', `Crash-Report: „${a.description}“`));
  for (const pr of a.problems) { const box = el('div', 'diag'); box.append(el('b', '', pr.title), el('p', '', pr.hint)); const act = diagAction(pr.action, a); if (act) box.append(act); body.append(box); }
  if (a.details?.length) { body.append(el('h3', '', 'Betroffen')); const ul = el('ul', 'diag-list'); for (const x of a.details) ul.append(el('li', '', x)); body.append(ul); }
  if (a.cause) body.append(el('div', 'pre', a.cause));
  const row = el('div', 'row gap'); row.style.marginTop = '10px';
  if (a.crash) { const b = el('button', 'ghost small', 'Crash-Report öffnen'); b.onclick = () => api.crashOpen(a.crash); row.append(b); }
  const lb = el('button', 'ghost small', 'Log-Datei öffnen'); lb.onclick = () => api.logs.openLast(); row.append(lb);
  body.append(row); d.showModal();
}
async function diagnoseProfile(id) { if (!id) { toast('Kein Profil gewählt', true); return; } try { showDiagnosis(await api.diagnose.last(id)); } catch (e) { toast(e.message, true); } }
api.onClosed(({ analysis, crash }) => {
  if (!analysis) return;
  const known = analysis.problems?.some(p => p.title !== 'Unbekannte Ursache');
  if (crash || known) showDiagnosis(analysis);
  else toast('Minecraft wurde unerwartet beendet – „Letzten Absturz analysieren“ unter Mods zeigt Details', true);
});

// ---------- Mod-Sets & Mod-Liste ----------
async function renderModsets() {
  const row = $('#modsetRow'); const show = state.kind === 'mods' && state.source === 'installed' && !!state.current;
  row.classList.toggle('hidden', !show); if (!show) return;
  const sel = $('#modsetSelect'), prev = sel.value; sel.innerHTML = '';
  let sets = []; try { sets = await api.modsets.list(state.current); } catch {}
  if (!sets.length) sel.add(new Option('– noch keine –', ''));
  for (const s of sets) sel.add(new Option(`${s.name} (${s.count} Mods)`, s.name));
  if (sets.some(s => s.name === prev)) sel.value = prev;
  $('#modsetApply').disabled = $('#modsetDelete').disabled = !sets.length;
}
$('#modsetSave').onclick = async () => {
  const name = await askText('Name für dieses Mod-Set (alle gerade aktiven Mods werden gespeichert):', $('#modsetSelect').value || 'PvP'); if (!name) return;
  try { const r = await api.modsets.save({ profileId: state.current, name }); toast(`Mod-Set „${r.name}“ mit ${r.count} Mods gespeichert`); await renderModsets(); $('#modsetSelect').value = r.name; } catch (e) { toast(e.message, true); }
};
$('#modsetApply').onclick = async () => {
  const name = $('#modsetSelect').value; if (!name) return;
  try { const r = await api.modsets.apply({ profileId: state.current, name }); toast(`„${name}“ aktiv: ${r.on} eingeschaltet, ${r.off} ausgeschaltet${r.missing.length ? `, ${r.missing.length} fehlen (gelöscht?)` : ''}`, r.missing.length > 0); loadInstalled(); } catch (e) { toast(e.message, true); }
};
$('#modsetDelete').onclick = async () => { const name = $('#modsetSelect').value; if (!name || !confirm(`Mod-Set „${name}“ löschen? Die Mods selbst bleiben.`)) return; await api.modsets.remove({ profileId: state.current, name }); renderModsets(); };
$('#modListCopy').onclick = async () => { try { const r = await api.modList(state.current); toast(`Liste mit ${r.count} Mods in der Zwischenablage – zum Teilen in Discord einfügen`); } catch (e) { toast(e.message, true); } };
$('#diagnoseBtn').onclick = () => diagnoseProfile(state.current);

// ---------- Server-Einstellungen (server.properties) ----------
const SP_BOOL = ['pvp', 'white-list', 'online-mode', 'allow-flight', 'hardcore', 'enable-command-block'];
const SP_TEXT = ['motd', 'max-players', 'gamemode', 'difficulty', 'view-distance', 'spawn-protection', 'level-seed'];
const SP_NUM = { gamemode: ['survival', 'creative', 'adventure', 'spectator'], difficulty: ['peaceful', 'easy', 'normal', 'hard'] };
let spNumeric = {};
async function renderServerProps() {
  const box = $('#serverPropsBox'); if (!state.current) { box.classList.add('hidden'); return; }
  let r; try { r = await api.serverProps.get(state.current); } catch { box.classList.add('hidden'); return; }
  box.classList.toggle('hidden', !r.exists); if (!r.exists) return;
  spNumeric = {};
  for (const k of SP_TEXT) { let v = r.props[k] ?? ''; if (SP_NUM[k] && /^\d$/.test(v)) { spNumeric[k] = true; v = SP_NUM[k][Number(v)] || SP_NUM[k][0]; } const i = $('#sp-' + k); if (i) i.value = v || (SP_NUM[k] ? (k === 'difficulty' ? 'easy' : 'survival') : ''); }
  for (const k of SP_BOOL) { const i = $('#sp-' + k); if (i) i.checked = (r.props[k] ?? (k === 'pvp' || k === 'online-mode' ? 'true' : 'false')) === 'true'; }
  $('#serverPropsState').textContent = '';
}
$('#serverPropsSave').onclick = async () => {
  const props = {};
  for (const k of SP_TEXT) { let v = $('#sp-' + k).value.trim(); if (SP_NUM[k] && spNumeric[k]) v = String(Math.max(0, SP_NUM[k].indexOf(v))); props[k] = v; }
  for (const k of SP_BOOL) props[k] = $('#sp-' + k).checked ? 'true' : 'false';
  try { const r = await api.serverProps.save({ profileId: state.current, props }); $('#serverPropsState').textContent = r.restart ? 'Gespeichert – greift nach Neustart des Servers' : 'Gespeichert'; toast('Server-Einstellungen gespeichert'); } catch (e) { toast(e.message, true); }
};

// ---------- Profil-Dialog: optimierte JVM-Argumente ----------
const JVM_FLAGS = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1';
(() => {
  const inp = $('#profileForm').jvmArgs; if (!inp) return;
  const row = el('div', 'row gap jvm-row');
  const b = el('button', 'ghost small', 'Optimierte Flags'); b.type = 'button'; b.title = 'Bewährte Garbage-Collector-Einstellungen für weniger Ruckler';
  b.onclick = () => { inp.value = JVM_FLAGS; toast('Optimierte JVM-Argumente eingetragen – Speichern nicht vergessen'); };
  const c = el('button', 'ghost small', 'Leeren'); c.type = 'button'; c.onclick = () => { inp.value = ''; };
  row.append(b, c); inp.after(row);
})();

// ---------- Befehlspalette (Strg+K) ----------
const VIEWS = [['play', 'Spielen'], ['profiles', 'Profile'], ['content', 'Mods & Packs'], ['worlds', 'Welten'], ['server', 'Server'], ['skins', 'Skins'], ['stats', 'Statistik'], ['settings', 'Optionen']];
let paletteFavs = [], paletteSel = 0, paletteShown = [];
function paletteItems() {
  const cur = currentProfile(), items = [];
  for (const p of state.profiles) items.push({ group: 'Starten', label: `${p.icon ? p.icon + ' ' : ''}${p.name}`, hint: `${p.version} · ${p.loader || 'Vanilla'}${runningSet.has(p.id) ? ' · läuft' : ''}`, run: () => launchProfile(p.id) });
  for (const f of paletteFavs) items.push({ group: 'Server', label: `Verbinden: ${f.name}`, hint: f.ip + (cur ? ` mit ${cur.name}` : ''), run: () => cur ? launchProfile(cur.id, f.ip) : toast('Erst ein Profil wählen', true) });
  VIEWS.forEach(([v, n], i) => items.push({ group: 'Gehe zu', label: n, hint: `Strg+${i + 1}`, run: () => showView(v) }));
  for (const p of state.profiles) if (p.id !== state.current) items.push({ group: 'Auswählen', label: p.name, hint: p.version, run: () => { state.current = p.id; renderLaunch(); toast(`${p.name} ausgewählt`); } });
  for (const id of runningSet) { const p = state.profiles.find(x => x.id === id); if (p) items.push({ group: 'Beenden', label: `${p.name} beenden`, hint: 'Instanz schließen', run: () => api.launchKill(id) }); }
  const act = (label, hint, run) => items.push({ group: 'Aktion', label, hint, run });
  act('Neues Profil', '', () => openProfileDialog());
  if (cur) {
    act('Profil bearbeiten', cur.name, () => openProfileDialog(cur));
    act('Desktop-Verknüpfung erstellen', cur.name, () => createShortcut(cur.id));
    act('Letzten Absturz analysieren', cur.name, () => diagnoseProfile(cur.id));
    act('Ausstattung öffnen', cur.name, () => openBundle(cur));
    act('Profil-Ordner öffnen', cur.name, () => api.profiles.openFolder(cur.id));
    act('Welten jetzt sichern', cur.name, async () => { try { await api.backups.now(cur.id); toast('Backup erstellt'); } catch (e) { toast(e.message, true); } });
    if (cur.loader) act('Mod-Liste kopieren', cur.name, async () => { try { const r = await api.modList(cur.id); toast(`Liste mit ${r.count} Mods kopiert`); } catch (e) { toast(e.message, true); } });
  }
  act('Log ein-/ausblenden', '', () => $('#log').classList.toggle('hidden'));
  act('Letzte Log-Datei öffnen', '', () => api.logs.openLast());
  act('Datenordner öffnen', '', () => api.settings.openDataDir());
  act('Launcher-Update prüfen', '', () => { showView('settings'); setTimeout(() => $('#updateNow').click(), 300); });
  return items;
}
function renderPalette() {
  const q = $('#paletteInput').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const ul = $('#paletteList'); ul.innerHTML = '';
  paletteShown = paletteItems().filter(it => { const t = `${it.group} ${it.label} ${it.hint}`.toLowerCase(); return q.every(w => t.includes(w)); }).slice(0, 40);
  if (paletteSel >= paletteShown.length) paletteSel = Math.max(0, paletteShown.length - 1);
  paletteShown.forEach((it, i) => {
    const li = el('li', i === paletteSel ? 'sel' : ''); li.append(el('span', 'pg', it.group), el('b', '', it.label), el('span', 'ph', it.hint || ''));
    li.onmouseenter = () => { paletteSel = i; [...ul.children].forEach((c, j) => c.classList.toggle('sel', j === i)); };
    li.onclick = () => runPalette(i); ul.appendChild(li);
  });
  if (!paletteShown.length) ul.append(el('li', 'none', 'Nichts gefunden'));
}
function runPalette(i) { const it = paletteShown[i]; if (!it) return; $('#paletteDialog').close(); setTimeout(() => it.run(), 0); }
async function openPalette() {
  const d = $('#paletteDialog'); if (d.open) { d.close(); return; }
  try { paletteFavs = await api.favorites.list(); } catch { paletteFavs = []; }
  $('#paletteInput').value = ''; paletteSel = 0; renderPalette(); d.showModal(); $('#paletteInput').focus();
}
$('#paletteInput').oninput = () => { paletteSel = 0; renderPalette(); };
$('#paletteInput').onkeydown = (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(paletteShown.length - 1, paletteSel + 1); renderPalette(); $('#paletteList .sel')?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(0, paletteSel - 1); renderPalette(); $('#paletteList .sel')?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteSel); }
};
$('#paletteDialog').addEventListener('click', (e) => { if (e.target === $('#paletteDialog')) $('#paletteDialog').close(); });
$('#paletteBtn').onclick = () => openPalette();

// ---------- Tastenkürzel ----------
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey; if (!ctrl || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && document.activeElement.id !== 'paletteInput';
  const anyDialog = [...document.querySelectorAll('dialog')].some(d => d.open && d.id !== 'paletteDialog');
  if (e.key.toLowerCase() === 'k') { e.preventDefault(); if (!anyDialog) openPalette(); return; }
  if (typing || anyDialog) return;
  if (e.key === 'Enter') { e.preventDefault(); $('#playBtn').click(); return; }
  const n = Number(e.key); if (n >= 1 && n <= VIEWS.length) { e.preventDefault(); showView(VIEWS[n - 1][0]); }
});

// ---------- Hooks in bestehende Ansichten ----------
{
  const _showView = showView;
  showView = function (view) { _showView(view); if (view === 'stats') renderStats(); };
  const _loadInstalled = loadInstalled;
  loadInstalled = async function (...a) { const r = await _loadInstalled.apply(this, a); renderModsets(); return r; };
  const _renderContentView = renderContentView;
  renderContentView = function (...a) { const r = _renderContentView.apply(this, a); if (state.source !== 'installed') $('#modsetRow').classList.add('hidden'); return r; };
  const _renderServer = renderServer;
  renderServer = async function (...a) { const r = await _renderServer.apply(this, a); renderServerProps(); return r; };
  const setupBtn = $('#serverSetup'), _setup = setupBtn.onclick;
  setupBtn.onclick = async (...a) => { await _setup.apply(setupBtn, a); renderServerProps(); };
}

// =====================================================================
// LellekClient 1.9 – Export-Auswahl (.mrpack), Selbst-Updater
// =====================================================================

// ---------- Profil exportieren: .mrpack oder LellekClient-ZIP ----------
function exportProfile(p) {
  const d = $('#infoDialog'); if (d.open) d.close();
  const body = $('#infoBody'); body.innerHTML = '';
  body.append(el('h2', '', `„${p.name}“ exportieren`));
  const opt = (title, desc, fn) => { const b = el('button', 'export-opt'); b.type = 'button'; b.append(el('b', '', title), el('span', '', desc)); b.onclick = async () => { d.close(); await fn(); }; body.append(b); };
  opt('Modrinth-Modpack (.mrpack)', 'Für Freunde mit LellekClient, Prism, Modrinth-App oder CurseForge-App. Mods von Modrinth werden nur verlinkt – die Datei bleibt klein.', async () => {
    toast('Exportiere als .mrpack…');
    try { const r = await api.profiles.exportMrpack(p.id); if (r) toast(`.mrpack gespeichert – ${r.linked} Dateien verlinkt, ${r.embedded} eingebettet`); } catch (e) { toast(e.message, true); }
  });
  opt('LellekClient-Profil (.zip)', 'Komplette Kopie mit allen Mods, Configs, Packs und Einstellungen – zum Sichern oder für andere LellekClient-Nutzer.', async () => {
    try { if (await api.profiles.export(p.id)) toast('Profil exportiert'); } catch (e) { toast(e.message, true); }
  });
  d.showModal();
}

// ---------- Selbst-Updater ----------
let upd = { phase: 'idle', percent: 0, info: null }; // idle | downloading | ready
function renderUpdateUi() {
  const r = upd.info, b = $('#updateBanner');
  let chip = $('#updateChip');
  if (!chip) { chip = el('button', 'upd-chip hidden'); chip.id = 'updateChip'; chip.onclick = () => { showView('profiles'); }; $('#paletteBtn').before(chip); }
  if (!r?.newer) { chip.classList.add('hidden'); b.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  chip.textContent = upd.phase === 'ready' ? `Update ${r.latest} bereit` : upd.phase === 'downloading' ? `Update lädt ${Math.round(upd.percent * 100)} %` : `Update ${r.latest}`;
  b.classList.remove('hidden'); b.innerHTML = '';
  const txt = el('div', 'grow'); txt.append(el('b', '', `LellekClient ${r.latest} ist da`), el('span', 'muted', ` (installiert: ${r.current})${r.notes ? ' – ' + r.notes.split('\n').find(l => l.trim())?.replace(/[#*]/g, '').trim().slice(0, 110) : ''}`));
  b.append(txt);
  if (upd.phase === 'ready') { const i = el('button', 'primary', 'Neu starten & installieren'); i.onclick = installUpdate; b.append(i); }
  else if (upd.phase === 'downloading') { const bar = el('div', 'upd-bar'); const f = el('div'); f.id = 'updFill'; f.style.width = `${Math.round(upd.percent * 100)}%`; bar.append(f); b.append(bar); }
  else { const dl = el('button', 'primary', 'Jetzt aktualisieren'); dl.onclick = downloadUpdate; const pg = el('button', 'ghost', 'Release-Seite'); pg.onclick = () => api.update.open(r.url); b.append(dl, pg); }
}
checkLauncherUpdate = async function () {
  let r; try { r = await api.update.check(); } catch (e) { r = { configured: true, error: e.message }; }
  const st = $('#updateState'); if (st) st.textContent = !r.configured ? 'Keine Update-Quelle eingetragen' : r.error ? 'Fehler: ' + r.error : r.newer ? `Neu: ${r.latest} (installiert ${r.current})` : `Aktuell (${r.current})`;
  upd.info = r; renderUpdateUi();
};
async function downloadUpdate() {
  if (upd.phase !== 'idle') return;
  upd.phase = 'downloading'; upd.percent = 0; renderUpdateUi();
  try { const res = await api.update.download(); if (res?.external) { upd.phase = 'idle'; renderUpdateUi(); toast('Download im Browser gestartet – danach die neue App in „Programme“ ziehen'); return; } upd.phase = 'ready'; renderUpdateUi(); toast(`Update ${upd.info.latest} geladen – „Neu starten & installieren“ klicken`); }
  catch (e) { upd.phase = 'idle'; renderUpdateUi(); toast(e.message, true); }
}
async function installUpdate() {
  if (!confirm('LellekClient schließt sich, installiert das Update im Hintergrund und startet danach neu. Weiter?')) return;
  try { toast('Installiere Update…'); await api.update.install(); } catch (e) { toast(e.message, true); }
}
api.update.onProgress(({ percent, done, total }) => {
  upd.percent = percent; const f = $('#updFill'); if (f) f.style.width = `${Math.round(percent * 100)}%`;
  const chip = $('#updateChip'); if (chip) chip.textContent = `Update lädt ${Math.round(percent * 100)} %`;
  toast(`Update wird geladen: ${Math.round(percent * 100)} % (${fmtSize(done)} von ${fmtSize(total)})`);
});

// ---------- Befehlspalette: neue Einträge ----------
{
  const _items = paletteItems;
  paletteItems = function () {
    const items = _items(), cur = currentProfile();
    if (cur) items.push({ group: 'Aktion', label: 'Als Modrinth-Modpack (.mrpack) exportieren', hint: cur.name, run: async () => { try { const r = await api.profiles.exportMrpack(cur.id); if (r) toast(`.mrpack gespeichert – ${r.linked} verlinkt, ${r.embedded} eingebettet`); } catch (e) { toast(e.message, true); } } });
    items.push({ group: 'Aktion', label: 'Profil oder .mrpack importieren', hint: '', run: () => $('#importProfile').click() });
    if (upd.info?.newer) items.push({ group: 'Aktion', label: upd.phase === 'ready' ? `Update ${upd.info.latest} installieren` : `Update ${upd.info.latest} laden`, hint: 'Launcher', run: () => upd.phase === 'ready' ? installUpdate() : downloadUpdate() });
    return items;
  };
}
