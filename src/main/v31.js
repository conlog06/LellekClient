// LellekClient 3.1 – Startzeit, Live-RAM, Taskleisten-Schnellstart, Merkliste, Screenshot-Sofortaktion, Mod-Detektiv
const fs = require('fs'), fsp = require('fs/promises'), path = require('path'), os = require('os');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
module.exports = function v31(ctx) {
  const { app, ipcMain, clipboard, store, saveStore, send, profileById, instanceDir, running, wrapHandler, logLauncher, notify, handlers } = ctx;

  // ---------- Startzeit ----------
  ipcMain.handle('launch:stats', (_e, id) => { const p = profileById(id); if (!p) return null; return { last: p.lastLaunch || null, history: p.launchHistory || [] }; });

  // ---------- Live-Arbeitsspeicher von Minecraft ----------
  function rssOf(pid) {
    return new Promise((resolve) => {
      if (process.platform === 'linux') { try { const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return resolve(m ? Number(m[1]) * 1024 : null); } catch { return resolve(null); } }
      if (process.platform === 'win32') return execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, out) => { if (err) return resolve(null); const f = String(out).trim().split('","'); const k = Number((f[4] || '').replace(/[^\d]/g, '')); resolve(k ? k * 1024 : null); });
      execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 4000 }, (err, out) => resolve(err ? null : Number(String(out).trim()) * 1024 || null));
    });
  }
  const usage = {};
  setInterval(async () => {
    if (!running.size) return;
    for (const [id, proc] of running) {
      if (!proc?.pid) continue; const rss = await rssOf(proc.pid); if (!rss) continue;
      const p = profileById(id); const u = usage[id] ??= { peak: 0 }; u.rss = rss; u.peak = Math.max(u.peak, rss); u.max = (p?.memory || store.settings.memory || 4) * 1073741824;
      send('perf:usage', { profileId: id, rss, peak: u.peak, max: u.max });
    }
  }, 5000).unref?.();
  ipcMain.handle('perf:usage', () => usage);

  // ---------- Taskleisten-Schnellstart (Windows-Sprungliste) ----------
  function updateJumpList() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    try {
      const recent = [...store.profiles].filter(p => p.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
      app.setUserTasks(recent.map(p => ({ program: process.execPath, arguments: `--launch=${p.id}`, title: `${p.name} starten`, description: `${p.version} ${p.loader || 'Vanilla'}`, iconPath: process.execPath, iconIndex: 0 })));
    } catch (e) { logLauncher('INFO', 'Sprungliste: ' + e.message); }
  }
  app.whenReady?.().then(() => setTimeout(updateJumpList, 3000));

  // ---------- Merkliste (Entdecken) ----------
  ipcMain.handle('watch:list', () => store.watchlist || []);
  ipcMain.handle('watch:toggle', (_e, it) => {
    store.watchlist ??= []; const i = store.watchlist.findIndex(x => x.id === it.id);
    if (i >= 0) store.watchlist.splice(i, 1); else store.watchlist.unshift({ id: String(it.id), title: String(it.title || '').slice(0, 80), icon: String(it.icon || '').slice(0, 400), kind: it.kind || 'mods', author: String(it.author || '').slice(0, 60), at: Date.now() });
    store.watchlist = store.watchlist.slice(0, 200); saveStore(); return store.watchlist;
  });

  // ---------- Screenshot-Sofortaktion ----------
  const watchers = new Map();
  function watchShots(p) {
    if (watchers.has(p.id) || store.settings.shotNotify === false) return;
    const dir = path.join(instanceDir(p), 'screenshots'); try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const seen = new Set(); try { for (const f of fs.readdirSync(dir)) seen.add(f); } catch {}
    let w; try { w = fs.watch(dir, (_ev, f) => {
      if (!f || !/\.png$/i.test(f) || seen.has(f)) return; seen.add(f);
      setTimeout(async () => { // warten bis die Datei fertig geschrieben ist
        const file = path.join(dir, f); try { if (!(await fsp.stat(file)).size) return; } catch { return; }
        let copied = false;
        if (store.settings.shotAutoCopy) { try { const { nativeImage } = require('electron'); clipboard.writeImage(nativeImage.createFromPath(file)); copied = true; } catch {} }
        send('shot:new', { profileId: p.id, file: f, copied });
      }, 700);
    }); } catch { return; }
    watchers.set(p.id, w);
  }
  function unwatchShots(id) { try { watchers.get(id)?.close(); } catch {} watchers.delete(id); }

  wrapHandler('launch', async (orig, e, id, server) => {
    const r = await orig(e, id, server); const p = profileById(id);
    if (p && running.has(id)) { watchShots(p); updateJumpList(); }
    return r;
  });
  setInterval(() => { for (const id of [...watchers.keys()]) if (!running.has(id)) unwatchShots(id); for (const id of Object.keys(usage)) if (!running.has(id)) delete usage[id]; }, 4000).unref?.();

  // ---------- Mod-Detektiv: fehlerhafte Mod per Halbierung finden ----------
  function modMeta(file) {
    const out = { ids: [], deps: [] };
    try {
      const z = new AdmZip(file);
      const fj = z.getEntry('fabric.mod.json') || z.getEntry('quilt.mod.json');
      if (fj) {
        const j = JSON.parse(fj.getData().toString('utf8').replace(/^﻿/, ''));
        const q = j.quilt_loader; const id = q?.id || j.id; if (id) out.ids.push(id);
        for (const pv of (j.provides || q?.provides || [])) out.ids.push(typeof pv === 'string' ? pv : pv.id);
        const deps = q ? (q.depends || []).map(d => typeof d === 'string' ? d : d.id) : Object.keys(j.depends || {});
        out.deps = deps.filter(Boolean);
        for (const n of (j.jars || [])) { try { const e = z.getEntry(String(n.file || '')); if (!e) continue; const iz = new AdmZip(e.getData()); const ij = iz.getEntry('fabric.mod.json'); if (ij) { const x = JSON.parse(ij.getData().toString('utf8').replace(/^\uFEFF/, '')); if (x.id) out.ids.push(x.id); for (const pv of (x.provides || [])) out.ids.push(typeof pv === 'string' ? pv : pv.id); } } catch {} } // mitgelieferte Bibliotheken
        return out;
      }
      const toml = z.getEntry('META-INF/neoforge.mods.toml') || z.getEntry('META-INF/mods.toml');
      if (toml) {
        const t = toml.getData().toString('utf8');
        for (const m of t.matchAll(/^\s*modId\s*=\s*"([^"]+)"/gm)) out.ids.push(m[1]);
        const blocks = t.split(/\[\[dependencies\.[^\]]+\]\]/).slice(1);
        for (const b of blocks) { const id = /modId\s*=\s*"([^"]+)"/.exec(b)?.[1]; const req = /mandatory\s*=\s*true/.test(b) || /type\s*=\s*"required"/i.test(b); if (id && req) out.deps.push(id); }
        out.ids = [...new Set(out.ids)];
        return out;
      }
      const mc = z.getEntry('mcmod.info');
      if (mc) { try { const j = JSON.parse(mc.getData().toString('utf8')); const list = Array.isArray(j) ? j : j.modList || []; for (const m of list) { if (m.modid) out.ids.push(m.modid); for (const d of (m.requiredMods || m.dependencies || [])) out.deps.push(String(d).replace(/@.*/, '')); } } catch {} }
    } catch {}
    return out;
  }
  const BASE_IDS = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'forge', 'neoforge', 'fml', 'mcp']);
  const isProtected = (f) => /^(fabric-api|LellekHUD|quilted-fabric-api|qsl)/i.test(f);
  /** Alle Dateien, die (auch indirekt) von den gegebenen Dateien abhängen, damit nichts wegen fehlender Abhängigkeit abstürzt */
  function closure(files, meta) {
    const off = new Set(files); let changed = true;
    while (changed) {
      changed = false; const offIds = new Set([...off].flatMap(f => meta[f]?.ids || []));
      for (const [f, m] of Object.entries(meta)) if (!off.has(f) && m.deps.some(d => !BASE_IDS.has(d) && offIds.has(d))) { off.add(f); changed = true; }
    }
    return [...off];
  }
  async function setEnabled(p, files, on) {
    const dir = path.join(instanceDir(p), 'mods');
    for (const f of files) { const a = path.join(dir, f), b = a + '.disabled'; try { if (on && fs.existsSync(b)) await fsp.rename(b, a); if (!on && fs.existsSync(a)) await fsp.rename(a, b); } catch {} }
  }
  function nextStep(p) {
    const B = p.bisect; const meta = B.meta; const S = B.suspects;
    if (S.length <= 1) return finish(p, S);
    const half = S.slice(0, Math.ceil(S.length / 2)); let D = closure(half, meta).filter(f => B.all.includes(f));
    if (D.filter(f => S.includes(f)).length >= S.length) { const other = S.slice(Math.ceil(S.length / 2)); D = closure(other, meta).filter(f => B.all.includes(f)); }
    if (D.filter(f => S.includes(f)).length >= S.length) return finish(p, S); // lässt sich nicht weiter trennen (gegenseitige Abhängigkeiten)
    B.off = D; B.step++;
    return B;
  }
  function finish(p, culprits) { p.bisect.done = true; p.bisect.culprits = culprits; p.bisect.off = []; return p.bisect; }
  const publicState = (p) => { const B = p.bisect; if (!B) return null; return { step: B.step, total: B.all.length, suspects: B.suspects.length, off: B.off.length, done: !!B.done, culprits: B.culprits || [], estimate: Math.max(0, Math.ceil(Math.log2(Math.max(1, B.suspects.length)))) }; };

  ipcMain.handle('bisect:status', (_e, id) => { const p = profileById(id); return p ? publicState(p) : null; });
  ipcMain.handle('bisect:start', async (_e, id) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden'); if (!p.loader) throw new Error('Die Instanz hat keine Mods');
    if (running.has(id)) throw new Error('Bitte erst Minecraft beenden');
    const dir = path.join(instanceDir(p), 'mods'); let files = []; try { files = (await fsp.readdir(dir)).filter(f => /\.jar$/i.test(f)); } catch {}
    const all = files.filter(f => !isProtected(f)); if (all.length < 2) throw new Error('Zu wenige Mods für die Fehlersuche');
    try { await ctx.tmSnapshotQuiet?.(id, 'Vor dem Mod-Detektiv'); } catch {}
    const meta = {}; for (const f of all) meta[f] = modMeta(path.join(dir, f));
    p.bisect = { all, suspects: all.slice(), meta, off: [], step: 0, startedAt: Date.now() };
    nextStep(p); await setEnabled(p, p.bisect.off, false); saveStore();
    logLauncher('INFO', `Mod-Detektiv gestartet für ${p.name}: ${all.length} Mods`);
    return publicState(p);
  });
  ipcMain.handle('bisect:answer', async (_e, { id, broken }) => {
    const p = profileById(id); if (!p?.bisect || p.bisect.done) throw new Error('Keine laufende Fehlersuche');
    if (running.has(id)) throw new Error('Bitte erst Minecraft beenden');
    const B = p.bisect; const off = new Set(B.off);
    B.suspects = broken ? B.suspects.filter(f => !off.has(f)) : B.suspects.filter(f => off.has(f));
    await setEnabled(p, B.off, true); B.off = [];
    if (!B.suspects.length) finish(p, []); else nextStep(p);
    await setEnabled(p, B.off, false); saveStore();
    return publicState(p);
  });
  ipcMain.handle('bisect:stop', async (_e, { id, disableCulprits }) => {
    const p = profileById(id); if (!p?.bisect) return null;
    if (running.has(id)) throw new Error('Bitte erst Minecraft beenden');
    const B = p.bisect; await setEnabled(p, B.all, true);
    if (disableCulprits && B.culprits?.length) await setEnabled(p, B.culprits, false);
    const res = { culprits: B.culprits || [], disabled: !!disableCulprits }; delete p.bisect; saveStore(); return res;
  });

  // Testzugriff
  ctx.v31 = { modMeta, closure, rssOf, updateJumpList };
};
