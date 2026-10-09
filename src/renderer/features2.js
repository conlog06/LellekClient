// LellekClient 2.0 – Streamer-Modus, Design, Freunde, Server-Plugins & Tunnel, PC-Check, Galerie, Changelogs
// Läuft nach app.js und features.js im selben Fenster.

// ---------- Ansichten & Kürzel erweitern ----------
VIEWS.splice(VIEWS.findIndex(v => v[0] === 'settings'), 0, ['friends', 'Freunde'], ['design', 'Design']);
{
  const _sv = showView;
  showView = function (view) { _sv(view); if (view === 'friends') loadFriends(); if (view === 'design') renderDesign(); };
  const _pi = paletteItems;
  paletteItems = function () {
    const items = _pi().map(it => it.hint === `Strg+${VIEWS.length}` ? { ...it, hint: 'Strg+0' } : it);
    items.push({ group: 'Aktion', label: streamer.active ? 'Streamer-Modus ausschalten' : 'Streamer-Modus einschalten', hint: 'Strg+Umschalt+S', run: () => toggleStreamer() });
    items.push({ group: 'Aktion', label: 'PC-Check', hint: 'Hardware & Empfehlungen', run: () => runPcCheck() });
    for (const [k, t] of Object.entries(THEMES)) items.push({ group: 'Design', label: `Farbschema: ${t.name}`, hint: '', run: () => pickTheme(k) });
    for (const f of (lastFriends?.friends || []).filter(f => f.online && f.server)) items.push({ group: 'Freunde', label: `${f.name} beitreten`, hint: f.server, run: () => joinFriend(f) });
    return items;
  };
  $('.palette-hint').textContent = '↑ ↓ auswählen · Enter ausführen · Esc schließen · Strg+Enter spielt · Strg+1–9/0 wechselt die Ansicht · Strg+Umschalt+S Streamer-Modus';
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); toggleStreamer(); return; }
  if (e.key === '0' && ![...document.querySelectorAll('dialog')].some(d => d.open) && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { e.preventDefault(); showView('settings'); }
});

// ---------- Streamer-Modus ----------
let streamer = { active: false };
function applyStreamer(st) {
  streamer = st || streamer;
  const on = !!streamer.active, b = document.body.classList;
  b.toggle('streamer', on); b.toggle('st-name', on && streamer.hideName !== false); b.toggle('st-ips', on && streamer.hideIps !== false);
  $('#streamerChip').classList.toggle('hidden', !on);
  $('#streamerChip').textContent = streamer.enabled ? '● LIVE · Streamer-Modus' : '● LIVE · automatisch (Stream-Programm läuft)';
  if ($('#stEnabled')) {
    $('#stEnabled').checked = !!streamer.enabled; $('#stAuto').checked = !!streamer.auto;
    $('#stHideName').checked = streamer.hideName !== false; $('#stHideIps').checked = streamer.hideIps !== false; $('#stDiscord').checked = streamer.discordMinimal !== false; $('#stMute').checked = streamer.mute !== false;
    $('#stState').textContent = on ? (streamer.enabled ? 'Aktiv.' : 'Aktiv, weil ein Stream-Programm läuft.') : streamer.auto ? 'Wartet auf OBS/Streamlabs …' : 'Aus.';
  }
}
async function setStreamer(patch) { try { applyStreamer(await api.streamer.set(patch)); } catch (e) { toast(e.message, true); } }
async function toggleStreamer() {
  if (streamer.active && !streamer.enabled) { toast('Streamer-Modus ist automatisch an, weil ein Stream-Programm läuft – in den Optionen abschaltbar', true); showView('settings'); return; }
  await setStreamer({ enabled: !streamer.enabled }); toast(streamer.active ? 'Streamer-Modus an – Name, Adressen und Seeds sind verborgen' : 'Streamer-Modus aus');
}
api.streamer.onState(applyStreamer);
$('#streamerChip').onclick = () => toggleStreamer();
$('#stEnabled').onchange = (e) => setStreamer({ enabled: e.target.checked });
$('#stAuto').onchange = (e) => setStreamer({ auto: e.target.checked });
$('#stHideName').onchange = (e) => setStreamer({ hideName: e.target.checked });
$('#stHideIps').onchange = (e) => setStreamer({ hideIps: e.target.checked });
$('#stDiscord').onchange = (e) => setStreamer({ discordMinimal: e.target.checked });
$('#stMute').onchange = (e) => setStreamer({ mute: e.target.checked });

