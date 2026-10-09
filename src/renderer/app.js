const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = window.lellek;

const state = { profiles: [], current: null, versions: [], latest: {}, account: null, view: 'play', kind: 'mods', source: 'installed', busy: false, page: 0, lastQuery: '' };

// ---------- Hilfen ----------
const fmtSize = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' Mio.' : n >= 1e3 ? Math.round(n / 1e3) + ' Tsd.' : String(n || 0);
const LOADER_NAMES = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
const loaderLabel = (p) => p.loader ? `${LOADER_NAMES[p.loader] || p.loader} ${p.loaderVersion}` : 'Vanilla';
const currentProfile = () => state.profiles.find(p => p.id === state.current);
const headCache = new Map();
/** Kopf (8x8 + Hut-Ebene) aus der Skin-Textur, als Data-URL 64px */
async function headUrl(uuid) {
  if (headCache.has(uuid)) return headCache.get(uuid);
  let out = '';
  try {
    const sk = await api.skin.of(uuid);
    if (sk) {
      const img = new Image(); img.src = sk.dataUrl; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
      g.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
      out = c.toDataURL();
    }
  } catch {}
  if (!out) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#C9A57A'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#5A3B28'; g.fillRect(0, 0, 64, 16); out = c.toDataURL(); }
  headCache.set(uuid, out);
  return out;
}
const setHead = (img, uuid) => { headUrl(uuid).then(u => { img.src = u; }); };
function log(line) { const el = $('#log'); el.textContent += line + '\n'; el.scrollTop = el.scrollHeight; }
function toast(msg, isError) { $('#progressText').textContent = msg; $('#progressText').style.color = isError ? 'var(--danger)' : ''; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// ---------- Navigation ----------
$$('.rail-btn').forEach(b => b.onclick = () => showView(b.dataset.view));
function showView(view) {
  state.view = view;
  $$('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => { v.classList.remove('active'); if (v.dataset.view === view) { void v.offsetWidth; v.classList.add('active'); } });
  if (view === 'profiles') renderProfiles();
  if (view === 'content') renderContentView();
  if (view === 'skins') renderSkins();
  if (view === 'worlds') renderWorlds();
  if (view === 'server') renderServer();
  if (view === 'settings') loadSettings();
}

// ---------- 3D-Skin ----------
let viewer = null;
function placeholderSkin() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2E3340'; g.fillRect(0, 0, 64, 64);            // Körper/Arme/Beine dunkel
  g.fillStyle = '#FFB400'; g.fillRect(16, 20, 24, 12);          // Brust gold
  g.fillStyle = '#C9A57A'; g.fillRect(0, 0, 32, 16);            // Kopf
  g.fillStyle = '#5A3B28'; g.fillRect(8, 8, 8, 2);              // Haaransatz
  g.fillStyle = '#FFFFFF'; g.fillRect(9, 12, 2, 1); g.fillRect(13, 12, 2, 1);
  g.fillStyle = '#3B3B8F'; g.fillRect(10, 12, 1, 1); g.fillRect(13, 12, 1, 1);
  return c.toDataURL();
}
let skinFallback = false;
async function initSkin() {
  const canvas = $('#skinCanvas');
  try { viewer = new skinview3d.SkinViewer({ canvas, width: 360, height: 440, skin: placeholderSkin() }); }
  catch (e) { // kein WebGL (z. B. Remote-Desktop, alte Grafiktreiber) → 2D-Ansicht
    skinFallback = true;
    const img = el('img', 'skin-2d'); img.alt = ''; img.id = 'skin2d';
    canvas.replaceWith(img); refreshSkin(); return;
  }
  viewer.zoom = 0.85;
  viewer.autoRotate = false;
  viewer.animation = new skinview3d.IdleAnimation();
  viewer.animation.speed = 0.7;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) viewer.animation = null;
  refreshSkin();
}
async function refreshSkin() {
  const a = state.account;
  $('#nameTag').textContent = a ? a.name : 'Gast';
  if (skinFallback) { const i = $('#skin2d'); if (i) { const sk = a ? await api.skin.of(a.id) : null; i.src = sk ? sk.dataUrl : ''; } return; }
  if (!viewer) return;
  if (!a) { viewer.loadSkin(placeholderSkin()); viewer.loadCape(null); return; }
  try {
    const sk = await api.skin.of(a.id);
    const tex = sk?.dataUrl, slim = sk ? sk.slim : a.skins.find(s => s.state === 'ACTIVE')?.variant === 'SLIM';
    if (tex) await viewer.loadSkin(tex, { model: slim ? 'slim' : 'default' });
    else log('Skin konnte nicht von Mojang geladen werden');
    const cape = a.capes.find(c => c.state === 'ACTIVE');
    // Cape-Texturen liegen auf Mojang-Servern ohne CORS – nur anzeigen, wenn erreichbar
    try { cape ? await viewer.loadCape(cape.url) : viewer.loadCape(null); } catch { viewer.loadCape(null); }
  } catch (e) { log('Skin konnte nicht geladen werden: ' + e.message); }
}

// ---------- Profile ----------
async function loadProfiles() {
  state.profiles = await api.profiles.list();
  if (!currentProfile()) state.current = state.profiles[0]?.id || null;
  $('#profileCount').textContent = `${state.profiles.length} ${state.profiles.length === 1 ? 'Profil' : 'Profile'}`;
  renderLaunch();
  if (state.view === 'profiles') renderProfiles();
}
function renderQuickTiles() {
  const box = $('#quickTiles'); if (!box) return; box.innerHTML = '';
  const recent = [...state.profiles].filter(p => p.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 3);
  for (const p of recent) { const t = el('div', 'tile'); t.style.borderColor = p.color || ''; t.append(el('span', 'ic', p.icon || '▶'), el('span', '', p.name), el('span', 'v', p.version)); t.onclick = async () => { state.current = p.id; renderLaunch(); if (!runningSet.has(p.id)) { try { await api.launch(p.id); runningSet.add(p.id); updatePlayButton(); renderRunning(); } catch (e) { toast(e.message, true); } } }; box.appendChild(t); }
}
function renderLaunch() {
  renderQuickTiles();
  const p = currentProfile();
  if (typeof runningSet !== 'undefined') updatePlayButton();
  $('#launchSub').textContent = p ? `${p.name} · ${p.version} · ${loaderLabel(p).split(' ')[0]}` : 'Kein Profil – lege eins an';
  const menu = $('#launchMenu');
  menu.innerHTML = '';
  for (const q of state.profiles) {
    const li = el('li', q.id === state.current ? 'active' : '');
    li.append(el('b', '', q.name), el('span', '', `${q.version} ${loaderLabel(q).split(' ')[0]}`));
    li.onclick = () => { state.current = q.id; menu.classList.add('hidden'); renderLaunch(); };
    menu.appendChild(li);
  }
  const add = el('li', '', '+ Neues Profil');
  add.onclick = () => { menu.classList.add('hidden'); openProfileDialog(); };
  menu.appendChild(add);
}
$('#pickProfile').onclick = (e) => { e.stopPropagation(); $('#launchMenu').classList.toggle('hidden'); };
document.addEventListener('click', () => $('#launchMenu').classList.add('hidden'));

