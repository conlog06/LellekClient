// Zweites Fenster: eigene Einstellungen, übernimmt Profile, blockiert doppelt laufende Profile
const path = require('path'), fs = require('fs');
const store = { profiles: [{ id: 'p1', name: 'PvP', version: '1.8.9', loader: '' }], favorites: [{ name: 'Gomme', ip: 'gommehd.net' }], accounts: [{ id: 'a1', name: 'Lellek', refreshToken: 'x' }, { id: 'a2', name: 'Kiwi', refreshToken: 'y' }], currentAccount: 'a1', settings: { memory: 6, tray: true } };
const h = require('./harness')({ store, files: { 'instances/p1/.lellek-laeuft': `${process.ppid}|1` }, argv: ['--instance=2'] });
(async () => {
  const s = await h.call('settings:get'); h.ok(s.windowNo === 2 && s.memory === 6 && s.tray === false, 'Fenster 2 übernimmt Einstellungen (ohne Infobereich)');
  const acc = await h.call('auth:list'); h.ok(acc.find(a => a.current)?.name === 'Kiwi', 'Fenster 2 wählt das andere Konto');
  try { await h.call('launch', 'p1'); h.ok(false, 'doppelter Start blockiert'); } catch (e) { h.ok(/Fenster 1/.test(e.message), 'doppelter Start blockiert'); }
  h.done();
})().catch(e => { console.error(e); process.exit(1); });
