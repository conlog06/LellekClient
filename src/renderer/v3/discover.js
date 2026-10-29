// LellekClient 3.0 – Entdecken: Modrinth-Browser mit Ziel-Instanz, Kategorien, Projektseite
const DISC_KINDS = [['mods', 'Mods'], ['modpacks', 'Modpacks'], ['resourcepacks', 'Resourcepacks'], ['shaderpacks', 'Shader'], ['datapacks', 'Datapacks']];
const DISC_TYPE = { mods: 'mod', modpacks: 'modpack', resourcepacks: 'resourcepack', shaderpacks: 'shader', datapacks: 'datapack' };
const DISC_SORT = [['relevance', 'Relevanz'], ['downloads', 'Downloads'], ['follows', 'Beliebt'], ['updated', 'Zuletzt aktualisiert'], ['newest', 'Neu']];
let discTags = null, discSeq = 0, discTimer = null;
const discNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mio.' : n >= 1e3 ? Math.round(n / 1e3) + ' Tsd.' : String(n || 0);
const SEARCH_SVG = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

function discTarget() { const d = V3.disc; if (d.kind === 'modpacks') return null; if (d.target && state.profiles.some(p => p.id === d.target)) return state.profiles.find(p => p.id === d.target); return currentProfile() || null; }

async function renderDiscover() {
  const root = $('#discRoot'); const d = V3.disc; root.innerHTML = '';
  // Kopf: Suche, Ziel, Sortierung
  const search = h('div.disc-search'); search.innerHTML = SEARCH_SVG;
  const q = h('input.input', { placeholder: `${DISC_KINDS.find(k => k[0] === d.kind)[1]} auf Modrinth suchen …`, value: d.query });
  search.append(q);
  q.oninput = () => { clearTimeout(discTimer); discTimer = setTimeout(() => { d.query = q.value.trim(); d.page = 0; discLoad(true); }, 320); };
  const tsel = h('select.select');
  for (const p of state.profiles) tsel.add(new Option(`${p.name} · ${p.version} ${loaderName(p.loader)}`, p.id));
  const tp = discTarget(); if (tp) tsel.value = tp.id;
  tsel.onchange = () => { d.target = tsel.value; d.page = 0; discLoad(true); };
  const any = h('input.sw', { type: 'checkbox', checked: !d.any, title: 'Nur passende für die Ziel-Instanz', onchange: () => { d.any = !any.checked; d.page = 0; discLoad(true); } });
  const target = h('div.disc-target', h('span.muted', 'Für'), tsel, h('label.row.gap', { title: 'Nur Projekte zeigen, die zu Version & Loader der Instanz passen' }, any, h('span.muted', 'passend')));
  if (d.kind === 'modpacks' || !state.profiles.length) target.classList.add('hidden');
  const sort = h('select.select'); for (const [k, t] of DISC_SORT) sort.add(new Option(t, k)); sort.value = d.sort; sort.onchange = () => { d.sort = sort.value; d.page = 0; discLoad(true); };
  root.append(h('div.disc-head', search, target, sort));
  // Art
  const seg = h('div.seg');
  for (const [k, t] of DISC_KINDS) seg.append(h('button' + (d.kind === k ? '.active' : ''), { onclick: () => { if (d.kind === k) return; d.kind = k; d.cats = []; d.page = 0; renderDiscover(); } }, t));
  root.append(h('div.row.gap', seg, h('span.grow'), h('span.muted#discCount')));
  // Kategorien
  const cats = h('div.disc-cats'); root.append(cats);
  try {
    discTags = discTags || await api.browser.tags();
    const list = discTags.categories.filter(c => c.type === DISC_TYPE[d.kind] && c.header !== 'loaders');
    const seen = new Set();
    for (const c of list) { if (seen.has(c.name)) continue; seen.add(c.name); cats.append(h('button.chip-btn' + (d.cats.includes(c.name) ? '.on' : ''), { onclick: (e) => { d.cats = d.cats.includes(c.name) ? d.cats.filter(x => x !== c.name) : [...d.cats, c.name]; e.currentTarget.classList.toggle('on'); d.page = 0; discLoad(true); } }, catLabel(c.name))); }
  } catch { cats.append(h('span.muted', 'Kategorien gerade nicht erreichbar')); }
  root.append(h('div.disc-grid#discGrid'), h('div.disc-more#discMore'));
  if (!d.items.length || d.lastKey !== discKey()) discLoad(true); else discDraw();
}
const CAT_DE = { adventure: 'Abenteuer', decoration: 'Deko', economy: 'Wirtschaft', equipment: 'Ausrüstung', food: 'Essen', 'game-mechanics': 'Spielmechanik', library: 'Bibliothek', magic: 'Magie', management: 'Verwaltung', minigame: 'Minispiel', mobs: 'Mobs', optimization: 'Performance', social: 'Sozial', storage: 'Lager', technology: 'Technik', transportation: 'Transport', utility: 'Nützlich', worldgen: 'Weltgenerierung', 'kitchen-sink': 'Alles drin', lightweight: 'Leicht', multiplayer: 'Mehrspieler', quests: 'Quests', challenging: 'Schwer', combat: 'Kampf', cursed: 'Verflucht', atmosphere: 'Atmosphäre', bloom: 'Bloom', shadows: 'Schatten', realistic: 'Realistisch', 'semi-realistic': 'Halb-realistisch', cartoon: 'Cartoon', fantasy: 'Fantasy', vanilla: 'Vanilla-Look', 'vanilla-like': 'Vanilla-artig', simplistic: 'Schlicht', themed: 'Thema', tweaks: 'Anpassungen', 'audio': 'Sound', blocks: 'Blöcke', entities: 'Wesen', environment: 'Umgebung', fonts: 'Schrift', gui: 'Oberfläche', items: 'Items', locale: 'Sprache', models: 'Modelle', 'core-shaders': 'Core-Shader', 'colored-lighting': 'Farbiges Licht', 'path-tracing': 'Path-Tracing', pbr: 'PBR', reflections: 'Spiegelungen', foliage: 'Pflanzen', 'potato': 'Kartoffel-PC', low: 'Schwacher PC', medium: 'Mittlerer PC', high: 'Starker PC', 'screenshot': 'Screenshot' };
const catLabel = (n) => CAT_DE[n] || n.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const discKey = () => { const d = V3.disc; const t = discTarget(); return JSON.stringify([d.kind, d.query, d.cats, d.sort, d.any, t?.id || '']); };

