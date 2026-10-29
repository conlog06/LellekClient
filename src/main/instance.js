// Instanz-Seiten 3.0: Übersicht, Banner, Logs, Grafik-Presets, Einstellungen übertragen, Resourcepacks
const fs = require('fs'), fsp = require('fs/promises'), path = require('path');
module.exports = function instance(ctx) {
  const { ipcMain, dialog, store, saveStore, profileById, instanceDir, DATA_DIR, running, mcMinor, tmSnapshotQuiet, handlers } = ctx;
  const BANNERS = path.join(DATA_DIR, 'banners');
  const count = async (d, re) => { try { return (await fsp.readdir(d)).filter(f => re.test(f)).length; } catch { return 0; } };
  const modern = (p) => mcMinor(p.version) >= 13;

  // ---------- Übersicht ----------
  ipcMain.handle('instance:overview', async (_e, id) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    const dir = instanceDir(p);
    const [mods, modsOff, rps, shaders, shots] = await Promise.all([count(path.join(dir, 'mods'), /\.jar$/i), count(path.join(dir, 'mods'), /\.jar\.disabled$/i), count(path.join(dir, 'resourcepacks'), /\.zip$|^[^.]+$/i), count(path.join(dir, 'shaderpacks'), /\.zip$/i), count(path.join(dir, 'screenshots'), /\.png$/i)]);
    let worlds = 0; try { worlds = (await fsp.readdir(path.join(dir, 'saves'), { withFileTypes: true })).filter(e => e.isDirectory()).length; } catch {}
    const sessions = (store.sessions || []).filter(s => s.profileId === p.id);
    let disk = null; try { disk = await handlers['disk:profile'](null, p.id); } catch {}
    return { profile: p, running: running.has(p.id), counts: { mods, modsOff, resourcepacks: rps, shaderpacks: shaders, worlds, screenshots: shots }, disk, banner: await bannerData(p),
      playtimeMs: p.playtimeMs || 0, lastPlayed: p.lastPlayed || 0, sessionCount: sessions.length, recent: sessions.slice(-6).reverse(),
      crashes: sessions.filter(s => s.code !== 0).length, servers: [...new Set(sessions.flatMap(s => s.servers || []))].slice(-5).reverse() };
  });
  async function bannerData(p) {
    const f = p.banner && path.join(BANNERS, path.basename(p.banner)); if (!f || !fs.existsSync(f)) return null;
    const ext = path.extname(f).slice(1).toLowerCase(); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + (await fsp.readFile(f)).toString('base64');
  }
  ipcMain.handle('instance:setBanner', async (_e, { id, screenshot, pick }) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    let src = null;
    if (screenshot) src = path.join(instanceDir(p), 'screenshots', path.basename(screenshot));
    else if (pick) { const r = await dialog.showOpenDialog(ctx.win, { properties: ['openFile'], filters: [{ name: 'Bild', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (r.canceled) return null; src = r.filePaths[0]; }
    if (!src || !fs.existsSync(src)) throw new Error('Bild nicht gefunden');
    if ((await fsp.stat(src)).size > 12e6) throw new Error('Bild ist größer als 12 MB');
    fs.mkdirSync(BANNERS, { recursive: true });
    for (const f of await fsp.readdir(BANNERS)) if (f.startsWith(p.id + '.')) await fsp.rm(path.join(BANNERS, f), { force: true });
    const name = p.id + path.extname(src).toLowerCase(); await fsp.copyFile(src, path.join(BANNERS, name));
    p.banner = name; saveStore(); return bannerData(p);
  });
  ipcMain.handle('instance:clearBanner', async (_e, id) => { const p = profileById(id); if (p?.banner) { await fsp.rm(path.join(BANNERS, path.basename(p.banner)), { force: true }); delete p.banner; saveStore(); } return true; });

  // ---------- Logs ----------
  ipcMain.handle('instance:log', async (_e, id) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    const L = path.join(DATA_DIR, 'logs'), pre = p.name.replace(/[^\w\- ]/g, '') + '_';
    let files = []; try { files = (await fsp.readdir(L)).filter(f => f.startsWith(pre) && f.endsWith('.log')).sort().reverse(); } catch {}
    let text = ''; if (files[0]) { const buf = await fsp.readFile(path.join(L, files[0]), 'utf8'); text = buf.slice(-250000); }
    let crashes = []; try { const cr = path.join(instanceDir(p), 'crash-reports'); crashes = (await fsp.readdir(cr)).filter(f => f.endsWith('.txt')).sort().reverse().slice(0, 5); } catch {}
    return { file: files[0] || null, files: files.slice(0, 10), text, crashes };
  });

  // ---------- options.txt ----------
  const optFile = (p) => path.join(instanceDir(p), 'options.txt');
  function readOpts(p) { const o = new Map(); try { for (const line of fs.readFileSync(optFile(p), 'utf8').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) o.set(line.slice(0, i), line.slice(i + 1)); } } catch {} return o; }
  function writeOpts(p, o) { fs.mkdirSync(instanceDir(p), { recursive: true }); fs.writeFileSync(optFile(p), [...o].map(([k, v]) => `${k}:${v}`).join('\n') + '\n'); }
  const GFX = {
    leistung: { renderDistance: 8, simulationDistance: 6, graphicsMode: 0, fancyGraphics: 'false', particles: 2, ao: 'off', renderClouds: '"false"', entityShadows: 'false', biomeBlendRadius: 0, mipmapLevels: 0, enableVsync: 'false', maxFps: 260, entityDistanceScaling: 0.75 },
    ausgewogen: { renderDistance: 12, simulationDistance: 8, graphicsMode: 1, fancyGraphics: 'true', particles: 1, ao: 'on', renderClouds: '"fast"', entityShadows: 'true', biomeBlendRadius: 2, mipmapLevels: 2, enableVsync: 'false', maxFps: 144, entityDistanceScaling: 1.0 },
    schoen: { renderDistance: 18, simulationDistance: 10, graphicsMode: 1, fancyGraphics: 'true', particles: 0, ao: 'on', renderClouds: '"true"', entityShadows: 'true', biomeBlendRadius: 5, mipmapLevels: 4, enableVsync: 'true', maxFps: 260, entityDistanceScaling: 1.25 },
  };
  ipcMain.handle('gfx:apply', async (_e, { id, preset }) => {
    const p = profileById(id); const g = GFX[preset]; if (!p || !g) throw new Error('Unbekannt');
    if (running.has(p.id)) throw new Error('Bitte erst Minecraft beenden – das Spiel überschreibt die Einstellungen sonst beim Schließen');
    await tmSnapshotQuiet(p.id, 'Vor dem Grafik-Preset');
    const o = readOpts(p), minor = mcMinor(p.version), old = minor <= 12;
    for (const [k, v] of Object.entries(g)) {
      if (k === 'simulationDistance' && minor < 18) continue;
      if (k === 'graphicsMode' && old) continue;
      if (k === 'fancyGraphics' && !old) continue;
      if (k === 'entityDistanceScaling' && minor < 16) continue;
      if (k === 'ao') { o.set('ao', minor >= 19 ? (v === 'on' ? 'true' : 'false') : (v === 'on' ? '2' : '0')); continue; }
      if (k === 'renderClouds') { o.set('renderClouds', old ? String(v).replace(/"/g, '') : v); continue; }
      o.set(k, String(v));
    }
    writeOpts(p, o); return true;
  });
  const PARTS = {
    keys: (k) => k.startsWith('key_'),
    video: (k) => /^(renderDistance|simulationDistance|graphicsMode|fancyGraphics|particles|ao|renderClouds|entityShadows|biomeBlendRadius|mipmapLevels|enableVsync|maxFps|fov|gamma|guiScale|fullscreen|bobView|attackIndicator|entityDistanceScaling|fovEffectScale|screenEffectScale|darknessEffectScale|glintSpeed|glintStrength|prioritizeChunkUpdates|chunkUpdateThreads|useVbo|anaglyph3d)$/.test(k),
    sound: (k) => k.startsWith('soundCategory_') || /^(soundDevice|showSubtitles|directionalAudio)$/.test(k),
    other: (k) => /^(lang|chatVisibility|chatColors|chatLinks|chatOpacity|chatScale|chatWidth|chatHeightFocused|chatHeightUnfocused|chatLineSpacing|textBackgroundOpacity|mouseSensitivity|invertYMouse|autoJump|toggleCrouch|toggleSprint|rawMouseInput|discrete_mouse_scroll|mouseWheelSensitivity|narrator|hideServerAddress|advancedItemTooltips|heldItemTooltips|skipMultiplayerWarning|tutorialStep|onboardAccessibility)$/.test(k),
  };
  ipcMain.handle('opts:transfer', async (_e, { from, to, parts }) => {
    const a = profileById(from); if (!a) throw new Error('Quelle nicht gefunden');
    const src = readOpts(a); if (!src.size) throw new Error(`„${a.name}“ hat noch keine Spiel-Einstellungen – einmal starten`);
    const out = [];
    for (const id of to) {
      const b = profileById(id); if (!b || b.id === a.id) continue;
      if (running.has(b.id)) { out.push({ name: b.name, ok: false, error: 'läuft gerade' }); continue; }
      await tmSnapshotQuiet(b.id, `Vor Einstellungen von „${a.name}“`);
      const o = readOpts(b); let n = 0, skippedKeys = false;
      const keyFormatA = [...src].some(([k, v]) => k.startsWith('key_') && /^key\./.test(v)), keyFormatB = modern(b);
      for (const [k, v] of src) {
        const part = Object.keys(PARTS).find(x => PARTS[x](k)); if (!part || !parts.includes(part)) continue;
        if (part === 'keys' && keyFormatA !== keyFormatB) { skippedKeys = true; continue; } // 1.8.9-Tastencodes passen nicht zu modernen Versionen
        o.set(k, v); n++;
      }
      writeOpts(b, o);
      if (parts.includes('video')) for (const f of ['optionsof.txt', 'optionsshaders.txt']) { const s = path.join(instanceDir(a), f); if (fs.existsSync(s) && mcMinor(a.version) === mcMinor(b.version)) await fsp.copyFile(s, path.join(instanceDir(b), f)); }
      out.push({ name: b.name, ok: true, count: n, skippedKeys });
    }
    return out;
  });

  // ---------- Resourcepacks aktivieren & sortieren ----------
  ipcMain.handle('rp:list', async (_e, id) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    const dir = path.join(instanceDir(p), 'resourcepacks'); let files = []; try { files = (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory() || /\.zip$/i.test(e.name)).map(e => e.name); } catch {}
    const o = readOpts(p); let enabled = []; try { enabled = JSON.parse(o.get('resourcePacks') || '[]'); } catch {}
    const old = mcMinor(p.version) <= 12;
    // anzeigen: oben = höchste Priorität
    const active = (old ? enabled : [...enabled].reverse()).filter(x => old || x.startsWith('file/')).map(x => old ? x : x.slice(5)).filter(f => files.includes(f));
    const AdmZip = require('adm-zip');
    const info = (f) => { try { const full = path.join(dir, f); let icon = null, desc = ''; if (fs.statSync(full).isDirectory()) { const pi = path.join(full, 'pack.png'); if (fs.existsSync(pi)) icon = 'data:image/png;base64,' + fs.readFileSync(pi).toString('base64'); try { desc = JSON.parse(fs.readFileSync(path.join(full, 'pack.mcmeta'), 'utf8')).pack?.description; } catch {} } else { const z = new AdmZip(full); const png = z.getEntry('pack.png'); if (png) icon = 'data:image/png;base64,' + png.getData().toString('base64'); const m = z.getEntry('pack.mcmeta'); if (m) desc = JSON.parse(z.readAsText(m).replace(/^﻿/, '')).pack?.description; } if (typeof desc !== 'string') desc = Array.isArray(desc) ? desc.map(x => x.text || x).join('') : desc?.text || ''; return { icon, desc: String(desc).replace(/§./g, '').slice(0, 120) }; } catch { return { icon: null, desc: '' }; } };
    return { active: active.map(f => ({ file: f, ...info(f) })), available: files.filter(f => !active.includes(f)).map(f => ({ file: f, ...info(f) })), running: running.has(p.id) };
  });
  ipcMain.handle('rp:save', async (_e, { id, active }) => {
    const p = profileById(id); if (!p) throw new Error('Profil nicht gefunden');
    if (running.has(p.id)) throw new Error('Bitte erst Minecraft beenden');
    const o = readOpts(p), old = mcMinor(p.version) <= 12;
    let cur = []; try { cur = JSON.parse(o.get('resourcePacks') || '[]'); } catch {}
    const builtin = old ? [] : cur.filter(x => !x.startsWith('file/'));
    if (!old && !builtin.includes('vanilla')) builtin.unshift('vanilla');
    const list = old ? active.map(f => path.basename(f)) : [...builtin, ...[...active].reverse().map(f => 'file/' + path.basename(f))];
    o.set('resourcePacks', JSON.stringify(list));
    if (o.has('incompatibleResourcePacks')) { try { const inc = JSON.parse(o.get('incompatibleResourcePacks')).filter(x => list.includes(x)); o.set('incompatibleResourcePacks', JSON.stringify(inc)); } catch {} }
    writeOpts(p, o); return true;
  });
  ctx.readOpts = readOpts; ctx.writeOpts = writeOpts;
};
