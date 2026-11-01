// LellekHUD nur auf Wunsch: Vorlagen ohne HUD, Hinzufügen/Entfernen pro Instanz, Option „bei neuen Vorlagen“
const path = require('path'), fs = require('fs');
const store = { profiles: [], accounts: [], settings: { kitAuto: false } };
const h = require('./harness')({
  store,
  fetch: async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('version_manifest')) return new Response(JSON.stringify({ latest: { release: '26.3' }, versions: [{ id: '26.3', type: 'release' }, { id: '26.2', type: 'release' }, { id: '1.8.9', type: 'release' }] }));
    if (u.includes('meta.fabricmc.net')) return new Response(JSON.stringify([{ loader: { version: '0.19.5' } }]));
    return new Response('[]');
  },
});
const hudIn = (id) => fs.readdirSync(path.join(h.DATA, 'instances', id, 'mods')).filter(f => /^LellekHUD/i.test(f));
(async () => {
  const pr = await h.call('presets:list');
  h.ok(!pr.some(t => /LellekHUD/.test(t.hint)), 'Vorlagen-Texte ohne LellekHUD');
  const r = await h.call('presets:create', 'fabric-26.3');
  h.ok(!r.hudInstalled && hudIn(r.id).length === 0, 'Neue Vorlage ohne LellekHUD');
  let st = await h.call('hud:status', r.id);
  h.ok(st.available && st.state === 'none', 'Status: verfügbar, nicht installiert');
  st = await h.call('hud:set', { id: r.id, on: true });
  h.ok(st.state === 'on' && hudIn(r.id).length === 1, `Hinzufügen klappt (${st.version})`);
  st = await h.call('hud:set', { id: r.id, on: false });
  h.ok(st.state === 'none' && hudIn(r.id).length === 0, 'Entfernen klappt');
  await h.call('settings:save', { hudAuto: true });
  const r2 = await h.call('presets:create', 'fabric-26.3');
  h.ok(r2.hudInstalled && hudIn(r2.id).length === 1, 'Mit Option „bei neuen Vorlagen“ kommt HUD mit');
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
