// Oberfläche: alle Renderer-Skripte laden ohne Namenskonflikte, jede genutzte API gibt es im Preload, jeder Preload-Kanal hat einen Handler
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = path.join(__dirname, '..', 'src'), R = path.join(SRC, 'renderer');
let ok = 0; const check = (name, fn) => { try { fn(); ok++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(m => m[1]).filter(s => !/^https?:/.test(s) && !/vendor|skinview/i.test(s));

check('alle Skripte aus index.html existieren', () => { for (const s of scripts) assert.ok(fs.existsSync(path.join(R, s)), `fehlt: ${s}`); });
check('alle Stylesheets aus index.html existieren', () => { for (const m of html.matchAll(/<link[^>]*href="([^"]+\.css)"/g)) if (!/^https?:/.test(m[1])) assert.ok(fs.existsSync(path.join(R, m[1])), `fehlt: ${m[1]}`); });

check('keine doppelten globalen Namen zwischen den Skripten', () => {
  // V8 meldet „has already been declared“ beim Laden eines Skripts – unabhängig davon, ob vorherige Skripte zur Laufzeit scheitern
  const ctx = vm.createContext({});
  for (const s of scripts) {
    const code = fs.readFileSync(path.join(R, s), 'utf8');
    let script; try { script = new vm.Script(code, { filename: s }); } catch (e) { throw new Error(`${s}: ${e.message}`); }
    try { script.runInContext(ctx, { timeout: 2000 }); } catch (e) { if (/has already been declared/.test(e.message)) throw new Error(`${s}: ${e.message}`); }
  }
});

// Preload auswerten
let api = null; const channels = new Set();
vm.runInNewContext(fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8'), {
  require: (m) => m === 'electron' ? { contextBridge: { exposeInMainWorld: (_k, v) => { api = v; } }, ipcRenderer: { invoke: (ch) => channels.add(ch), on() {}, off() {}, send() {} }, webUtils: { getPathForFile: () => '' } } : require(m),
  process, console,
});
// invoke() wird erst beim Aufruf ausgeführt → Kanäle aus dem Quelltext lesen
for (const m of fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8').matchAll(/invoke\('([^']+)'\)/g)) channels.add(m[1]);

check('jede im Renderer genutzte API gibt es im Preload', () => {
  const missing = new Set();
  for (const s of scripts) {
    const code = fs.readFileSync(path.join(R, s), 'utf8');
    for (const m of code.matchAll(/\bapi\.([a-zA-Z]+)(?:\.([a-zA-Z]+))?\s*\(/g)) { if (!(m[1] in api)) missing.add(`api.${m[1]}`); else if (m[2] && typeof api[m[1]] === 'object' && !(m[2] in api[m[1]])) missing.add(`api.${m[1]}.${m[2]} (${s})`); }
    for (const m of code.matchAll(/\bapi\.([a-zA-Z]+)\.([a-zA-Z]+)\b/g)) if (typeof api[m[1]] === 'object' && !(m[2] in api[m[1]])) missing.add(`api.${m[1]}.${m[2]} (${s})`);
  }
  assert.deepStrictEqual([...missing], []);
});

check('jeder Preload-Kanal hat einen Handler im Hauptprozess', () => {
  const mainSrc = [path.join(SRC, 'main.js'), ...fs.readdirSync(path.join(SRC, 'main')).map(f => path.join(SRC, 'main', f))].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const handled = new Set([...mainSrc.matchAll(/ipcMain\.handle\(\s*['`]([^'`]+)['`]/g)].map(m => m[1]));
  const missing = [...channels].filter(c => !handled.has(c));
  assert.deepStrictEqual(missing, []);
});

check('3.0-Funktionen sind definiert', () => {
  const all = scripts.map(s => fs.readFileSync(path.join(R, s), 'utf8')).join('\n');
  for (const fn of ['renderInstance', 'renderDiscover', 'renderGallery', 'openWrapped', 'openOnboarding', 'openUpgrade', 'openModTransfer', 'openOptsTransfer', 'openProject', 'lightbox', 'renderMd'])
    assert.ok(new RegExp(`(async )?function ${fn}\\b`).test(all), `fehlt: ${fn}`);
});

console.log(`\n${ok} Prüfungen bestanden`);
