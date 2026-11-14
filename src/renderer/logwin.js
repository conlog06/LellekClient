// LellekClient – Minecraft-Logs: ein Fenster für alle Instanzen, Filter nach Level, Hinweise zu bekannten Meldungen
const api = window.lellek;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------- Bekannte Meldungen: harmlos (h) oder Problem (p) ----------
const KNOWN = [
  { id: 'sig', kind: 'h', re: /Failed to verify signature on property|Profile contained invalid signature for textures|Bad signature length: got 0/, title: 'Skins ohne Signatur', text: 'Ein Server (z. B. NPCs in der Lobby) oder eine Mod schickt Spieler-Skins ohne Mojang-Signatur. Minecraft meldet das sehr ausführlich – es hat aber keine Auswirkungen auf dein Spiel.' },
  { id: 'xaero', kind: 'h', re: /Online mod data expired/, title: 'Xaero-Mod ist nicht die neueste', text: 'Xaero\'s Minimap/Weltkarte meldet veraltete Online-Daten, weil die installierte Version älter ist. Harmlos – ein Mod-Update beseitigt die Meldung.', action: 'update' },
  { id: 'optcls', kind: 'h', re: /Error loading class: .*ClassNotFoundException|ClassNotFoundException: mezz\/jei/, title: 'Optionale Mod-Erweiterung fehlt', text: 'Eine Mod prüft, ob eine andere Mod (z. B. JEI) installiert ist, um Zusatzfunktionen anzubieten. Fehlt sie, erscheint diese Warnung – harmlos.' },
  { id: 'refmap', kind: 'h', re: /Reference map '.*' for .* could not be read|refmap/i, title: 'Mixin-Refmap', text: 'Technische Meldung beim Laden einer Mod (Fabric-Entwicklungsdaten fehlen). Harmlos.' },
  { id: 'tex', kind: 'h', re: /Missing (texture|model|sprite)|Unable to (load|resolve) (model|texture)|Texture .* has invalid size|Unknown custom packet identifier/i, title: 'Fehlende Texturen/Modelle', text: 'Eine Mod oder ein Resourcepack verweist auf eine Textur, die es nicht gibt. Meist unsichtbar im Spiel – harmlos.' },
  { id: 'data', kind: 'h', re: /Couldn't parse (data file|element)|Parsing error loading recipe|Unknown recipe|Couldn't load (tag|advancement)|Ignored advancement|Couldn't find criteria/i, title: 'Rezepte/Datenpakete', text: 'Rezepte oder Fortschritte einer Mod passen nicht ganz zur Version. Betroffen ist höchstens das eine Rezept – harmlos.' },
  { id: 'net', kind: 'h', re: /Received passengers for unknown entity|Ignoring player info update for unknown player|Received packet for unknown team|unknown entity|Ignoring chunk since it's not in the view range/i, title: 'Server-Pakete', text: 'Der Server schickt Daten zu Objekten, die dein Spiel (noch) nicht kennt. Normal auf großen Servern – harmlos.' },
  { id: 'narr', kind: 'h', re: /Narrator|flite|Failed to load native library: (narrator|flite)/i, title: 'Sprachausgabe', text: 'Die Erzähler-Funktion ist auf diesem System nicht verfügbar. Harmlos.' },
  { id: 'realms', kind: 'h', re: /Realms|realms/, title: 'Realms', text: 'Meldungen zu Minecraft Realms (Mojangs Server-Abo). Ohne Realms-Nutzung harmlos.' },
  { id: 'telemetry', kind: 'h', re: /telemetry|Telemetry/, title: 'Telemetrie', text: 'Minecraft konnte Nutzungsstatistiken nicht senden. Harmlos.' },
  { id: 'gl', kind: 'h', re: /OpenGL debug message|GL_DEBUG|Unable to create a backup of|lwjgl.*(deprecated)/i, title: 'Grafik-Hinweis', text: 'Technische Meldung des Grafiktreibers. Solange das Spiel läuft, harmlos.' },
  { id: 'ambig', kind: 'h', re: /Ambiguity between arguments/, title: 'Befehls-Hinweis', text: 'Zwei Befehle haben ähnliche Parameter – nur für Entwickler interessant. Harmlos.' },
  { id: 'patreon', kind: 'h', re: /checking patreon|patreon/i, title: 'Unterstützer-Abfrage', text: 'Eine Mod fragt online ihre Unterstützer ab. Klappt das nicht, passiert nichts weiter. Harmlos.' },
  // Probleme
  { id: 'oom', kind: 'p', re: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/, title: 'Zu wenig Arbeitsspeicher', text: 'Minecraft hatte nicht genug RAM. In der Instanz unter „Einstellungen“ mehr Arbeitsspeicher geben (z. B. +2 GB).', action: 'settings' },
  { id: 'mixin', kind: 'p', re: /Mixin apply (for mod .* )?failed|MixinApplyError|InvalidInjectionException|InjectionError|Critical injection failure/, title: 'Mod-Konflikt', text: 'Eine Mod passt nicht zur Minecraft-Version oder verträgt sich nicht mit einer anderen. Der Mod-Detektiv findet sie in wenigen Starts.', action: 'detective' },
  { id: 'deps', kind: 'p', re: /Incompatible mods? found|requires .* which is missing|Could not find required mod|depends on .* which is missing|Missing or unsupported mandatory dependencies|is missing required dependency/i, title: 'Fehlende Abhängigkeit', text: 'Eine Mod braucht eine andere Mod (oder eine andere Version). Im Mods-Reiter der Instanz nachinstallieren oder die Mod entfernen.', action: 'mods' },
  { id: 'dupe', kind: 'p', re: /Duplicate mods?|duplicate mod|Found duplicate|Mod resolution failed/i, title: 'Mod doppelt installiert', text: 'Eine Mod liegt mehrfach im Mods-Ordner. Der Konflikt-Check im Mods-Reiter löst das mit einem Klick.', action: 'mods' },
  { id: 'java', kind: 'p', re: /UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime/, title: 'Falsche Java-Version', text: 'Eine Mod braucht ein neueres Java. In der Instanz unter „Einstellungen“ den Java-Pfad leeren – LellekClient wählt dann automatisch das passende.', action: 'settings' },
  { id: 'crash', kind: 'p', re: /Crash report saved to|Encountered an unexpected exception|#@!@# Game crashed!/, title: 'Absturz', text: 'Minecraft ist abgestürzt. Die Absturz-Analyse im Launcher zeigt die wahrscheinliche Ursache.' },
];
const matchKnown = (s) => { for (const k of KNOWN) if (k.re.test(s)) return k; return null; };

// ---------- Zeilen zerlegen ----------
const LINE = /^\[(\d\d:\d\d:\d\d(?:\.\d+)?)\] \[([^\]]*?)\/(\w+)\](?: \[([^\]]*)\])?:? ?(.*)$/;
const CONT = /^(\s+at |\s*\.\.\. \d+ more|Caused by:|\s+Suppressed:|[\w$.]+(Exception|Error|Throwable)(: |$)|\t)/;
const lvOf = (raw) => { const l = String(raw).toUpperCase(); return l === 'ERROR' || l === 'FATAL' || l === 'SEVERE' ? 'error' : l === 'WARN' || l === 'WARNING' ? 'warn' : l === 'DEBUG' || l === 'TRACE' ? 'debug' : 'info'; };

const S = { sel: null, sessions: [], entries: [], counts: { error: 0, warn: 0 }, hints: new Map(), follow: true, q: '', usage: {}, progress: {} };
const MAX_DOM = 8000;
const logBox = $('#log');

function parseLine(line, prev) {
  const m = LINE.exec(line);
  if (m) return { t: m[1].slice(0, 8), th: m[2], lv: lvOf(m[3]), msg: m[5] || '', src: m[4] || '' };
  if (prev && CONT.test(line)) return { cont: true };
  if (/^\[MCLC\]/.test(line)) return { t: '', th: '', lv: 'debug', msg: line };
  if (/^(Starte |Verbinde |Lade Welt|Java|Welt-Backup|Fabric API|LellekHUD|Mod-Updates|Minecraft beendet|Vorlage|Selbstheilung|Prüf|Mod aktualisiert)/.test(line)) return { t: '', th: 'LellekClient', lv: 'info', msg: line, lc: true };
  return { t: '', th: '', lv: /ERROR|Exception|FATAL/.test(line) ? 'error' : /WARN/.test(line) ? 'warn' : 'info', msg: line };
}
function addLines(lines) {
  let last = S.entries[S.entries.length - 1] || null; const touched = new Set(), fresh = [];
  for (const line of lines) {
    if (line == null) continue;
    const p = parseLine(line, last);
    if (p.cont && last) { (last.extra ??= []).push(line); if (last.node) touched.add(last); if (!last.known) { const k = matchKnown(line); if (k) mark(last, k); } continue; }
    const e = { ...p, raw: line }; S.entries.push(e); fresh.push(e);
    const k = matchKnown(e.msg); if (k) mark(e, k);
    if (!(k && k.kind === 'h')) { if (e.lv === 'error') S.counts.error++; if (e.lv === 'warn') S.counts.warn++; } // harmlose zählen nicht als Fehler
    if (/Minecraft beendet mit Code/.test(line)) e.end = /Code 0\b/.test(line) ? 'ok' : 'bad';
    last = e;
  }
  for (const e of touched) { const n = render(e); e.node.replaceWith(n); e.node = n; }
  const frag = document.createDocumentFragment(); for (const e of fresh) { e.node = render(e); frag.append(e.node); }
  logBox.append(frag);
  while (logBox.childElementCount > MAX_DOM) { const first = logBox.firstElementChild; const e = nodeEntry.get(first); if (e) e.node = null; first.remove(); }
  if (S.entries.length > MAX_DOM * 1.5) S.entries = S.entries.slice(-MAX_DOM);
  updateCounts(); drawHints(); if (S.follow) logBox.scrollTop = logBox.scrollHeight;
}
function mark(e, k) { e.known = k; const h = S.hints.get(k.id) || { k, n: 0 }; h.n++; S.hints.set(k.id, h); }
function hl(text) { if (!S.q) return document.createTextNode(text); const f = document.createDocumentFragment(); const low = text.toLowerCase(); let i = 0, j; while ((j = low.indexOf(S.q, i)) >= 0) { f.append(text.slice(i, j), el('mark', null, text.slice(j, j + S.q.length))); i = j + S.q.length; } f.append(text.slice(i)); return f; }
const nodeEntry = new WeakMap();
function render(e) {
  const d = el('div', `e lv-${e.lv}${e.known?.kind === 'h' ? ' harm' : ''}${e.lc ? ' lc' : ''}${e.end ? ' end-' + e.end : ''}`);
  if (e.t) d.append(el('span', 't', e.t)); if (e.th && !e.lc) d.append(el('span', 'th', e.th));
  d.append(hl(e.msg.replace(/[A-Za-z0-9+/=_-]{90,}/g, (x) => x.slice(0, 28) + '…'))); if (/[A-Za-z0-9+/=_-]{90,}/.test(e.msg)) d.title = 'Gekürzt – „Kopieren“ übernimmt die vollständige Zeile';
  if (e.known) { const b = el('span', 'bdg ' + e.known.kind, e.known.kind === 'h' ? 'harmlos' : e.known.title); b.title = e.known.title + ': ' + e.known.text; b.onclick = () => openHints(e.known.id); d.append(b); }
  if (e.extra?.length) {
    const btn = el('button', 'more', `▸ ${e.extra.length} Zeile${e.extra.length === 1 ? '' : 'n'}`); let pre = null;
    btn.onclick = () => { if (pre) { pre.remove(); pre = null; btn.textContent = `▸ ${e.extra.length} Zeile${e.extra.length === 1 ? '' : 'n'}`; return; } pre = el('pre', null, e.extra.join('\n')); d.append(pre); btn.textContent = '▾ einklappen'; };
    d.append(btn);
  }
  if (S.q && !(e.raw + (e.extra || []).join('\n')).toLowerCase().includes(S.q)) d.classList.add('nm');
  nodeEntry.set(d, e); return d;
}
function updateCounts() {
  $('#cError').textContent = S.counts.error; $('#cWarn').textContent = S.counts.warn;
  const n = S.entries.reduce((a, e) => a + 1 + (e.extra?.length || 0), 0);
  $('#count').textContent = `${n.toLocaleString('de-DE')} Zeilen`;
}
// ---------- Hinweise ----------
function drawHints() {
  const box = $('#hints'); const list = [...S.hints.values()]; if (!list.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const bad = list.filter(x => x.k.kind === 'p'), harm = list.filter(x => x.k.kind === 'h');
  const head = $('#hintsHead'); head.innerHTML = '';
  head.append(el('span', null, box.classList.contains('open') ? '▾' : '▸'), el('span', null, 'Hinweise zu diesem Log'));
  if (bad.length) head.append(el('span', 'tag bad', `${bad.length} Problem${bad.length > 1 ? 'e' : ''}`));
  if (harm.length) head.append(el('span', 'tag ok', `${harm.reduce((a, x) => a + x.n, 0)} harmlose Meldungen${$('#hideHarm').checked ? ' (ausgeblendet)' : ''}`));
  const l = $('#hintsList'); l.innerHTML = '';
  for (const { k, n } of [...bad, ...harm]) {
    const r = el('div', 'hint ' + (k.kind === 'p' ? 'bad' : '')); r.dataset.id = k.id;
    const body = el('div'); body.append(el('b', null, (k.kind === 'h' ? 'Harmlos: ' : '') + k.title), el('span', null, k.text));
    const act = actionButton(k); if (act) body.append(act);
    r.append(el('i', null, k.kind === 'p' ? '⚠️' : '✅'), body, el('span', 'n', `${n}×`)); l.append(r);
  }
}
function openHints(id) { $('#hints').classList.add('open'); drawHints(); const r = document.querySelector(`.hint[data-id="${id}"]`); r?.scrollIntoView({ block: 'nearest' }); }
$('#hintsHead').onclick = () => { $('#hints').classList.toggle('open'); drawHints(); };
function actionButton(k) {
  const id = S.sel; if (!id || !k.action) return null;
  if (k.action === 'update') return btn('Mods dieser Instanz aktualisieren', async (b) => {
    b.disabled = true; b.textContent = 'Prüft …';
    try { const res = await api.content.checkUpdates({ profileId: id, kind: 'mods', force: true }); const ups = res.filter(r => r.status === 'update'); for (const u of ups) { b.textContent = `Aktualisiert ${u.newFile} …`; await api.content.update({ profileId: id, kind: 'mods', file: u.file, url: u.url, newFile: u.newFile, projectId: u.projectId }); } b.textContent = ups.length ? `${ups.length} Mods aktualisiert – beim nächsten Start aktiv` : 'Alles aktuell'; }
    catch (e) { b.textContent = 'Fehler: ' + e.message; }
  });
  if (k.action === 'detective') return btn('Mod-Detektiv im Launcher öffnen', () => { api.v32?.focusMain?.({ view: 'detective', profileId: id }); toast('Im Launcher: Instanz → ⋯ → Mod-Detektiv'); });
  if (k.action === 'mods' || k.action === 'settings') return btn(k.action === 'mods' ? 'Mods-Reiter öffnen' : 'Einstellungen öffnen', () => { api.v32?.focusMain?.({ view: k.action, profileId: id }); });
  return null;
}
function btn(text, fn) { const b = el('button', null, text); b.onclick = () => fn(b); return b; }

// ---------- Filter & Suche ----------
for (const c of document.querySelectorAll('#chips .chip')) {
  c.onclick = () => { c.classList.toggle('on'); logBox.classList.toggle('hide-' + c.dataset.lv, !c.classList.contains('on')); savePrefs(); };
}
$('#hideHarm').onchange = () => { logBox.classList.toggle('hide-harm', $('#hideHarm').checked); savePrefs(); drawHints(); };
let qT = null;
$('#q').oninput = () => { clearTimeout(qT); qT = setTimeout(() => { S.q = $('#q').value.trim().toLowerCase(); for (const e of S.entries) if (e.node) { const n = render(e); e.node.replaceWith(n); e.node = n; } }, 180); };
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); } if (e.key === 'End' && document.activeElement !== $('#q')) setFollow(true); });
function savePrefs() { try { localStorage.setItem('lellek.logwin', JSON.stringify({ off: [...document.querySelectorAll('#chips .chip:not(.on)')].map(c => c.dataset.lv), harm: $('#hideHarm').checked })); } catch {} }
try { const p = JSON.parse(localStorage.getItem('lellek.logwin') || 'null'); if (p) { for (const c of document.querySelectorAll('#chips .chip')) { const on = !p.off.includes(c.dataset.lv); c.classList.toggle('on', on); logBox.classList.toggle('hide-' + c.dataset.lv, !on); } $('#hideHarm').checked = !!p.harm; logBox.classList.toggle('hide-harm', !!p.harm); } else { logBox.classList.add('hide-debug', 'hide-harm'); $('#hideHarm').checked = true; } } catch { logBox.classList.add('hide-debug', 'hide-harm'); $('#hideHarm').checked = true; }