async function discLoad(reset) {
  const d = V3.disc; const seq = ++discSeq; const grid = $('#discGrid'); if (!grid) return;
  if (reset) { d.items = []; d.page = 0; grid.innerHTML = ''; for (let i = 0; i < 8; i++) grid.append(h('div.dcard.skel', { style: { height: '210px' } })); }
  const more = $('#discMore'); more.innerHTML = '';
  try {
    const t = discTarget();
    const r = await api.browser.search({ query: d.query, kind: d.kind, categories: d.cats, sort: d.sort, profileId: t?.id, page: d.page, any: d.any });
    if (seq !== discSeq) return;
    d.items = reset ? r.items : d.items.concat(r.items); d.total = r.total; d.lastKey = discKey();
    discDraw();
  } catch (e) { if (seq !== discSeq) return; grid.innerHTML = ''; grid.append(h('div.empty-state', h('span.big', '📡'), h('b', 'Modrinth nicht erreichbar'), h('span', e.message), h('button.ghost', { onclick: () => discLoad(true) }, 'Nochmal versuchen'))); }
}
function discDraw() {
  const d = V3.disc; const grid = $('#discGrid'); if (!grid) return; grid.innerHTML = '';
  const t = discTarget();
  if ($('#discCount')) $('#discCount').textContent = d.total ? `${discNum(d.total)} Treffer${t && !d.any && d.kind !== 'modpacks' ? ` für ${t.version}${d.kind === 'mods' && t.loader ? ' ' + loaderName(t.loader) : ''}` : ''}` : '';
  if (!d.items.length) grid.append(h('div.empty-state', h('span.big', '🔍'), h('b', 'Nichts gefunden'), h('span', !d.any && t ? 'Tipp: Schalter „passend“ ausschalten, um alle Versionen zu sehen.' : 'Anderen Suchbegriff oder weniger Kategorien probieren.')));
  for (const it of d.items) grid.append(discCard(it));
  const more = $('#discMore'); more.innerHTML = '';
  if (d.items.length < (d.total || 0)) more.append(h('button.ghost', { onclick: (e) => { e.target.disabled = true; e.target.textContent = 'Lädt …'; d.page++; discLoad(false); } }, 'Mehr laden'));
}
function discCard(it) {
  const ban = h('div.dban'); if (it.banner) ban.style.backgroundImage = `url("${it.banner}")`; else if (it.color != null) ban.style.background = `linear-gradient(135deg, #${(it.color >>> 0).toString(16).padStart(6, '0')}55, var(--panel2))`;
  const ic = h('img.dicon', { alt: '', loading: 'lazy' }); if (it.icon) ic.src = it.icon;
  const c = h('div.dcard', { onclick: () => openProject(it.id, it) }, ban, h('div.dbody', ic, h('div.dt', h('b', it.title), h('span', 'von ' + it.author)), h('p', it.desc), h('div.dfoot', h('span', `⬇ ${discNum(it.downloads)}`), h('span', `♥ ${discNum(it.follows)}`), h('span.grow'), ...(it.categories || []).filter(x => !['fabric', 'forge', 'neoforge', 'quilt', 'minecraft'].includes(x)).slice(0, 2).map(x => h('span.pill', catLabel(x))))));
  if (it.installed) c.append(h('span.pill.ok.dinst', '✓ installiert'));
  else if (V3.disc.kind !== 'modpacks') { const b = h('button.primary.small.dinst', { title: 'Schnell installieren', onclick: async (e) => { e.stopPropagation(); await discInstall(it.id, null, it.title, b); } }, '+'); c.append(b); }
  return c;
}
async function discInstall(id, versionId, title, button) {
  const d = V3.disc; const t = discTarget();
  if (d.kind !== 'modpacks' && !t) { toast('Erst eine Instanz anlegen – z. B. unter Profile → Vorlagen', true); return false; }
  if (button) { button.disabled = true; button.dataset.t = button.textContent; button.textContent = '…'; }
  try {
    const r = await api.browser.install({ id, versionId, profileId: t?.id, kind: d.kind, name: title });
    if (d.kind === 'modpacks') { state.profiles = r.profiles || r; await loadProfiles(); toast(`Modpack „${title}“ ist als neue Instanz bereit`); if (r.id) openInstance(r.id); return true; }
    toast(`${title} → ${t.name} installiert${r.files?.length > 1 ? ` (+${r.files.length - 1} Abhängigkeiten)` : ''}`);
    const it = d.items.find(x => x.id === id); if (it) it.installed = true;
    if (button) { const p = h('span.pill.ok.dinst', '✓ installiert'); button.replaceWith(p); }
    return true;
  } catch (e) { toast(e.message, true); if (button) { button.disabled = false; button.textContent = button.dataset.t || '+'; } return false; }
}

