// Vorlagen (inkl. neueste Version), Ausstattung installieren und entfernen, FreeCam
const path = require('path'), fs = require('fs');
const avail = { '26.3|fabric': ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'dynamic-fps', 'xaeros-minimap', 'xaeros-world-map', 'freecam', 'zoomify', 'appleskin', 'modmenu', 'mouse-tweaks', 'iris', 'fabric-api'], '1.8.9|forge': ['freecam-by-zergatul', 'xaeros-minimap', 'xaeros-world-map', 'entityculling', 'patcher'] };
const h = require('./harness')({
  fetch: async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('version_manifest')) return new Response(JSON.stringify({ latest: { release: '26.3' }, versions: [{ id: '26.3', type: 'release' }, { id: '26.2', type: 'release' }, { id: '1.8.9', type: 'release' }] }));
    if (u.includes('meta.fabricmc.net')) return new Response(JSON.stringify([{ loader: { version: '0.19.5' } }]));
    if (u.includes('promotions_slim')) return new Response(JSON.stringify({ promos: { '1.8.9-recommended': '11.15.1.2318' } }));
    const m = /\/v2\/project\/([^/]+)\/version\?game_versions=\["([^"]+)"\](?:&loaders=\["([^"]+)"\])?/.exec(u);
    if (m) { const ok = (avail[`${m[2]}|${m[3]}`] || []).includes(m[1]); return new Response(JSON.stringify(ok ? [{ version_type: 'release', project_id: m[1], version_number: '1.0', dependencies: [], files: [{ url: 'https://x/' + m[1], filename: `${m[1]}-${m[2]}.jar`, primary: true }] }] : [])); }
    if (u.startsWith('https://x/')) return new Response('JAR');
    return new Response('[]');
  },
});
(async () => {
  const pr = await h.call('presets:list'); h.ok(pr.some(p => p.version === '26.3' && p.latest), 'Vorlage für neueste Version (26.3)');
  for (const key of ['fabric-26.3', '1.8.9-forge']) {
    const r = await h.call('presets:create', key); const p = r.profiles.find(x => x.id === r.id);
    const dir = path.join(h.DATA, 'instances', p.id, 'mods');
    h.ok(r.kit.ok >= 4 && fs.readdirSync(dir).some(f => /freecam/.test(f)), `${p.name}: ${r.kit.ok} Mods inkl. FreeCam`);
    await h.call('bundle:remove', { profileId: p.id, which: 'recommended' });
    const left = fs.readdirSync(dir).filter(f => !/^(fabric-api|LellekHUD)/.test(f));
    h.ok(!left.length, `${p.name}: Empfohlene entfernt`);
  }
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