// ---------- Mitlaufen, Kopieren, Leeren, Hochladen ----------
function setFollow(v) { S.follow = v; $('#follow').classList.toggle('on', v); if (v) logBox.scrollTop = logBox.scrollHeight; }
$('#follow').onclick = () => setFollow(!S.follow);
let lastScroll = 0; logBox.addEventListener('scroll', () => { const atEnd = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 40; if (logBox.scrollTop < lastScroll && !atEnd) setFollow(false); else if (atEnd && !S.follow) setFollow(true); lastScroll = logBox.scrollTop; });
$('#copy').onclick = () => { const txt = S.entries.filter(e => e.node && e.node.offsetParent !== null).map(e => [e.raw, ...(e.extra || [])].join('\n')).join('\n'); navigator.clipboard.writeText(txt).then(() => toast('Sichtbare Zeilen kopiert')); };
$('#clear').onclick = () => { logBox.innerHTML = ''; S.entries = []; S.counts = { error: 0, warn: 0 }; S.hints.clear(); updateCounts(); drawHints(); };
$('#upload').onclick = async () => { if (!S.sel) return; const b = $('#upload'); b.disabled = true; b.textContent = 'Lädt hoch …'; try { const url = await api.logs.upload(S.sel); toast(`Link kopiert: ${url}`, 6000); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000); } b.disabled = false; b.textContent = '⇪ Hochladen (mclo.gs)'; };
let toastT = null; function toast(t, ms = 2600) { const x = $('#toast'); x.textContent = t; x.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => x.classList.add('hidden'), ms); }

