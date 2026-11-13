// LellekClient 3.1 – Launcher sparsamer, Spielstart messbar, neue Werkzeuge
const V31 = { usage: {}, game: false, ready: {} };
const fmtGb = (b) => (b / 1073741824).toFixed(1).replace('.', ',') + ' GB';
const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const usageText = (u) => `RAM ${fmtGb(u.rss)}${u.max ? ' / ' + Math.round(u.max / 1073741824) + ' GB' : ''}`;

// =====================================================================
// Performance: Animationen und 3D-Vorschauen schlafen, wenn niemand hinsieht
// =====================================================================
let pauseSettings = { pauseUnfocused: true, gameMode: true };
function applyPause() {
  const away = document.hidden || (pauseSettings.pauseUnfocused !== false && !document.hasFocus());
  const gaming = pauseSettings.gameMode !== false && V31.game;
  const pause = away || gaming;
  document.body.classList.toggle('idle-pause', pause);
  document.body.classList.toggle('game-running', V31.game);
  try { if (typeof viewer !== 'undefined' && viewer) viewer.renderPaused = pause || state.view !== 'play'; } catch {}
  try { if (typeof currentViewer !== 'undefined' && currentViewer) currentViewer.renderPaused = pause || state.view !== 'skins'; } catch {}
  try { for (const v of skinViewers) v.renderPaused = pause || state.view !== 'skins'; } catch {}
}
window.addEventListener('blur', () => setTimeout(applyPause, 50));
window.addEventListener('focus', applyPause);
document.addEventListener('visibilitychange', applyPause);
{ const _sv = showView; showView = function (v) { const r = _sv(v); safe('pause', applyPause); return r; }; }
api.settings.get().then(s => { pauseSettings = s; applyPause(); }).catch(() => {});

// Skin-Bibliothek: statische Vorschaubilder aus EINEM 3D-Renderer statt einem WebGL-Kontext pro Skin
const thumbCache = new Map(); let thumbViewer = null, thumbQueue = Promise.resolve();
{
  const _sc = skinCanvas;
  skinCanvas = function (canvas, dataUrl, slim, w, hgt) {
    if (w > 140 || typeof skinview3d === 'undefined') { const v = _sc(canvas, dataUrl, slim, w, hgt); safe('pause', applyPause); return v; }
    const img = new Image(w, hgt); img.alt = ''; img.className = 'skin-thumb'; img.style.width = w + 'px'; img.style.height = hgt + 'px'; canvas.replaceWith(img);
    const key = (slim ? 's' : 'd') + dataUrl.length + dataUrl.slice(-64);
    if (thumbCache.has(key)) { img.src = thumbCache.get(key); return null; }
    thumbQueue = thumbQueue.then(async () => {
      try {
        if (!thumbViewer) { thumbViewer = new skinview3d.SkinViewer({ canvas: document.createElement('canvas'), width: w, height: hgt, preserveDrawingBuffer: true }); thumbViewer.renderPaused = true; thumbViewer.zoom = 0.9; try { thumbViewer.playerObject.rotation.y = 0.5; } catch {} }
        await thumbViewer.loadSkin(dataUrl, { model: slim ? 'slim' : 'default' });
        thumbViewer.render(); const url = thumbViewer.canvas.toDataURL('image/png'); thumbCache.set(key, url); img.src = url;
      } catch { img.src = dataUrl; img.style.imageRendering = 'pixelated'; }
    });
    return null;
  };
}

// =====================================================================
// Spielstart: Spielmodus, „bereit in …“, Live-RAM
// =====================================================================
const syncGame = () => { V31.game = runningSet.size > 0; applyPause(); };
api.v31.onGame(({ running }) => { V31.game = running > 0 || runningSet.size > 0; applyPause(); });
api.onClosed(({ profileId }) => { setTimeout(syncGame, 300); delete V31.usage[profileId]; setTimeout(() => afterGameClosed(profileId), 1200); });
api.v31.onReady(({ profileId, ms }) => {
  V31.ready[profileId] = ms; const p = state.profiles.find(x => x.id === profileId);
  if (p) { p.lastLaunch = { ...(p.lastLaunch || {}), readyMs: ms, at: Date.now() }; }
  floatToast(`${p?.name || 'Minecraft'} ist bereit`, `Start bis Hauptmenü: ${fmtSec(ms)}`);
});
api.v31.onUsage((u) => {
  V31.usage[u.profileId] = u;
  if (state.view === 'instance' && V3.inst === u.profileId) { const e = $('#instUsage'); if (e) { e.textContent = usageText(u); e.classList.toggle('warn', u.max && u.rss > u.max * 1.6); } }
});
// Screenshot-Sofortaktion
api.v31.onShot(({ profileId, file, copied }) => {
  const p = state.profiles.find(x => x.id === profileId);
  floatToast(copied ? 'Screenshot kopiert' : '📸 Screenshot gespeichert', `${p?.name || ''} · ${file}`, copied ? { icon: '📸' } : { action: ['Kopieren', () => api.shotCopy({ profileId, file }).then(() => toast('In die Zwischenablage kopiert'))], ms: 6000 });
});