async function renderProfiles() {
  const pl = $('#presetList'); pl.innerHTML = '';
  let presets = [];
  try { presets = await api.presets.list(); }
  catch (e) { pl.append(el('p', 'muted', 'Vorlagen brauchen eine Internetverbindung (' + e.message + ')')); }
  for (const t of presets) {
    const c = el('div', 'card');
    c.append(el('b', '', t.name), el('span', 'ver', `${t.version} · ${t.loader}`), el('span', 'muted', t.hint));
    const act = el('div', 'actions');
    const b = el('button', 'primary', 'Anlegen');
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Lädt…';
      try {
        const r = await api.presets.create(t.key);
        state.current = r.id;
        await loadProfiles();
        toast(r.hudInstalled ? 'Profil mit LellekHUD angelegt' : 'Profil angelegt');
        renderProfiles();
        openBundle(currentProfile());
      } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Anlegen'; }
    };
    act.append(b); c.append(act); pl.appendChild(c);
  }
  const pc = $('#profileCards'); pc.innerHTML = '';
  if (!state.profiles.length) pc.append(el('p', 'muted', 'Noch keine Profile. Nimm eine Vorlage oder lege ein eigenes an.'));
  const total = state.profiles.reduce((a, p) => a + (p.playtimeMs || 0), 0), top = [...state.profiles].sort((a, b) => (b.playtimeMs || 0) - (a.playtimeMs || 0))[0];
  const sb = $('#statsBar'); sb.innerHTML = '';
  if (total) sb.append(el('span', '', `Gesamt: `), el('b', '', `${Math.floor(total / 3600000)} h ${Math.round(total / 60000) % 60} min`), el('span', '', `· Meistgespielt: `), el('b', '', top.name));
  const q = ($('#profileSearch').value || '').toLowerCase(), sort = $('#profileSort').value;
  const list = state.profiles.filter(p => !q || p.name.toLowerCase().includes(q) || p.version.includes(q)).sort((a, b) => sort === 'played' ? (b.lastPlayed || 0) - (a.lastPlayed || 0) : sort === 'time' ? (b.playtimeMs || 0) - (a.playtimeMs || 0) : a.name.localeCompare(b.name));
  for (const p of list) {
    const c = el('div', 'card' + (p.id === state.current ? ' active' : '')); if (p.color) c.style.borderLeft = `4px solid ${p.color}`;
    const title = el('b'); if (p.icon) title.append(el('span', 'ic', p.icon)); title.append(document.createTextNode(p.name));
    c.append(title, el('span', 'ver', `${p.version} · ${loaderLabel(p)} · ${p.memory || 4} GB${p.accountId ? ' · eigenes Konto' : ''}${runningSet.has(p.id) ? ' · läuft' : ''}`));
    const act = el('div', 'actions');
    const start = el('button', 'primary', runningSet.has(p.id) ? 'Log' : 'Starten');
    start.onclick = async () => { if (runningSet.has(p.id)) { api.launchOpenLog(p.id); return; } start.disabled = true; try { await api.launch(p.id); runningSet.add(p.id); toast(`${p.name} läuft`); } catch (e) { toast(e.message, true); } renderProfiles(); renderRunning(); updatePlayButton(); };
    act.append(start);
    const use = el('button', 'primary', p.id === state.current ? 'Ausgewählt' : 'Auswählen');
    use.onclick = () => { state.current = p.id; renderLaunch(); renderProfiles(); };
    const edit = el('button', 'ghost', 'Bearbeiten'); edit.onclick = () => openProfileDialog(p);
    const folder = el('button', 'ghost', 'Ordner'); folder.onclick = () => api.profiles.openFolder(p.id);
    const kit = el('button', 'ghost', 'Ausstattung'); kit.onclick = () => openBundle(p);
    const dup = el('button', 'ghost', 'Duplizieren'); dup.onclick = async () => { toast('Kopiere…'); try { state.profiles = await api.profiles.duplicate(p.id); renderProfiles(); renderLaunch(); toast('Profil kopiert'); } catch (e) { toast(e.message, true); } };
    const exp = el('button', 'ghost', 'Export'); exp.onclick = () => exportProfile(p);
    const pm = Math.round((p.playtimeMs || 0) / 60000);
    c.append(el('span', 'stat', `Spielzeit ${pm >= 60 ? Math.floor(pm / 60) + ' h ' : ''}${pm % 60} min${p.lastPlayed ? ' · zuletzt ' + new Date(p.lastPlayed).toLocaleDateString('de-DE') : ''}`));
    const lnk = el('button', 'ghost', 'Desktop-Link'); lnk.title = 'Verknüpfung auf dem Desktop, die dieses Profil direkt startet'; lnk.onclick = () => createShortcut(p.id);
    act.append(use, edit, kit, dup, exp, ...(/Mac/.test(navigator.userAgent) ? [] : [lnk]), folder); c.append(act); pc.appendChild(c);
  }
}

// ---------- Profil-Dialog ----------
const dlg = $('#profileDialog');
let editing = null;
async function ensureVersions() { if (!state.versions.length) { const r = await api.versions.list(); state.versions = r.versions; state.latest = r.latest; } }
function fillVersions(selected) {
  const showAll = $('#showSnapshots').checked, sel = $('#versionSelect');
  sel.innerHTML = '';
  for (const v of state.versions) { if (!showAll && v.type !== 'release') continue; sel.add(new Option(v.type === 'release' ? v.id : `${v.id} (${v.type})`, v.id)); }
  sel.value = selected || state.latest.release;
  if (!sel.value) sel.selectedIndex = 0;
}
async function fillLoaderVersions(selected) {
  const loader = $('#loaderSelect').value;
  $('#loaderVersionRow').classList.toggle('hidden', !loader);
  if (!loader) return;
  const mc = $('#versionSelect').value, sel = $('#loaderVersionSelect');
  sel.innerHTML = '<option>lädt…</option>';
  const list = loader === 'fabric' ? await api.versions.fabric(mc) : loader === 'neoforge' ? await api.versions.neoforge(mc) : await api.versions.forge(mc);
  sel.innerHTML = '';
  if (!list.length) { sel.add(new Option(`Kein ${loader} für ${mc}`, '')); return; }
  for (const v of list) sel.add(new Option(v, v));
  if (selected && list.includes(selected)) sel.value = selected;
}
async function openProfileDialog(p) {
  editing = p || null;
  await ensureVersions();
  const f = $('#profileForm');
  $('#dialogTitle').textContent = p ? 'Profil bearbeiten' : 'Neues Profil';
  $('#deleteProfile').classList.toggle('hidden', !p);
  f.name.value = p?.name || ''; f.icon.value = p?.icon || ''; f.color.value = p?.color || '#FFB400';
  $('#showSnapshots').checked = !!p && state.versions.find(v => v.id === p.version)?.type !== 'release';
  fillVersions(p?.version);
  f.loader.value = p?.loader || '';
  f.memory.value = p?.memory || 4;
  f.javaPath.value = p?.javaPath || '';
  f.linkVanilla.checked = !!p?.linkVanilla; f.width.value = p?.width || ''; f.height.value = p?.height || ''; f.fullscreen.checked = !!p?.fullscreen; f.jvmArgs.value = p?.jvmArgs || ''; f.autoServer.value = p?.autoServer || '';
  $('#importVanillaNow').classList.toggle('hidden', !p);
  $('#importVanillaNow').onclick = async () => { try { const ok = await api.vanilla.importSettings(p.id); toast(ok ? 'Einstellungen übernommen' : 'Nichts gefunden in .minecraft'); } catch (e) { toast(e.message, true); } };
  const accounts = await api.auth.list(); const asel = $('#accountSelect'); asel.innerHTML = ''; asel.add(new Option('Aktives Konto', ''));
  for (const a of accounts) asel.add(new Option(a.name, a.id)); asel.value = p?.accountId || '';
  await fillLoaderVersions(p?.loaderVersion);
  dlg.showModal();
}
$('#showSnapshots').onchange = () => { fillVersions($('#versionSelect').value); fillLoaderVersions(); };
$('#versionSelect').onchange = () => fillLoaderVersions();
$('#loaderSelect').onchange = () => fillLoaderVersions();
$('#cancelProfile').onclick = () => dlg.close();
$('#newProfile').onclick = () => openProfileDialog();
$('#profileSearch').oninput = () => renderProfiles(); $('#profileSort').onchange = () => renderProfiles();
$('#importOther').onclick = async () => {
  const box = $('#importList'); box.innerHTML = ''; box.append(el('p', 'muted', 'Suche…')); $('#importDialog').showModal();
  const found = await api.imports.scan(); box.innerHTML = '';
  if (!found.length) { box.append(el('p', 'muted', 'Nichts gefunden. Unterstützt: offizieller Launcher, Prism, MultiMC, CurseForge-App, Modrinth-App, ATLauncher.')); return; }
  let src = '';
  for (const it of found) {
    if (it.source !== src) { src = it.source; box.append(el('div', 'bundle-group', src)); }
    const row = el('div', 'bundle-item'); row._item = it;
    const cb = el('input'); cb.type = 'checkbox';
    const body = el('div'); body.append(el('b', '', `${it.name} · ${it.version}${it.loader ? ' ' + it.loader + ' ' + it.loaderVersion : ' Vanilla'}`), el('span', '', `${it.mods} Mods · ${it.worlds} Welten${it.hasOptions ? ' · Einstellungen' : ''}${it.note ? ' · ' + it.note : ''}`));
    row.append(cb, body, el('span', 'state', '')); box.appendChild(row);
  }
};
$('#importClose').onclick = () => $('#importDialog').close();
$('#importGo').onclick = async () => {
  const rows = $$('#importList .bundle-item').filter(r => r.querySelector('input').checked);
  if (!rows.length) { toast('Nichts ausgewählt', true); return; }
  const parts = { mods: $('#impMods').checked, worlds: $('#impWorlds').checked, settings: $('#impSettings').checked, packs: $('#impPacks').checked };
  const b = $('#importGo'); b.disabled = true; let ok = 0;
  for (const r of rows) { const st = r.querySelector('.state'); st.textContent = 'Importiert…'; try { const res = await api.imports.profile({ ...r._item, parts }); st.textContent = `✓ ${res.copied} übernommen`; state.profiles = res.profiles; state.current = res.id; ok++; } catch (e) { st.textContent = e.message; st.classList.add('err'); } }
  b.disabled = false; renderProfiles(); renderLaunch(); toast(`${ok} Profil(e) importiert`);
};
async function checkLauncherUpdate(force) {
  const r = await api.update.check(); const b = $('#updateBanner');
  if ($('#updateState')) $('#updateState').textContent = !r.configured ? 'Keine Update-Quelle eingetragen' : r.error ? 'Fehler: ' + r.error : r.newer ? `Neu: ${r.latest} (installiert ${r.current})` : `Aktuell (${r.current})`;
  if (r.configured && r.newer) { b.classList.remove('hidden'); b.innerHTML = ''; b.append(el('b', '', `LellekClient ${r.latest} ist da`), el('span', 'muted', r.notes ? r.notes.split('\n')[0].slice(0, 100) : '')); const dl = el('button', 'primary', 'Herunterladen'); dl.onclick = () => api.update.open(r.url); b.append(dl); }
  else b.classList.add('hidden');
}
$('#importProfile').onclick = async () => { try { const r = await api.profiles.import(); if (r) { state.profiles = r.profiles; state.current = r.id; renderProfiles(); renderLaunch(); toast(`Profil „${r.name}“ importiert`); } } catch (e) { toast(e.message, true); } };
$('#deleteProfile').onclick = async () => {
  if (!editing || !confirm(`Profil „${editing.name}“ löschen? Der Ordner mit Mods und Welten bleibt erhalten.`)) return;
  await api.profiles.delete(editing.id); dlg.close(); await loadProfiles(); renderProfiles();
};
$('#profileForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, loader = f.loader.value;
  if (loader && !f.loaderVersion.value) { alert(`Für diese Version gibt es kein ${loader}.`); return; }
  const p = { id: editing?.id, name: f.name.value.trim(), version: f.version.value, loader, loaderVersion: loader ? f.loaderVersion.value : '', memory: Number(f.memory.value) || 4, javaPath: f.javaPath.value.trim(), accountId: f.accountId.value || '', linkVanilla: f.linkVanilla.checked, installed: editing?.installed || {}, width: Number(f.width.value) || 0, height: Number(f.height.value) || 0, fullscreen: f.fullscreen.checked, jvmArgs: f.jvmArgs.value.trim(), autoServer: f.autoServer.value.trim(), icon: f.icon.value.trim(), color: f.color.value };
  const list = await api.profiles.save(p);
  state.current = p.id || list[list.length - 1].id;
  try { await api.vanilla.link({ profileId: state.current, enable: f.linkVanilla.checked }); } catch (e) { toast('Verknüpfung: ' + e.message, true); }
  dlg.close(); await loadProfiles(); renderProfiles();
};