// ---------- Instanzen ----------
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const fmtMb = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2).replace('.', ',') + ' GB' : Math.round(b / 1048576) + ' MB';
async function loadSessions() {
  try { S.sessions = await api.logs.sessions(); } catch { return; }
  if (!S.sel && S.sessions[0]) select(S.sessions[0].profileId);
  drawList(); drawCard();
}
function drawList() {
  const l = $('#list'); l.innerHTML = '';
  if (!S.sessions.length) { l.append(el('p', 'muted', 'Noch kein Spielstart in dieser Sitzung. Sobald du eine Instanz startest, erscheint ihr Log hier.')); }
  for (const s of S.sessions) {
    const b = el('button', 'inst' + (s.profileId === S.sel ? ' sel' : '')); const ic = el('span', 'ic', s.icon || (s.loader ? '🧩' : '🟩')); if (s.color) ic.style.background = s.color + '33';
    const info = el('div'); info.append(el('b', null, s.name));
    const sm = el('small'); const dot = el('span', 'dot' + (s.running ? ' on' : s.code ? ' bad' : ''));
    sm.append(dot, document.createTextNode(`${s.version}${s.account ? ' · ' + s.account : ''} · `), el('span', s.running ? 'ok' : '', s.running ? fmtDur(Date.now() - s.start) : s.code ? `Code ${s.code}` : 'beendet'));
    sm.lastChild.dataset.start = s.running ? s.start : ''; info.append(sm);
    b.append(ic, info); b.onclick = () => select(s.profileId); l.append(b);
  }
  const n = S.sessions.filter(x => x.running).length; $('#runCount').textContent = n ? `${n} läuft` : '';
}
function drawCard() {
  const s = S.sessions.find(x => x.profileId === S.sel); const c = $('#card'); if (!s) { c.classList.add('hidden'); return; }
  c.classList.remove('hidden'); $('#cardName').textContent = s.name;
  $('#cardTime').textContent = s.running ? fmtDur(Date.now() - s.start) : s.end ? `beendet nach ${fmtDur(s.end - s.start)}` : '';
  $('#cardTime').className = s.running ? 'ok' : 'muted';
  const u = S.usage[s.profileId];
  const max = (u?.max) || s.memory * 1073741824;
  $('#ramBar').style.width = u?.rss ? Math.min(100, u.rss / max * 100) + '%' : '0'; $('#ramTxt').textContent = u?.rss && s.running ? fmtMb(u.rss) : '–';
  $('#cpuBar').style.width = u?.cpu != null && s.running ? Math.min(100, u.cpu) + '%' : '0'; $('#cpuTxt').textContent = u?.cpu != null && s.running ? Math.round(u.cpu) + ' %' : '–';
  const stop = $('#stop');
  if (s.running) { stop.className = 'stop'; stop.textContent = '■ Beenden'; stop.onclick = async () => { if (!confirm(`„${s.name}“ wirklich beenden? Nicht gespeicherte Fortschritte gehen verloren.`)) return; await api.launchKill(s.profileId); }; }
  else { stop.className = 'start'; stop.textContent = '▶ Neu starten'; stop.onclick = async () => { stop.disabled = true; try { await api.launch(s.profileId); } catch (e) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000); } stop.disabled = false; }; }
  $('#folder').onclick = () => api.profiles.openFolder(s.profileId);
  $('#files').onclick = () => api.logs.openFolder();
  document.title = `${s.name} – Minecraft-Logs`;
  const pr = S.progress[s.profileId]; $('#prog').classList.toggle('hidden', !(s.running && pr && pr.percent < 1));
  if (pr) { $('#progText').textContent = `${pr.task} ${Math.round(pr.percent * 100)} %`; $('#progBar').style.width = Math.round(pr.percent * 100) + '%'; }
}
async function select(id) {
  S.sel = id; logBox.innerHTML = ''; S.entries = []; S.counts = { error: 0, warn: 0 }; S.hints.clear(); updateCounts(); drawHints();
  drawList(); drawCard();
  let lines = []; try { lines = await api.logs.lines(id); } catch {}
  if (S.sel !== id) return;
  // große Logs in Stücken einfügen, damit das Fenster nicht hängt
  const CH = 1500; for (let i = Math.max(0, lines.length - MAX_DOM * 3); i < lines.length; i += CH) { addLines(lines.slice(i, i + CH)); await new Promise(r => setTimeout(r)); if (S.sel !== id) return; }
  setFollow(true);
}

