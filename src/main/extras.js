// Galerie, Skin per Name, Lellek Wrapped, Pausen-Erinnerung, Backup-Spiegel, Serverliste im Spiel
const fs = require('fs'), fsp = require('fs/promises'), path = require('path');
const { pathToFileURL } = require('url');
module.exports = function extras(ctx) {
  const { ipcMain, dialog, shell, store, saveStore, profileById, instanceDir, SKINS_DIR, lookupPlayer, skinFor, notify, running, gameContext, nbt, wrapHandler, logLauncher, ACHIEVEMENTS, levelInfo } = ctx;

  // ---------- Galerie über alle Profile ----------
  ipcMain.handle('gallery:list', async () => {
    const out = [];
    for (const p of store.profiles) {
      const d = path.join(instanceDir(p), 'screenshots'); let files = []; try { files = (await fsp.readdir(d)).filter(f => /\.png$/i.test(f)); } catch { continue; }
      for (const f of files) { try { const st = await fsp.stat(path.join(d, f)); out.push({ profileId: p.id, profileName: p.name, version: p.version, file: f, time: st.mtimeMs, size: st.size, url: pathToFileURL(path.join(d, f)).href }); } catch {} }
    }
    return out.sort((a, b) => b.time - a.time).slice(0, 600);
  });
  ipcMain.handle('gallery:reveal', (_e, { profileId, file }) => { const p = profileById(profileId); if (p) shell.showItemInFolder(path.join(instanceDir(p), 'screenshots', path.basename(file))); return true; });

  // ---------- Skin eines Spielers übernehmen ----------
  ipcMain.handle('skins:fromPlayer', async (_e, name) => {
    const pl = await lookupPlayer(name);
    const sk = await skinFor(pl.uuid.replace(/-/g, ''));
    if (!sk?.dataUrl) throw new Error(`${pl.name} hat keinen eigenen Skin`);
    fs.mkdirSync(SKINS_DIR, { recursive: true });
    const file = `${pl.name}${sk.slim ? ' (slim)' : ''}.png`;
    await fsp.writeFile(path.join(SKINS_DIR, file), Buffer.from(sk.dataUrl.split(',')[1], 'base64'));
    return { name: pl.name, file, slim: !!sk.slim };
  });

  // ---------- Lellek Wrapped: Jahresrückblick ----------
  ipcMain.handle('wrapped:get', (_e, year) => {
    year = Number(year) || new Date().getFullYear();
    const S = (store.sessions || []).filter(s => new Date(s.start).getFullYear() === year);
    const dur = (s) => Math.max(0, s.end - s.start);
    const total = S.reduce((a, s) => a + dur(s), 0);
    const by = (keyFn) => { const m = {}; for (const s of S) for (const k of [].concat(keyFn(s) || [])) m[k] = (m[k] || 0) + dur(s); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const profiles = by(s => s.name), versions = by(s => s.version), servers = by(s => s.servers || []);
    const days = new Set(S.map(s => new Date(s.start).toDateString()));
    const wd = by(s => ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][new Date(s.start).getDay()]);
    const months = by(s => ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][new Date(s.start).getMonth()]);
    const longest = S.reduce((a, s) => dur(s) > dur(a || { start: 0, end: 0 }) ? s : a, null);
    const sum = (k) => S.reduce((a, s) => a + (Array.isArray(s.recap?.[k]) ? s.recap[k].length : (s.recap?.[k] || 0)), 0);
    const ach = Object.entries(store.achievements || {}).filter(([, t]) => new Date(t).getFullYear() === year).map(([id]) => ACHIEVEMENTS.find(a => a.id === id)).filter(Boolean).map(a => ({ icon: a.icon, title: a.title }));
    const nights = S.filter(s => { const h = new Date(s.start).getHours(); return h >= 23 || h < 5; }).length;
    return { year, totalMs: total, sessions: S.length, days: days.size, topProfile: profiles[0] ? { name: profiles[0][0], ms: profiles[0][1] } : null, topVersion: versions[0]?.[0] || null, versions: versions.length,
      topServers: servers.slice(0, 3).map(([n, ms]) => ({ name: n, ms })), weekday: wd[0]?.[0] || null, month: months[0]?.[0] || null, longest: longest ? { ms: dur(longest), name: longest.name, at: longest.start } : null,
      advancements: sum('advancements'), deaths: sum('deaths'), kills: sum('kills'), screenshots: sum('screenshots'), nights, achievements: ach, level: levelInfo(), crashes: S.filter(s => s.code !== 0).length };
  });

  // ---------- Pausen-Erinnerung ----------
  const reminded = new Map(); // profileId → Anzahl Erinnerungen
  setInterval(() => {
    const min = Number(store.settings.pauseReminder) || 0; if (!min) return;
    for (const id of running.keys()) {
      const since = gameContext.get(id)?.since; if (!since) continue;
      const played = (Date.now() - since) / 60000, n = reminded.get(id) || 0;
      if (played >= min * (n + 1)) { reminded.set(id, n + 1); const h = Math.floor(played / 60), m = Math.round(played % 60); notify('Zeit für eine kurze Pause?', `Du spielst seit ${h ? h + ' h ' : ''}${m} min. Kurz aufstehen, trinken, Augen entspannen.`); }
    }
    for (const id of [...reminded.keys()]) if (!running.has(id)) reminded.delete(id);
  }, 60000);

  // ---------- Backup-Spiegel (z. B. OneDrive / Google Drive) ----------
  ipcMain.handle('backup:pickMirror', async () => {
    const r = await dialog.showOpenDialog(ctx.win, { properties: ['openDirectory', 'createDirectory'], title: 'Ordner für Backup-Kopien (z. B. OneDrive)' });
    if (r.canceled) return store.settings.backupMirror || null;
    store.settings.backupMirror = r.filePaths[0]; saveStore(); return store.settings.backupMirror;
  });
  ipcMain.handle('backup:clearMirror', () => { delete store.settings.backupMirror; saveStore(); return null; });
  ctx.mirrorBackup = async (p, zipFile) => {
    const root = store.settings.backupMirror; if (!root || !fs.existsSync(root)) return;
    try {
      const d = path.join(root, 'LellekClient-Backups', p.name.replace(/[<>:"/\\|?*]/g, '_')); fs.mkdirSync(d, { recursive: true });
      await fsp.copyFile(zipFile, path.join(d, path.basename(zipFile)));
      const old = (await fsp.readdir(d)).filter(f => f.endsWith('.zip')).sort(); for (const f of old.slice(0, Math.max(0, old.length - 5))) await fsp.rm(path.join(d, f), { force: true });
    } catch (e) { logLauncher('WARNUNG', 'Backup-Spiegel: ' + e.message); }
  };

  // ---------- Server-Radar → Serverliste im Spiel (servers.dat) ----------
  function syncServers(p) {
    const favs = store.favorites || []; if (!favs.length) return 0;
    const f = path.join(instanceDir(p), 'servers.dat');
    let root = { name: '', value: { servers: { type: 'list', value: { type: 'compound', value: [] } } } };
    if (fs.existsSync(f)) { try { root = nbt.parseUncompressed(fs.readFileSync(f)); } catch { return 0; } }
    root.value.servers ??= { type: 'list', value: { type: 'compound', value: [] } };
    const list = root.value.servers.value; if (list.type !== 'compound') { list.type = 'compound'; list.value = []; }
    const have = new Set(list.value.map(s => String(s.ip?.value || '').toLowerCase()));
    let n = 0;
    for (const fav of favs) { const ip = String(fav.ip || '').trim(); if (!ip || have.has(ip.toLowerCase())) continue; list.value.push({ name: { type: 'string', value: String(fav.name || ip).slice(0, 60) }, ip: { type: 'string', value: ip } }); have.add(ip.toLowerCase()); n++; }
    if (n) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(nbt.writeUncompressed(root))); }
    return n;
  }
  ipcMain.handle('servers:syncAll', () => { let n = 0, profiles = 0; for (const p of store.profiles) { if (running.has(p.id)) continue; const k = syncServers(p); n += k; if (k) profiles++; } return { added: n, profiles }; });
  wrapHandler('launch', async (orig, e, id, server) => { const p = profileById(id); if (p && store.settings.serversSync !== false && !running.has(p.id)) { try { syncServers(p); } catch (err) { logLauncher('WARNUNG', 'Serverliste: ' + err.message); } } return orig(e, id, server); });
};