// Startzeit-Karte (Instanz-Übersicht)
function startTimeCard(p) {
  const box = h('div.start-card');
  const hist = (p.launchHistory || []).filter(x => x.readyMs).slice(-10);
  const last = p.lastLaunch;
  box.append(h('div.row', h('h3', { style: { margin: 0 } }, '⏱️ Startzeit'), h('span.grow'), last?.readyMs ? h('b.start-big', fmtSec(last.readyMs)) : h('span.muted', 'noch nicht gemessen')));
  if (hist.length > 1) {
    const max = Math.max(...hist.map(x => x.readyMs));
    const bars = h('div.start-bars'); for (const x of hist) { const b = h('div', { title: `${new Date(x.at).toLocaleString('de-DE')}: ${fmtSec(x.readyMs)} (Vorbereitung ${fmtSec(x.prepMs || 0)})` }); b.style.height = Math.max(8, Math.round(x.readyMs / max * 100)) + '%'; bars.append(b); }
    box.append(bars);
  }
  box.append(h('p.muted.small-note', last?.readyMs ? `Vom Klick auf „Spielen“ bis zum Hauptmenü. Vorbereitung im Launcher: ${fmtSec(last.prepMs || 0)}. Ab dem zweiten Start deutlich schneller – geprüfte Dateien werden gemerkt.` : 'Wird beim nächsten Start gemessen: Klick auf „Spielen“ bis Hauptmenü.'));
  if (last?.readyMs > 90000 && p.loader) box.append(h('p.small-note', '💡 Langsamer Start? Der Performance-Autopilot findet passende Mods, und der Mod-Detektiv hilft bei Problem-Mods.'));
  return box;
}

// Notizen (Instanz-Übersicht)
function notesCard(p) {
  const ta = h('textarea.input.inst-notes', { placeholder: 'Notizen zu dieser Instanz – Server-Adressen, Koordinaten, To-dos …', maxLength: 4000, value: p.notes || '' });
  let t = null; const st = h('span.muted.small-note');
  ta.oninput = () => { clearTimeout(t); st.textContent = '…'; t = setTimeout(async () => { try { state.profiles = await api.profiles.save({ id: p.id, notes: ta.value }); st.textContent = 'Gespeichert'; setTimeout(() => st.textContent = '', 1500); } catch (e) { st.textContent = e.message; } }, 700); };
  return h('div.notes-card', h('div.row', h('h3', { style: { margin: '0 0 6px' } }, '📝 Notizen'), h('span.grow'), st), ta);
}