async function openProject(id, pre) {
  const t = discTarget();
  const { d: dlg, body, foot, close } = v25Dialog('proj-dlg');
  body.append(h('div.proj-head', h('img', { src: pre?.icon || '', alt: '' }), h('div', h('h2', pre?.title || 'Lädt …'), h('span.muted', pre?.desc || '')), h('span')), h('p.muted', 'Lade Details …'));
  foot.append(h('button.ghost', { onclick: close }, 'Schließen'));
  let pr; try { pr = await api.browser.project({ id, profileId: t?.id }); } catch (e) { body.lastChild.textContent = e.message; return; }
  if (!dlg.open) return;
  body.innerHTML = ''; foot.innerHTML = '';
  const isPack = pr.type === 'modpack';
  const compat = isPack ? h('span.compat.ok', '📦 wird als neue Instanz angelegt') : !t ? h('span.compat', 'Keine Instanz gewählt') : pr.compatible ? h('span.compat.ok', `✓ passt zu „${t.name}“ (${t.version}${t.loader ? ' ' + loaderName(t.loader) : ''})`) : h('span.compat.no', `✕ keine Version für ${t.version}${t.loader && pr.type === 'mod' ? ' ' + loaderName(t.loader) : ''}`);
  const go = h('button.primary', pr.installed ? '✓ Installiert' : isPack ? 'Als Instanz anlegen' : 'Installieren');
  go.disabled = pr.installed || (!isPack && (!t || !pr.compatible));
  body.append(h('div.proj-head', h('img', { src: pr.icon || '', alt: '' }), h('div', h('h2', pr.title), h('div.muted', pr.desc), h('div.row.gap', { style: { marginTop: '6px', flexWrap: 'wrap' } }, h('span.pill', `⬇ ${discNum(pr.downloads)}`), h('span.pill', `♥ ${discNum(pr.followers)}`), pr.license ? h('span.pill', pr.license) : null, pr.client === 'required' && pr.server === 'unsupported' ? h('span.pill', 'nur Client') : null, pr.server === 'required' ? h('span.pill.warn', 'auch auf Server') : null)), h('div', { style: { textAlign: 'right' } }, compat)));
  if (pr.gallery.length) { const g = h('div.proj-gal'); pr.gallery.forEach((x, i) => g.append(h('img', { src: x.url, alt: x.title, loading: 'lazy', title: x.title, onclick: () => lightbox(pr.gallery.map(y => ({ url: y.raw, caption: y.title || y.desc || pr.title })), i) }))); body.append(g); }
  if (pr.deps?.length && !isPack) { const box = h('div.row.gap', { style: { flexWrap: 'wrap', margin: '6px 0 10px' } }, h('span.muted', 'Braucht:')); for (const dp of pr.deps) box.append(h('span.pill' + (dp.available ? '' : '.bad'), (dp.available ? '' : '⚠ ') + dp.title)); body.append(box); if (pr.deps.some(x => !x.available)) body.append(h('p.danger', 'Eine benötigte Mod gibt es nicht für diese Version – die Installation kann unvollständig sein.')); }
  // Reiter: Beschreibung / Versionen / Links
  const pane = h('div'); const tabs = h('div.seg.proj-tabs');
  const show = (k) => { [...tabs.children].forEach(b => b.classList.toggle('active', b.dataset.k === k)); pane.innerHTML = '';
    if (k === 'desc') pane.append(renderMd(pr.body || pr.desc));
    if (k === 'ver') { const l = h('div.ver-list'); if (!pr.versions.length) l.append(h('p.muted', isPack ? 'Versionen auf Modrinth ansehen.' : 'Keine Version für diese Instanz.'));
      for (const v of pr.versions) l.append(h('div.ver-row', h('div', h('b', v.name || v.number), ' ', v.id === pr.recommended ? h('span.pill.ok', 'empfohlen') : null, v.type !== 'release' ? h('span.pill.warn', v.type === 'beta' ? 'Beta' : 'Alpha') : null, h('div.muted', `${v.gameVersions.join(', ')} · ${v.loaders.map(loaderName).join(', ')} · ${fmtDate(v.date)} · ${fmtSize(v.size)}`)), h('span.muted', `⬇ ${discNum(v.downloads)}`), isPack ? h('span') : h('button.ghost.small', { disabled: !t, onclick: async (e) => { if (await discInstall(pr.id, v.id, pr.title, null)) { e.target.textContent = '✓'; go.disabled = true; go.textContent = '✓ Installiert'; } } }, 'Diese installieren')));
      pane.append(l); }
    if (k === 'links') { const l = h('div.perf-list'); for (const [lk, label] of [['page', 'Modrinth-Seite'], ['source', 'Quellcode'], ['issues', 'Fehler melden'], ['wiki', 'Wiki'], ['discord', 'Discord']]) if (pr.links[lk]) l.append(h('div.perf-item', { style: { cursor: 'pointer' }, onclick: () => api.bundle.open(pr.links[lk]) }, h('span', '🔗'), h('div', h('b', label), h('span', pr.links[lk])), h('span'))); pane.append(l, h('p.muted', `Kategorien: ${(pr.categories || []).map(catLabel).join(', ')} · Zuletzt aktualisiert ${fmtDate(pr.updated)}`)); }
  };
  for (const [k, l] of [['desc', 'Beschreibung'], ['ver', `Versionen${pr.versions.length ? ' (' + pr.versions.length + ')' : ''}`], ['links', 'Links']]) tabs.append(h('button', { dataset: { k }, onclick: () => show(k) }, l));
  body.append(tabs, pane); show('desc');
  go.onclick = async () => { go.disabled = true; go.textContent = 'Installiert …'; if (await discInstall(pr.id, null, pr.title, null)) { go.textContent = '✓ Installiert'; if (isPack) close(); } else { go.disabled = false; go.textContent = isPack ? 'Als Instanz anlegen' : 'Installieren'; } };
  foot.append(h('button.ghost', { onclick: () => api.bundle.open(pr.links.page) }, 'Auf Modrinth'), h('span.grow'), h('button.ghost', { onclick: close }, 'Schließen'), go);
}
