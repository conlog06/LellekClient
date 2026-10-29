// Startet den Freunde-Server und je zwei simulierte Launcher: Freundschaftsanfrage, dann Party & Chat
const { spawn } = require('child_process'), path = require('path');
const run = (args, env) => new Promise((res) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env } }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); p.on('close', (code) => res({ code, out })); });
(async () => {
  let bad = 0;
  for (const [scen, port] of [['freunde', 18900 + Math.floor(Math.random() * 50)], ['party', 18960 + Math.floor(Math.random() * 30)]]) {
    const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'presence-server.js')], { env: { ...process.env, PORT: String(port), LELLEK_DEV_NOAUTH: '1' } });
    await new Promise(r => setTimeout(r, 800));
    const [a, b] = await Promise.all([run([path.join(__dirname, 'e2e-client.js'), `${scen}-A`, 'Lellek', 'Kiwi', String(port)]), run([path.join(__dirname, 'e2e-client.js'), `${scen}-B`, 'Kiwi', 'Lellek', String(port)])]);
    srv.kill();
    console.log(`  — ${scen}`); process.stdout.write(a.out.replace(/^/gm, '  ') + b.out.replace(/^/gm, '  '));
    if (a.code || b.code) bad++;
  }
  process.exit(bad ? 1 : 0);
})();