// =====================================================================
// Mods-Reiter: Konflikt-Check und Mod-Sets
// =====================================================================
async function modExtras(p, bar, refresh) {
  bar.innerHTML = '';
  // Mod-Sets
  let sets = []; try { sets = await api.modsets.list(p.id); } catch {}
  const sel = h('select.select', { title: 'Mod-Set anwenden' }); sel.add(new Option(sets.length ? `Mod-Sets (${sets.length})` : 'Keine Mod-Sets', ''));
  for (const s of sets) sel.add(new Option(`${s.name} · ${s.count} Mods`, s.name));
  sel.onchange = async () => { const n = sel.value; if (!n) return; try { await api.modsets.apply({ profileId: p.id, name: n }); toast(`Mod-Set „${n}“ aktiv`); refresh(); } catch (e) { toast(e.message, true); } sel.value = ''; };
  bar.append(...[h('span.muted', 'Mod-Sets:'), sel,
    h('button.ghost.small', { title: 'Merkt sich, welche Mods gerade an sind', onclick: async () => { const n = prompt('Name für dieses Mod-Set (z. B. „PvP“ oder „Bauen“):'); if (!n) return; try { await api.modsets.save({ profileId: p.id, name: n }); toast(`Mod-Set „${n}“ gespeichert`); modExtras(p, bar, refresh); } catch (e) { toast(e.message, true); } } }, 'Aktuelle als Set speichern'),
    sets.length ? h('button.ghost.small', { onclick: async () => { const n = prompt('Welches Mod-Set löschen?\n' + sets.map(s => s.name).join(', ')); if (!n) return; await api.modsets.remove({ profileId: p.id, name: n.trim() }); modExtras(p, bar, refresh); } }, 'Set löschen') : null].filter(Boolean));
  // Konflikte
  let cf = []; try { cf = await api.modtools.conflicts(p.id); } catch {}
  if (cf.length) {
    const dupes = cf.filter(c => c.files.length > 1);
    const box = h('div.conflict-box', h('b', `⚠️ ${cf.length} Problem${cf.length > 1 ? 'e' : ''} gefunden`), h('ul', ...cf.slice(0, 6).map(c => h('li', c.files.length > 1 ? `${c.id} ist ${c.files.length}× installiert: ${c.files.map(f => f.file).join(', ')}` : c.id))));
    if (dupes.length) box.append(h('button.primary.small', { onclick: async () => {
      let n = 0; for (const c of dupes) { const keep = [...c.files].sort((a, b) => cmpVerLoose(b.version, a.version))[0]; for (const f of c.files) if (f.file !== keep.file) { await api.content.toggle({ profileId: p.id, kind: 'mods', file: f.file }); n++; } }
      toast(`${n} doppelte Mod(s) deaktiviert – die neueste bleibt an`); refresh(); modExtras(p, bar, refresh);
    } }, 'Doppelte deaktivieren (neueste behalten)'));
    bar.append(box);
  }
}
const cmpVerLoose = (a, b) => { const pa = String(a || '').split(/[.+-]/).map(x => parseInt(x) || 0), pb = String(b || '').split(/[.+-]/).map(x => parseInt(x) || 0); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; };

// =====================================================================
// Instanzen vergleichen
// =====================================================================
async function openCompare(id) {
  const a = state.profiles.find(x => x.id === id); if (!a) return;
  const others = state.profiles.filter(x => x.id !== id && x.loader);
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(h('h2', '⚖️ Instanzen vergleichen'));
  if (!others.length) { body.append(h('p.muted', 'Es gibt keine zweite Mod-Instanz zum Vergleichen.')); foot.append(h('button.primary', { onclick: close }, 'Schließen')); return; }
  const sel = h('select.select'); for (const o of others) sel.add(new Option(`${o.name} (${o.version} ${loaderName(o.loader)})`, o.id));
  const out = h('div'); body.append(h('div.row.gap', h('b', a.name), h('span.muted', 'mit'), sel), out);
  foot.append(h('button.primary', { onclick: close }, 'Fertig'));
  const key = (m) => m.projectId || m.title.toLowerCase().replace(/[-_ ]?(fabric|forge|neoforge|mc)?[-_ ]?\d.*$/, '').replace(/[^a-z0-9]/g, '');
  const run = async () => {
    const b = state.profiles.find(x => x.id === sel.value); out.innerHTML = ''; out.append(h('p.muted', 'Mods werden erkannt …'));
    let ma, mb; try { [ma, mb] = await Promise.all([api.tools.modsIdentify(a.id), api.tools.modsIdentify(b.id)]); } catch (e) { out.innerHTML = ''; out.append(h('p.danger', e.message)); return; }
    const A = new Map(ma.map(m => [key(m), m])), B = new Map(mb.map(m => [key(m), m]));
    const onlyA = [...A].filter(([k]) => !B.has(k)).map(([, m]) => m), onlyB = [...B].filter(([k]) => !A.has(k)).map(([, m]) => m), both = [...A].filter(([k]) => B.has(k));
    out.innerHTML = '';
    out.append(h('div.row.gap', { style: { margin: '10px 0' } }, h('span.pill.ok', `${both.length} in beiden`), h('span.pill', `${onlyA.length} nur in „${a.name}“`), h('span.pill', `${onlyB.length} nur in „${b.name}“`)));
    const col = (title, list, from, to) => {
      const c = h('div.cmp-col', h('h3', title)); if (!list.length) c.append(h('p.muted', '–'));
      for (const m of list) c.append(h('label.perf-item', from ? h('input.sw', { type: 'checkbox', checked: !m.disabled, dataset: { file: m.file } }) : h('span', '✓'), h('div', h('b', m.title), h('span', m.file)), h('span')));
      if (from && list.length) c.append(h('button.ghost.small', { style: { marginTop: '8px' }, onclick: async (e) => { const files = [...c.querySelectorAll('input:checked')].map(x => x.dataset.file); if (!files.length) return; e.target.disabled = true; e.target.textContent = 'Überträgt …'; try { const r = await api.tools.modsTransfer({ from: from.id, to: to.id, files }); toast(`${r.ok.length + r.copied.length} Mods nach „${to.name}“ übernommen${r.missing.length ? ` – nicht verfügbar: ${r.missing.join(', ')}` : ''}`, !!r.missing.length); run(); } catch (err) { toast(err.message, true); e.target.disabled = false; } } }, `Auswahl nach „${to.name}“ übernehmen`));
      return c;
    };
    out.append(h('div.cmp-grid', col(`Nur in „${a.name}“`, onlyA, a, b), col(`Nur in „${b.name}“`, onlyB, b, a), col('In beiden', both.map(([, m]) => m), null, null)));
  };
  sel.onchange = run; run();
}

