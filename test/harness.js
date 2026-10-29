// Test-Hilfe: startet src/main.js ohne Electron (Stub) in einem leeren Datenordner.
// Nutzung: const h = require('./harness')({ store, files, fetch, argv }); await h.call('kanal', ...args)
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
module.exports = function harness(opt = {}) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lellek-test-'));
  fs.writeFileSync(path.join(DATA, 'lellek.json'), typeof opt.store === 'string' ? opt.store : JSON.stringify(opt.store || { profiles: [], accounts: [], settings: {} }));
  for (const [rel, content] of Object.entries(opt.files || {})) { const f = path.join(DATA, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
  if (opt.fetch) globalThis.fetch = opt.fetch;
  for (const a of opt.argv || []) process.argv.push(a);
  const notes = [], sent = [];
  let userData = DATA;
  const electron = {
    app: { getPath: () => userData, setPath: (_k, v) => { userData = v; }, whenReady: () => new Promise(() => {}), on() {}, requestSingleInstanceLock: () => true, exit() {}, quit() {}, isPackaged: true, getAppPath: () => '' },
    ipcMain: {}, BrowserWindow: function () {}, dialog: {}, shell: { openPath() {}, openExternal() {} }, clipboard: { writeText(t) { electron.clip = t; } }, nativeImage: {}, Tray: function () {}, Menu: {},
    Notification: function (o) { notes.push(o.body); return { show() {} }; },
  };
  const handlers = {};
  electron.ipcMain.handle = (ch, fn) => { handlers[ch] = fn; };
  electron.ipcMain.removeHandler = (ch) => { delete handlers[ch]; };
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (r, ...a) { return r === 'electron' || r === 'msmc' ? r : orig.call(this, r, ...a); };
  require.cache.electron = { id: 'electron', filename: 'electron', loaded: true, exports: electron };
  require.cache.msmc = { id: 'msmc', filename: 'msmc', loaded: true, exports: opt.msmc || { Auth: class {} } };
  require(path.join(__dirname, '..', 'src', 'main.js'));
  let failed = 0;
  return {
    DATA, electron, notes, handlers,
    call: (ch, ...a) => { if (!handlers[ch]) throw new Error('Kein Handler: ' + ch); return handlers[ch](null, ...a); },
    ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) { failed++; process.exitCode = 1; } },
    done() { setTimeout(() => process.exit(failed ? 1 : 0), 50); },
  };
};
