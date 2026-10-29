// Versions-Upgrade-Assistent und Mods zwischen Profilen übertragen – Mods werden für die Ziel-Version neu gesucht
const fs = require('fs'), fsp = require('fs/promises'), path = require('path');
const MR = 'https://api.modrinth.com/v2';
module.exports = function upgrade(ctx) {
  const { ipcMain, getJson, pool, sha1, pickVersion, modrinthVersions, installModrinthVersion, ensureFabricApi, newProfileFrom, neoforgeVersions, instanceDir, profileById, store, saveStore, send, tmSnapshotQuiet, withTimeout, running, manifest } = ctx;

  async function loaderVersionFor(loader, mc) {
    if (!loader) return '';
    if (loader === 'fabric') return (await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}`))[0]?.loader.version || '';
    if (loader === 'forge') { const pr = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos; return pr[`${mc}-recommended`] || pr[`${mc}-latest`] || ''; }
    if (loader === 'neoforge') return (await neoforgeVersions(mc))[0] || '';
    return '';
  }
  /** Mods eines Profils erkennen: Datei → Modrinth-Projekt */
  async function identify(p, only) {
    const dir = path.join(instanceDir(p), 'mods'); let files = [];
    try { files = (await fsp.readdir(dir)).filter(f => /\.jar(\.disabled)?$/i.test(f) && !/^LellekHUD/i.test(f) && !/^fabric-api/i.test(f)); } catch {}
    if (only) files = files.filter(f => only.includes(f));
    const hashes = {}; for (const f of files) { try { hashes[await sha1(path.join(dir, f))] = f; } catch {} }
    let known = {};
    if (Object.keys(hashes).length) { try { const r = await fetch(`${MR}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'LellekClient' }, body: JSON.stringify({ hashes: Object.keys(hashes), algorithm: 'sha1' }), signal: withTimeout(20000) }); if (r.ok) known = await r.json(); } catch {} }
    const pids = [...new Set(Object.values(known).map(v => v.project_id))]; let titles = {};
    if (pids.length) { try { for (const x of await getJson(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(pids))}`)) titles[x.id] = x.title; } catch {} }
    return Object.entries(hashes).map(([h, f]) => ({ file: f, disabled: f.endsWith('.disabled'), projectId: known[h]?.project_id || null, title: titles[known[h]?.project_id] || f.replace(/\.jar(\.disabled)?$/i, '') }));
  }
  async function resolve(items, target) {
    await pool(items.filter(i => i.projectId), 6, async (it) => {
      try { const v = pickVersion(await modrinthVersions(it.projectId, target, 'mods')); it.version = v || null; it.status = v ? 'ok' : 'missing'; it.newVersion = v?.version_number || null; } catch { it.status = 'missing'; }
    });
    for (const it of items) if (!it.projectId) it.status = 'manual';
    return items;
  }
  const strip = (items) => items.map(({ version, ...x }) => x);

  ipcMain.handle('upgrade:targets', async (_e, id) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    const m = await manifest(); const rel = (m.versions || []).filter(v => v.type === 'release').map(v => v.id);
    const i = rel.indexOf(p.version); return { current: p.version, newer: (i > 0 ? rel.slice(0, i) : rel.slice(0, 8)).slice(0, 12), latest: m.latest?.release };
  });
  ipcMain.handle('upgrade:plan', async (_e, { id, version }) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    const target = { ...p, version };
    const [lv, items] = await Promise.all([loaderVersionFor(p.loader, version).catch(() => ''), identify(p)]);
    await resolve(items, target);
    return { from: p.version, to: version, loader: p.loader || '', loaderVersion: lv, loaderMissing: !!p.loader && !lv, items: strip(items),
      ok: items.filter(i => i.status === 'ok').length, missing: items.filter(i => i.status === 'missing').length, manual: items.filter(i => i.status === 'manual').length };
  });
  ipcMain.handle('upgrade:run', async (_e, { id, version, name, copyWorlds }) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    if (running.has(p.id)) throw new Error('Bitte erst Minecraft beenden');
    const lv = await loaderVersionFor(p.loader, version);
    if (p.loader && !lv) throw new Error(`${p.loader} gibt es für ${version} noch nicht`);
    send('launch:progress', { task: 'Upgrade: Mods für ' + version + ' suchen', percent: 0.1 });
    const items = await resolve(await identify(p), { ...p, version });
    const n = await newProfileFrom(String(name || `${p.name} ${version}`).slice(0, 40), version, p.loader || '', lv);
    for (const k of ['memory', 'jvmArgs', 'icon', 'color', 'width', 'height', 'fullscreen', 'accountId', 'autoServer']) if (p[k] !== undefined) n[k] = p[k];
    const src = instanceDir(p), dst = instanceDir(n);
    const copy = async (rel) => { const a = path.join(src, rel); if (fs.existsSync(a)) await fsp.cp(a, path.join(dst, rel), { recursive: true, force: true }).catch(() => {}); };
    for (const rel of ['config', 'resourcepacks', 'shaderpacks', 'options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']) await copy(rel);
    if (copyWorlds) await copy('saves');
    if (n.loader === 'fabric') await ensureFabricApi(n).catch(() => {});
    let done = 0; const failed = [];
    for (const it of items.filter(i => i.status === 'ok')) {
      send('launch:progress', { task: `Upgrade: ${it.title}`, percent: 0.1 + 0.9 * (++done / Math.max(1, items.length)) });
      try { const files = await installModrinthVersion(n, 'mods', it.version, new Set()); if (it.disabled) for (const f of files.slice(-1)) await fsp.rename(path.join(dst, 'mods', f), path.join(dst, 'mods', f + '.disabled')).catch(() => {}); } catch (e) { failed.push(it.title); }
    }
    saveStore(); send('launch:progress', { task: 'Upgrade fertig', percent: 0 });
    return { id: n.id, name: n.name, profiles: store.profiles, installed: done - failed.length, missing: items.filter(i => i.status !== 'ok').map(i => i.title), failed };
  });

  ipcMain.handle('mods:transfer', async (_e, { from, to, files }) => {
    const a = profileById(from), b = profileById(to); if (!a || !b) throw new Error('Profil nicht gefunden');
    if (running.has(b.id)) throw new Error(`„${b.name}“ läuft gerade`);
    await tmSnapshotQuiet(b.id, `Vor Mods aus „${a.name}“`);
    const items = await resolve(await identify(a, files), b);
    if (b.loader === 'fabric') await ensureFabricApi(b).catch(() => {});
    const res = { ok: [], missing: [], copied: [] };
    for (const it of items) {
      if (it.status === 'ok') { try { await installModrinthVersion(b, 'mods', it.version, new Set()); res.ok.push(it.title); } catch { res.missing.push(it.title); } }
      else if (it.status === 'manual' && a.version === b.version && a.loader === b.loader) { await fsp.copyFile(path.join(instanceDir(a), 'mods', it.file), path.join(instanceDir(b), 'mods', it.file)).catch(() => {}); res.copied.push(it.title); }
      else res.missing.push(it.title);
    }
    saveStore(); return res;
  });
  ipcMain.handle('mods:identify', async (_e, id) => { const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden'); return strip(await identify(p)); });
};
