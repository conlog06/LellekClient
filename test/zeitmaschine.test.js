// Zeitmaschine, Profil-Codes, Autopilot, Erfolge
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const h = require('./harness')({
  store: { profiles: [{ id: 'p1', name: 'Test Fabric', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.0', memory: 4, installed: {}, playtimeMs: 3 * 36e5 }], accounts: [], settings: {}, sessions: [] },
  files: { 'instances/p1/mods/sodium-1.jar': 'AAA', 'instances/p1/mods/lithium-1.jar': 'BBB', 'instances/p1/config/a.json': '{"x":1}' },
  fetch: async (url, opts) => {
    const u = String(url);
    if (u.endsWith('/v2/version_files')) { const b = JSON.parse(opts.body); const out = {}; for (const x of b.hashes) if (x === sha('AAA')) out[x] = { id: 'AbCdEf12', project_id: 'AANobbMI' }; return new Response(JSON.stringify(out)); }
    if (u.includes('/v2/versions?ids=')) return new Response(JSON.stringify([{ id: 'AbCdEf12', project_id: 'AANobbMI', version_number: '0.6', files: [{ url: 'https://x/sodium.jar', filename: 'sodium-0.6.jar', primary: true, size: 3 }] }]));
    if (u.includes('/v2/projects?ids=')) return new Response(JSON.stringify([{ id: 'AANobbMI', title: 'Sodium' }]));
    if (u.startsWith('https://x/')) return new Response('NEWJAR');
    if (u.includes('/v2/project/')) return new Response(JSON.stringify([{ version_type: 'release', project_id: 'zzz', version_number: '1', dependencies: [], files: [{ url: 'https://x/m.jar', filename: u.split('/')[5] + '-1.jar', primary: true }] }]));
    return new Response('{}', { status: 404 });
  },
});
const mods = path.join(h.DATA, 'instances', 'p1', 'mods');
(async () => {
  h.ok(await h.call('tm:snapshot', { profileId: 'p1', reason: 'Test' }), 'Schnappschuss 1');
  fs.writeFileSync(path.join(mods, 'neu.jar'), 'CCC'); fs.renameSync(path.join(mods, 'lithium-1.jar'), path.join(mods, 'lithium-1.jar.disabled'));
  let l = await h.call('tm:list', 'p1'); h.ok(l.pending?.added.includes('neu.jar') && l.pending.disabled.includes('lithium-1.jar'), 'ungesicherte Änderungen erkannt');
  await h.call('tm:snapshot', { profileId: 'p1', reason: 'Test2' });
  l = await h.call('tm:list', 'p1');
  await h.call('tm:restore', { profileId: 'p1', id: l.snaps[1].id });
  h.ok(fs.existsSync(path.join(mods, 'lithium-1.jar')) && !fs.existsSync(path.join(mods, 'neu.jar')), 'Zurücksetzen stellt alten Stand her');
  const sc = await h.call('share:create', 'p1'); h.ok(/^LC1-/.test(sc.code) && sc.matched === 1, 'Profil-Code erstellt');
  const pv = await h.call('share:preview', sc.code); h.ok(pv.items[0].title === 'Sodium', 'Code-Vorschau');
  const im = await h.call('share:import', { code: sc.code }); h.ok(fs.existsSync(path.join(h.DATA, 'instances', im.id, 'mods', 'sodium-0.6.jar')), 'Code-Import legt Profil an');
  try { await h.call('share:preview', 'LC1-kaputt'); h.ok(false, 'kaputter Code abgelehnt'); } catch { h.ok(true, 'kaputter Code abgelehnt'); }
  const plan = await h.call('perf:plan', 'p1'); h.ok(plan.mods.find(m => m.slug === 'sodium').installed, 'Autopilot erkennt installierte Mods');
  const ap = await h.call('perf:apply', { profileId: 'p1', memory: plan.memory.recommended, jvm: plan.jvm.recommended, mods: ['ferrite-core'] }); h.ok(ap.done.length === 1, 'Autopilot installiert');
  const a = await h.call('ach:get'); h.ok(a.level >= 1 && a.list.length >= 25, 'Level & Erfolge');
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
