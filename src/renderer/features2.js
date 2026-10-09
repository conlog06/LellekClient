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
  $('#sideTitle').textContent = (ui.title || '').trim() || 'LellekClient';
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

// ---------- Freunde (Anfragen, Status, Einladungen) ----------
let lastFriends = null, ftab = 'friends';
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} min` : m < 1440 ? `vor ${Math.round(m / 60)} h` : `vor ${Math.round(m / 1440)} Tagen`; };
const STATUS_TEXT = { online: 'Online', away: 'Abwesend', dnd: 'Bitte nicht stören', invisible: 'Unsichtbar' };
const dotClass = (f) => !f.online ? 'off' : f.status === 'dnd' ? 'dnd' : f.status === 'away' ? 'away' : f.state === 'playing' ? 'play' : 'on';
function friendText(f) {
  if (f.pending) return 'Wartet auf Bestätigung …';
  if (!f.online) return f.lastSeen ? `Offline · zuletzt ${ago(f.lastSeen)}` : 'Offline';
  const st = f.status && f.status !== 'online' ? STATUS_TEXT[f.status] + ' · ' : '';
  if (f.state !== 'playing') return st + 'Im Launcher';
  return `${st}Spielt ${f.version || ''}${f.loader ? ' ' + (LOADER_NAMES[f.loader] || f.loader) : ''}${f.server ? ' auf ' + f.server : f.world ? ' · Einzelspieler' : ''}${f.since ? ' · seit ' + ago(f.since).replace('vor ', '') : ''}`;
}
const fname = (f) => f.nick || f.name;
async function joinFriend(f) {
  const p = currentProfile(); if (!p) { toast('Erst ein Profil wählen', true); return; }
  if (f.version && p.version !== f.version) { const same = state.profiles.find(x => x.version === f.version); if (same && confirm(`${fname(f)} spielt ${f.version}. Mit „${same.name}“ beitreten statt mit „${p.name}“ (${p.version})?`)) { launchProfile(same.id, f.server); return; } }
  launchProfile(p.id, f.server);
}
async function friendAction(fn, okText) { try { const r = await fn(); if (r && r.friends) renderFriends(r); if (okText) toast(okText); } catch (e) { toast(e.message, true); } }
function headImg(uuid, cls = 'fhead') { const h = el('img', cls); h.alt = ''; setHead(h, uuid); return h; }
function renderFriends(d) {
  lastFriends = d || lastFriends; const L = lastFriends; if (!L) return;
  $('#friendsSub').textContent = L.account ? `Freundesliste von ${L.account} – jedes Minecraft-Konto hat seine eigene.` : 'Melde dich oben rechts an – jedes Minecraft-Konto hat seine eigene Freundesliste.';
  // eigener Status
  $('#meStatus').classList.toggle('hidden', !L.loggedIn);
  if (L.loggedIn) {
    $('#meName').textContent = L.account || '';
    if (document.activeElement !== $('#meStatusSel')) $('#meStatusSel').value = L.sharePresence ? (L.status || 'online') : 'invisible';
    if (document.activeElement !== $('#meNote')) $('#meNote').value = L.note || '';
    $('#meDot').className = 'sdot ' + ({ online: 'on', away: 'away', dnd: 'dnd', invisible: 'off' }[L.sharePresence ? L.status : 'invisible'] || 'on');
  }
  // Server-Hinweis
  const sb = $('#friendsServer'); sb.classList.toggle('hidden', L.reachable || !L.loggedIn);
  if (!L.reachable && L.loggedIn) { sb.innerHTML = ''; sb.append(el('span', '', `Freunde-Server gerade nicht erreichbar (${L.server}). Er wacht nach einer Pause in bis zu einer Minute auf – danach erscheinen Status und Anfragen.`)); const o = el('button', 'ghost small', 'Erneut versuchen'); o.onclick = () => loadFriends(true); sb.append(o); }
  // Zähler
  const online = L.friends.filter(f => f.online).length;
  $('#cntFriends').textContent = L.friends.length ? `${online}/${L.friends.length}` : '';
  $('#cntReq').textContent = String(L.incoming.length); $('#cntReq').classList.toggle('hidden', !L.incoming.length);
  railBadge(L.incoming.length);
  // Tabs
  $$('#friendsSeg button').forEach(b => b.classList.toggle('active', b.dataset.ftab === ftab));
  $('#friendList').classList.toggle('hidden', ftab !== 'friends'); $('#requestList').classList.toggle('hidden', ftab !== 'requests'); $('#blockedList').classList.toggle('hidden', ftab !== 'blocked');
  $('#friendSearch').classList.toggle('hidden', ftab !== 'friends'); $('#chatPane').classList.toggle('hidden', ftab !== 'chat');
  if (ftab === 'friends') renderFriendCards(L); else if (ftab === 'requests') renderRequests(L); else if (ftab === 'chat') renderChat(); else renderBlocked(L);
  renderFriendsMini();
}
function renderFriendCards(L) {
  const box = $('#friendList'); box.innerHTML = '';
  const q = ($('#friendSearch').value || '').toLowerCase();
  const rank = (f) => (f.fav ? 0 : 10) + (f.online ? (f.state === 'playing' ? 0 : 1) : 5);
  const list = L.friends.filter(f => !q || `${f.name} ${f.nick || ''}`.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || fname(a).localeCompare(fname(b)));
  if (!L.friends.length) { const e = el('div', 'empty-friends'); e.append(el('b', '', 'Noch keine Freunde'), el('span', '', L.loggedIn ? 'Gib oben einen Minecraft-Namen ein und schick eine Anfrage. Sobald sie angenommen ist, seht ihr euch gegenseitig.' : 'Melde dich oben rechts mit Microsoft an.')); if (L.incoming.length) { const b = el('button', 'primary small', `${L.incoming.length} offene Anfrage(n) ansehen`); b.onclick = () => { ftab = 'requests'; renderFriends(); }; e.append(b); } box.append(e); return; }
  if (!list.length) box.append(el('p', 'muted', 'Kein Freund passt zur Suche.'));
  for (const f of list) {
    const c = el('div', 'card friend ' + dotClass(f));
    const top = el('div', 'friend-top'); const nm = el('div', 'fn');
    const title = el('b'); title.append(document.createTextNode(fname(f))); if (f.fav) title.prepend(el('span', 'star', '★ ')); if (f.nick) title.append(el('small', 'real', ` ${f.name}`)); if (f.level) { const lv = el('span', 'lvl-pill', String(f.level)); lv.title = `Level ${f.level}${f.badge ? ' · ' + f.badge : ''}`; title.append(' ', lv); }
    nm.append(title, el('span', 'fstatus', friendText(f))); if (f.online && f.note) nm.append(el('span', 'fnote', `„${f.note}“`)); if (f.badge) nm.append(el('span', 'fbadge', f.badge));
    top.append(headImg(f.uuid), nm);
    const act = el('div', 'actions');
    if (f.online && f.server) { const j = el('button', 'primary', 'Beitreten'); j.onclick = () => joinFriend(f); act.append(j); }
    if (f.online && !f.pending) { const i = el('button', 'ghost', 'Einladen'); i.title = L.myServer ? `Auf ${L.myServer} einladen` : 'Nachricht/Einladung schicken'; i.onclick = () => inviteFriend(f); act.append(i); }
    if (!f.pending) { const ch = el('button', 'ghost', 'Nachricht'); ch.onclick = () => openChat(f.uuid); act.append(ch); }
    const fav = el('button', 'ghost icon-btn' + (f.fav ? ' on' : ''), '★'); fav.title = f.fav ? 'Kein Favorit mehr' : 'Als Favorit oben anheften'; fav.onclick = () => friendAction(() => api.friends.edit({ uuid: f.uuid, fav: !f.fav })); act.append(fav);
    const more = el('button', 'ghost icon-btn', '⋯'); more.title = 'Mehr'; act.append(more);
    const menu = el('div', 'fmenu hidden');
    const nick = el('button', 'ghost small', 'Spitzname'); nick.onclick = async () => { const n = await askText(`Spitzname für ${f.name} („-“ entfernt ihn):`, f.nick || ''); if (n === null) return; friendAction(() => api.friends.edit({ uuid: f.uuid, nick: n === '-' ? '' : n }), n === '-' ? 'Spitzname entfernt' : 'Spitzname gespeichert'); };
    const rm = el('button', 'ghost small danger', 'Entfernen'); rm.onclick = () => { if (confirm(`${fname(f)} als Freund entfernen? Ihr seht euch dann nicht mehr.`)) friendAction(() => api.friends.remove(f.uuid), `${fname(f)} entfernt`); };
    const bl = el('button', 'ghost small danger', 'Blockieren'); bl.onclick = () => { if (confirm(`${f.name} blockieren? Er wird entfernt und kann dir keine Anfragen mehr schicken.`)) friendAction(() => api.friends.block({ uuid: f.uuid, name: f.name }), `${f.name} blockiert`); };
    const pty = el('button', 'ghost small', 'In Party einladen'); pty.onclick = () => partyInviteFriend(f);
    const shr = el('button', 'ghost small', 'Profil schicken'); shr.onclick = () => chatSendProfile(f.uuid);
    if (!f.pending) menu.append(pty, shr);
    menu.append(nick, rm, bl); more.onclick = () => menu.classList.toggle('hidden');
    c.append(top, act, menu); box.append(c);
  }
}
function reqRow(x, sub, buttons) { const r = el('div', 'req-row'); const t = el('div'); t.append(el('b', '', x.name), el('span', 'muted', sub)); r.append(headImg(x.uuid, 'rhead'), t, ...buttons); return r; }
function renderRequests(L) {
  const box = $('#requestList'); box.innerHTML = '';
  box.append(el('h3', '', `Eingehend (${L.incoming.length})`));
  if (!L.incoming.length) box.append(el('p', 'muted', 'Keine offenen Anfragen.'));
  for (const x of L.incoming) {
    const yes = el('button', 'primary', 'Annehmen'); yes.onclick = () => friendAction(() => api.friends.respond({ uuid: x.uuid, accept: true }), `Du bist jetzt mit ${x.name} befreundet`);
    const no = el('button', 'ghost', 'Ablehnen'); no.onclick = () => friendAction(() => api.friends.respond({ uuid: x.uuid, accept: false }), 'Anfrage abgelehnt');
    const bl = el('button', 'ghost danger', 'Blockieren'); bl.onclick = () => friendAction(() => api.friends.block({ uuid: x.uuid, name: x.name }), `${x.name} blockiert`);
    box.append(reqRow(x, `möchte mit dir befreundet sein · ${ago(x.at)}`, [yes, no, bl]));
  }
  box.append(el('h3', '', `Gesendet (${L.outgoing.length})`));
  if (!L.outgoing.length) box.append(el('p', 'muted', 'Keine gesendeten Anfragen. Der andere sieht deine Anfrage, sobald er LellekClient öffnet.'));
  for (const x of L.outgoing) { const c = el('button', 'ghost', 'Zurückziehen'); c.onclick = () => friendAction(() => api.friends.cancel(x.uuid), 'Anfrage zurückgezogen'); box.append(reqRow(x, `Anfrage gesendet ${ago(x.at)} – wartet auf Antwort`, [c])); }
}
function renderBlocked(L) {
  const box = $('#blockedList'); box.innerHTML = '';
  if (!L.blocked.length) { box.append(el('p', 'muted', 'Niemand blockiert. Blockierte Spieler können dir keine Anfragen schicken und sehen deinen Status nicht.')); return; }
  for (const x of L.blocked) { const u = el('button', 'ghost', 'Entsperren'); u.onclick = () => friendAction(() => api.friends.unblock(x.uuid), `${x.name} entsperrt`); box.append(reqRow(x, `blockiert ${ago(x.at || Date.now())}`, [u])); }
}
function railBadge(n) {
  const btn = $('.rail-btn[data-view="friends"]'); if (!btn) return;
  let b = btn.querySelector('.rail-badge'); if (!b) { b = el('i', 'rail-badge'); btn.append(b); }
  b.textContent = n > 9 ? '9+' : String(n); b.classList.toggle('hidden', !n);
}
async function inviteFriend(f) {
  const where = lastFriends?.myServer;
  const msg = await askText(where ? `${fname(f)} auf ${where} einladen – Nachricht (optional):` : `Nachricht an ${fname(f)} (z. B. „Lust auf eine Runde?“):`, where ? 'Komm rüber!' : 'Lust auf eine Runde?');
  if (msg === null) return;
  try { await api.friends.invite({ uuid: f.uuid, message: msg }); toast(`Einladung an ${fname(f)} geschickt`); } catch (e) { toast(e.message, true); }
}
function renderFriendsMini() {
  const on = (lastFriends?.friends || []).filter(f => f.online);
  $('#friendsMini').classList.toggle('hidden', !on.length && !(lastFriends?.incoming || []).length);
  const box = $('#friendsMiniList'); box.innerHTML = '';
  if (lastFriends?.incoming?.length) { const r = el('div', 'fmini req'); r.append(el('b', '', `${lastFriends.incoming.length} Freundschaftsanfrage(n)`), el('span', '', 'ansehen →')); r.title = 'Anfragen öffnen'; r.onclick = () => { ftab = 'requests'; showView('friends'); }; box.append(r); }
  for (const f of on.sort((a, b) => (b.state === 'playing') - (a.state === 'playing')).slice(0, 6)) {
    const r = el('div', 'fmini ' + dotClass(f)); const t = el('div'); t.append(el('b', '', fname(f)), el('span', '', f.state === 'playing' ? (f.server || (f.world ? 'Einzelspieler' : f.version)) : (f.note || STATUS_TEXT[f.status] || 'im Launcher')));
    r.append(headImg(f.uuid, ''), t); if (f.server) { r.title = 'Klicken zum Beitreten'; r.onclick = () => joinFriend(f); } box.append(r);
  }
}
async function loadFriends(force) { try { renderFriends(await api.friends.list()); } catch (e) { if (force) toast(e.message, true); } }
api.friends.onUpdate((d) => { renderFriends(d); });
// Kontowechsel → Freundesliste des neuen Kontos laden
api.auth.onChange(() => { lastFriends = null; $('#friendList').innerHTML = ''; railBadge(0); setTimeout(loadFriends, 300); });
// Einladungen als Banner
api.friends.onInvite((inv) => {
  let box = $('#inviteToasts'); if (!box) { box = el('div', 'invite-toasts'); box.id = 'inviteToasts'; document.body.append(box); }
  const t = el('div', 'invite-toast'); const h = headImg(inv.from, 'ihead');
  const body = el('div'); body.append(el('b', '', `${inv.name} lädt dich ein`), el('span', '', [inv.server ? `auf ${inv.server}${inv.version ? ' (' + inv.version + ')' : ''}` : '', inv.message ? `„${inv.message}“` : ''].filter(Boolean).join(' · ') || 'Lust auf eine Runde?'));
  const acts = el('div', 'row gap');
  if (inv.server) { const j = el('button', 'primary small', 'Beitreten'); j.onclick = () => { t.remove(); joinFriend({ name: inv.name, server: inv.server, version: inv.version }); }; acts.append(j); }
  const x = el('button', 'ghost small', 'Schließen'); x.onclick = () => t.remove(); acts.append(x);
  body.append(acts); t.append(h, body); box.append(t); setTimeout(() => t.remove(), 120000);
});
$('#friendAdd').onclick = async () => {
  const n = $('#friendName').value.trim(); if (!n) return; const b = $('#friendAdd'); b.disabled = true;
  try { const r = await api.friends.add(n); renderFriends(r); $('#friendName').value = ''; toast(r.result === 'friends' ? `${r.name} hatte dich schon angefragt – ihr seid jetzt Freunde` : `Anfrage an ${r.name} gesendet – sobald sie angenommen ist, seht ihr euch`); if (r.result === 'sent') { ftab = 'requests'; renderFriends(); } }
  catch (e) { toast(e.message, true); }
  b.disabled = false;
};
$('#friendName').onkeydown = (e) => { if (e.key === 'Enter') $('#friendAdd').click(); };
$$('#friendsSeg button').forEach(b => b.onclick = () => { ftab = b.dataset.ftab; renderFriends(); });
$('#friendSearch').oninput = () => renderFriends();
$('#meStatusSel').onchange = (e) => friendAction(async () => { const v = e.target.value; if (v !== 'invisible' && lastFriends && !lastFriends.sharePresence) await api.settings.save({ sharePresence: true }); return api.friends.setStatus({ status: v }); }, `Status: ${STATUS_TEXT[$('#meStatusSel').value]}`);
$('#meNoteSave').onclick = () => friendAction(() => api.friends.setStatus({ note: $('#meNote').value }), 'Statusnachricht gespeichert');
$('#meNote').onkeydown = (e) => { if (e.key === 'Enter') $('#meNoteSave').click(); };

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