// =====================================================================
// Mod-Detektiv
// =====================================================================
function bisectBanner(p, bs) {
  const box = h('div.bisect-banner');
  if (bs.done) {
    box.append(h('div', h('b', bs.culprits.length === 1 ? `🔍 Gefunden: ${bs.culprits[0].replace(/\.jar$/i, '')}` : bs.culprits.length ? `🔍 Eine dieser Mods ist es: ${bs.culprits.map(f => f.replace(/\.jar$/i, '')).join(', ')}` : '🔍 Keine einzelne Mod schuld'), h('div.muted', bs.culprits.length ? 'Alle anderen Mods sind unschuldig. Deaktivieren und fertig – oder alles wieder anschalten.' : 'Der Fehler hängt wohl nicht an einer Mod (Einstellungen, Welt oder Java?).')));
    box.append(h('div.row.gap', bs.culprits.length ? h('button.primary', { onclick: () => bisectStop(p.id, true) }, 'Deaktivieren & fertig') : null, h('button.ghost', { onclick: () => bisectStop(p.id, false) }, 'Alles wieder an')));
    return box;
  }
  box.append(h('div', h('b', `🔍 Mod-Detektiv · Schritt ${bs.step}`), h('div.muted', `${bs.suspects} verdächtige Mods, ${bs.off} gerade aus · noch etwa ${bs.estimate} Start${bs.estimate === 1 ? '' : 's'}. Starte Minecraft und schau, ob der Fehler noch auftritt.`)));
  box.append(h('div.row.gap', h('button.primary', { onclick: () => launchProfile(p.id) }, '▶ Testen'), h('button.ghost', { onclick: () => bisectAnswer(p.id, true) }, 'Fehler noch da'), h('button.ghost', { onclick: () => bisectAnswer(p.id, false) }, 'Fehler weg'), h('button.ghost.danger', { onclick: () => bisectStop(p.id, false) }, 'Abbrechen')));
  return box;
}
async function openBisect(id) {
  const p = state.profiles.find(x => x.id === id); if (!p) return;
  const cur = await api.v31.bisectStatus(id).catch(() => null); if (cur) { openInstance(id); return; }
  const { body, foot, close } = v25Dialog();
  body.append(h('h2', '🔍 Mod-Detektiv'), h('p', 'Stürzt Minecraft ab oder spinnt etwas, seit du Mods installiert hast? Der Detektiv findet die Schuldige in wenigen Starts:'),
    h('ol.muted', h('li', 'Er schaltet die Hälfte der Mods aus (abhängige Mods gleich mit).'), h('li', 'Du startest Minecraft und sagst, ob der Fehler noch da ist.'), h('li', 'Nach ein paar Runden steht fest, welche Mod es ist. Danach ist alles wieder wie vorher.')),
    h('p.muted.small-note', 'Fabric API und LellekHUD bleiben immer an. Vorher sichert die Zeitmaschine.'));
  foot.append(h('button.ghost', { onclick: close }, 'Abbrechen'), h('button.primary', { onclick: async (e) => { e.target.disabled = true; try { const st = await api.v31.bisectStart(id); close(); toast(`Fehlersuche gestartet – ${st.off} Mods vorübergehend aus`); openInstance(id); } catch (err) { toast(err.message, true); e.target.disabled = false; } } }, 'Fehlersuche starten'));
}
async function bisectAnswer(id, broken) {
  try { const st = await api.v31.bisectAnswer({ id, broken }); toast(st.done ? 'Fertig – Ergebnis steht fest' : `Weiter: noch ${st.suspects} verdächtige Mods`); if (state.view === 'instance') renderInstance(); return st; } catch (e) { toast(e.message, true); }
}
async function bisectStop(id, disable) {
  try { const r = await api.v31.bisectStop({ id, disableCulprits: disable }); toast(disable && r?.culprits?.length ? `${r.culprits.length} Mod(s) deaktiviert, Rest wieder an` : 'Alle Mods wieder an'); if (state.view === 'instance') renderInstance(); } catch (e) { toast(e.message, true); }
}
async function afterGameClosed(profileId) {
  const st = await api.v31.bisectStatus(profileId).catch(() => null); if (!st || st.done) return;
  const p = state.profiles.find(x => x.id === profileId);
  const { body, foot, close } = v25Dialog();
  body.append(h('h2', '🔍 Mod-Detektiv'), h('p', `War der Fehler in „${p?.name || 'Minecraft'}“ gerade noch da?`), h('p.muted', `Schritt ${st.step} · ${st.suspects} verdächtige Mods`));
  foot.append(h('button.ghost', { onclick: close }, 'Später'), h('button.ghost', { onclick: async () => { close(); const r = await bisectAnswer(profileId, false); if (r && !r.done) openInstance(profileId); } }, 'Nein, alles lief'), h('button.primary', { onclick: async () => { close(); const r = await bisectAnswer(profileId, true); if (r && !r.done) openInstance(profileId); } }, 'Ja, Fehler noch da'));
}

