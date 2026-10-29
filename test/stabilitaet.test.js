// Datenrettung, Downloads, Selbstheilung, Diagnose, Weiterspielen
const path = require('path'), fs = require('fs'); const AdmZip = require('adm-zip');
const good = { profiles: [{ id: 'p1', name: 'Survival', version: '26.3', loader: 'fabric', loaderVersion: '0.19.5', javaPath: 'C:/gibtsnicht/java.exe' }], accounts: [], settings: {}, sessions: [{ profileId: 'p1', name: 'Survival', version: '26.3', loader: 'fabric', start: Date.now() - 4e6, end: Date.now() - 1e6, code: 0, servers: ['gommehd.net'], worlds: ['Neue Welt'] }] };
const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'coolmod', name: 'Cool Mod', description: 'Macht alles cooler', version: '1.0' }))); z.addFile('a.class', Buffer.alloc(200, 1));
let dlTries = 0;
const h = require('./harness')({
  store: '{"profiles": [ kaputt',
  files: { 'lellek.json.bak': JSON.stringify(good), 'instances/p1/mods/cool-1.0.jar': z.toBuffer(), 'instances/p1/mods/kaputt.jar': 'kein zip '.repeat(30), 'instances/p1/mods/halb.jar.part': 'x', 'instances/p1/saves/Neue Welt/level.dat': 'x' },
  fetch: async (url) => { const u = String(url); if (u.startsWith('https://dl/')) { dlTries++; return dlTries === 1 ? new Response('kurz', { headers: { 'content-length': '999' } }) : new Response('vollstaendig', { headers: { 'content-length': '12' } }); } return new Response('{}'); },
});
const mods = path.join(h.DATA, 'instances', 'p1', 'mods');
(async () => {
  const info = await h.call('app:startupInfo');
  h.ok(/\.bak$/.test(info.recovered || ''), 'beschädigte Einstellungen aus Sicherung gerettet');
  h.ok((await h.call('profiles:list')).length === 1, 'Profil ist noch da');
  h.ok(fs.readdirSync(h.DATA).some(f => f.startsWith('lellek.json.defekt-')), 'kaputte Datei aufgehoben');
  const meta = await h.call('content:meta', { profileId: 'p1', kind: 'mods' });
  h.ok(meta['cool-1.0.jar']?.title === 'Cool Mod', 'Mod-Name aus der Datei gelesen');
  const d = await h.call('diag:run'); const pr = d.checks.find(c => c.group === 'Profile');
  h.ok(pr.status === 'bad' && /defekte/.test(pr.detail), 'Diagnose findet defekte Mod');
  await h.call('diag:repair', pr.fix);
  const left = fs.readdirSync(mods); h.ok(left.join() === 'cool-1.0.jar', 'Reparatur räumt auf: ' + left.join(', '));
  h.ok((await h.call('profiles:list'))[0].javaPath === '', 'kaputter Java-Pfad zurückgesetzt');
  const c = await h.call('continue:list'); h.ok(c.length === 2 && c.some(x => x.target === 'world:Neue Welt'), 'Weiterspielen kennt Welt und Server');
  await h.call('mods:update', { profileId: 'p1', kind: 'mods', file: 'cool-1.0.jar', url: 'https://dl/neu.jar', newFile: 'neu.jar' });
  h.ok(fs.readFileSync(path.join(mods, 'neu.jar'), 'utf8') === 'vollstaendig' && dlTries === 2 && !fs.existsSync(path.join(mods, 'neu.jar.part')), 'Download wiederholt, keine Teil-Datei');
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