// ---------- Design ----------
const THEMES = {
  gold: { name: 'Gold', accent: '#FFB400', vars: null, sw: ['#16110A', '#2A2015', '#FFB400'] },
  mitternacht: { name: 'Mitternacht', accent: '#5B9BFF', vars: { bg: '#0F1218', panel: '#161B24', panel2: '#1D2430', line: '#2A3342', hover: '#232B38', text: '#E8ECF2', muted: '#98A3B3' } },
  nether: { name: 'Nether', accent: '#FF4D3A', vars: { bg: '#160B0B', panel: '#1F1010', panel2: '#2A1515', line: '#3D1F1F', hover: '#331A1A', text: '#F5E6E2', muted: '#B39690' } },
  end: { name: 'End', accent: '#B57BFF', vars: { bg: '#100C17', panel: '#18121F', panel2: '#21182B', line: '#33264A', hover: '#2A2038', text: '#EDE6F5', muted: '#A596B8' } },
  wald: { name: 'Wald', accent: '#6BD86B', vars: { bg: '#0D140E', panel: '#131D14', panel2: '#1A271B', line: '#2A3D2B', hover: '#213222', text: '#E6F2E6', muted: '#95AD96' } },
  ozean: { name: 'Ozean', accent: '#2EC8D8', vars: { bg: '#0A1416', panel: '#0F1D20', panel2: '#15282C', line: '#213D42', hover: '#1A3236', text: '#E2F2F3', muted: '#8FB0B3' } },
  graphit: { name: 'Graphit', accent: '#E0E0E0', vars: { bg: '#121212', panel: '#1A1A1A', panel2: '#222222', line: '#333333', hover: '#2A2A2A', text: '#EDEDED', muted: '#9A9A9A' } },
  hell: { name: 'Hell', accent: '#E89B00', light: true, vars: { bg: '#F4F1EA', panel: '#FFFFFF', panel2: '#F0EBE1', line: '#DDD3C2', hover: '#EAE3D6', text: '#1F1A12', muted: '#6E6455' } },
};
for (const t of Object.values(THEMES)) if (t.vars) t.sw = [t.vars.bg, t.vars.panel2, t.accent];
let ui = {};
const SKIN_ANIMS = { idle: 'IdleAnimation', walk: 'WalkingAnimation', run: 'RunningAnimation', fly: 'FlyingAnimation' };
function applyUi() {
  const root = document.documentElement.style, t = THEMES[ui.theme] || THEMES.gold;
  for (const k of ['bg', 'panel', 'panel2', 'line', 'hover', 'text', 'muted']) t.vars ? root.setProperty('--' + k, t.vars[k]) : root.removeProperty('--' + k);
  const b = document.body.classList;
  b.toggle('theme-light', !!t.light); b.toggle('compact', !!ui.compact); b.toggle('no-news', ui.news === false); b.toggle('no-grid', ui.grid === false); b.toggle('reduce-motion', !!ui.reduceMotion); b.toggle('hide-skin', !!ui.skinHide);
  const hero = $('.hero'); let bg = $('#heroBg');
  if (ui.bgData) {
    if (!bg) { bg = el('div', 'hero-bg'); bg.id = 'heroBg'; bg.append(el('div', 'hero-dim')); hero.prepend(bg); }
    bg.style.backgroundImage = `url("${ui.bgData}")`; bg.style.filter = ui.blur ? `blur(${ui.blur}px)` : ''; bg.style.inset = ui.blur ? `-${ui.blur * 2}px` : '0';
    bg.firstChild.style.background = `rgba(0,0,0,${(ui.dim ?? 45) / 100})`;
  } else if (bg) bg.remove();
  hero.classList.toggle('has-bg', !!ui.bgData);
  $('.wordmark span').textContent = (ui.title || '').trim() || 'LellekClient';
  let st = $('#userCss'); if (!st) { st = document.createElement('style'); st.id = 'userCss'; document.head.append(st); } st.textContent = ui.css || '';
  api.ui.zoom((ui.zoom || 100) / 100);
  applySkinAnim();
}
function applySkinAnim(tries = 0) {
  if (typeof viewer === 'undefined' || !viewer) { if (tries < 20) setTimeout(() => applySkinAnim(tries + 1), 500); return; }
  const a = ui.skinAnim || 'idle';
  viewer.animation = a === 'none' || ui.reduceMotion ? null : new skinview3d[SKIN_ANIMS[a] || 'IdleAnimation']();
  if (viewer.animation) viewer.animation.speed = a === 'idle' ? 0.7 : 0.8;
  viewer.autoRotate = !!ui.skinRotate && !ui.reduceMotion; viewer.autoRotateSpeed = 0.5;
}
let uiSaveT = null;
function setUi(patch) { Object.assign(ui, patch); applyUi(); clearTimeout(uiSaveT); uiSaveT = setTimeout(() => api.ui.save(Object.fromEntries(Object.entries(ui).filter(([k]) => k !== 'bgData'))), 350); }
async function pickTheme(key) {
  setUi({ theme: key }); const acc = THEMES[key].accent;
  try { await api.settings.save({ accent: acc }); } catch {}
  applyAccent(acc); if ($('#dAccent')) $('#dAccent').value = acc; if (state.view === 'design') renderDesign();
}
function renderDesign() {
  const g = $('#themeGrid'); g.innerHTML = '';
  for (const [k, t] of Object.entries(THEMES)) {
    const b = el('button', 'theme' + ((ui.theme || 'gold') === k ? ' active' : '')); b.type = 'button';
    const sw = el('span', 'sw'); for (const c of t.sw) { const i = el('i'); i.style.background = c; sw.append(i); }
    b.append(sw, el('span', '', t.name)); b.onclick = () => pickTheme(k); g.append(b);
  }
  api.settings.get().then(s => { $('#dAccent').value = s.accent || '#FFB400'; });
  $('#dDim').value = ui.dim ?? 45; $('#dBlur').value = ui.blur ?? 0; $('#dGrid').checked = ui.grid !== false;
  $('#dZoom').value = ui.zoom || 100; $('#dCompact').checked = !!ui.compact; $('#dNews').checked = ui.news !== false; $('#dMotion').checked = !!ui.reduceMotion;
  $('#dSkinAnim').value = ui.skinAnim || 'idle'; $('#dSkinRotate').checked = !!ui.skinRotate; $('#dSkinHide').checked = !!ui.skinHide;
  $('#dTitle').value = ui.title || ''; $('#dMenuBrand').value = ui.menuBrand || ''; $('#dCss').value = ui.css || '';
  updateDesignLabels();
}
function updateDesignLabels() { $('#dDimVal').textContent = `${$('#dDim').value} %`; $('#dBlurVal').textContent = `${$('#dBlur').value} px`; $('#dZoomVal').textContent = `${$('#dZoom').value} %`; }
$('#dAccent').oninput = (e) => applyAccent(e.target.value);
$('#dAccent').onchange = async (e) => { try { await api.settings.save({ accent: e.target.value }); } catch {} };
$('#dDim').oninput = (e) => { updateDesignLabels(); setUi({ dim: Number(e.target.value) }); };
$('#dBlur').oninput = (e) => { updateDesignLabels(); setUi({ blur: Number(e.target.value) }); };
$('#dGrid').onchange = (e) => setUi({ grid: e.target.checked });
$('#dZoom').onchange = (e) => { updateDesignLabels(); setUi({ zoom: Number(e.target.value) }); };
$('#dZoom').oninput = updateDesignLabels;
$('#dCompact').onchange = (e) => setUi({ compact: e.target.checked });
$('#dNews').onchange = (e) => setUi({ news: e.target.checked });
$('#dMotion').onchange = (e) => setUi({ reduceMotion: e.target.checked });
$('#dSkinAnim').onchange = (e) => setUi({ skinAnim: e.target.value });
$('#dSkinRotate').onchange = (e) => setUi({ skinRotate: e.target.checked });
$('#dSkinHide').onchange = (e) => setUi({ skinHide: e.target.checked });
$('#dTitle').oninput = (e) => setUi({ title: e.target.value });
$('#dMenuBrand').onchange = (e) => setUi({ menuBrand: e.target.value.trim() });
$('#dCssApply').onclick = () => { setUi({ css: $('#dCss').value }); toast('Eigenes CSS angewendet'); };
$('#bgPick').onclick = async () => { try { const r = await api.ui.pickBackground(); if (r) { ui = r; applyUi(); toast('Hintergrund gesetzt – schau auf „Spielen“'); } } catch (e) { toast(e.message, true); } };
$('#bgClear').onclick = async () => { await api.ui.clearBackground(); delete ui.bgData; delete ui.bgFile; applyUi(); toast('Hintergrund entfernt'); };
$('#designReset').onclick = async () => {
  if (!confirm('Design auf Standard zurücksetzen? (Hintergrundbild und eigenes CSS werden entfernt)')) return;
  await api.ui.clearBackground(); ui = {}; await api.ui.save({ theme: 'gold', dim: 45, blur: 0, grid: true, zoom: 100, compact: false, news: true, reduceMotion: false, skinAnim: 'idle', skinRotate: false, skinHide: false, title: '', menuBrand: '', css: '' });
  ui = await api.ui.get(); await api.settings.save({ accent: '#FFB400' }); applyAccent('#FFB400'); applyUi(); renderDesign(); toast('Design zurückgesetzt');
};

