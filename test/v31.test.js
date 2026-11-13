// 3.1: Prüfsummen-Cache, Backups nur bei Änderungen, Java-Optimierung, Mod-Detektiv, Merkliste
const path = require('path'), fs = require('fs'), AdmZip = require('adm-zip'), crypto = require('crypto');
const h = require('./harness')({ store: { profiles: [{ id: 'p1', name: 'Test', version: '26.3', loader: 'fabric', loaderVersion: '0.19.5', memory: 4 }, { id: 'p2', name: 'Alt', version: '1.8.9', loader: 'forge', memory: 3, jvmArgs: '-XX:+UseZGC -Dfoo=1' }], accounts: [], settings: {} } });
const T = globalThis.__lellekTest;
const jar = (file, json) => { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify(json))); z.writeZip(file); };
(async () => {
  // Prüfsummen
  const root = path.join(h.DATA, 'minecraft'); fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  const f = path.join(root, 'assets', 'x.bin'); fs.writeFileSync(f, 'hallo');
  const sha = crypto.createHash('sha1').update('hallo').digest('hex');
  const Handler = require('minecraft-launcher-core/components/handler');
  h.ok(await Handler.prototype.checkSum(sha, f) === true && await Handler.prototype.checkSum('falsch', f) === false, 'Prüfsumme richtig/falsch erkannt');
  fs.writeFileSync(f, 'anders!'); h.ok(await Handler.prototype.checkSum(sha, f) === false, 'Geänderte Datei wird neu geprüft');
  await new Promise(r => setTimeout(r, 2300));
  h.ok(fs.existsSync(path.join(h.DATA, 'cache', 'checksums.json')), 'Prüfsummen-Cache gespeichert');
  // Java
  const a1 = T.jvmArgsFor({ jvmArgs: '-Dx=1' }, 21); h.ok(a1.includes('-XX:+UseG1GC') && a1.includes('-Dx=1'), 'Optimierte Java-Argumente + eigene');
  const a2 = T.jvmArgsFor({ jvmArgs: '-XX:+UseZGC -Dfoo=1' }, 21); h.ok(!a2.includes('-XX:+UseG1GC') && a2.includes('-XX:+UseZGC'), 'Eigener GC bleibt unangetastet');
  // Backups
  const w = path.join(h.DATA, 'instances', 'p1', 'saves', 'Welt'); fs.mkdirSync(path.join(w, 'region'), { recursive: true }); fs.writeFileSync(path.join(w, 'level.dat'), 'x'); fs.writeFileSync(path.join(w, 'region', 'r.0.0.mca'), Buffer.alloc(5000, 1));
  const past = new Date(Date.now() - 60000); fs.utimesSync(path.join(w, 'level.dat'), past, past);
  await h.call('backups:now', 'p1'); await h.call('backups:now', 'p1');
  const bdir = path.join(h.DATA, 'backups', 'p1'); const n1 = fs.readdirSync(bdir).filter(x => x.endsWith('.zip')).length;
  h.ok(n1 === 1, `Unveränderte Welt wird nicht doppelt gesichert (${n1})`);
  const fut = new Date(Date.now() + 120000); fs.utimesSync(path.join(w, 'level.dat'), fut, fut);
  await new Promise(r => setTimeout(r, 1100)); await h.call('backups:now', 'p1');
  const zips = fs.readdirSync(bdir).filter(x => x.endsWith('.zip'));
  h.ok(zips.length === 2 || zips.some(z => z !== zips[0]), `Geänderte Welt wird gesichert (${zips.length})`);
  h.ok(new AdmZip(path.join(bdir, zips.sort().pop())).getEntries().some(e => /region\/r\.0\.0\.mca$/.test(e.entryName)), 'Backup enthält die Welt-Dateien');
  // Mod-Detektiv
  const mods = path.join(h.DATA, 'instances', 'p1', 'mods'); fs.mkdirSync(mods, { recursive: true });
  jar(path.join(mods, 'lib.jar'), { id: 'lib' }); jar(path.join(mods, 'nutzt-lib.jar'), { id: 'nutzt', depends: { lib: '*', minecraft: '*' } });
  for (const n of ['a', 'b', 'c', 'kaputt', 'e', 'f', 'g']) jar(path.join(mods, n + '.jar'), { id: n });
  jar(path.join(mods, 'fabric-api.jar'), { id: 'fabric-api' });
  const on = (f) => fs.existsSync(path.join(mods, f));
  let st = await h.call('bisect:start', 'p1'); let steps = 0, depOk = true;
  while (!st.done && steps < 12) { if (!on('lib.jar') && on('nutzt-lib.jar')) depOk = false; st = await h.call('bisect:answer', { id: 'p1', broken: on('kaputt.jar') }); steps++; }
  h.ok(st.done && st.culprits.length === 1 && st.culprits[0] === 'kaputt.jar', `Mod-Detektiv findet die Mod in ${steps} Schritten (${st.culprits})`);
  h.ok(depOk, 'Abhängige Mods werden mit abgeschaltet');
  h.ok(on('fabric-api.jar'), 'Fabric API bleibt immer an');
  const res = await h.call('bisect:stop', { id: 'p1', disableCulprits: true });
  h.ok(!on('kaputt.jar') && on('kaputt.jar.disabled') && ['a', 'b', 'lib', 'nutzt-lib'].every(n => on(n + '.jar')), 'Danach alles wieder an, nur die Schuldige aus');
  // Merkliste
  let wl = await h.call('watch:toggle', { id: 'AANobbMI', title: 'Sodium', kind: 'mods' }); h.ok(wl.length === 1, 'Merkliste: hinzufügen');
  wl = await h.call('watch:toggle', { id: 'AANobbMI' }); h.ok(wl.length === 0, 'Merkliste: entfernen');
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