api.onLog(({ profileId, line, lines }) => { if (profileId && profileId === S.sel) addLines(lines || [line]); else if (profileId && !S.sessions.some(s => s.profileId === profileId)) loadSessions(); });
api.onProgress(({ profileId, task, percent }) => { if (!profileId) return; S.progress[profileId] = { task, percent }; if (profileId === S.sel) drawCard(); });
api.onClosed(({ profileId }) => { setTimeout(loadSessions, 300); });
api.v31.onUsage((u) => { S.usage[u.profileId] = u; if (u.profileId === S.sel) drawCard(); });
api.logs.onSelect((id) => { loadSessions().then(() => select(id)); });
api.logs.onNew((id) => { delete S.progress[id]; loadSessions().then(() => { if (S.sel === id || !S.sel) select(id); else drawList(); }); });
setInterval(() => { for (const n of document.querySelectorAll('.inst small span[data-start]')) if (n.dataset.start) n.textContent = fmtDur(Date.now() - Number(n.dataset.start)); const s = S.sessions.find(x => x.profileId === S.sel); if (s?.running) $('#cardTime').textContent = fmtDur(Date.now() - s.start); }, 1000);
setInterval(loadSessions, 5000);

const want = new URLSearchParams(location.search).get('select');
loadSessions().then(() => { if (want && S.sessions.some(s => s.profileId === want)) select(want); });