// ---------- Freunde ----------
let lastFriends = null;
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} min` : m < 1440 ? `vor ${Math.round(m / 60)} h` : `vor ${Math.round(m / 1440)} Tagen`; };
function friendText(f) {
  if (!f.online) return f.lastSeen ? `Offline · zuletzt ${ago(f.lastSeen)}` : 'Offline';
  if (f.state !== 'playing') return 'Online im Launcher';
  return `Spielt ${f.version || ''}${f.loader ? ' ' + (LOADER_NAMES[f.loader] || f.loader) : ''}${f.server ? ' auf ' + f.server : f.world ? ' · Einzelspieler' : ''}${f.since ? ' · seit ' + ago(f.since).replace('vor ', '') : ''}`;
}
async function joinFriend(f) {
  const p = currentProfile(); if (!p) { toast('Erst ein Profil wählen', true); return; }
  if (f.version && p.version !== f.version) { const same = state.profiles.find(x => x.version === f.version); if (same && confirm(`${f.name} spielt ${f.version}. Mit „${same.name}“ beitreten statt mit „${p.name}“ (${p.version})?`)) { launchProfile(same.id, f.server); return; } }
  launchProfile(p.id, f.server);
}
function renderFriends(d) {
  lastFriends = d || lastFriends; if (!lastFriends) return;
  const sub = $('.view[data-view="friends"] .view-head p');
  if (sub) sub.textContent = lastFriends.account ? `Freundesliste von ${lastFriends.account} – jedes Minecraft-Konto hat seine eigene Liste.` : 'Melde dich oben rechts an – jedes Minecraft-Konto hat seine eigene Freundesliste.';
  const sb = $('#friendsServer');
  sb.classList.toggle('hidden', lastFriends.reachable);
  if (!lastFriends.reachable) { sb.innerHTML = ''; sb.append(el('span', '', `Presence-Server nicht erreichbar (${lastFriends.server}) – Online-Status wird nicht angezeigt. Starte ihn mit „node presence-server.js“ und trag die Adresse unter Optionen → Freunde ein.`)); const o = el('button', 'ghost small', 'Optionen'); o.onclick = () => showView('settings'); sb.append(o); }
  const box = $('#friendList'); box.innerHTML = '';
  const list = [...lastFriends.friends].sort((a, b) => (b.online - a.online) || ((b.state === 'playing') - (a.state === 'playing')) || a.name.localeCompare(b.name));
  if (!list.length) box.append(el('p', 'muted', 'Noch keine Freunde. Minecraft-Namen oben eintragen – sie sehen dich, sobald sie auch LellekClient nutzen.'));
  for (const f of list) {
    const c = el('div', 'card friend' + (f.online ? (f.state === 'playing' ? ' playing' : ' online') : ''));
    const head = el('img', 'fhead'); head.alt = ''; setHead(head, f.uuid);
    const top = el('div', 'friend-top'); const nm = el('div'); nm.append(el('b', '', f.name), el('span', 'fstatus', friendText(f))); top.append(head, nm);
    const act = el('div', 'actions');
    if (f.online && f.server) { const j = el('button', 'primary', 'Beitreten'); j.onclick = () => joinFriend(f); act.append(j); }
    const rm = el('button', 'ghost danger', 'Entfernen'); rm.onclick = async () => { if (!confirm(`${f.name} aus der Liste entfernen?`)) return; renderFriends(await api.friends.remove(f.uuid)); }; act.append(rm);
    c.append(top, act); box.append(c);
  }
  renderFriendsMini();
}
function renderFriendsMini() {
  const on = (lastFriends?.friends || []).filter(f => f.online);
  $('#friendsMini').classList.toggle('hidden', !on.length);
  const box = $('#friendsMiniList'); box.innerHTML = '';
  for (const f of on.slice(0, 6)) {
    const r = el('div', 'fmini' + (f.state === 'playing' ? ' playing' : '')); const h = el('img'); h.alt = ''; setHead(h, f.uuid);
    const t = el('div'); t.append(el('b', '', f.name), el('span', '', f.state === 'playing' ? (f.server || (f.world ? 'Einzelspieler' : f.version)) : 'im Launcher'));
    r.append(h, t); if (f.server) { r.title = 'Klicken zum Beitreten'; r.onclick = () => joinFriend(f); } box.append(r);
  }
}
async function loadFriends() { try { renderFriends(await api.friends.list()); } catch (e) { toast(e.message, true); } }
api.friends.onUpdate((d) => { renderFriends(d); });
// Kontowechsel → Freundesliste des neuen Kontos laden
api.auth.onChange(() => { lastFriends = null; $('#friendList').innerHTML = ''; renderFriendsMini(); setTimeout(loadFriends, 300); lastPresencePush = 0; });
let lastPresencePush = 0;
$('#friendAdd').onclick = async () => { const n = $('#friendName').value.trim(); if (!n) return; const b = $('#friendAdd'); b.disabled = true; try { renderFriends(await api.friends.add(n)); $('#friendName').value = ''; toast(`${n} hinzugefügt`); } catch (e) { toast(e.message, true); } b.disabled = false; };
$('#friendName').onkeydown = (e) => { if (e.key === 'Enter') $('#friendAdd').click(); };

// ---------- Server: Typ, Tunnel, öffentliche Adresse, Plugins ----------
{
  const _rs = renderServer;
  renderServer = async function (...a) {
    const r = await _rs.apply(this, a); if (!state.current) return r;
    let info; try { info = await api.server.info(state.current); } catch { return r; }
    $('#serverType').value = info.serverType || 'vanilla';
    $('#publicAddress').value = info.publicAddress || ''; $('#tunnelPort').textContent = info.port;
    setTunnelUi(info.tunnel);
    const label = { vanilla: 'Vanilla', paper: 'Paper', fabric: 'Fabric' }[info.serverType] || 'Vanilla';
    const stLine = $('#serverStatus .muted'); if (stLine) stLine.textContent = `${label} ${info.version}`;
    renderPlugins();
    return r;
  };
}
function setTunnelUi(running) { $('#tunnelStart').classList.toggle('hidden', !!running); $('#tunnelStop').classList.toggle('hidden', !running); }
api.tunnel.onState(({ running, error }) => { setTunnelUi(running); if (error) toast('Tunnel: ' + error, true); });
$('#tunnelStart').onclick = async () => { const b = $('#tunnelStart'); b.disabled = true; toast('Lade playit.gg-Agent…'); try { await api.tunnel.start(); toast('playit-Fenster geöffnet – beim ersten Mal dem Link folgen und den Tunnel anlegen'); } catch (e) { toast(e.message, true); } b.disabled = false; };
$('#tunnelStop').onclick = async () => { await api.tunnel.stop(); toast('Tunnel gestoppt'); };
$('#publicSave').onclick = async () => { try { await api.setServerAddress({ profileId: state.current, address: $('#publicAddress').value }); toast('Adresse gespeichert'); } catch (e) { toast(e.message, true); } };
$('#publicCopy').onclick = () => { const v = $('#publicAddress').value.trim(); if (!v || /•/.test(v)) return; navigator.clipboard.writeText(v); toast('Adresse kopiert – an Freunde schicken'); };
async function renderPlugins() {
  const box = $('#pluginBox'); if (!state.current) { box.classList.add('hidden'); return; }
  const r = await api.serverContent.list(state.current);
  const ok = r.type === 'paper' || r.type === 'fabric'; box.classList.toggle('hidden', !ok); if (!ok) return;
  $('#pluginTitle').textContent = r.type === 'paper' ? 'Plugins (Paper)' : 'Server-Mods (Fabric)';
  const ul = $('#pluginList'); ul.innerHTML = '';
  if (!r.files.length) ul.append(el('li', 'empty-li', r.type === 'paper' ? 'Noch keine Plugins – unten suchen.' : 'Noch keine Server-Mods – unten suchen.'));
  for (const f of r.files) {
    const li = el('li', f.enabled ? '' : 'off'); const acts = el('span', 'row gap');
    const t = el('button', 'ghost', f.enabled ? 'Aus' : 'An'); t.onclick = async () => { await api.serverContent.toggle({ profileId: state.current, file: f.file }); renderPlugins(); };
    const d = el('button', 'ghost danger', 'Löschen'); d.onclick = async () => { if (confirm(`${f.file} löschen?`)) { await api.serverContent.remove({ profileId: state.current, file: f.file }); renderPlugins(); } };
    acts.append(t, d); li.append(el('span', 'dot'), el('span', '', f.file.replace(/\.disabled$/, '')), el('span', 'size', fmtSize(f.size)), acts); ul.append(li);
  }
  if (!$('#pluginResults').children.length) searchPlugins();
}
async function searchPlugins() {
  const out = $('#pluginResults'); out.innerHTML = '';
  try {
    const r = await api.serverContent.search({ profileId: state.current, query: $('#pluginQuery').value.trim() });
    for (const it of r.items) {
      const c = el('div', 'result'); const img = el('img'); img.src = it.icon || ''; img.alt = '';
      const body = el('div'); body.append(el('b', '', it.name), el('p', '', it.summary || ''), el('span', 'meta', `${it.author || ''} · ${fmtNum(it.downloads)} Downloads`));
      const b = el('button', 'primary', 'Installieren'); b.onclick = async () => { b.disabled = true; b.textContent = 'Lädt…'; try { const f = await api.serverContent.install({ profileId: state.current, projectId: it.id }); b.textContent = 'Installiert'; toast(`${f.join(', ')} installiert – Server neu starten`); renderPlugins(); } catch (e) { b.disabled = false; b.textContent = 'Installieren'; toast(e.message, true); } };
      c.append(img, body, b); attachDetails(c, it); out.append(c);
    }
    if (!r.items.length) out.append(el('p', 'muted', 'Nichts gefunden.'));
  } catch (e) { out.append(el('p', 'muted', e.message)); }
}
$('#pluginSearch').onclick = searchPlugins;
$('#pluginQuery').onkeydown = (e) => { if (e.key === 'Enter') searchPlugins(); };
$('#pluginFolder').onclick = () => api.serverContent.openFolder(state.current).catch(e => toast(e.message, true));

// ---------- Screenshots an Discord ----------
async function sendShotToDiscord(file, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Sendet…'; }
  try { await api.shotDiscord({ profileId: state.current, file }); toast('Screenshot an Discord gesendet'); if (btn) btn.textContent = 'Gesendet ✓'; }
  catch (e) { toast(e.message, true); if (btn) { btn.disabled = false; btn.textContent = 'Discord'; } if (/Webhook/.test(e.message)) { showView('settings'); setTimeout(() => $('#settingsForm').discordWebhook.focus(), 300); } }
}

// ---------- PC-Check ----------
async function runPcCheck() {
  const d = $('#infoDialog'); if (d.open) d.close();
  const body = $('#infoBody'); body.innerHTML = ''; body.append(el('h2', '', 'PC-Check'), el('p', 'muted', 'Prüfe Hardware …')); d.showModal();
  let r; try { r = await api.pc.check(); } catch (e) { body.append(el('p', 'muted', e.message)); return; }
  body.innerHTML = ''; body.append(el('h2', '', 'PC-Check'));
  const spec = el('div', 'pc-specs');
  const row = (k, v) => { const x = el('div'); x.append(el('span', 'muted', k), el('b', '', v)); spec.append(x); };
  row('Arbeitsspeicher', `${r.totalGb} GB (frei ${r.freeGb} GB)`); row('Prozessor', `${r.cpu} · ${r.threads} Threads`);
  for (const g of r.gpus) row('Grafik', `${g.name}${g.vram ? ' · ' + g.vram + ' GB' : ''}${g.date ? ' · Treiber ' + g.date.slice(6, 8) + '.' + g.date.slice(4, 6) + '.' + g.date.slice(0, 4) : ''}`);
  if (!r.gpus.length) row('Grafik', 'nicht erkannt');
  if (r.diskFreeGb != null) row('Freier Speicher', `${r.diskFreeGb} GB`); row('System', r.os);
  body.append(spec, el('h3', '', 'Empfehlungen'));
  for (const t of r.tips) { const x = el('div', 'pc-tip ' + t.level); x.append(el('span', 'ic', t.level === 'ok' ? '✓' : '!'), el('span', '', t.text)); body.append(x); }
  if (r.profiles.length) {
    body.append(el('h3', '', 'Arbeitsspeicher deiner Profile'));
    for (const p of r.profiles) {
      const x = el('div', 'pc-prof'); x.append(el('span', 'grow', p.name), el('span', p.status === 'ok' ? 'muted' : 'warn', `${p.memory} GB${p.status === 'high' ? ' – zu viel' : p.status === 'low' ? ' – knapp' : ''}`));
      if (p.memory !== p.recommended) { const b = el('button', 'ghost small', `Auf ${p.recommended} GB`); b.onclick = async () => { state.profiles = await api.pc.setMemory({ id: p.id, memory: p.recommended }); b.disabled = true; b.textContent = 'Gesetzt ✓'; renderLaunch(); }; x.append(b); }
      body.append(x);
    }
  }
}
$('#pcCheck').onclick = runPcCheck;

// ---------- Projekt-Details mit Galerie ----------
function attachDetails(card, it) {
  const img = card.querySelector('img'), title = card.querySelector('b');
  for (const x of [img, title]) if (x) { x.classList.add('clickable'); x.title = 'Details & Bilder'; x.onclick = () => showProjectDetails(it, card); }
}
async function showProjectDetails(it, card) {
  const d = $('#infoDialog'); if (d.open) d.close();
  const body = $('#infoBody'); body.innerHTML = ''; body.append(el('h2', '', it.name), el('p', 'muted', 'Lade Details …')); d.classList.add('wide'); d.showModal();
  let r; try { r = await api.details({ source: it.source, id: it.id }); } catch (e) { body.lastChild.textContent = e.message; return; }
  body.innerHTML = '';
  if (r.icon) { const i = el('img'); i.src = r.icon; i.alt = ''; body.append(i); }
  body.append(el('h2', '', r.title), el('p', 'muted', r.summary || ''));
  body.append(el('p', 'muted', [`${fmtNum(r.downloads)} Downloads`, r.followers ? `${fmtNum(r.followers)} Follower` : '', r.loaders.join(', '), r.versions.length ? 'MC ' + r.versions.join(', ') : '', r.updated ? 'aktualisiert ' + new Date(r.updated).toLocaleDateString('de-DE') : ''].filter(Boolean).join(' · ')));
  const btns = el('div', 'row gap');
  const inst = card?.querySelector('button.primary');
  if (inst && !inst.disabled) { const b = el('button', 'primary small', inst.textContent); b.onclick = () => { d.close(); inst.click(); }; btns.append(b); }
  if (r.url) { const b = el('button', 'ghost small', it.source === 'modrinth' ? 'Auf Modrinth öffnen' : 'Auf CurseForge öffnen'); b.onclick = () => api.bundle.open(r.url); btns.append(b); }
  if (r.source) { const b = el('button', 'ghost small', 'Quellcode'); b.onclick = () => api.bundle.open(r.source); btns.append(b); }
  body.append(btns);
  if (r.gallery.length) {
    const big = el('img', 'gal-big'); big.alt = ''; big.src = r.gallery[0].raw; const cap = el('p', 'muted gal-cap', r.gallery[0].title);
    const strip = el('div', 'gal-strip');
    r.gallery.forEach((g, i) => { const t = el('img', i === 0 ? 'sel' : ''); t.src = g.url; t.alt = ''; t.onclick = () => { big.src = g.raw; cap.textContent = g.title; [...strip.children].forEach(c => c.classList.toggle('sel', c === t)); }; strip.append(t); });
    body.append(big, cap, strip);
  }
  if (r.body) body.append(el('div', 'pre', r.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/[#*`>_]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim()));
}
$('#infoDialog').addEventListener('close', () => $('#infoDialog').classList.remove('wide'));

