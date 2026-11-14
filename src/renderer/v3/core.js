// LellekClient 3.0 – gemeinsame Bausteine: Element-Helfer, Reiter, Großansicht, Markdown, Navigation
const V3 = { inst: null, instTab: 'overview', disc: { kind: 'mods', cats: [], sort: 'relevance', page: 0, items: [], query: '', any: false } };

/** Element bauen: h('div.klasse', { onclick, title, ... }, kinder…) */
function h(sel, attrs, ...kids) {
  let id = null; sel = String(sel).replace(/#([\w-]+)/, (m, x) => { id = x; return ''; });
  const [tag, ...cls] = sel.split('.'); const e = document.createElement(tag || 'div'); if (cls.length) e.className = cls.join(' '); if (id) e.id = id; if (tag === 'button') e.type = 'button'; // nie versehentlich Formulare absenden
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e[k] = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k === 'dataset') Object.assign(e.dataset, v); else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v); }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const fmtH = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const loaderName = (l) => l ? (LOADER_NAMES[l] || l) : 'Vanilla';
const profIcon = (p) => p?.icon || (p?.loader ? { fabric: '🧵', forge: '⚒️', neoforge: '🦊' }[p.loader] || '📦' : '🟩');

// ---------- Großansicht für Bilder ----------
function lightbox(items, start = 0, extra) {
  let i = start; const lb = h('div.lightbox'); const img = h('img'); const cap = h('span');
  const show = () => { const it = items[i]; img.src = it.url || it.raw || it; cap.textContent = it.caption || `${i + 1} / ${items.length}`; bar.querySelectorAll('[data-x]').forEach(b => b.remove()); for (const [label, fn] of (extra ? extra(it) : [])) { const b = h('button.ghost.small', { onclick: (e) => { e.stopPropagation(); fn(it, close); } }, label); b.dataset.x = '1'; bar.append(b); } };
  const bar = h('div.lb-bar', cap);
  const close = () => { lb.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % items.length; show(); } if (e.key === 'ArrowLeft') { i = (i - 1 + items.length) % items.length; show(); } };
  lb.append(img, bar, h('button.lb-close', { onclick: close }, '✕'));
  if (items.length > 1) lb.append(h('button.lb-nav.lb-prev', { onclick: (e) => { e.stopPropagation(); i = (i - 1 + items.length) % items.length; show(); } }, '‹'), h('button.lb-nav.lb-next', { onclick: (e) => { e.stopPropagation(); i = (i + 1) % items.length; show(); } }, '›'));
  lb.onclick = (e) => { if (e.target === lb) close(); };
  document.addEventListener('keydown', key); document.body.append(lb); show();
}