// =====================================================================
// Merkliste im Mod-Browser
// =====================================================================
let watchIds = new Set(); api.v31.watchList().then(l => { watchIds = new Set(l.map(x => x.id)); }).catch(() => {});
async function toggleWatch(it, btn) { const l = await api.v31.watchToggle({ id: it.id, title: it.title, icon: it.icon, kind: V3.disc.kind, author: it.author }); watchIds = new Set(l.map(x => x.id)); if (btn) { btn.classList.toggle('on', watchIds.has(it.id)); btn.textContent = watchIds.has(it.id) ? '♥' : '♡'; } const c = $('#watchBtn'); if (c) c.textContent = `♥ Merkliste (${l.length})`; }
{
  const _dc = discCard;
  discCard = function (it) { const c = _dc(it); const b = h('button.watch-btn' + (watchIds.has(it.id) ? '.on' : ''), { title: 'Auf die Merkliste', onclick: (e) => { e.stopPropagation(); toggleWatch(it, b); } }, watchIds.has(it.id) ? '♥' : '♡'); c.append(b); return c; };
  const _rd = renderDiscover;
  renderDiscover = async function () {
    await _rd();
    const head = $('#discRoot .disc-head'); if (head && !$('#watchBtn')) { const b = h('button.ghost#watchBtn', { onclick: openWatchlist }, `♥ Merkliste (${watchIds.size})`); head.append(b); }
  };
  const _op = openProject;
  openProject = async function (id, pre) {
    await _op(id, pre);
    const foot = $('#v25Dialog .row.end'); if (!foot || foot.querySelector('.watch-btn')) return;
    const it = { id, title: pre?.title || $('#v25Dialog .proj-head h2')?.textContent || id, icon: pre?.icon, author: pre?.author };
    const b = h('button.ghost.watch-btn' + (watchIds.has(id) ? '.on' : ''), { title: 'Merken', onclick: () => toggleWatch(it, b) }, watchIds.has(id) ? '♥' : '♡'); foot.prepend(b);
  };
}
async function openWatchlist() {
  const list = await api.v31.watchList(); const t = discTarget();
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(h('h2', '♥ Merkliste'), h('p.muted', t ? `Vorgemerkte Projekte – installieren in „${t.name}“ (${t.version}${t.loader ? ' ' + loaderName(t.loader) : ''}). Andere Instanz oben im Mod-Browser wählen.` : 'Vorgemerkte Projekte.'));
  const l = h('div.perf-list', { style: { maxHeight: '55vh', overflowY: 'auto' } });
  if (!list.length) l.append(h('p.muted', 'Noch leer – im Mod-Browser auf ♡ klicken.'));
  for (const it of list) {
    const ic = it.icon ? h('img', { src: it.icon, alt: '', style: { width: '32px', height: '32px', borderRadius: '8px' } }) : h('span', '🧩');
    const inst = h('button.primary.small', { disabled: !t && it.kind !== 'modpacks', onclick: async () => { inst.disabled = true; inst.textContent = '…'; try { const r = await api.browser.install({ id: it.id, profileId: it.kind === 'modpacks' ? undefined : t?.id, kind: it.kind, name: it.title }); if (it.kind === 'modpacks') { await loadProfiles(); toast(`„${it.title}“ als neue Instanz angelegt`); } else toast(`${it.title} → ${t.name} installiert`); inst.textContent = '✓'; } catch (e) { toast(e.message, true); inst.disabled = false; inst.textContent = 'Installieren'; } } }, 'Installieren');
    l.append(h('div.perf-item', ic, h('div', { style: { cursor: 'pointer' }, onclick: () => { close(); V3.disc.kind = it.kind || 'mods'; openProject(it.id, it); } }, h('b', it.title), h('span', `${({ mods: 'Mod', modpacks: 'Modpack', resourcepacks: 'Resourcepack', shaderpacks: 'Shader', datapacks: 'Datapack' })[it.kind] || 'Mod'}${it.author ? ' · ' + it.author : ''}`)), h('div.row.gap', inst, h('button.ghost.small', { title: 'Entfernen', onclick: async (e) => { await toggleWatch(it, null); e.target.closest('.perf-item').remove(); } }, '✕'))));
  }
  body.append(l); foot.append(h('button.primary', { onclick: close }, 'Fertig'));
}