// ---------- Changelog bei Mod-Updates ----------
async function showChangelog(r) {
  const d = $('#infoDialog'); if (d.open) d.close();
  const body = $('#infoBody'); body.innerHTML = ''; body.append(el('h2', '', `${r.newFile}`), el('p', 'muted', `Neue Version ${r.newVersion} · ${r.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}`));
  const pre = el('div', 'pre', 'Lade Änderungen …'); body.append(pre); d.showModal();
  try { const t = await api.changelog({ source: r.source, cfModId: r.cfModId, cfFileId: r.cfFileId, changelog: r.changelog }); pre.textContent = (t || 'Der Autor hat keine Änderungen angegeben.').replace(/[#*`]/g, ''); } catch (e) { pre.textContent = e.message; }
  if (r.url) { const b = el('button', 'primary small', 'Jetzt aktualisieren'); b.onclick = () => { d.close(); applyUpdate(r, null).then(() => loadInstalled()); }; body.append(b); }
}

// ---------- Optionen: zusätzliche Felder ----------
{
  const _ls = loadSettings;
  loadSettings = async function (...a) {
    const r = await _ls.apply(this, a); const s = await api.settings.get(), f = $('#settingsForm');
    f.presenceServer.value = s.presenceServer || ''; f.sharePresence.checked = s.sharePresence !== false; f.friendNotify.checked = s.friendNotify !== false; f.discordWebhook.value = s.discordWebhook || '';
    api.friends.status().then(st => { $('#presenceState').textContent = st.online ? `Verbunden – ${st.online_players ?? st.players ?? 0} Spieler online (${st.server})` : `Nicht erreichbar (${st.server}). Server: node presence-server.js im Ordner „server“ des Quellcodes.`; });
    applyStreamer(await api.streamer.get());
    return r;
  };
  $('#settingsForm').addEventListener('submit', (e) => { const f = e.target; api.settings.save({ presenceServer: f.presenceServer.value.trim(), sharePresence: f.sharePresence.checked, friendNotify: f.friendNotify.checked, discordWebhook: f.discordWebhook.value.trim() }); }, true);
}

// ---------- Start ----------
(async () => {
  try { ui = await api.ui.get(); } catch { ui = {}; }
  applyUi();
  try { applyStreamer(await api.streamer.get()); } catch {}
  setTimeout(loadFriends, 2500);
})();

// ---------- macOS: ⌘ statt Strg anzeigen ----------
if (/Mac/.test(navigator.userAgent)) {
  const mac = (t) => String(t).replace(/Strg\s*\+\s*Umschalt\s*\+\s*/g, '⌘⇧').replace(/Strg\s*\+\s*/g, '⌘').replace(/\bStrg\b/g, '⌘');
  document.body.classList.add('os-mac');
  const walk = (root) => { const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = it.nextNode())) if (n.nodeValue.includes('Strg')) n.nodeValue = mac(n.nodeValue); };
  walk(document.body);
  for (const e of document.querySelectorAll('[title*="Strg"]')) e.title = mac(e.title);
  const _pi2 = paletteItems; paletteItems = function () { return _pi2().map(it => ({ ...it, hint: mac(it.hint || '') })); };
}