// ---------- Inhalte ----------
const HINTS = {
  mods: 'Mods brauchen Fabric, Forge oder NeoForge im Profil.',
  shaderpacks: 'Shader brauchen Iris (Fabric) oder OptiFine/Oculus (Forge).',
  resourcepacks: 'Im Spiel unter Optionen → Resourcepacks aktivieren.',
  datapacks: 'Datapacks gelten pro Welt: aus diesem Ordner nach <Welt>/datapacks kopieren.',
};
const TITLES = { mods: 'Mods', shaderpacks: 'Shader', resourcepacks: 'Resourcepacks', datapacks: 'Datapacks', modpacks: 'Modpacks' };
HINTS.modpacks = 'Ein Modpack wird als eigenes Profil installiert – mit passender Version, Loader und allen Mods.';
$$('#kindSeg button').forEach(b => b.onclick = () => { state.kind = b.dataset.kind; state.page = 0; renderContentView(); });
$$('#sourceSeg button').forEach(b => b.onclick = () => { state.source = b.dataset.source; state.page = 0; renderContentView(); });
$('#contentProfile').onchange = (e) => { state.current = e.target.value; renderLaunch(); renderContentView(); };
function renderContentView() {
  $$('#kindSeg button').forEach(b => b.classList.toggle('active', b.dataset.kind === state.kind));
  $$('#sourceSeg button').forEach(b => b.classList.toggle('active', b.dataset.source === state.source));
  $('#contentTitle').textContent = TITLES[state.kind];
  $('#contentHint').textContent = HINTS[state.kind];
  const sel = $('#contentProfile'); sel.innerHTML = '';
  for (const p of state.profiles) sel.add(new Option(`${p.name} (${p.version})`, p.id));
  sel.value = state.current || '';
  const packs = state.kind === 'modpacks';
  if (packs && state.source === 'installed') state.source = 'modrinth';
  $$('#sourceSeg button[data-source="installed"]').forEach(b => b.classList.toggle('hidden', packs));
  $$('#sourceSeg button').forEach(b => b.classList.toggle('active', b.dataset.source === state.source));
  $('#contentProfile').classList.toggle('hidden', packs);
  const browsing = state.source !== 'installed';
  $('#installedPane').classList.toggle('hidden', browsing);
  $('#browsePane').classList.toggle('hidden', !browsing);
  browsing ? runSearch(true) : loadInstalled();
}
async function loadInstalled() {
  const ul = $('#contentList'); ul.innerHTML = '';
  const empty = $('#contentEmpty');
  if (!state.current) { empty.classList.remove('hidden'); empty.textContent = 'Lege zuerst ein Profil an.'; return; }
  const files = await api.content.list({ profileId: state.current, kind: state.kind });
  empty.classList.toggle('hidden', files.length > 0);
  empty.textContent = 'Noch nichts installiert. Stöbere bei Modrinth oder CurseForge, oder füge eine Datei hinzu.';
  updates = {};
  $('#updateAll').classList.add('hidden'); $('#updateInfo').textContent = '';
  for (const f of files) {
    const li = el('li', f.enabled ? '' : 'off'); li.dataset.file = f.file;
    const acts = el('span', 'row gap');
    const tgl = el('button', 'ghost', f.enabled ? 'Deaktivieren' : 'Aktivieren');
    tgl.onclick = async () => { await api.content.toggle({ profileId: state.current, kind: state.kind, file: f.file }); loadInstalled(); };
    const rm = el('button', 'ghost danger', 'Löschen');
    rm.onclick = async () => { if (confirm(`${f.name} löschen?`)) { await api.content.remove({ profileId: state.current, kind: state.kind, file: f.file }); loadInstalled(); } };
    acts.append(tgl, rm);
    const nameCell = el('span'); const nb = el('button', 'name-btn', f.name); nb.onclick = () => showInfo(f); nameCell.append(nb, el('span', 'updtag hidden'));
    li.append(el('span', 'dot'), nameCell, el('span', 'size', fmtSize(f.size)), acts);
    ul.appendChild(li);
  }
  if (files.length) checkUpdates(false);
}
let updates = {};
async function showInfo(f) {
  const body = $('#infoBody'); body.innerHTML = ''; body.append(el('p', 'muted', 'Lade…')); $('#infoDialog').showModal();
  if (state.kind === 'mods') {
    const i = await api.modInfo({ profileId: state.current, kind: state.kind, file: f.file }); body.innerHTML = '';
    if (i.icon) { const img = el('img'); img.src = i.icon; body.append(img); }
    body.append(el('h2', '', i.title), el('p', 'muted', i.description || ''));
    if (!i.local) { body.append(el('p', 'muted', `Version ${i.version} · ${fmtNum(i.downloads)} Downloads · ${(i.loaders || []).join(', ')} · ${(i.gameVersions || []).join(', ')}`)); const a = el('button', 'ghost small', 'Auf Modrinth öffnen'); a.onclick = () => api.bundle.open(i.url); body.append(a); body.append(el('div', 'pre', (i.body || '').replace(/[#*`>]/g, ''))); }
  } else {
    const pv = await api.packPreview({ profileId: state.current, kind: state.kind, file: f.file }); body.innerHTML = '';
    if (pv?.icon) { const img = el('img'); img.src = pv.icon; body.append(img); }
    body.append(el('h2', '', f.name), el('p', 'muted', pv?.description || 'Keine Beschreibung'), el('p', 'muted', pv?.format ? `pack_format ${pv.format}` : ''));
  }
}
$('#infoClose').onclick = () => $('#infoDialog').close();
async function checkUpdates(force = true) {
  if (!state.current || state.kind === 'modpacks') return;
  const b = $('#checkUpdates'); b.disabled = true; b.textContent = 'Prüft…';
  try {
    const res = await api.content.checkUpdates({ profileId: state.current, kind: state.kind, force });
    updates = {}; let n = 0;
    for (const r of res) {
      const li = $(`#contentList li[data-file="${CSS.escape(r.file)}"]`); if (!li) continue;
      const tag = li.querySelector('.updtag'); if (!tag) continue; tag.classList.remove('hidden'); tag.style.color = ''; li.querySelectorAll('.row button.primary').forEach(b => b.remove());
      if (r.status === 'update') {
        n++; updates[r.file] = r; tag.textContent = `→ ${r.newVersion} (${r.source === 'curseforge' ? 'CurseForge' : 'Modrinth'})`; tag.className = 'updtag upd'; tag.title = 'Klicken: Änderungen anzeigen'; tag.style.cursor = 'pointer'; tag.onclick = () => showChangelog(r);
        const up = el('button', 'primary', 'Aktualisieren'); up.onclick = () => applyUpdate(r, up);
        li.querySelector('.row').prepend(up);
      } else if (r.status === 'current') { tag.textContent = 'aktuell'; tag.className = 'updtag cur'; }
      else if (r.status === 'manual') { tag.textContent = `→ ${r.newVersion} – nur manuell (CurseForge)`; tag.className = 'updtag upd'; }
      else { tag.textContent = 'unbekannte Quelle'; tag.className = 'updtag upd'; tag.style.color = 'var(--muted)'; }
    }
    $('#updateInfo').textContent = n ? `${n} Update(s) verfügbar` : 'Alles aktuell';
    $('#updateAll').classList.toggle('hidden', n === 0);
  } catch (e) { toast(e.message, true); }
  b.disabled = false; b.textContent = 'Updates prüfen';
}
async function applyUpdate(r, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Lädt…'; }
  try { await api.content.update({ profileId: state.current, kind: state.kind, file: r.file, url: r.url, newFile: r.newFile, projectId: r.projectId }); toast(`${r.newFile} installiert`); }
  catch (e) { toast(e.message, true); }
}
$('#checkUpdates').onclick = () => checkUpdates(true);
$('#checkConflicts').onclick = async () => { const c = await api.modtools.conflicts(state.current); if (!c.length) { toast('Keine doppelten Mods'); return; } $('#updateInfo').textContent = 'Konflikte: ' + c.map(x => `${x.id} (${x.files.map(f => f.file).join(' + ')})`).join(' · '); toast(`${c.length} Mod(s) doppelt – siehe Hinweis`, true); };
$('#safeMode').onclick = async () => {
  const p = currentProfile(); if (!p) return;
  const b = $('#safeMode');
  if (b.dataset.on) { const n = await api.modtools.safeToggle({ profileId: p.id, disable: false }); delete b.dataset.on; b.textContent = 'Sicherer Start (ohne Mods)'; toast(`${n} Mods wieder aktiv`); loadInstalled(); return; }
  if (!confirm('Alle Mods außer LellekHUD vorübergehend deaktivieren und starten? Danach „Mods wieder aktivieren“ klicken.')) return;
  const n = await api.modtools.safeToggle({ profileId: p.id, disable: true }); b.dataset.on = '1'; b.textContent = `Mods wieder aktivieren (${n})`; loadInstalled();
  try { await api.launch(p.id); runningSet.add(p.id); updatePlayButton(); renderRunning(); } catch (e) { toast(e.message, true); }
};
$('#updateAll').onclick = async () => {
  const b = $('#updateAll'); b.disabled = true; b.textContent = 'Aktualisiert…';
  for (const r of Object.values(updates)) await applyUpdate(r, null);
  b.disabled = false; b.textContent = 'Alle aktualisieren';
  toast('Alle Updates installiert'); loadInstalled();
};
$('#contentAdd').onclick = async () => { const n = await api.content.add({ profileId: state.current, kind: state.kind }); if (n) { toast(`${n} Datei(en) hinzugefügt`); loadInstalled(); } };
$('#contentFolder').onclick = () => api.content.openFolder({ profileId: state.current, kind: state.kind });
// Drag & Drop: Jars/ZIPs auf die Mods-/Shader-/Resourcepack-Liste ziehen
const dropZone = document.querySelector('.view[data-view="content"]');
dropZone.addEventListener('dragover', (e) => { if (state.source !== 'installed' || state.kind === 'modpacks') return; e.preventDefault(); dropZone.classList.add('dropping'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dropping'));
dropZone.addEventListener('drop', async (e) => {
  dropZone.classList.remove('dropping'); if (state.source !== 'installed' || state.kind === 'modpacks' || !state.current) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map(f => api.pathOf(f)).filter(Boolean);
  if (!paths.length) return;
  const n = await api.content.drop({ profileId: state.current, kind: state.kind, paths });
  toast(n ? `${n} Datei(en) hinzugefügt` : 'Nur .jar und .zip werden übernommen', !n); loadInstalled();
});

// Mod-Browser
$('#browseGo').onclick = () => runSearch(true);
$('#browseQuery').onkeydown = (e) => { if (e.key === 'Enter') runSearch(true); };
$('#browseMore').onclick = () => runSearch(false);
async function runSearch(reset) {
  const p = currentProfile(), out = $('#browseResults'), info = $('#browseInfo');
  if (reset) { state.page = 0; out.innerHTML = ''; } else state.page++;
  $('#browseMore').classList.add('hidden');
  if (state.kind === 'modpacks') {
    info.textContent = 'Suche…';
    try {
      const r = await api.packs.search({ source: state.source, query: $('#browseQuery').value.trim(), page: state.page });
      info.textContent = `${fmtNum(r.total)} Modpacks`;
      for (const it of r.items) out.appendChild(packCard(it));
      $('#browseMore').classList.toggle('hidden', (state.page + 1) * 20 >= r.total);
    } catch (e) { info.textContent = e.message; }
    return;
  }
  if (!p) { info.textContent = 'Lege zuerst ein Profil an.'; return; }
  if (state.kind === 'mods' && !p.loader) { info.textContent = `„${p.name}“ ist Vanilla – Mods brauchen Fabric, Forge oder NeoForge im Profil.`; return; }
  info.textContent = 'Suche…';
  try {
    const r = await api.browse.search({ source: state.source, kind: state.kind, query: $('#browseQuery').value.trim(), version: p.version, loader: p.loader, page: state.page });
    info.textContent = `${fmtNum(r.total)} Treffer für ${p.version}${state.kind === 'mods' ? ' / ' + p.loader : ''}`;
    for (const it of r.items) out.appendChild(resultCard(it));
    $('#browseMore').classList.toggle('hidden', (state.page + 1) * 20 >= r.total);
  } catch (e) { info.textContent = e.message; }
}
function packCard(it) {
  const c = el('div', 'result');
  const img = el('img'); img.src = it.icon || ''; img.alt = '';
  const body = el('div');
  body.append(el('b', '', it.name), el('p', '', it.summary || ''), el('span', 'meta', `${it.author || ''} · ${fmtNum(it.downloads)} Downloads · ${it.versions || ''}`));
  const b = el('button', 'primary', 'Als Profil installieren');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Installiert…'; toast('Modpack wird installiert – Fortschritt unten');
    try { const r = await api.packs.install({ source: it.source, projectId: it.id, name: it.name }); state.profiles = r.profiles; state.current = r.id; renderLaunch(); b.textContent = 'Installiert'; toast(`${r.name} (${r.version}, ${r.loader}) mit ${r.mods} Dateien angelegt${r.skipped ? `, ${r.skipped} manuell nötig – siehe Log` : ''}`); if (r.skipped) $('#log').classList.remove('hidden'); }
    catch (e) { b.disabled = false; b.textContent = 'Als Profil installieren'; toast(e.message, true); }
  };
  c.append(img, body, b); attachDetails(c, it);
  return c;
}
function resultCard(it) {
  const c = el('div', 'result');
  const img = el('img'); img.src = it.icon || ''; img.alt = '';
  const body = el('div');
  body.append(el('b', '', it.name), el('p', '', it.summary || ''), el('span', 'meta', `${it.author || ''} · ${fmtNum(it.downloads)} Downloads`));
  const b = el('button', 'primary', 'Installieren');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Lädt…';
    try { const f = await api.browse.install({ source: it.source, kind: state.kind, projectId: it.id, profileId: state.current }); b.textContent = 'Installiert'; toast(`${f} installiert`); }
    catch (e) { b.disabled = false; b.textContent = 'Installieren'; toast(e.message, true); }
  };
  c.append(img, body, b); attachDetails(c, it);
  return c;
}

// ---------- Konto & Skins ----------
let accountRender = 0;
async function renderAccount() {
  const seq = ++accountRender;
  const accounts = await api.auth.list();
  if (seq !== accountRender) return; // ein neuerer Aufruf läuft schon
  const box = $('#account'); box.innerHTML = '';
  const btn = el('button', 'account-btn');
  if (state.account) { const img = el('img'); setHead(img, state.account.id); img.alt = ''; btn.append(img, el('span', 'name', state.account.name), el('span', 'muted', '▾')); }
  else btn.append(el('span', '', accounts.length ? 'Konto wählen ▾' : 'Mit Microsoft anmelden'));
  const menu = el('div', 'account-menu hidden');
  for (const a of accounts) {
    const it = el('div', 'item' + (a.current ? ' current' : ''));
    const img = el('img'); setHead(img, a.id); img.alt = '';
    const x = el('span', 'x', '✕'); x.title = 'Konto entfernen';
    x.onclick = async (e) => { e.stopPropagation(); await api.auth.remove(a.id); state.account = await api.auth.current(); renderAccount(); renderSkins(); refreshSkin(); };
    it.append(img, el('span', '', a.name), x);
    it.onclick = async () => { if (a.current) return; try { toast('Wechsle zu ' + a.name + '…'); state.account = await api.auth.switch(a.id); toast('Angemeldet als ' + a.name); } catch (e) { toast(e.message, true); } renderAccount(); renderSkins(); refreshSkin(); };
    menu.appendChild(it);
  }
  if (accounts.length) menu.appendChild(el('hr'));
  const add = el('div', 'item', '+ Konto hinzufügen');
  add.onclick = async () => { try { state.account = await api.auth.login(); toast('Angemeldet'); } catch (e) { toast('Anmeldung abgebrochen: ' + e.message, true); } renderAccount(); renderSkins(); refreshSkin(); };
  menu.appendChild(add);
  if (state.account) { const out = el('div', 'item', 'Abmelden'); out.onclick = async () => { state.account = await api.auth.logout(); renderAccount(); renderSkins(); refreshSkin(); }; menu.appendChild(out); }
  btn.onclick = (e) => { e.stopPropagation(); if (!accounts.length && !state.account) { add.onclick(); return; } menu.classList.toggle('hidden'); };
  document.addEventListener('click', () => menu.classList.add('hidden'));
  box.append(btn, menu);
}

// Skin-Bibliothek mit 3D-Vorschauen
const skinViewers = [];
let currentViewer = null;
function skinCanvas(canvas, dataUrl, slim, w, h) {
  try {
    const v = new skinview3d.SkinViewer({ canvas, width: w, height: h, skin: dataUrl, model: slim ? 'slim' : 'default' });
    v.zoom = 0.9; v.autoRotate = true; v.autoRotateSpeed = 0.6; v.animation = new skinview3d.IdleAnimation();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.autoRotate = false; v.animation = null; }
    skinViewers.push(v); return v;
  } catch { const img = el('img', 'raw'); img.src = dataUrl; canvas.replaceWith(img); return null; }
}
async function renderSkins() {
  const a = state.account;
  $('#skinsLoggedOut').classList.toggle('hidden', !!a);
  $('#skinSaveCurrent').disabled = !a;
  for (const v of skinViewers) v.dispose?.(); skinViewers.length = 0;
  const slim = document.querySelector('input[name=variant]:checked').value === 'slim';
  // Bibliothek
  const grid = $('#skinGrid'); grid.innerHTML = '';
  let list = [];
  try { list = await api.skins.list(); } catch {}
  if (!list.length) grid.append(el('p', 'muted', 'Noch keine Skins. Füge PNGs hinzu oder speichere deinen aktuellen Skin.'));
  for (const sk of list) {
    const card = el('div', 'skin-card');
    const c = el('canvas'); c.width = 120; c.height = 150;
    const acts = el('div', 'actions');
    const use = el('button', 'primary', 'Anwenden'); use.disabled = !a;
    use.onclick = async () => { use.disabled = true; use.textContent = 'Lädt…'; try { state.account = await api.skins.apply({ file: sk.file, variant: document.querySelector('input[name=variant]:checked').value }); toast('Skin angewendet'); renderSkins(); refreshSkin(); } catch (e) { toast(e.message, true); use.disabled = false; use.textContent = 'Anwenden'; } };
    const rm = el('button', 'ghost danger', '✕'); rm.title = 'Aus Bibliothek entfernen';
    rm.onclick = async () => { if (confirm(`${sk.name} entfernen?`)) { await api.skins.remove(sk.file); renderSkins(); } };
    acts.append(use, rm);
    card.append(c, el('b', '', sk.name), acts);
    grid.appendChild(card);
    skinCanvas(c, sk.dataUrl, slim, 120, 150);
  }
  // Aktueller Skin + Capes
  const cur = $('#skinCurrent');
  if (currentViewer) { currentViewer.dispose?.(); currentViewer = null; }
  if (!a) { $('#capeList').innerHTML = ''; return; }
  const variant = a.skins.find(x => x.state === 'ACTIVE')?.variant?.toLowerCase();
  if (variant) document.querySelector(`input[name=variant][value=${variant}]`).checked = true;
  try { const tex = await api.skin.texture(); if (tex) currentViewer = skinCanvas(cur, tex, variant === 'slim', 200, 260); } catch {}
  renderCustomCape();
  const capes = $('#capeList'); capes.innerHTML = '';
  if (!a.capes.length) { capes.append(el('p', 'muted', 'Dein Konto hat keine Capes.')); return; }
  const none = el('div', 'cape' + (a.capes.some(c => c.state === 'ACTIVE') ? '' : ' active'));
  none.append(el('p', '', 'Kein Cape')); none.onclick = () => setCape(null); capes.appendChild(none);
  for (const c of a.capes) {
    const d = el('div', 'cape' + (c.state === 'ACTIVE' ? ' active' : ''));
    const img = el('img'); img.src = c.url; img.alt = '';
    d.append(img, el('p', '', c.alias || 'Cape')); d.onclick = () => setCape(c.id); capes.appendChild(d);
  }
}
async function renderCustomCape() {
  const box = $('#customCape'); box.innerHTML = '';
  const st = await api.cosmetics.status();
  if (!st.online) { box.append(el('p', 'muted', 'Cosmetics-Server nicht erreichbar (' + st.server + '). Adresse unter Optionen.')); return; }
  const cur = await api.cosmetics.myCape();
  if (cur) { const img = el('img'); img.src = cur; img.alt = ''; box.append(img); }
  const up = el('button', 'primary', cur ? 'Anderes Cape hochladen' : 'Cape hochladen (PNG)');
  up.onclick = async () => { up.disabled = true; try { if (await api.cosmetics.uploadCape()) { toast('Cape hochgeladen – im Spiel „Eigenes Cape“ wählen'); } } catch (e) { toast(e.message, true); } up.disabled = false; renderCustomCape(); };
  box.append(up);
  if (cur) { const del = el('button', 'ghost danger', 'Cape löschen'); del.onclick = async () => { try { await api.cosmetics.deleteCape(); toast('Cape gelöscht'); } catch (e) { toast(e.message, true); } renderCustomCape(); }; box.append(del); }
  box.append(el('span', 'muted', 'Format wie ein Minecraft-Cape: 64x32 Pixel (oder 128x64 / 256x128).'));
}
async function setCape(id) { try { state.account = await api.skin.setCape(id); renderSkins(); refreshSkin(); toast('Cape gesetzt'); } catch (e) { toast(e.message, true); } }
$('#skinAdd').onclick = async () => { const n = await api.skins.add(); if (n) { toast(`${n} Skin(s) hinzugefügt`); renderSkins(); } };
$('#skinSaveCurrent').onclick = async () => { const name = await askText('Name für den Skin:', state.account?.name || 'Skin'); if (!name) return; try { await api.skins.saveCurrent(name); toast('Skin gespeichert'); renderSkins(); } catch (e) { toast(e.message, true); } };
document.querySelectorAll('input[name=variant]').forEach(r => r.onchange = () => renderSkins());
api.auth.onChange((acc) => { state.account = acc; if (acc) headCache.delete(acc.id); renderAccount(); renderSkins(); refreshSkin(); });

// ---------- Ausstattung ----------
const bdlg = $('#bundleDialog');
let bundleProfile = null;
async function openBundle(p) {
  if (!p) return;
  bundleProfile = p;
  $('#bundleSub').textContent = `${p.name} · ${p.version} · ${loaderLabel(p)}`;
  const box = $('#bundleList'); box.innerHTML = '';
  let items = [];
  try { items = await api.bundle.list(p.id); } catch (e) { box.append(el('p', 'muted', e.message)); }
  if (!p.loader) box.append(el('p', 'muted', 'Dieses Profil ist Vanilla – für Mods braucht es Fabric, Forge oder NeoForge.'));
  let group = '';
  for (const it of items) {
    if (it.group !== group) { group = it.group; box.append(el('div', 'bundle-group', group)); }
    const row = el('div', 'bundle-item'); row.dataset.slug = it.slug;
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !it.installed && it.kind !== 'manual';
    if (it.installed) cb.disabled = true;
    const body = el('div'); body.append(el('b', '', it.name), el('span', '', it.desc));
    const state = el('span', 'state', it.installed ? 'installiert' : '');
    if (it.kind === 'manual') { cb.disabled = true; const b = el('button', 'ghost small', 'Seite öffnen'); b.onclick = () => api.bundle.open(it.url); row.append(cb, body, b); }
    else row.append(cb, body, state);
    box.appendChild(row);
  }
  bdlg.showModal();
}
$('#bundleClose').onclick = () => bdlg.close();
$('#bundleInstall').onclick = async () => {
  const slugs = $$('#bundleList .bundle-item').filter(r => r.querySelector('input').checked && !r.querySelector('input').disabled).map(r => r.dataset.slug);
  if (!slugs.length) { bdlg.close(); return; }
  const btn = $('#bundleInstall'); btn.disabled = true; btn.textContent = 'Installiert…';
  try {
    const res = await api.bundle.install({ profileId: bundleProfile.id, slugs });
    for (const r of res) {
      const row = $(`#bundleList .bundle-item[data-slug="${r.slug}"]`); if (!row) continue;
      const st = row.querySelector('.state'); st.textContent = r.ok ? 'installiert' : r.error; st.classList.toggle('err', !r.ok);
      if (r.ok) row.querySelector('input').disabled = true;
    }
    toast(`${res.filter(r => r.ok).length} von ${res.length} installiert`);
    await loadProfiles();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = 'Ausgewählte installieren';
};

// ---------- Welten ----------
function fillProfileSelect(sel) { sel.innerHTML = ''; for (const p of state.profiles) sel.add(new Option(`${p.name} (${p.version})`, p.id)); sel.value = state.current || ''; }
async function renderWorlds() {
  fillProfileSelect($('#worldsProfile'));
  const box = $('#worldList'); box.innerHTML = '';
  if (!state.current) { $('#worldsEmpty').classList.remove('hidden'); return; }
  const worlds = await api.worlds.list(state.current);
  $('#worldsEmpty').classList.toggle('hidden', worlds.length > 0);
  for (const w of worlds) {
    const c = el('div', 'world');
    const icon = w.icon ? el('img') : el('div', 'noicon', '🌍'); if (w.icon) { icon.src = w.icon; icon.alt = ''; }
    const body = el('div');
    body.append(el('b', '', w.name), el('div', 'meta', `${fmtSize(w.size)} · zuletzt ${new Date(w.modified).toLocaleDateString('de-DE')}`));
    const acts = el('div', 'actions');
    const info = el('button', 'ghost', 'Infos'); info.onclick = async () => { const i = await api.worldInfo({ profileId: state.current, name: w.name }); const body = $('#infoBody'); body.innerHTML = ''; if (i.error) body.append(el('p', 'muted', i.error)); else { body.append(el('h2', '', i.name || w.name)); for (const [k, v] of [['Seed', i.seed], ['Modus', i.mode + (i.hardcore ? ' (Hardcore)' : '')], ['Schwierigkeit', i.difficulty], ['Cheats', i.cheats ? 'an' : 'aus'], ['Version', i.version], ['Spawn', i.spawn], ['Zuletzt gespielt', i.lastPlayed ? new Date(Number(i.lastPlayed)).toLocaleString('de-DE') : '']]) if (v) body.append(el('p', '', `${k}: ${v}`)); const cp = el('button', 'ghost small', 'Seed kopieren'); cp.onclick = () => { navigator.clipboard.writeText(i.seed); toast('Seed kopiert'); }; body.append(cp); } $('#infoDialog').showModal(); };
    const exp = el('button', 'primary', 'Exportieren'); exp.onclick = async () => { if (await api.worlds.export({ profileId: state.current, name: w.name })) toast('Welt exportiert'); };
    const cp = el('button', 'ghost', 'Kopieren nach…');
    cp.onclick = async () => {
      const others = state.profiles.filter(p => p.id !== state.current);
      if (!others.length) { toast('Kein anderes Profil vorhanden', true); return; }
      const pick = await askText('In welches Profil kopieren? (Nummer eingeben)\n' + others.map((p, i) => `${i + 1}: ${p.name} (${p.version})`).join('\n'), '1');
      const t = others[Number(pick) - 1]; if (!t) return;
      try { const n = await api.worlds.copy({ profileId: state.current, name: w.name, targetProfileId: t.id }); toast(`Als „${n}“ nach ${t.name} kopiert`); } catch (e) { toast(e.message, true); }
    };
    const del = el('button', 'ghost danger', 'Löschen'); del.onclick = async () => { if (confirm(`Welt „${w.name}“ endgültig löschen?`)) { await api.worlds.delete({ profileId: state.current, name: w.name }); renderWorlds(); } };
    acts.append(info, exp, cp, del); body.append(acts); c.append(icon, body); box.appendChild(c);
  }
}
let wtab = 'worlds';
$$('#worldsSeg button').forEach(b => b.onclick = () => { wtab = b.dataset.wtab; $$('#worldsSeg button').forEach(x => x.classList.toggle('active', x === b)); $('#worldsPane').classList.toggle('hidden', wtab !== 'worlds'); $('#backupsPane').classList.toggle('hidden', wtab !== 'backups'); $('#shotsPane').classList.toggle('hidden', wtab !== 'shots'); if (wtab === 'backups') renderBackups(); if (wtab === 'shots') renderShots(); });
async function renderBackups() {
  const ul = $('#backupList'); ul.innerHTML = '';
  const list = state.current ? await api.backups.list(state.current) : [];
  if (!list.length) ul.append(el('li', '', 'Noch keine Backups.'));
  for (const b of list) {
    const li = el('li'); const acts = el('span', 'row gap');
    const rs = el('button', 'primary', 'Wiederherstellen'); rs.onclick = async () => { if (confirm('Welten aus diesem Backup wiederherstellen? Vorhandene Dateien werden überschrieben.')) { try { await api.backups.restore({ profileId: state.current, file: b.file }); toast('Backup wiederhergestellt'); } catch (e) { toast(e.message, true); } } };
    acts.append(rs); li.append(el('span', 'dot'), el('span', '', new Date(b.time).toLocaleString('de-DE')), el('span', 'size', fmtSize(b.size)), acts); ul.appendChild(li);
  }
}
$('#backupNow').onclick = async () => { try { await api.backups.now(state.current); toast('Backup erstellt'); renderBackups(); } catch (e) { toast(e.message, true); } };
$('#backupFolder').onclick = () => api.backups.openFolder(state.current);
async function renderShots() {
  const g = $('#shotGrid'); g.innerHTML = '';
  const list = state.current ? await api.shots.list(state.current) : [];
  $('#shotsInfo').textContent = list.length ? `${list.length} Screenshots (neueste zuerst)` : 'Noch keine Screenshots – F2 im Spiel.';
  for (const sh of list) {
    const c = el('div', 'shot'); const img = el('img'); img.src = sh.dataUrl; img.alt = ''; img.onclick = () => api.shots.open({ profileId: state.current, file: sh.file });
    const row = el('div', 'row'); const del = el('button', 'ghost danger small', '✕'); del.onclick = async () => { await api.shots.delete({ profileId: state.current, file: sh.file }); renderShots(); };
    const cpy = el('button', 'ghost small', 'Kopieren'); cpy.onclick = async () => { await api.shotCopy({ profileId: state.current, file: sh.file }); toast('Screenshot in der Zwischenablage'); };
    const dc = el('button', 'ghost small', 'Discord'); dc.title = 'An deinen Discord-Webhook senden'; dc.onclick = () => sendShotToDiscord(sh.file, dc);
    const btns = el('span', 'row gap'); btns.append(cpy, dc, del);
    row.append(el('span', '', new Date(sh.time).toLocaleString('de-DE')), btns); c.append(img, row); g.appendChild(c);
  }
}
$('#shotsFolder').onclick = () => api.shots.openFolder(state.current);
$('#worldsProfile').onchange = (e) => { state.current = e.target.value; renderLaunch(); renderWorlds(); if (wtab === 'backups') renderBackups(); if (wtab === 'shots') renderShots(); };
$('#worldsImport').onclick = async () => { try { const n = await api.worlds.import(state.current); if (n) { toast(`Welt „${n}“ importiert`); renderWorlds(); } } catch (e) { toast(e.message, true); } };
$('#worldsFolder').onclick = () => api.worlds.openFolder(state.current);

// ---------- Server ----------
let serverRunning = false;
async function renderFavorites() {
  const box = $('#favList'); box.innerHTML = '';
  const favs = await api.favorites.list();
  if (!favs.length) box.append(el('p', 'muted', 'Noch keine Favoriten. Name und Adresse eintragen – „Verbinden“ startet das gewählte Profil direkt auf dem Server.'));
  for (const f of favs) {
    const c = el('div', 'card'); c.append(el('b', '', f.name), el('span', 'ver', f.ip));
    const st = el('span', 'srv-status', 'Prüfe…'); c.append(st);
    api.serverPing(f.ip).then(r => { st.textContent = r.online ? `Online · ${r.players}/${r.max} Spieler · ${r.ping} ms · ${r.version}` : `Offline (${r.error})`; st.classList.toggle('on', r.online); });
    const act = el('div', 'actions');
    const join = el('button', 'primary', 'Verbinden'); join.onclick = async () => { if (!state.current) { toast('Erst ein Profil wählen', true); return; } join.disabled = true; try { await api.launch(state.current, f.ip); runningSet.add(state.current); updatePlayButton(); renderRunning(); toast(`Verbinde mit ${f.name}`); } catch (e) { toast(e.message, true); } join.disabled = false; };
    const rm = el('button', 'ghost danger', 'Entfernen'); rm.onclick = async () => { await api.favorites.save(favs.filter(x => x !== f)); renderFavorites(); };
    act.append(join, rm); c.append(act); box.appendChild(c);
  }
}
$('#favImport').onclick = async () => { if (!state.current) return; const list = await api.favoritesFromServersDat(state.current); if (!list.length) { toast('Keine Serverliste im Profil', true); return; } const favs = await api.favorites.list(); let n = 0; for (const s of list) if (!favs.some(f => f.ip === s.ip)) { favs.push(s); n++; } await api.favorites.save(favs); renderFavorites(); toast(`${n} Server übernommen`); };
$('#favAdd').onclick = async () => { const name = $('#favName').value.trim(), ip = $('#favIp').value.trim(); if (!ip) return; const favs = await api.favorites.list(); favs.push({ name: name || ip, ip }); await api.favorites.save(favs); $('#favName').value = ''; $('#favIp').value = ''; renderFavorites(); };
async function renderServer() {
  renderFavorites();
  fillProfileSelect($('#serverProfile'));
  if (!state.current) return;
  let info; try { info = await api.server.info(state.current); } catch (e) { toast(e.message, true); return; }
  serverRunning = info.running;
  const st = $('#serverStatus'); st.innerHTML = '';
  st.append(el('span', 'state' + (info.running ? ' on' : ''), info.running ? 'Läuft' : info.installed ? 'Bereit' : 'Nicht eingerichtet'), el('span', 'muted', `Vanilla ${info.version}`));
  $('#serverPort').value = info.port; $('#serverMemory').value = info.memory;
  $('#serverEula').checked = info.eula;
  $('#serverSetup').textContent = info.installed ? 'Einstellungen speichern' : 'Einrichten';
  $('#serverStart').classList.toggle('hidden', !info.installed || info.running);
  $('#serverStop').classList.toggle('hidden', !info.running);
  $('#serverAddr').textContent = info.installed ? `Verbinden: localhost:${info.port} (du) · ${info.lanIps.map(ip => ip + ':' + info.port).join(', ') || 'keine LAN-Adresse'} (Freunde im selben Netz)` : '';
  const ws = $('#serverWorld'); ws.innerHTML = '';
  const worlds = await api.worlds.list(state.current);
  ws.add(new Option(info.hasWorld ? 'Aktuelle Server-Welt behalten' : 'Neue Welt erzeugen', ''));
  for (const w of worlds) ws.add(new Option(w.name, w.name));
}
$('#serverProfile').onchange = (e) => { state.current = e.target.value; renderLaunch(); renderServer(); };
$('#eulaLink').onclick = (e) => { e.preventDefault(); api.bundle.open('https://www.minecraft.net/eula'); };
$('#serverSetup').onclick = async () => {
  const b = $('#serverSetup'); b.disabled = true;
  try { await api.server.setup({ profileId: state.current, port: Number($('#serverPort').value) || 25565, memory: Number($('#serverMemory').value) || 2, eulaAccepted: $('#serverEula').checked, serverType: $('#serverType')?.value || 'vanilla' }); toast('Server eingerichtet'); renderServer(); }
  catch (e) { toast(e.message, true); }
  b.disabled = false;
};
$('#serverStart').onclick = async () => { $('#serverLog').textContent = ''; try { await api.server.start(state.current); } catch (e) { toast(e.message, true); } };
$('#serverStop').onclick = () => api.server.stop();
$('#serverFolder').onclick = () => api.server.openFolder(state.current);
$('#serverImportWorld').onclick = async () => { const w = $('#serverWorld').value; if (!w) return; try { await api.server.importWorld({ profileId: state.current, name: w }); toast(`Welt „${w}“ auf den Server übernommen`); renderServer(); } catch (e) { toast(e.message, true); } };
$('#serverSend').onclick = async () => { const i = $('#serverCmd'); if (!i.value.trim()) return; try { await api.server.command(i.value.trim()); i.value = ''; } catch (e) { toast(e.message, true); } };
$('#serverCmd').onkeydown = (e) => { if (e.key === 'Enter') $('#serverSend').onclick(); };
api.server.onLog((line) => { const l = $('#serverLog'); l.textContent += line + '\n'; l.scrollTop = l.scrollHeight; });
api.server.onState(({ running }) => { serverRunning = running; if (state.view === 'server') renderServer(); });

// ---------- Einstellungen ----------
async function loadSettings() {
  const s = await api.settings.get(), f = $('#settingsForm');
  f.memory.value = s.memory; f.memory.max = s.totalMemoryGb;
  f.closeOnLaunch.checked = !!s.closeOnLaunch;
  f.logWindow.checked = s.logWindow !== false;
  f.updateUrl.value = s.updateUrl || ''; f.autostart.checked = !!s.autostart; renderJava(); renderDisk();
  f.autoUpdateMods.checked = !!s.autoUpdateMods; f.notifications.checked = s.notifications !== false; $('#portableHint').textContent = s.portable ? '(Portable-Modus aktiv)' : '';
  f.backupWorlds.checked = s.backupWorlds !== false; f.tray.checked = s.tray !== false; f.accent.value = s.accent || '#FFB400';
  f.discord.checked = s.discord !== false; f.discordAppId.value = s.discordAppId || ''; f.discordImageUrl.value = s.discordImageUrl || '';
  f.importVanilla.checked = s.importVanilla !== false;
  api.vanilla.info().then(v => { $('#vanillaInfo').textContent = v.exists ? `Gefunden: ${v.dir}${v.hasOptions ? '' : ' (noch keine options.txt)'}` : 'Kein .minecraft-Ordner gefunden – der offizielle Launcher wurde hier noch nie gestartet.'; });
  f.curseforgeKey.value = s.curseforgeKey || '';
  f.spotifyClientId.value = s.spotifyClientId || '';
  f.cosmeticsServer.value = s.cosmeticsServer || '';
  f.voiceServer.value = s.voiceServer || '';
  api.voice.status().then(st => { $('#voiceState').textContent = st.online ? `Verbunden – ${st.players} Spieler online, Reichweite ${st.range} Blöcke` : 'Server nicht erreichbar – läuft er? Zum Testen: node server.js im Voice-Server-Ordner.'; });
  $('#dataDir').textContent = s.dataDir;
  api.cosmetics.status().then(st => { $('#cosmeticsState').textContent = st.online ? `Verbunden – ${st.players} Spieler, ${st.wearing} tragen ein Cosmetic, ${st.capes} Capes` : 'Server nicht erreichbar – läuft er? Zum Testen: node server.js im Cosmetics-Server-Ordner.'; });
  renderSpotify();
}
async function renderSpotify() {
  const row = $('#spotifyRow'); row.innerHTML = '';
  const st = await api.spotify.status();
  if (st.connected) {
    const out = el('button', 'ghost', 'Spotify trennen'); out.onclick = async () => { await api.spotify.logout(); renderSpotify(); };
    row.append(el('span', 'muted', 'Verbunden – Titel erscheint im HUD, Steuerung über Numpad 4/5/6'), out);
  } else {
    const b = el('button', 'primary', 'Mit Spotify verbinden');
    b.onclick = async () => { b.disabled = true; b.textContent = 'Browser geöffnet…'; try { await api.spotify.login($('#settingsForm').spotifyClientId.value); toast('Spotify verbunden'); } catch (e) { toast(e.message, true); } renderSpotify(); };
    row.append(b);
  }
}
$('#openDataDir').onclick = () => api.settings.openDataDir();
$('#updateNow').onclick = () => checkLauncherUpdate(true);
$('#backupAll').onclick = async () => { try { if (await api.backupAll()) toast('Backup erstellt'); } catch (e) { toast(e.message, true); } };
$('#restoreAll').onclick = async () => { try { if (await api.restoreAll()) { toast('Backup wiederhergestellt'); await loadProfiles(); renderProfiles(); } } catch (e) { toast(e.message, true); } };
async function renderJava() {
  const box = $('#javaList'); box.innerHTML = '';
  const list = await api.java.list();
  if (!list.length) box.append(el('span', 'muted', 'Noch kein Java geladen – passiert automatisch beim ersten Start.'));
  for (const j of list) { const c = el('div', 'jre'); const del = el('button', 'ghost danger small', '✕'); del.onclick = async () => { if (confirm(`${j.name} löschen? Wird beim nächsten Start neu geladen.`)) { await api.java.delete(j.name); renderJava(); } }; c.append(el('b', '', j.name), el('span', 'muted', fmtSize(j.size)), del); box.appendChild(c); }
}
for (const v of [8, 17, 21, 25]) $(`#javaInstall${v}`).onclick = async () => { toast(`Lade Java ${v}…`); try { await api.java.install(v); toast(`Java ${v} bereit`); renderJava(); } catch (e) { toast(e.message, true); } };
async function renderDisk() {
  const p = currentProfile(); const info = p ? await api.disk.profile(p.id) : null;
  $('#diskInfo').textContent = info ? `${p.name}: ${fmtSize(info.total)} (Mods ${fmtSize(info.parts.mods)}, Welten ${fmtSize(info.parts.saves)}, Logs ${fmtSize(info.parts.logs + info.parts['crash-reports'])})` : 'Kein Profil gewählt';
}
$('#diskClean').onclick = async () => { const freed = await api.disk.clean(state.current); toast(`${fmtSize(freed)} freigegeben`); renderDisk(); };
$('#settingsForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  await api.settings.save({ memory: Number(f.memory.value), closeOnLaunch: f.closeOnLaunch.checked, logWindow: f.logWindow.checked, discord: f.discord.checked, updateUrl: f.updateUrl.value.trim(), autostart: f.autostart.checked, backupWorlds: f.backupWorlds.checked, autoUpdateMods: f.autoUpdateMods.checked, notifications: f.notifications.checked, tray: f.tray.checked, accent: f.accent.value, discordAppId: f.discordAppId.value.trim(), discordImageUrl: f.discordImageUrl.value.trim(), importVanilla: f.importVanilla.checked, curseforgeKey: f.curseforgeKey.value.trim(), spotifyClientId: f.spotifyClientId.value.trim(), cosmeticsServer: f.cosmeticsServer.value.trim() || 'http://127.0.0.1:8765', voiceServer: f.voiceServer.value.trim() || 'http://127.0.0.1:8766' });
  loadSettings();
  applyAccent(f.accent.value); api.autostart(f.autostart.checked); toast('Optionen gespeichert');
};

// ---------- Neuigkeiten ----------
const NEWS = [
  { date: '2026-10-09', title: 'LellekClient 2.2 – Freundschaftsanfragen', text: 'Freunde müssen deine Anfrage jetzt annehmen – erst dann seht ihr euch gegenseitig. Neu: eigener Status (Online, Abwesend, Bitte nicht stören, Unsichtbar) mit kurzer Notiz, Einladungen an Freunde mit Nachricht und Server, Favoriten, Spitznamen, Blockieren und ein Zähler für offene Anfragen.' },
  { date: '2026-10-09', title: 'LellekClient 2.1.1', text: 'Jedes Minecraft-Konto hat jetzt seine eigene Freundesliste – beim Kontowechsel wechselt die Liste mit. Updates kommen ab jetzt automatisch über GitHub.' },
  { date: '2026-10-09', title: 'LellekClient 2.1 – jetzt auch für Mac', text: 'LellekClient läuft auf macOS – für Apple-Silicon-Macs (M1–M4) und Intel-Macs. Alte Versionen wie 1.8.9 und 1.12.2 starten auf Apple Silicon automatisch mit Intel-Java über Rosetta. ⌘-Tastenkürzel, Menüleisten-Symbol, PC-Check erkennt Apple-Chips.' },
  { date: '2026-10-09', title: 'LellekClient 2.0', text: 'Freundesliste mit Online-Status und Beitreten-Knopf. Streamer-Modus (auch automatisch bei OBS). Neue Design-Seite: 8 Farbschemas, eigener Hintergrund, Größe, kompakter Modus, Skin-Animationen, eigener Titel, Text im Minecraft-Menü, eigenes CSS. Server mit Paper oder Fabric samt Plugins/Mods und playit.gg-Tunnel. Screenshots an Discord, PC-Check, Bilder-Galerie bei Mods und Changelogs bei Updates.' },
  { date: '2026-10-09', title: 'LellekClient 1.9', text: 'NeoForge-Unterstützung: Profile, Mods, Ausstattung und NeoForge-Modpacks. Selbst-Updater: neue Versionen laden und mit einem Klick installieren. Profile als Modrinth-Modpack (.mrpack) exportieren – öffnet sich auch in Prism, Modrinth-App und CurseForge; .mrpack-Dateien importieren. Fix: Wechsel zwischen Forge-Versionen derselben Minecraft-Version.' },
  { date: '2026-10-08', title: 'LellekClient 1.8', text: 'Neue Statistik-Seite mit Spielzeit pro Tag, Serie, Servern und Sitzungsverlauf. Befehlspalette mit Strg+K, Tastenkürzel (Strg+Enter spielt, Strg+1–8). Desktop-Verknüpfung pro Profil. Absturz-Diagnose mit Lösungsvorschlägen. Mod-Sets zum Umschalten, Mod-Liste kopieren. server.properties direkt im Launcher. Optimierte JVM-Flags mit einem Klick. Namens-Eingaben funktionieren wieder.' },
  { date: '2026-09-11', title: 'LellekClient 1.7.2', text: 'Log-Fenster repariert, Welt-Infos repariert, Zeitlimits bei Netzwerkzugriffen, Modpacks laden mit 4 parallelen Downloads.' },
  { date: '2026-09-11', title: 'LellekClient 1.7.1', text: 'Modpacks repariert. Import aus Lunar, Feather und NoRisk. Mods, Shader und Resourcepacks per Drag & Drop.' },
  { date: '2026-09-11', title: 'LellekClient 1.7', text: 'Schnellstart-Kacheln, Profil-Symbole, Mod-Details, Pack-Vorschau, Welt-Infos mit Seed, Serverliste importieren, Log-Suche, Portable-Modus, Komplett-Backup, Benachrichtigungen.' },
  { date: '2026-09-11', title: 'LellekClient 1.6.1', text: 'Discord-Status funktioniert jetzt für alle ohne Einrichtung.' },
  { date: '2026-09-11', title: 'LellekClient 1.6', text: 'Mod-Updates jetzt auch über CurseForge, Update-Button direkt in der Liste, Auto-Update vor dem Start. Import-Dialog mit CurseForge-App, Modrinth-App und ATLauncher.' },
  { date: '2026-09-10', title: 'LellekClient 1.5', text: 'Update-Check, Java-Verwaltung, Speicher aufräumen, Profil-Suche und Statistik, Auto-Join, Import aus offiziellem Launcher/Prism, Autostart, Mod-Konflikte, Sicherer Start, Server-Status.' },
  { date: '2026-09-10', title: 'LellekClient 1.4.1', text: 'LellekHUD 1.2 für alle drei Versionen eingebaut – Emotes auch offline, Maustasten trennbar, 10 neue Elemente.' },
  { date: '2026-09-10', title: 'LellekClient 1.4', text: 'Server-Favoriten mit Direktverbindung, Welt-Backups, Screenshot-Galerie, Profil duplizieren/exportieren/importieren, Tray-Schnellstart, Akzentfarbe, JVM-Args und Fenstergröße pro Profil, Spielzeit, Crash-Report-Erkennung.' },
  { date: '2026-09-10', title: 'LellekClient 1.3.2', text: 'LellekHUD 1.1 für 1.8.9 und 1.12.2 eingebaut: Emotes, Shop, neue Cosmetics-Texturen.' },
  { date: '2026-09-10', title: 'LellekClient 1.3', text: 'Discord-Status mit Version, Server oder Welt. Einstellungen aus .minecraft übernehmen, Welten und Resourcepacks teilen.' },
  { date: '2026-09-10', title: 'LellekClient 1.2', text: 'Modpacks von Modrinth und CurseForge: durchsuchen und mit einem Klick als eigenes Profil installieren.' },
  { date: '2026-09-10', title: 'LellekClient 1.1', text: 'LellekHUD für 1.8.9, 1.12.2 und 26.2 ist eingebaut und wird beim Start automatisch aktuell gehalten.' },
  { date: '2026-09-10', title: 'LellekClient 1.0', text: 'Mehrere Instanzen gleichzeitig, auch mit verschiedenen Konten. Eigenes Log-Fenster pro Start.' },
  { date: '2026-09-09', title: 'LellekClient 0.9', text: 'Eigener Voice-Chat: Push-to-Talk mit B, Proximity, in jeder Version. Server-Adresse unter Optionen.' },
  { date: '2026-09-09', title: 'LellekClient 0.8', text: 'Cosmetics-Server: Andere Spieler sehen dein Cosmetic. Eigenes Cape hochladen unter Skins.' },
  { date: '2026-09-09', title: 'LellekClient 0.7', text: 'Skins direkt von Mojang – korrekte Köpfe und 3D-Vorschau für alle Konten.' },
  { date: '2026-09-09', title: 'LellekClient 0.6', text: 'Mod-Updates einzeln oder alle auf einmal, Abhängigkeiten werden mitinstalliert, Fabric API kommt automatisch, stabile Versionen statt Betas.' },
  { date: '2026-09-09', title: 'LellekClient 0.5', text: 'Welten sichern, importieren und zwischen Profilen kopieren. Eigenen Server auf dem PC hosten. Essential Mod in der Ausstattung.' },
  { date: '2026-09-09', title: 'LellekClient 0.4', text: 'Mehrere Konten mit Schnellwechsel, Skin-Bibliothek mit 3D-Vorschau, eigene Log-Datei pro Start.' },
  { date: '2026-09-08', title: 'LellekClient 0.3.1', text: 'Ausstattung pro Profil: Minimap, Voice-Chat, Performance, Shader mit einem Klick. Spotify-Anbindung. LellekHUD 1.8.9 ist eingebaut.' },
  { date: '2026-09-08', title: 'LellekHUD 0.2', text: 'Farbe, Größe und Hintergrund pro Element, Ping und Uhr, Spotify-Anzeige, Hauptmenü mit Logo.' },
  { date: '2026-09-08', title: 'LellekHUD in Arbeit', text: 'CPS, Keystrokes, Hitboxen, FPS und Koordinaten – zuerst für 1.8.9, dann 1.12.2 und Fabric.' },
  { date: '2026-09-08', title: 'Alle Versionen', text: 'Die Versionsliste kommt live von Mojang, Java wird automatisch passend geladen.' },
];
function renderNews() {
  const box = $('#newsList'); box.innerHTML = '';
  for (const n of NEWS) { const c = el('div', 'news-card'); c.append(el('time', '', n.date), el('b', '', n.title), el('p', '', n.text)); box.appendChild(c); }
}

// ---------- Starten ----------
function updatePlayButton() {
  const btn = $('#playBtn'), b = btn.querySelector('b');
  const isRunning = runningSet.has(state.current);
  btn.disabled = false; b.textContent = isRunning ? 'Läuft – Log' : 'Spielen';
}
async function renderRunning() {
  const n = runningSet.size;
  $('#profileCount').textContent = n ? `${n} Instanz${n === 1 ? '' : 'en'} läuft` : `${state.profiles.length} ${state.profiles.length === 1 ? 'Profil' : 'Profile'}`;
}
$('#playBtn').onclick = async () => {
  if (!state.current) { openProfileDialog(); return; }
  if (runningSet.has(state.current)) { api.launchOpenLog(state.current); return; }
  const btn = $('#playBtn'), b = btn.querySelector('b');
  btn.disabled = true; b.textContent = 'Startet…';
  try { await api.launch(state.current); runningSet.add(state.current); toast('Minecraft läuft – weitere Profile können parallel starten'); }
  catch (e) { toast(e.message, true); log('FEHLER: ' + e.message); $('#log').classList.remove('hidden'); }
  updatePlayButton(); renderRunning();
};
api.onLog(({ line }) => log(line));
api.onProgress(({ task, percent }) => { $('#progressBar').style.width = Math.round(percent * 100) + '%'; toast(`${task}: ${Math.round(percent * 100)} %`); });
const runningSet = new Set();
api.onClosed(({ profileId, code, crash, analysis }) => { if (crash && !analysis) { toast('Abgestürzt – Crash-Report wird geöffnet', true); api.crashOpen(crash); } runningSet.delete(profileId); state.busy = false; updatePlayButton(); $('#progressBar').style.width = '0'; toast(code === 0 ? 'Bereit' : `Minecraft wurde mit Code ${code} beendet – siehe Log`, code !== 0); renderRunning(); });
api.onTrayLaunch(async (id) => { if (runningSet.has(id)) { api.launchOpenLog(id); return; } try { await api.launch(id); runningSet.add(id); updatePlayButton(); renderRunning(); } catch (e) { toast(e.message, true); } });
$('#logToggle').onclick = () => $('#log').classList.toggle('hidden');
$('#logFile').onclick = () => api.logs.openLast();
$('#logFolder').onclick = () => api.logs.openFolder();

// ---------- Start ----------
function applyAccent(hex) { if (!hex) return; document.documentElement.style.setProperty('--accent', hex); const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},.16)`); }
(async () => {
  const s = await api.settings.get();
  applyAccent(s.accent);
  $('#clientVersion').textContent = 'v' + s.clientVersion;
  state.account = await api.auth.current();
  renderAccount();
  renderNews();
  await loadProfiles();
  setTimeout(() => checkLauncherUpdate(false), 4000);
  initSkin();
})();