// =====================================================================
// Optionen: Leistung beim Spielen
// =====================================================================
safe('opts-v31', () => {
  const game = $('.opt-sec[data-cat="game"]'); if (!game) return;
  const sw = (key, def) => { const c = h('input.sw', { type: 'checkbox', onchange: () => { api.settings.save({ [key]: c.checked }).then(() => { flashSaved(); pauseSettings[key] = c.checked; applyPause(); }); } }); c.dataset.key = key; c.dataset.def = def ? '1' : ''; return c; };
  const row = (title, sub, ctrl) => h('label.opt-row', h('div', h('b', title), h('span', sub)), ctrl);
  const prio = h('select.select', { onchange: () => api.settings.save({ gamePriority: prio.value }).then(flashSaved) });
  for (const [v, t] of [['normal', 'Normal'], ['above', 'Höher (empfohlen)'], ['high', 'Hoch']]) prio.add(new Option(t, v));
  const toggles = [sw('gameMode', true), sw('optimizeJvm', true), sw('pauseUnfocused', true), sw('shotNotify', true), sw('shotAutoCopy', false)];
  const first = game.querySelector('h3');
  const els = [h('h3', 'Leistung beim Spielen'),
    row('Spielmodus', 'Während Minecraft läuft, schläft der Launcher: keine Animationen, keine 3D-Vorschau – mehr Leistung fürs Spiel', toggles[0]),
    h('div.opt-row', h('div', h('b', 'Priorität von Minecraft'), h('span', 'Windows gibt Minecraft mehr Rechenzeit als Programmen im Hintergrund')), prio),
    row('Java automatisch optimieren', 'Moderner Garbage-Collector mit kurzen Pausen – weniger Ruckler. Eigene Java-Argumente der Instanz haben Vorrang', toggles[1]),
    row('Animationen im Hintergrund pausieren', 'Spart Strom und Grafikleistung, wenn das Launcher-Fenster nicht aktiv ist', toggles[2]),
    h('h3', 'Screenshots'),
    row('Meldung bei neuem Screenshot', 'Kurze Meldung im Launcher, sobald du im Spiel F2 drückst', toggles[3]),
    row('Screenshot automatisch kopieren', 'Liegt sofort in der Zwischenablage – direkt in Discord einfügen', toggles[4])];
  if (first) first.before(...els); else game.append(...els);
  const _ls = loadSettings;
  loadSettings = async function (...a) { const r = await _ls.apply(this, a); try { const s = await api.settings.get(); for (const c of toggles) c.checked = s[c.dataset.key] === undefined ? !!c.dataset.def : !!s[c.dataset.key]; prio.value = s.gamePriority || 'above'; } catch {} return r; };
});
