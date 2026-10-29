// 3.0-Module: Mod-Browser, Upgrade-Assistent, Mods/Einstellungen übertragen, Grafik-Presets, Resourcepacks, Serverliste, Galerie, Wrapped
const path = require('path'), fs = require('fs'), crypto = require('crypto'); const AdmZip = require('adm-zip');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const nbt = require('nbt');
const rp = new AdmZip(); rp.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 34, description: 'Schöne Texturen' } }))); rp.addFile('pack.png', Buffer.from([137, 80, 78, 71]));
const store = { profiles: [
  { id: 'old', name: 'Alt 1.21.1', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.0', memory: 5, icon: '⚔️', installed: {} },
  { id: 'new', name: 'Neu 26.3', version: '26.3', loader: 'fabric', loaderVersion: '0.19.5', installed: {} },
  { id: 'leg', name: 'PvP 1.8.9', version: '1.8.9', loader: 'forge', loaderVersion: '11.15', installed: {} },
], accounts: [], settings: {}, favorites: [{ name: 'Gomme', ip: 'gommehd.net' }, { name: 'Hypixel', ip: 'mc.hypixel.net' }],
  sessions: [{ profileId: 'old', name: 'Alt 1.21.1', version: '1.21.1', loader: 'fabric', start: new Date(2026, 4, 3, 23, 30).getTime(), end: new Date(2026, 4, 4, 2, 0).getTime(), code: 0, servers: ['gommehd.net'], recap: { deaths: 3, kills: 5, advancements: ['A', 'B'], screenshots: 1 } }] };
const projects = { [sha('SODIUM')]: 'sodium', [sha('LITH')]: 'lithium', [sha('XAERO')]: 'xaeros-minimap' };
const avail = { '26.3': ['sodium', 'xaeros-minimap'], '1.21.1': ['sodium', 'lithium', 'xaeros-minimap'] };
const h = require('./harness')({
  store,
  files: { 'instances/old/mods/sodium-0.5.jar': 'SODIUM', 'instances/old/mods/lithium-0.11.jar': 'LITH', 'instances/old/mods/xaero.jar.disabled': 'XAERO', 'instances/old/mods/eigene.jar': 'EIGEN',
    'instances/old/options.txt': 'key_key.jump:key.keyboard.space\nrenderDistance:20\nfov:0.5\nsoundCategory_master:0.4\nlang:de_de\n', 'instances/old/config/sodium.json': '{}',
    'instances/new/options.txt': 'renderDistance:6\nresourcePacks:["vanilla","fabric"]\n', 'instances/new/resourcepacks/Faithful.zip': rp.toBuffer(), 'instances/new/resourcepacks/Dark.zip': rp.toBuffer(),
    'instances/leg/options.txt': 'key_key.jump:57\n', 'instances/old/screenshots/2026-05-04.png': 'PNG' },
  fetch: async (url, opts) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('version_manifest')) return new Response(JSON.stringify({ latest: { release: '26.3' }, versions: [{ id: '26.3', type: 'release' }, { id: '26.2', type: 'release' }, { id: '1.21.1', type: 'release' }] }));
    if (u.includes('meta.fabricmc.net')) return new Response(JSON.stringify([{ loader: { version: '0.19.5' } }]));
    if (u.endsWith('/v2/version_files')) { const b = JSON.parse(opts.body); const o = {}; for (const x of b.hashes) if (projects[x]) o[x] = { project_id: projects[x] }; return new Response(JSON.stringify(o)); }
    if (u.includes('/v2/projects?ids=')) return new Response(JSON.stringify(Object.values(projects).map(id => ({ id, title: id.toUpperCase() }))));
    const m = /\/v2\/project\/([^/?]+)\/version\?game_versions=\["([^"]+)"\]/.exec(u);
    if (m) { const ok = (avail[m[2]] || []).includes(m[1]) || m[1] === 'fabric-api'; return new Response(JSON.stringify(ok ? [{ id: 'v-' + m[1], version_type: 'release', project_id: m[1], version_number: '9.9', name: m[1] + ' 9.9', dependencies: [], game_versions: [m[2]], loaders: ['fabric'], files: [{ url: 'https://x/' + m[1], filename: `${m[1]}-${m[2]}.jar`, primary: true, size: 5 }] }] : [])); }
    if (u.includes('/v2/search?')) return new Response(JSON.stringify({ total_hits: 1, hits: [{ project_id: 'sodium', slug: 'sodium', title: 'Sodium', description: 'FPS', downloads: 9e7, follows: 1, categories: ['optimization'], author: 'jelly' }] }));
    if (/\/v2\/project\/sodium$/.test(u)) return new Response(JSON.stringify({ id: 'sodium', slug: 'sodium', project_type: 'mod', title: 'Sodium', description: 'FPS', body: '# Sodium', gallery: [], loaders: ['fabric'], game_versions: ['26.3'] }));
    if (u.startsWith('https://x/')) return new Response('JAR');
    return new Response('[]');
  },
});
const D = (...p) => path.join(h.DATA, 'instances', ...p);
const opts = (id) => Object.fromEntries(fs.readFileSync(D(id, 'options.txt'), 'utf8').trim().split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));
(async () => {
  // Mod-Browser
  const s = await h.call('browser:search', { query: 'sodium', profileId: 'new' }); h.ok(s.items[0]?.title === 'Sodium', 'Mod-Browser sucht');
  const pr = await h.call('browser:project', { id: 'sodium', profileId: 'new' }); h.ok(pr.compatible && pr.versions.length === 1, 'Projekt-Details mit passender Version');
  await h.call('browser:install', { id: 'sodium', profileId: 'new' }); h.ok(fs.existsSync(D('new', 'mods', 'sodium-26.3.jar')), 'Installation aus dem Mod-Browser');
  // Upgrade-Assistent
  const t = await h.call('upgrade:targets', 'old'); h.ok(t.newer.includes('26.3'), 'neuere Versionen gefunden');
  const plan = await h.call('upgrade:plan', { id: 'old', version: '26.3' });
  h.ok(plan.ok === 2 && plan.missing === 1 && plan.manual === 1, `Plan: ${plan.ok} passen, ${plan.missing} fehlt, ${plan.manual} manuell`);
  const up = await h.call('upgrade:run', { id: 'old', version: '26.3', name: 'Alt auf 26.3' });
  const nm = fs.readdirSync(D(up.id, 'mods'));
  h.ok(nm.includes('sodium-26.3.jar') && nm.includes('xaeros-minimap-26.3.jar.disabled') && fs.existsSync(D(up.id, 'config', 'sodium.json')), 'Upgrade: Mods neu gesucht, Deaktivierte bleiben aus, Configs übernommen');
  h.ok(up.profiles.find(p => p.id === up.id).memory === 5, 'Upgrade übernimmt RAM & Symbol');
  // Mods übertragen
  const tr = await h.call('mods:transfer', { from: 'old', to: 'new', files: ['lithium-0.11.jar', 'xaero.jar.disabled'] });
  h.ok(tr.ok.length === 1 && tr.missing.length === 1, 'Mods übertragen: passende installiert, fehlende gemeldet');
  // Grafik-Presets
  await h.call('gfx:apply', { id: 'new', preset: 'leistung' }); let o = opts('new');
  h.ok(o.renderDistance === '8' && o.ao === 'false' && o.graphicsMode === '0' && o.resourcePacks, 'Grafik-Preset (modern) – andere Werte bleiben');
  await h.call('gfx:apply', { id: 'leg', preset: 'schoen' }); o = opts('leg'); h.ok(o.fancyGraphics === 'true' && o.ao === '2' && !o.graphicsMode, 'Grafik-Preset (1.8.9-Schlüssel)');
  // Einstellungen übertragen
  const ot = await h.call('opts:transfer', { from: 'old', to: ['new', 'leg'], parts: ['keys', 'video', 'sound'] });
  o = opts('new'); h.ok(o.fov === '0.5' && o['key_key.jump'] === 'key.keyboard.space' && o.soundCategory_master === '0.4' && !o.lang, 'Einstellungen übertragen (ohne „Sonstiges“)');
  h.ok(ot.find(x => x.name === 'PvP 1.8.9').skippedKeys && opts('leg')['key_key.jump'] === '57', 'Tastenbelegung zu 1.8.9 übersprungen (anderes Format)');
  // Resourcepacks
  let r = await h.call('rp:list', 'new'); h.ok(r.available.length === 2 && r.available[0].desc === 'Schöne Texturen', 'Resourcepacks mit Beschreibung');
  await h.call('rp:save', { id: 'new', active: ['Faithful.zip', 'Dark.zip'] });
  h.ok(opts('new').resourcePacks === '["vanilla","fabric","file/Dark.zip","file/Faithful.zip"]', 'Reihenfolge: oben = höchste Priorität');
  r = await h.call('rp:list', 'new'); h.ok(r.active.map(x => x.file).join() === 'Faithful.zip,Dark.zip', 'Liste liest Reihenfolge zurück');
  // Serverliste
  const sv = await h.call('servers:syncAll'); const dat = nbt.parseUncompressed(fs.readFileSync(D('new', 'servers.dat')));
  h.ok(sv.added >= 2 && dat.value.servers.value.value.length === 2, 'Server-Radar → servers.dat');
  h.ok((await h.call('servers:syncAll')).added === 0, 'keine Doppelten beim zweiten Mal');
  // Galerie, Wrapped
  h.ok((await h.call('gallery:list'))[0]?.url.startsWith('file://'), 'Galerie über alle Profile');
  const w = await h.call('wrapped:get', 2026); h.ok(w.sessions === 1 && w.nights === 1 && w.deaths === 3 && w.advancements === 2 && w.topProfile.name === 'Alt 1.21.1', 'Wrapped zählt richtig');
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