// ---------- Markdown/HTML von Modrinth sicher darstellen (nur Text, Überschriften, Listen, Bilder, Links) ----------
function renderMd(src) {
  const box = h('div.md');
  const text = String(src || '').replace(/\r/g, '')
    .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, '\n![]($1)\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|center|details|summary)>/gi, '\n')
    .replace(/<h(\d)[^>]*>/gi, (m, n) => '\n' + '#'.repeat(Number(n)) + ' ').replace(/<li[^>]*>/gi, '\n- ').replace(/<a [^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let list = null;
  const inline = (line, into) => {
    const re = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|`([^`]+)`/g; let last = 0, m;
    while ((m = re.exec(line))) {
      if (m.index > last) into.append(line.slice(last, m.index));
      if (m[1]) { if (/^https:\/\//.test(m[1])) { const im = h('img', { loading: 'lazy', alt: '' }); im.src = m[1]; into.append(im); } }
      else if (m[2]) { const url = m[3]; into.append(h('a', { title: url, onclick: () => /^https?:\/\//.test(url) && api.bundle.open(url) }, m[2].replace(/!\[[^\]]*\]\([^)]*\)/g, ''))); }
      else if (m[4]) into.append(h('b', m[4])); else if (m[5]) into.append(h('code', m[5]));
      last = re.lastIndex;
    }
    if (last < line.length) into.append(line.slice(last));
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line) { list = null; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { list = null; const e = h(m[1].length <= 1 ? 'h1' : m[1].length === 2 ? 'h2' : 'h3'); inline(m[2], e); box.append(e); continue; }
    if ((m = /^[-*+]\s+(.*)$/.exec(line))) { if (!list) { list = h('ul'); box.append(list); } const li = h('li'); inline(m[1], li); list.append(li); continue; }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line)) { box.append(h('hr')); continue; }
    list = null; const p = h('p'); inline(line.replace(/^>\s?/, ''), p); box.append(p);
  }
  return box;
}

// ---------- Navigation 3.0 ----------
Object.assign(VIEW_META, { instance: ['Instanz', ''], discover: ['Entdecken', 'Modrinth'], gallery: ['Galerie', 'Alle Screenshots'] });
Object.assign(VIEW_GROUP, { instance: 'Bibliothek', discover: 'Bibliothek', gallery: 'Bibliothek' });
VIEWS.splice(0, VIEWS.length, ['play', 'Startseite'], ['profiles', 'Profile'], ['discover', 'Entdecken'], ['content', 'Mods & Packs'], ['worlds', 'Welten'], ['gallery', 'Galerie'], ['skins', 'Skins'], ['friends', 'Freunde'], ['party', 'Party'], ['radar', 'Server-Radar'], ['stats', 'Statistik & Erfolge'], ['server', 'Server hosten'], ['design', 'Design'], ['settings', 'Optionen']);
{
  const _sv = showView;
  showView = function (view) {
    _sv(view);
    if (view === 'instance' && V3.inst) { const p = state.profiles.find(x => x.id === V3.inst); $('#viewTitle').textContent = p?.name || 'Instanz'; $('#viewSub').textContent = 'Profile'; $$('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'profiles')); }
    if (view === 'discover') safe('discover', () => renderDiscover());
    if (view === 'gallery') safe('gallery', () => renderGallery());
    if (view === 'play') safe('home-banner', () => homeBanner());
  };
}
function openInstance(id, tab) { V3.inst = id; if (tab) V3.instTab = tab; else if (V3.lastInst !== id) V3.instTab = 'overview'; V3.lastInst = id; showView('instance'); renderInstance(); }

// Profilkarten: Klick auf Kopf öffnet die Instanz
{
  const _rp = renderProfiles;
  renderProfiles = async function () {
    await _rp();
    safe('cards-open', () => {
      for (const c of $$('#profileCards .pcard')) {
        const p = profileOfCard(c); if (!p) continue;
        const head = c.querySelector('.pcard-head'); head.style.cursor = 'pointer'; head.title = 'Instanz öffnen';
        head.onclick = () => openInstance(p.id);
        const acts = c.querySelector('.actions'); if (acts && !acts.querySelector('.open-btn')) { const b = h('button.ghost.open-btn', { onclick: () => openInstance(p.id) }, 'Öffnen'); acts.querySelector('.icon-btn')?.before(b); }
      }
    });
  };
}
// Startseite: Banner der gewählten Instanz und Knopf „Instanz öffnen“
async function homeBanner() {
  const p = currentProfile(); const hero = $('.hero'); if (!hero) return;
  let b = $('#heroBanner'); let data = null;
  if (p?.banner) { try { data = (await api.instance.overview(p.id)).banner; } catch {} }
  if (data && !ui.bgData) { if (!b) { b = h('div.hero-banner'); b.id = 'heroBanner'; hero.prepend(b); } b.style.backgroundImage = `url("${data}")`; hero.classList.add('inst-bg'); }
  else { b?.remove(); hero.classList.remove('inst-bg'); }
  let o = $('#instOpenBtn'); if (!o) { o = h('button.inst-open', { onclick: () => state.current && openInstance(state.current) }); o.id = 'instOpenBtn'; $('.launch-row')?.after(o); }
  o.textContent = p ? `Instanz „${p.name}“ öffnen →` : ''; o.classList.toggle('hidden', !p);
}
{ const _rl = renderLaunch; renderLaunch = function (...a) { const r = _rl.apply(this, a); if (state.view === 'play') safe('home-banner', () => homeBanner()); return r; }; }

// Befehlspalette
{
  const _pi = paletteItems;
  paletteItems = function () {
    const items = _pi();
    for (const p of state.profiles) items.push({ group: 'Instanz', label: `${p.name} öffnen`, hint: `${p.version} ${loaderName(p.loader)}`, run: () => openInstance(p.id) });
    items.push({ group: 'Aktion', label: 'Mods entdecken', hint: 'Modrinth', run: () => showView('discover') });
    items.push({ group: 'Aktion', label: 'Lellek Wrapped', hint: 'Jahresrückblick', run: () => openWrapped() });
    items.push({ group: 'Aktion', label: 'Galerie', hint: 'Screenshots', run: () => showView('gallery') });
    return items;
  };
}
// Startseite war schon offen, bevor 3.0 geladen wurde
setTimeout(() => { if (state.view === 'play') safe('home-banner', () => homeBanner()); }, 700);
