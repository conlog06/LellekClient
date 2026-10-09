// LellekClient – Hauptprozess
// Verwaltet Versionen (Vanilla/Fabric/Forge), Java, Profile, Mods, Login und den Spielstart.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const extractZip = require('extract-zip');
const tar = require('tar');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');

// ---------- Pfade & Store ----------
const PORTABLE = (() => { try { const d = path.dirname(process.execPath); return fs.existsSync(path.join(d, 'portable.txt')) ? path.join(d, 'LellekClient-Daten') : null; } catch { return null; } })();
const DATA_DIR = PORTABLE || app.getPath('userData');
const ROOT = path.join(DATA_DIR, 'minecraft');      // gemeinsame Libraries/Assets/Versionen
const INSTANCES = path.join(DATA_DIR, 'instances'); // ein Spielordner pro Profil
const JAVA_DIR = path.join(DATA_DIR, 'java');
const STORE_FILE = path.join(DATA_DIR, 'lellek.json');
const CLIENT_NAME = 'LellekClient';
// Voreingestellter CurseForge-Key (kann in den Optionen überschrieben werden)
const DEFAULT_CF_KEY = '$2a$10$cS7B7K8MQOivIx44iqyc4O547xbpwaH/s6r3J.FJHjWgvr/E4A7Fe';
const CLIENT_VERSION = require('../package.json').version;

const handlers = {}; const _handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (ch, fn) => { handlers[ch] = fn; return _handle(ch, fn); };
const store = loadStore();
let win = null;
let currentAuth = null; // { mclc, profile, xbox }

function loadStore() {
  try {
    const st = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); st.settings ??= {}; if (!st.settings.curseforgeKey) st.settings.curseforgeKey = DEFAULT_CF_KEY;
    st.accounts ??= []; // Migration: alter Einzel-Token → Kontoliste
    if (st.refreshToken && !st.accounts.length) { st.accounts.push({ id: 'legacy', name: 'Konto', refreshToken: st.refreshToken }); st.currentAccount = 'legacy'; delete st.refreshToken; }
    return st;
  }
  catch { return { profiles: [], accounts: [], currentAccount: null, settings: { memory: 4, closeOnLaunch: false, curseforgeKey: DEFAULT_CF_KEY, spotifyClientId: '', cosmeticsServer: 'http://127.0.0.1:8765', voiceServer: 'http://127.0.0.1:8766', updateUrl: '' } }; }
}
// Speichern gebündelt (max. alle 400 ms) – blockiert den Launcher nicht bei vielen Änderungen hintereinander
let storeTimer = null;
function saveStoreNow() {
  clearTimeout(storeTimer); storeTimer = null;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = STORE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, STORE_FILE); }
  catch { try { fs.writeFileSync(STORE_FILE, JSON.stringify(store)); } catch {} }
}
function saveStore() { if (!storeTimer) storeTimer = setTimeout(saveStoreNow, 400); }
process.on('exit', () => { if (storeTimer) saveStoreNow(); });
function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

// ---------- Fenster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 980, minHeight: 640,
    backgroundColor: '#22262E',
    title: 'LellekClient',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(async () => {
  for (const d of [ROOT, INSTANCES, JAVA_DIR]) fs.mkdirSync(d, { recursive: true });
  createWindow();
  tryRestoreLogin();
});
app.on('window-all-closed', () => app.quit());

// ---------- HTTP-Helfer ----------
const withTimeout = (ms = 20000) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'LellekClient/0.1' }, signal: withTimeout() });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function download(url, dest, onProgress) {
  const r = await fetch(url, { signal: withTimeout(120000) });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status}): ${url}`);
  const total = Number(r.headers.get('content-length') || 0);
  let done = 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const reader = r.body.getReader();
  const out = fs.createWriteStream(dest);
  while (true) {
    const { value, done: end } = await reader.read();
    if (end) break;
    out.write(Buffer.from(value));
    done += value.length;
    if (onProgress && total) onProgress(done / total);
  }
  await new Promise((res) => out.end(res));
}

// ---------- Versionen ----------
let manifestCache = null;
async function manifest() {
  if (!manifestCache) manifestCache = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return manifestCache;
}
ipcMain.handle('versions:list', async () => {
  const m = await manifest();
  return { latest: m.latest, versions: m.versions.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })) };
});
ipcMain.handle('loaders:fabric', async (_e, mc) => {
  try { return (await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}`)).map(x => x.loader.version); }
  catch { return []; }
});
ipcMain.handle('loaders:forge', async (_e, mc) => {
  try {
    const p = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos;
    return [p[`${mc}-recommended`], p[`${mc}-latest`]].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  } catch { return []; }
});

// Version-JSON von Mojang (liefert u. a. die benötigte Java-Version)
async function versionJson(id) {
  const m = await manifest();
  const v = m.versions.find(x => x.id === id);
  if (!v) throw new Error(`Version ${id} nicht im Manifest gefunden`);
  return getJson(v.url);
}

// ---------- Java ----------
function javaBinary(dir) {
  const bin = process.platform === 'win32' ? 'bin/javaw.exe' : process.platform === 'darwin' ? 'Contents/Home/bin/java' : 'bin/java';
  return path.join(dir, bin);
}
/** Apple Silicon: Minecraft vor 1.19 hat nur Intel-Natives (LWJGL) → Intel-Java über Rosetta 2 */
function needsX64Java(mcVersion) { return process.platform === 'darwin' && process.arch === 'arm64' && mcMinor(String(mcVersion || '1.21')) < 19; }
async function ensureJava(major, log, forceX64 = false) {
  const osName = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  let arch = forceX64 ? 'x64' : (process.arch === 'arm64' ? 'aarch64' : 'x64');
  const dirFor = (a) => path.join(JAVA_DIR, a === 'x64' && process.arch === 'arm64' ? `jre-${major}-x64` : `jre-${major}`);
  let dir = dirFor(arch);
  if (fs.existsSync(javaBinary(dir))) return javaBinary(dir);
  if (arch === 'aarch64' && fs.existsSync(javaBinary(dirFor('x64')))) return javaBinary(dirFor('x64'));

  log(`Java ${major}${arch === 'x64' && process.arch === 'arm64' ? ' (Intel, über Rosetta)' : ''} wird heruntergeladen…`);
  let assets = await getJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=${osName}&architecture=${arch}&image_type=jre`);
  if (!assets.length && arch === 'aarch64') { arch = 'x64'; dir = dirFor('x64'); log(`Kein Java ${major} für ARM – nutze die Intel-Version über Rosetta`); assets = await getJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=${osName}&architecture=x64&image_type=jre`); }
  if (!assets.length) throw new Error(`Keine Java-${major}-Laufzeit für ${osName}/${arch} gefunden`);
  const bin = javaBinary(dir);
  const pkg = assets[0].binary.package;
  const archive = path.join(JAVA_DIR, pkg.name);
  await download(pkg.link, archive, (p) => send('launch:progress', { task: `Java ${major}`, percent: p }));

  const tmp = path.join(JAVA_DIR, `tmp-${major}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (pkg.name.endsWith('.zip')) await extractZip(archive, { dir: tmp });
  else await tar.x({ file: archive, cwd: tmp });
  const [inner] = await fsp.readdir(tmp);
  await fsp.rename(path.join(tmp, inner), dir);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.rm(archive, { force: true });
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  return bin;
}

// ---------- Fabric / Forge vorbereiten ----------
async function prepareFabric(mc, loader) {
  const id = `fabric-loader-${loader}-${mc}`;
  const file = path.join(ROOT, 'versions', id, `${id}.json`);
  if (!fs.existsSync(file)) {
    const json = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(json, null, 2));
  }
  return id;
}
async function prepareForge(mc, forge, log) {
  const dir = path.join(ROOT, 'forge');
  fs.mkdirSync(dir, { recursive: true });
  const base = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
  // Bis 1.12.2 braucht der Starter die Universal-Jar, ab 1.13 den Installer.
  const [, minor] = mc.split('.').map(Number);
  const kind = minor <= 12 ? 'universal' : 'installer';
  const dest = path.join(dir, `forge-${mc}-${forge}-${kind}.jar`);
  const installer = path.join(dir, `forge-${mc}-${forge}-installer.jar`);
  // Späte 1.12.2-Builds (ab 2851) nutzen das neue Installer-Format: ihre Universal-Jar hat keine version.json mehr
  const needsInstaller = (jar) => { try { return !new AdmZip(jar).getEntry('version.json'); } catch { return true; } };
  // Alte Versionen: immer erst die Universal-Jar prüfen – nur wenn sie keine version.json hat (späte 1.12.2-Builds), den Installer nehmen
  if (fs.existsSync(dest)) {
    if (kind === 'universal' && needsInstaller(dest)) { log('Universal-Jar ohne version.json – nutze Installer'); return prepareForgeInstaller(mc, forge, log, base, installer); }
    return dest;
  }
  log(`Forge ${forge} (${kind}) wird heruntergeladen…`);
  // Alte Versionen (1.7.10–1.8.9) tragen die MC-Version doppelt im Dateinamen
  const candidates = [
    `${base}/${mc}-${forge}/forge-${mc}-${forge}-${kind}.jar`,
    `${base}/${mc}-${forge}-${mc}/forge-${mc}-${forge}-${mc}-${kind}.jar`,
  ];
  for (const url of candidates) {
    try { await download(url, dest); break; } catch (e) { /* nächsten Kandidaten probieren */ }
  }
  if (!fs.existsSync(dest)) throw new Error(`Forge-${kind} für ${mc} ${forge} nicht gefunden`);
  if (kind === 'universal' && needsInstaller(dest)) { log('Universal-Jar ohne version.json – nutze Installer'); return prepareForgeInstaller(mc, forge, log, base, installer); }
  return dest;
}
async function prepareForgeInstaller(mc, forge, log, base, installer) {
  if (fs.existsSync(installer)) return installer;
  log(`Forge ${forge} (installer) wird heruntergeladen…`);
  for (const url of [`${base}/${mc}-${forge}/forge-${mc}-${forge}-installer.jar`, `${base}/${mc}-${forge}-${mc}/forge-${mc}-${forge}-${mc}-installer.jar`]) {
    try { await download(url, installer); return installer; } catch {}
  }
  throw new Error(`Forge-Installer für ${mc} ${forge} nicht gefunden`);
}

// ---------- Profile ----------
function newId() { return Math.random().toString(36).slice(2, 10); }
function instanceDir(profile) { return path.join(INSTANCES, profile.id); }

ipcMain.handle('profiles:list', () => store.profiles);
ipcMain.handle('profiles:save', (_e, p) => {
  if (!p.id) { p.id = newId(); store.profiles.push(p); } else { const i = store.profiles.findIndex(x => x.id === p.id); if (i >= 0) { p = { ...store.profiles[i], ...p }; store.profiles[i] = p; } else store.profiles.push(p); }
  for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'datapacks']) fs.mkdirSync(path.join(instanceDir(p), sub), { recursive: true });
  saveStore(); setTimeout(buildTray, 100);
  return store.profiles;
});
ipcMain.handle('profiles:delete', async (_e, id) => {
  store.profiles = store.profiles.filter(p => p.id !== id);
  saveStore();
  return store.profiles;
});
ipcMain.handle('profiles:openFolder', (_e, id) => {
  const p = store.profiles.find(x => x.id === id);
  if (p) shell.openPath(instanceDir(p));
});

// ---------- Mods / Shader / Resourcepacks / Datapacks ----------
const KINDS = { mods: 'mods', shaderpacks: 'shaderpacks', resourcepacks: 'resourcepacks', datapacks: 'datapacks' };
function kindDir(profileId, kind) {
  const p = store.profiles.find(x => x.id === profileId);
  if (!p || !KINDS[kind]) throw new Error('Ungültiges Profil oder Typ');
  const d = path.join(instanceDir(p), KINDS[kind]);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
ipcMain.handle('content:list', async (_e, { profileId, kind }) => {
  const d = kindDir(profileId, kind);
  const files = await fsp.readdir(d);
  return files.filter(f => !f.startsWith('.')).map(f => ({
    file: f,
    name: f.replace(/\.disabled$/, ''),
    enabled: !f.endsWith('.disabled'),
    size: fs.statSync(path.join(d, f)).size,
  })).sort((a, b) => a.name.localeCompare(b.name));
});
ipcMain.handle('content:toggle', async (_e, { profileId, kind, file }) => {
  const d = kindDir(profileId, kind);
  const target = file.endsWith('.disabled') ? file.slice(0, -9) : `${file}.disabled`;
  await fsp.rename(path.join(d, file), path.join(d, target));
});
ipcMain.handle('content:remove', async (_e, { profileId, kind, file }) => {
  await fsp.rm(path.join(kindDir(profileId, kind), file), { recursive: true, force: true });
});
ipcMain.handle('content:add', async (_e, { profileId, kind }) => {
  const d = kindDir(profileId, kind);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods & Packs', extensions: ['jar', 'zip'] }],
  });
  if (canceled) return 0;
  for (const f of filePaths) await fsp.copyFile(f, path.join(d, path.basename(f)));
  return filePaths.length;
});
ipcMain.handle('content:drop', async (_e, { profileId, kind, paths }) => { const d = kindDir(profileId, kind); let n = 0; for (const f of paths) { if (!/\.(jar|zip)$/i.test(f)) continue; await fsp.copyFile(f, path.join(d, path.basename(f))); n++; } return n; });
ipcMain.handle('content:openFolder', (_e, { profileId, kind }) => shell.openPath(kindDir(profileId, kind)));

// ---------- Login (Microsoft) – mehrere Konten ----------
async function finishLogin(xbox) {
  const mc = await xbox.getMinecraft();
  currentAuth = { mclc: mc.mclc(), xbox, profile: mc.profile };
  const acc = { id: mc.profile.id, name: mc.profile.name, refreshToken: xbox.msToken.refresh_token };
  store.accounts = store.accounts.filter(a => a.id !== acc.id && a.id !== 'legacy');
  store.accounts.push(acc);
  store.currentAccount = acc.id;
  saveStore();
  send('auth:changed', publicAccount());
  return publicAccount();
}
function publicAccount() {
  if (!currentAuth) return null;
  const { id, name, skins = [], capes = [] } = currentAuth.profile;
  return { id, name, skins, capes };
}
function accountList() { return store.accounts.map(a => ({ id: a.id, name: a.name, current: a.id === store.currentAccount })); }
async function loginWithToken(acc) {
  try { await finishLogin(await new Auth('select_account').refresh(acc.refreshToken)); return true; }
  catch { store.accounts = store.accounts.filter(a => a.id !== acc.id); if (store.currentAccount === acc.id) store.currentAccount = null; saveStore(); return false; }
}
async function tryRestoreLogin() {
  const acc = store.accounts.find(a => a.id === store.currentAccount);
  if (acc) await loginWithToken(acc);
}
ipcMain.handle('auth:login', async () => finishLogin(await new Auth('select_account').launch('electron')));
ipcMain.handle('auth:logout', () => {
  store.accounts = store.accounts.filter(a => a.id !== store.currentAccount);
  store.currentAccount = null; currentAuth = null; saveStore();
  send('auth:changed', null); return null;
});
ipcMain.handle('auth:current', () => publicAccount());
ipcMain.handle('auth:list', () => accountList());
ipcMain.handle('auth:switch', async (_e, id) => {
  const acc = store.accounts.find(a => a.id === id);
  if (!acc) throw new Error('Konto nicht gefunden');
  if (!(await loginWithToken(acc))) throw new Error('Sitzung abgelaufen – bitte das Konto neu anmelden');
  return publicAccount();
});
ipcMain.handle('auth:remove', (_e, id) => { store.accounts = store.accounts.filter(a => a.id !== id); if (store.currentAccount === id) { store.currentAccount = null; currentAuth = null; send('auth:changed', null); } saveStore(); return accountList(); });

/** MCLC-Auth für ein bestimmtes Konto – für Profile mit eigenem Konto, ohne das aktive zu wechseln */
async function authFor(accountId) {
  if (!accountId || accountId === store.currentAccount) { if (!currentAuth) throw new Error('Bitte zuerst mit deinem Microsoft-Konto einloggen'); return currentAuth.mclc; }
  const acc = store.accounts.find(a => a.id === accountId);
  if (!acc) throw new Error('Das Konto dieses Profils ist nicht mehr angemeldet');
  const xbox = await new Auth('select_account').refresh(acc.refreshToken);
  acc.refreshToken = xbox.msToken.refresh_token; saveStore();
  return (await xbox.getMinecraft()).mclc();
}

// ---------- Skins & Capes (offizielle Mojang-API) ----------
function mojangHeaders() {
  if (!currentAuth) throw new Error('Nicht eingeloggt');
  return { Authorization: `Bearer ${currentAuth.mclc.access_token}` };
}
ipcMain.handle('skin:upload', async (_e, variant) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Skin (PNG)', extensions: ['png'] }] });
  if (canceled) return null;
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([await fsp.readFile(filePaths[0])], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: mojangHeaders(), body: form });
  if (!r.ok) throw new Error(`Skin-Upload fehlgeschlagen (${r.status})`);
  currentAuth.profile = await r.json();
  skinCache.delete(currentAuth.profile.id);
  return publicAccount();
});
ipcMain.handle('cape:set', async (_e, capeId) => {
  const r = capeId
    ? await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', { method: 'PUT', headers: { ...mojangHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) })
    : await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', { method: 'DELETE', headers: mojangHeaders() });
  if (!r.ok) throw new Error(`Cape konnte nicht gesetzt werden (${r.status})`);
  currentAuth.profile = await r.json();
  skinCache.delete(currentAuth.profile.id);
  return publicAccount();
});

// Skin-Textur direkt von Mojang (Sessionserver → textures → PNG), mit Cache
const skinCache = new Map();
async function skinFor(uuid) {
  const hit = skinCache.get(uuid);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.value;
  let value = null;
  try {
    const prof = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`);
    const tex = JSON.parse(Buffer.from(prof.properties.find(p => p.name === 'textures').value, 'base64').toString('utf8')).textures;
    if (tex.SKIN?.url) {
      const r = await fetch(tex.SKIN.url);
      if (r.ok) value = { dataUrl: 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'), slim: tex.SKIN.metadata?.model === 'slim', cape: tex.CAPE?.url || null };
    }
  } catch {}
  if (!value && currentAuth?.profile?.id === uuid) { // Fallback: Profil-API
    const sk = currentAuth.profile.skins?.find(x => x.state === 'ACTIVE');
    if (sk?.url) { try { const r = await fetch(sk.url); if (r.ok) value = { dataUrl: 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'), slim: sk.variant === 'SLIM', cape: null }; } catch {} }
  }
  skinCache.set(uuid, { at: Date.now(), value });
  return value;
}
ipcMain.handle('skin:texture', async () => currentAuth ? (await skinFor(currentAuth.profile.id))?.dataUrl || null : null);
ipcMain.handle('skin:of', async (_e, uuid) => skinFor(uuid));
ipcMain.handle('skin:invalidate', (_e, uuid) => { skinCache.delete(uuid); });

// ---------- Vorlagen-Profile ----------
// LellekHUD-Downloads werden hier eingetragen, sobald die Mods gebaut sind (URL pro Ziel).
const HUD_DOWNLOADS = { '1.8.9-forge': null, '1.12.2-forge': null, 'fabric': null };
// Mitgelieferte HUD-Jars (assets/mods) – werden bei Vorlagen direkt kopiert
const HUD_BUNDLED = {
  '1.8.9-forge': path.join(__dirname, '..', 'assets', 'mods', 'LellekHUD-1.8.9.jar'),
  '1.12.2-forge': path.join(__dirname, '..', 'assets', 'mods', 'LellekHUD-1.12.2.jar'),
  'fabric': path.join(__dirname, '..', 'assets', 'mods', 'LellekHUD-26.2.jar'),
};
/** Passende HUD-Jar für ein Profil (null = keine für diese Version) */
function hudFor(p) {
  if (p.loader === 'forge' && p.version === '1.8.9') return HUD_BUNDLED['1.8.9-forge'];
  if (p.loader === 'forge' && p.version === '1.12.2') return HUD_BUNDLED['1.12.2-forge'];
  if (p.loader === 'fabric' && p.version === '26.2') return HUD_BUNDLED['fabric'];
  return null;
}
/** Version einer LellekHUD-Jar aus fabric.mod.json bzw. mcmod.info lesen */
function hudJarVersion(jar) {
  try {
    const z = new AdmZip(jar);
    const fm = z.getEntry('fabric.mod.json'); if (fm) return JSON.parse(z.readAsText(fm)).version || '0';
    const mi = z.getEntry('mcmod.info'); if (mi) return JSON.parse(z.readAsText(mi))[0]?.version || '0';
  } catch {}
  return '0';
}
const cmpVer = (a, b) => { const x = String(a).split(/[.-]/).map(n => parseInt(n) || 0), y = String(b).split(/[.-]/).map(n => parseInt(n) || 0); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
/** LellekHUD ins Profil legen – nur wenn dort keine oder eine ÄLTERE Version liegt. Neuere (selbst gebaute) bleiben unangetastet. */
async function ensureHud(p, log = () => {}) {
  const src = hudFor(p); if (!src || !fs.existsSync(src)) return false;
  const mods = path.join(instanceDir(p), 'mods'); fs.mkdirSync(mods, { recursive: true });
  const bundledVer = hudJarVersion(src);
  const existing = (await fsp.readdir(mods)).filter(f => /^LellekHUD-.*\.jar(\.disabled)?$/i.test(f));
  let best = null, bestVer = '0';
  for (const f of existing) { const v = hudJarVersion(path.join(mods, f)); if (cmpVer(v, bestVer) > 0) { best = f; bestVer = v; } }
  if (best && cmpVer(bestVer, bundledVer) >= 0) { // vorhandene ist gleich oder neuer → nur Duplikate aufräumen
    for (const f of existing) if (f !== best) { await fsp.rm(path.join(mods, f), { force: true }); log(`Doppelte HUD-Jar ${f} entfernt`); }
    return true;
  }
  for (const f of existing) { await fsp.rm(path.join(mods, f), { force: true }); log(`LellekHUD ${hudJarVersion(path.join(mods, f)) || '?'} (${f}) durch ${bundledVer} ersetzt`); }
  await fsp.copyFile(src, path.join(mods, path.basename(src)));
  log(`LellekHUD ${bundledVer} für ${p.version} installiert`);
  return true;
}
ipcMain.handle('presets:list', async () => {
  const m = await manifest();
  return [
    { key: '1.8.9-forge', name: 'Lellek PvP 1.8.9', version: '1.8.9', loader: 'forge', memory: 3, hint: 'Klassisches PvP, Forge, Java 8 automatisch' },
    { key: '1.12.2-forge', name: 'Lellek Mods 1.12.2', version: '1.12.2', loader: 'forge', memory: 4, hint: 'Die große Forge-Mod-Ära' },
    { key: 'fabric', name: 'Lellek 26.2', version: '26.2', loader: 'fabric', memory: 4, hint: 'Fabric mit Sodium, Iris & LellekHUD' },
  ];
});
ipcMain.handle('presets:create', async (_e, key) => {
  const m = await manifest();
  const all = {
    '1.8.9-forge': { name: 'Lellek PvP 1.8.9', version: '1.8.9', loader: 'forge', memory: 3 },
    '1.12.2-forge': { name: 'Lellek Mods 1.12.2', version: '1.12.2', loader: 'forge', memory: 4 },
    'fabric': { name: 'Lellek 26.2', version: '26.2', loader: 'fabric', memory: 4 },
  };
  const base = all[key];
  if (!base) throw new Error('Unbekannte Vorlage');
  let loaderVersion = '';
  if (base.loader === 'fabric') loaderVersion = (await getJson(`https://meta.fabricmc.net/v2/versions/loader/${base.version}`))[0]?.loader.version || '';
  if (base.loader === 'forge') loaderVersion = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos[`${base.version}-recommended`] || '';
  if (!loaderVersion) throw new Error(`Kein ${base.loader} für ${base.version} gefunden`);
  const p = { id: newId(), ...base, loaderVersion, javaPath: '', preset: key };
  store.profiles.push(p);
  for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'datapacks']) fs.mkdirSync(path.join(instanceDir(p), sub), { recursive: true });
  saveStore();
  await ensureFabricApi(p);
  let hudInstalled = false;
  try { hudInstalled = await ensureHud(p); } catch {}
  const hud = HUD_DOWNLOADS[key];
  if (!hudInstalled && hud) { try { await download(hud, path.join(instanceDir(p), 'mods', path.basename(hud))); hudInstalled = true; } catch {} }
  return { profiles: store.profiles, id: p.id, hudInstalled };
});

// ---------- Modrinth-Helfer: Release bevorzugen, Abhängigkeiten mitnehmen ----------
function pickVersion(versions) {
  return versions.find(v => v.version_type === 'release') || versions.find(v => v.version_type === 'beta') || versions[0] || null;
}
async function modrinthVersions(projectId, p, kind) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([p.version]) });
  if (kind === 'mods' && p.loader) q.set('loaders', JSON.stringify([p.loader]));
  return getJson(`https://api.modrinth.com/v2/project/${projectId}/version?${q}`);
}
/** Bei Versionen mit mehreren Jars (Forge/Fabric/NeoForge in einer) die zum Loader passende nehmen */
function pickFile(version, loader) {
  const files = version.files || []; if (files.length <= 1) return files[0];
  const others = { fabric: ['forge', 'neoforge', 'quilt'], forge: ['fabric', 'neoforge', 'quilt'], neoforge: ['fabric', 'forge', 'quilt'] }[loader] || [];
  const fits = files.filter(f => { const n = f.filename.toLowerCase(); return n.includes(loader) || !others.some(o => n.includes(o)); });
  return fits.find(f => f.filename.toLowerCase().includes(loader)) || fits.find(f => f.primary) || fits[0] || files.find(f => f.primary) || files[0];
}
/** Installiert eine Modrinth-Version samt required-Abhängigkeiten. Gibt die Dateinamen zurück. */
async function installModrinthVersion(p, kind, version, seen = new Set(), log = () => {}) {
  const out = [];
  if (!version || seen.has(version.project_id)) return out;
  seen.add(version.project_id);
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue;
    try {
      const dv = pickVersion(await modrinthVersions(dep.project_id, p, 'mods'));
      if (dv && !alreadyInstalled(p, dv)) out.push(...await installModrinthVersion(p, 'mods', dv, seen, log));
    } catch (e) { log(`Abhängigkeit ${dep.project_id} nicht installierbar: ${e.message}`); }
  }
  const file = kind === 'mods' ? pickFile(version, p.loader) : (version.files.find(f => f.primary) || version.files[0]);
  if (!file) return out;
  file.filename = path.basename(file.filename);
  await download(file.url, path.join(kindDir(p.id, kind), file.filename));
  p.installed ??= {};
  p.installed[version.project_id] = file.filename;
  out.push(file.filename);
  return out;
}
function alreadyInstalled(p, version) {
  const f = p.installed?.[version.project_id];
  return f && fs.existsSync(path.join(instanceDir(p), 'mods', f));
}
/** Fabric-Profile brauchen Fabric API – still nachinstallieren, wenn sie fehlt */
async function ensureFabricApi(p, log = () => {}) {
  if (p.loader !== 'fabric') return;
  const mods = path.join(instanceDir(p), 'mods');
  fs.mkdirSync(mods, { recursive: true });
  if ((await fsp.readdir(mods)).some(f => /^fabric-api/i.test(f))) return;
  try { const v = pickVersion(await modrinthVersions('fabric-api', p, 'mods')); if (v) { await installModrinthVersion(p, 'mods', v, new Set(), log); log('Fabric API installiert'); saveStore(); } }
  catch (e) { log('Fabric API konnte nicht geladen werden: ' + e.message); }
}

// ---------- Ausstattung (kuratierte Mod-Pakete pro Profil) ----------
function mcMinor(v) { const [a, b] = v.split('.').map(Number); return a >= 26 ? 99 : b; }
const BUNDLE_ITEMS = [
  { group: 'Karte & Waypoints', slug: 'xaeros-minimap', name: "Xaero's Minimap", kind: 'mods', desc: 'Minimap mit Waypoints', ok: () => true },
  { group: 'Karte & Waypoints', slug: 'xaeros-world-map', name: "Xaero's World Map", kind: 'mods', desc: 'Vollbild-Weltkarte', ok: () => true },
  { group: 'Voice-Chat', slug: 'simple-voice-chat', name: 'Simple Voice Chat', kind: 'mods', desc: 'Proximity-Voice, Server braucht die Mod ebenfalls', ok: (p) => mcMinor(p.version) >= 12 },
  { group: 'Performance', slug: 'sodium', name: 'Sodium', kind: 'mods', desc: 'Rendering-Ersatz, großer FPS-Gewinn', ok: (p) => p.loader === 'fabric' || p.loader === 'neoforge' },
  { group: 'Performance', slug: 'lithium', name: 'Lithium', kind: 'mods', desc: 'Schnellere Spiellogik', ok: (p) => p.loader === 'fabric' || p.loader === 'neoforge' },
  { group: 'Performance', slug: 'immediatelyfast', name: 'ImmediatelyFast', kind: 'mods', desc: 'Schnelleres HUD-/Text-Rendering', ok: (p) => p.loader === 'fabric' || p.loader === 'neoforge' },
  { group: 'Performance', slug: 'entityculling', name: 'Entity Culling', kind: 'mods', desc: 'Versteckte Entities werden nicht gerendert', ok: (p) => mcMinor(p.version) >= 16 },
  { group: 'Performance', slug: 'ferrite-core', name: 'FerriteCore', kind: 'mods', desc: 'Weniger RAM-Verbrauch', ok: (p) => mcMinor(p.version) >= 16 },
  { group: 'Performance', slug: 'modernfix', cfName: 'ModernFix', name: 'ModernFix', kind: 'mods', desc: 'Schnellerer Start, weniger Speicher (Forge/NeoForge)', ok: (p) => p.loader !== 'fabric' && mcMinor(p.version) >= 16 },
  { group: 'Performance', slug: 'modernfix-mvus', cfName: 'ModernFix-mVUS', name: 'ModernFix-mVUS', kind: 'mods', desc: 'Gepflegter ModernFix-Fork für Fabric', ok: (p) => p.loader === 'fabric' && mcMinor(p.version) >= 21 },
  { group: 'Performance', slug: 'betterfps', cfName: 'BetterFps', name: 'BetterFps', kind: 'mods', desc: 'Schnellere Mathe-Routinen (alte Versionen)', ok: (p) => p.loader === 'forge' && mcMinor(p.version) <= 12 },
  { group: 'Shader', slug: 'iris', name: 'Iris', kind: 'mods', desc: 'Shader-Loader für Fabric & NeoForge', ok: (p) => p.loader === 'fabric' || p.loader === 'neoforge' },
  { group: 'Shader', slug: 'oculus', name: 'Oculus', kind: 'mods', desc: 'Shader-Loader für Forge', ok: (p) => p.loader === 'forge' && mcMinor(p.version) >= 16 },
  { group: 'Shader', slug: 'complementary-reimagined', name: 'Complementary Reimagined', kind: 'shaderpacks', desc: 'Beliebtes Shaderpack', ok: (p) => mcMinor(p.version) >= 16 },
  { group: 'Social', slug: 'essential', cfName: 'Essential Mod', name: 'Essential Mod', kind: 'mods', desc: 'Freundesliste, Welten für Freunde hosten, Chat, Cosmetics – für alle Versionen', ok: () => true },
  { group: 'Shader', slug: 'optifine', name: 'OptiFine', kind: 'manual', desc: 'Performance + Shader für 1.8.9/1.12.2 – nur manuell von optifine.net erlaubt', url: 'https://optifine.net/downloads', ok: (p) => p.loader === 'forge' && mcMinor(p.version) <= 12 },
];
ipcMain.handle('bundle:list', (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId);
  if (!p) throw new Error('Profil nicht gefunden');
  const installed = p.installed || {};
  return BUNDLE_ITEMS.filter(i => i.ok(p)).map(({ ok, ...i }) => ({ ...i, installed: installed[i.slug] || null }));
});
ipcMain.handle('bundle:install', async (_e, { profileId, slugs }) => {
  const p = store.profiles.find(x => x.id === profileId);
  if (!p) throw new Error('Profil nicht gefunden');
  p.installed ??= {};
  const results = [];
  await ensureFabricApi(p);
  for (const slug of slugs) {
    const item = BUNDLE_ITEMS.find(i => i.slug === slug);
    if (!item || item.kind === 'manual') continue;
    try {
      let version = null;
      try { version = pickVersion(await modrinthVersions(slug, p, item.kind)); } catch {}
      if (version) {
        const files = await installModrinthVersion(p, item.kind, version, new Set());
        p.installed[slug] = files[files.length - 1];
        results.push({ slug, ok: true, file: files.join(', ') });
        continue;
      }
      const file = await curseforgeFile(item.cfName || item.name, p, item.kind); // Fallback: CurseForge
      if (!file) throw new Error('nicht verfügbar für diese Version');
      await download(file.url, path.join(kindDir(profileId, item.kind), file.name));
      p.installed[slug] = file.name;
      results.push({ slug, ok: true, file: file.name });
    } catch (e) { results.push({ slug, ok: false, error: e.message }); }
  }
  saveStore();
  return results;
});
ipcMain.handle('bundle:open', (_e, url) => shell.openExternal(url));
async function curseforgeFile(name, p, kind) {
  if (!store.settings.curseforgeKey) return null;
  const params = new URLSearchParams({ gameId: 432, classId: CF_CLASS[kind], gameVersion: p.version, searchFilter: name, pageSize: 10 });
  if (kind === 'mods' && CF_LOADER[p.loader]) params.set('modLoaderType', CF_LOADER[p.loader]);
  const r = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, { headers: cfHeaders() });
  if (!r.ok) return null;
  const mods = (await r.json()).data;
  const mod = mods.find(m => m.name.toLowerCase() === name.toLowerCase()) || mods.find(m => m.name.toLowerCase().includes(name.toLowerCase()));
  if (!mod) return null;
  const fp = new URLSearchParams({ gameVersion: p.version, pageSize: 50 });
  if (kind === 'mods' && CF_LOADER[p.loader]) fp.set('modLoaderType', CF_LOADER[p.loader]);
  const fr = await fetch(`https://api.curseforge.com/v1/mods/${mod.id}/files?${fp}`, { headers: cfHeaders() });
  if (!fr.ok) return null;
  const others = { fabric: ['forge', 'neoforge'], forge: ['fabric', 'neoforge'], neoforge: ['fabric'] }[p.loader] || [];
  const file = (await fr.json()).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate)).find(f => !others.some(o => f.fileName.toLowerCase().includes(o)) || f.fileName.toLowerCase().includes(p.loader));
  if (!file?.downloadUrl) return null;
  return { url: file.downloadUrl, name: file.fileName };
}

// ---------- Spotify (PKCE, kein Client-Secret nötig) ----------
const SPOTIFY_REDIRECT = 'http://127.0.0.1:8737/callback';
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
const crypto = require('crypto');
const http = require('http');
ipcMain.handle('spotify:status', () => store.spotify ? { connected: true } : { connected: false });
ipcMain.handle('spotify:logout', () => { store.spotify = null; saveStore(); return { connected: false }; });
ipcMain.handle('spotify:login', async (_e, clientIdFromForm) => {
  const clientId = (clientIdFromForm || store.settings.spotifyClientId || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(clientId)) throw new Error('Bitte zuerst die 32-stellige Spotify-Client-ID in das Feld darüber eintragen');
  store.settings.spotifyClientId = clientId; saveStore();
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1:8737');
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { res.end('<h2>Spotify-Login fehlgeschlagen</h2>'); reject(new Error('Login abgebrochen')); }
      else { res.end('<h2 style="font-family:sans-serif">LellekClient ist mit Spotify verbunden – du kannst das Fenster schließen.</h2>'); resolve(u.searchParams.get('code')); }
      setTimeout(() => server.close(), 500);
    });
    server.listen(8737, '127.0.0.1');
    setTimeout(() => { server.close(); reject(new Error('Zeitüberschreitung')); }, 180000);
    const auth = new URL('https://accounts.spotify.com/authorize');
    auth.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT, scope: SPOTIFY_SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge });
    shell.openExternal(auth.toString());
  });
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT, client_id: clientId, code_verifier: verifier }) });
  if (!r.ok) throw new Error(`Spotify-Token fehlgeschlagen (${r.status})`);
  const t = await r.json();
  store.spotify = { clientId, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 - 30000 };
  saveStore();
  return { connected: true };
});
async function spotifyRefresh() {
  const s = store.spotify;
  if (!s || Date.now() < s.expiresAt) return;
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId }) });
  if (!r.ok) return;
  const t = await r.json();
  s.accessToken = t.access_token; if (t.refresh_token) s.refreshToken = t.refresh_token;
  s.expiresAt = Date.now() + t.expires_in * 1000 - 30000;
  saveStore();
}
async function writeSpotifyFile(dir) {
  const f = path.join(dir, 'lellek', 'spotify.json');
  if (!store.spotify) { await fsp.rm(f, { force: true }); return; }
  await spotifyRefresh();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, JSON.stringify(store.spotify));
}

// ---------- Mod-Updates: Modrinth (SHA1) + CurseForge (Fingerprint) ----------
async function sha1(file) { return crypto.createHash('sha1').update(await fsp.readFile(file)).digest('hex'); }
/** CurseForge-Fingerprint: MurmurHash2 (32 Bit, Seed 1) über die Datei ohne Whitespace-Bytes */
function cfFingerprint(buf) {
  const data = []; for (const b of buf) if (b !== 9 && b !== 10 && b !== 13 && b !== 32) data.push(b);
  const len = data.length, m = 0x5bd1e995; let h = (1 ^ len) >>> 0, i = 0;
  while (len - i >= 4) { let k = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0; k = Math.imul(k, m) >>> 0; k ^= k >>> 24; k = Math.imul(k, m) >>> 0; h = Math.imul(h, m) >>> 0; h = (h ^ k) >>> 0; i += 4; }
  const rem = len - i; if (rem >= 3) h ^= data[i + 2] << 16; if (rem >= 2) h ^= data[i + 1] << 8; if (rem >= 1) { h ^= data[i]; h = Math.imul(h, m) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, m) >>> 0; h ^= h >>> 15; return h >>> 0;
}
const updateCache = new Map(); // profileId:kind → { at, results }
ipcMain.handle('mods:checkUpdates', async (_e, { profileId, kind, force }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const key = `${profileId}:${kind}`; const cached = updateCache.get(key);
  if (!force && cached && Date.now() - cached.at < 10 * 60000) return cached.results;
  const dir = kindDir(profileId, kind);
  const files = (await fsp.readdir(dir)).filter(f => /\.(jar|zip)$/i.test(f) || /\.(jar|zip)\.disabled$/i.test(f));
  if (!files.length) return [];
  const results = new Map(); const hashes = {}; const fps = {};
  for (const f of files) { const buf = await fsp.readFile(path.join(dir, f)); hashes[crypto.createHash('sha1').update(buf).digest('hex')] = f; fps[cfFingerprint(buf)] = f; results.set(f, { file: f, status: 'unknown' }); }
  // 1) Modrinth
  try {
    const body = { hashes: Object.keys(hashes), algorithm: 'sha1', loaders: kind === 'mods' && p.loader ? [p.loader] : [], game_versions: [p.version] };
    const r = await fetch('https://api.modrinth.com/v2/version_files/update', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'LellekClient' }, body: JSON.stringify(body) });
    if (r.ok) { const latest = await r.json(); for (const [hash, file] of Object.entries(hashes)) { const v = latest[hash]; if (!v) continue; const nf = kind === 'mods' ? pickFile(v, p.loader) : (v.files.find(x => x.primary) || v.files[0]); results.set(file, nf.hashes?.sha1 === hash ? { file, status: 'current', source: 'modrinth' } : { file, status: 'update', source: 'modrinth', newVersion: v.version_number, newFile: nf.filename, url: nf.url, projectId: v.project_id, changelog: (v.changelog || '').slice(0, 4000) }); } }
  } catch {}
  // 2) CurseForge für alles, was Modrinth nicht kennt
  const open = Object.entries(fps).filter(([, f]) => results.get(f).status === 'unknown');
  if (open.length && store.settings.curseforgeKey) {
    try {
      const r = await fetch('https://api.curseforge.com/v1/fingerprints/432', { method: 'POST', headers: { ...cfHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprints: open.map(([fp]) => Number(fp)) }) });
      if (r.ok) {
        const data = (await r.json()).data;
        for (const m of data.exactMatches || []) {
          const file = fps[m.file.fileFingerprint]; if (!file) continue;
          const params = new URLSearchParams({ gameVersion: p.version, pageSize: 50 }); if (kind === 'mods' && CF_LOADER[p.loader]) params.set('modLoaderType', CF_LOADER[p.loader]);
          const fr = await fetch(`https://api.curseforge.com/v1/mods/${m.id}/files?${params}`, { headers: cfHeaders() });
          if (!fr.ok) { results.set(file, { file, status: 'current', source: 'curseforge' }); continue; }
          const latest = (await fr.json()).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))[0];
          if (!latest || latest.id === m.file.id) results.set(file, { file, status: 'current', source: 'curseforge' });
          else results.set(file, { file, status: latest.downloadUrl ? 'update' : 'manual', source: 'curseforge', newVersion: latest.displayName, newFile: latest.fileName, url: latest.downloadUrl, cfModId: m.id, cfFileId: latest.id });
        }
      }
    } catch {}
  }
  const out = [...results.values()]; updateCache.set(key, { at: Date.now(), results: out }); return out;
});
ipcMain.handle('mods:update', async (_e, { profileId, kind, file, url, newFile, projectId }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const dir = kindDir(profileId, kind); const disabled = file.endsWith('.disabled');
  await download(url, path.join(dir, newFile + (disabled ? '.disabled' : '')));
  if (path.basename(file) !== newFile + (disabled ? '.disabled' : '')) await fsp.rm(path.join(dir, file), { force: true });
  p.installed ??= {}; if (projectId) p.installed[projectId] = newFile; saveStore(); updateCache.delete(`${profileId}:${kind}`);
  return newFile;
});
/** Vor dem Start: alle Mods mit Update aktualisieren (Option „Mods automatisch aktualisieren“) */
async function autoUpdateMods(p, log) {
  const res = await handlers['mods:checkUpdates'](null, { profileId: p.id, kind: 'mods', force: true });
  const ups = res.filter(r => r.status === 'update'); if (!ups.length) { log('Mod-Updates: alles aktuell'); return; }
  for (const u of ups) { try { await handlers['mods:update'](null, { profileId: p.id, kind: 'mods', file: u.file, url: u.url, newFile: u.newFile, projectId: u.projectId }); log(`Mod aktualisiert: ${u.newFile}`); } catch (e) { log(`Update fehlgeschlagen: ${u.file} (${e.message})`); } }
}

// ---------- Modpacks: Modrinth (.mrpack) & CurseForge (manifest.json) → neues Profil ----------
ipcMain.handle('packs:search', async (_e, { source, query, page = 0 }) => {
  if (source === 'modrinth') {
    const u = `https://api.modrinth.com/v2/search?limit=20&offset=${page * 20}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify([['project_type:modpack']]))}&index=${query ? 'relevance' : 'downloads'}`;
    const r = await getJson(u);
    return { total: r.total_hits, items: r.hits.map(h => ({ id: h.project_id, name: h.title, author: h.author, summary: h.description, icon: h.icon_url, downloads: h.downloads, versions: (h.versions || []).slice(-3).join(', '), source })) };
  }
  const params = new URLSearchParams({ gameId: 432, classId: 4471, searchFilter: query || '', pageSize: 20, index: page * 20, sortField: query ? 1 : 2, sortOrder: 'desc' });
  const r = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, { headers: cfHeaders() });
  if (!r.ok) throw new Error(`CurseForge-Fehler ${r.status}`);
  const j = await r.json();
  return { total: j.pagination.totalCount, items: j.data.map(m => ({ id: m.id, name: m.name, author: m.authors?.[0]?.name, summary: m.summary, icon: m.logo?.thumbnailUrl, downloads: m.downloadCount, versions: (m.latestFilesIndexes || []).slice(0, 3).map(f => f.gameVersion).join(', '), source })) };
});
async function pool(items, limit, fn) { let i = 0; const workers = Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const idx = i++; await fn(items[idx], idx); } }); await Promise.all(workers); }
function parseLoader(id) { const m = /^(forge|fabric|neoforge|quilt)-(.+)$/.exec(id || ''); return m ? { loader: m[1], version: m[2] } : null; }
async function newProfileFrom(name, version, loader, loaderVersion) {
  const p = { id: newId(), name, version, loader, loaderVersion, memory: 4, javaPath: '', installed: {} };
  store.profiles.push(p);
  for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'datapacks', 'config']) fs.mkdirSync(path.join(instanceDir(p), sub), { recursive: true });
  saveStore(); return p;
}
function copyOverrides(zip, prefix, dest) {
  for (const e of zip.getEntries()) { if (e.isDirectory || !e.entryName.startsWith(prefix)) continue; const rel = e.entryName.slice(prefix.length), out = path.join(dest, rel); if (!out.startsWith(dest)) continue; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.getData()); }
}
ipcMain.handle('packs:install', async (_e, { source, projectId, name }) => {
  const progress = (task, percent) => send('launch:progress', { task, percent });
  const tmp = path.join(DATA_DIR, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
  if (source === 'modrinth') {
    const versions = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version`);
    const v = versions.find(x => x.version_type === 'release') || versions[0]; if (!v) throw new Error('Keine Version gefunden');
    const file = v.files.find(f => f.primary) || v.files[0]; const packFile = path.join(tmp, `${projectId}.mrpack`);
    progress('Modpack', 0); await download(file.url, packFile, (x) => progress('Modpack laden', x));
    return installMrpackFile(packFile, name, true);
  }
  const mod = (await (await fetch(`https://api.curseforge.com/v1/mods/${projectId}`, { headers: cfHeaders() })).json()).data;
  const latest = mod.latestFiles.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))[0];
  if (!latest?.downloadUrl) throw new Error('Dieses Modpack erlaubt keinen Download über Drittanbieter');
  const packFile = path.join(tmp, `${projectId}.zip`);
  progress('Modpack', 0); await download(latest.downloadUrl, packFile, (x) => progress('Modpack laden', x));
  const zip = new AdmZip(packFile); const manifest = JSON.parse(zip.readAsText('manifest.json'));
  const ld = parseLoader(manifest.minecraft?.modLoaders?.find(l => l.primary)?.id || manifest.minecraft?.modLoaders?.[0]?.id);
  if (!ld || ld.loader === 'quilt') throw new Error(`Dieses Modpack braucht ${ld?.loader || 'einen unbekannten Loader'} – der Launcher startet Fabric, Forge und NeoForge`);
  const p = await newProfileFrom(name || manifest.name, manifest.minecraft.version, ld.loader, ld.version);
  const dir = instanceDir(p), files = manifest.files || []; let skipped = 0;
  let done = 0;
  await pool(files, 4, async (f) => {
    try { const info = (await (await fetch(`https://api.curseforge.com/v1/mods/${f.projectID}/files/${f.fileID}`, { headers: cfHeaders(), signal: withTimeout() })).json()).data;
      if (!info?.downloadUrl) { skipped++; send('launch:log', { line: `Modpack: ${info?.fileName || f.projectID} muss manuell von CurseForge geladen werden` }); }
      else { const sub = /\.zip$/i.test(info.fileName) ? 'resourcepacks' : 'mods'; await download(info.downloadUrl, path.join(dir, sub, info.fileName)); }
    } catch (e) { skipped++; send('launch:log', { line: `Modpack: Datei ${f.projectID}/${f.fileID} fehlgeschlagen (${e.message})` }); }
    progress(`Mod ${++done}/${files.length}`, done / files.length);
  });
  copyOverrides(zip, (manifest.overrides || 'overrides') + '/', dir);
  await fsp.rm(packFile, { force: true }); progress('Fertig', 1); notify('LellekClient', `Modpack „${p.name}“ installiert`);
  return { profiles: store.profiles, id: p.id, name: p.name, version: p.version, loader: ld.loader, mods: files.length, skipped };
});

// ---------- Mod-Browser: Modrinth & CurseForge ----------// ---------- Mod-Browser: Modrinth & CurseForge ----------
const MR_TYPES = { mods: 'mod', shaderpacks: 'shader', resourcepacks: 'resourcepack', datapacks: 'datapack' };
const CF_CLASS = { mods: 6, shaderpacks: 6552, resourcepacks: 12, datapacks: 6945 };
const CF_LOADER = { forge: 1, fabric: 4, neoforge: 6 };
function cfHeaders() {
  if (!store.settings.curseforgeKey) throw new Error('Kein CurseForge-API-Key hinterlegt (Einstellungen)');
  return { 'x-api-key': store.settings.curseforgeKey, Accept: 'application/json' };
}
ipcMain.handle('browse:search', async (_e, { source, kind, query, version, loader, page = 0 }) => {
  if (source === 'modrinth') {
    const facets = [[`project_type:${MR_TYPES[kind]}`], [`versions:${version}`]];
    if (kind === 'mods' && loader) facets.push([`categories:${loader}`]);
    const u = `https://api.modrinth.com/v2/search?limit=20&offset=${page * 20}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
    const r = await getJson(u);
    return { total: r.total_hits, items: r.hits.map(h => ({ id: h.project_id, name: h.title, author: h.author, summary: h.description, icon: h.icon_url, downloads: h.downloads, source })) };
  }
  const params = new URLSearchParams({ gameId: 432, classId: CF_CLASS[kind], gameVersion: version, searchFilter: query || '', pageSize: 20, index: page * 20, sortField: 2, sortOrder: 'desc' });
  if (kind === 'mods' && CF_LOADER[loader]) params.set('modLoaderType', CF_LOADER[loader]);
  const r = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, { headers: cfHeaders(), signal: withTimeout() });
  if (!r.ok) throw new Error(`CurseForge-Fehler ${r.status}${r.status === 403 ? ' – API-Key ungültig?' : ''}`);
  const j = await r.json();
  return { total: j.pagination.totalCount, items: j.data.map(m => ({ id: m.id, name: m.name, author: m.authors?.[0]?.name, summary: m.summary, icon: m.logo?.thumbnailUrl, downloads: m.downloadCount, source })) };
});
ipcMain.handle('browse:install', async (_e, { source, kind, projectId, profileId }) => {
  const p = store.profiles.find(x => x.id === profileId);
  if (!p) throw new Error('Profil nicht gefunden');
  const dest = kindDir(profileId, kind);
  const loaders = kind === 'mods' && p.loader ? [p.loader] : null;
  if (source === 'modrinth') {
    const version = pickVersion(await modrinthVersions(projectId, p, kind));
    if (!version) throw new Error(`Keine passende Datei für ${p.version}${loaders ? ' / ' + loaders[0] : ''}`);
    await ensureFabricApi(p);
    const files = await installModrinthVersion(p, kind, version, new Set());
    saveStore();
    return files.join(', ');
  }
  const params = new URLSearchParams({ gameVersion: p.version, pageSize: 50 });
  if (loaders && CF_LOADER[loaders[0]]) params.set('modLoaderType', CF_LOADER[loaders[0]]);
  const r = await fetch(`https://api.curseforge.com/v1/mods/${projectId}/files?${params}`, { headers: cfHeaders() });
  if (!r.ok) throw new Error(`CurseForge-Fehler ${r.status}`);
  const files = (await r.json()).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
  const file = files[0];
  if (!file) throw new Error(`Keine passende Datei für ${p.version}`);
  if (!file.downloadUrl) throw new Error('Der Autor erlaubt keinen Download über Drittanbieter – bitte manuell von CurseForge laden');
  await download(file.downloadUrl, path.join(dest, file.fileName));
  return file.fileName;
});

// ---------- Skin-Bibliothek (lokale PNGs mit Vorschau) ----------
const SKINS_DIR = path.join(DATA_DIR, 'skins');
ipcMain.handle('skins:list', async () => {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
  const files = (await fsp.readdir(SKINS_DIR)).filter(f => f.toLowerCase().endsWith('.png'));
  return Promise.all(files.map(async f => ({ file: f, name: f.replace(/\.png$/i, ''), dataUrl: 'data:image/png;base64,' + (await fsp.readFile(path.join(SKINS_DIR, f))).toString('base64') })));
});
ipcMain.handle('skins:add', async () => {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Skin (PNG)', extensions: ['png'] }] });
  if (canceled) return 0;
  for (const f of filePaths) await fsp.copyFile(f, path.join(SKINS_DIR, path.basename(f)));
  return filePaths.length;
});
ipcMain.handle('skins:saveCurrent', async (_e, name) => {
  const url = currentAuth?.profile?.skins?.find(x => x.state === 'ACTIVE')?.url;
  if (!url) throw new Error('Kein aktiver Skin');
  fs.mkdirSync(SKINS_DIR, { recursive: true });
  const r = await fetch(url);
  await fsp.writeFile(path.join(SKINS_DIR, `${name.replace(/[^\w\- ]/g, '') || 'Skin'}.png`), Buffer.from(await r.arrayBuffer()));
});
ipcMain.handle('skins:remove', async (_e, file) => fsp.rm(path.join(SKINS_DIR, path.basename(file)), { force: true }));
ipcMain.handle('skins:apply', async (_e, { file, variant }) => {
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([await fsp.readFile(path.join(SKINS_DIR, path.basename(file)))], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: mojangHeaders(), body: form });
  if (!r.ok) throw new Error(`Skin-Upload fehlgeschlagen (${r.status})`);
  currentAuth.profile = await r.json();
  skinCache.delete(currentAuth.profile.id);
  send('auth:changed', publicAccount());
  return publicAccount();
});

// ---------- Welten ----------
function savesDir(profileId) { const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden'); const d = path.join(instanceDir(p), 'saves'); fs.mkdirSync(d, { recursive: true }); return d; }
async function dirSize(d) { let n = 0; for (const e of await fsp.readdir(d, { withFileTypes: true })) { const f = path.join(d, e.name); n += e.isDirectory() ? await dirSize(f) : (await fsp.stat(f)).size; } return n; }
ipcMain.handle('worlds:list', async (_e, profileId) => {
  const d = savesDir(profileId), out = [];
  for (const e of await fsp.readdir(d, { withFileTypes: true })) {
    if (!e.isDirectory() || !fs.existsSync(path.join(d, e.name, 'level.dat'))) continue;
    const icon = path.join(d, e.name, 'icon.png');
    out.push({ name: e.name, size: await dirSize(path.join(d, e.name)), modified: (await fsp.stat(path.join(d, e.name, 'level.dat'))).mtimeMs,
      icon: fs.existsSync(icon) ? 'data:image/png;base64,' + (await fsp.readFile(icon)).toString('base64') : null });
  }
  return out.sort((a, b) => b.modified - a.modified);
});
ipcMain.handle('worlds:export', async (_e, { profileId, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `${name}.zip`, filters: [{ name: 'Welt (ZIP)', extensions: ['zip'] }] });
  if (canceled) return false;
  const zip = new AdmZip(); zip.addLocalFolder(path.join(savesDir(profileId), name), name); zip.writeZip(filePath);
  return true;
});
ipcMain.handle('worlds:import', async (_e, profileId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Welt (ZIP)', extensions: ['zip'] }] });
  if (canceled) return null;
  const zip = new AdmZip(filePaths[0]), entries = zip.getEntries();
  const level = entries.find(e => e.entryName.endsWith('level.dat'));
  if (!level) throw new Error('Keine level.dat im ZIP – ist das eine Minecraft-Welt?');
  const root = level.entryName.slice(0, -'level.dat'.length); // '' oder 'Name/'
  let name = root ? root.replace(/\/$/, '').split('/').pop() : path.basename(filePaths[0], '.zip');
  const d = savesDir(profileId);
  while (fs.existsSync(path.join(d, name))) name += ' (Kopie)';
  for (const e of entries) {
    if (!e.entryName.startsWith(root) || e.isDirectory) continue;
    const rel = e.entryName.slice(root.length), dest = path.join(d, name, rel);
    if (!dest.startsWith(path.join(d, name))) continue; // Zip-Slip-Schutz
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, e.getData());
  }
  return name;
});
ipcMain.handle('worlds:delete', async (_e, { profileId, name }) => fsp.rm(path.join(savesDir(profileId), path.basename(name)), { recursive: true, force: true }));
ipcMain.handle('worlds:copy', async (_e, { profileId, name, targetProfileId }) => {
  let target = name; const td = savesDir(targetProfileId);
  while (fs.existsSync(path.join(td, target))) target += ' (Kopie)';
  await fsp.cp(path.join(savesDir(profileId), name), path.join(td, target), { recursive: true });
  return target;
});
ipcMain.handle('worlds:openFolder', (_e, profileId) => shell.openPath(savesDir(profileId)));

// ---------- Welt-Backups (vor jedem Start, die letzten 5 bleiben) ----------
function backupDir(p) { const d = path.join(DATA_DIR, 'backups', p.id); fs.mkdirSync(d, { recursive: true }); return d; }
async function backupWorlds(p, log) {
  const saves = path.join(instanceDir(p), 'saves');
  if (!fs.existsSync(saves) || fs.lstatSync(saves).isSymbolicLink()) return;
  const worlds = (await fsp.readdir(saves, { withFileTypes: true })).filter(e => e.isDirectory() && fs.existsSync(path.join(saves, e.name, 'level.dat')));
  if (!worlds.length) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const zip = new AdmZip(); for (const w of worlds) zip.addLocalFolder(path.join(saves, w.name), w.name);
  const out = path.join(backupDir(p), `${stamp}.zip`); zip.writeZip(out);
  const old = (await fsp.readdir(backupDir(p))).filter(f => f.endsWith('.zip')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 5))) await fsp.rm(path.join(backupDir(p), f), { force: true });
  log(`Welt-Backup: ${worlds.length} Welt(en) → ${path.basename(out)}`);
}
ipcMain.handle('backups:list', async (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (!p) return []; return (await fsp.readdir(backupDir(p))).filter(f => f.endsWith('.zip')).sort().reverse().map(f => ({ file: f, size: fs.statSync(path.join(backupDir(p), f)).size, time: fs.statSync(path.join(backupDir(p), f)).mtimeMs })); });
ipcMain.handle('backups:restore', async (_e, { profileId, file }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  if (running.has(profileId)) throw new Error('Profil läuft – zuerst beenden');
  const zip = new AdmZip(path.join(backupDir(p), path.basename(file))), saves = path.join(instanceDir(p), 'saves');
  for (const e of zip.getEntries()) { if (e.isDirectory) continue; const out = path.join(saves, e.entryName); if (!out.startsWith(saves)) continue; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.getData()); }
  return true;
});
ipcMain.handle('backups:now', async (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden'); await backupWorlds(p, () => {}); return true; });
ipcMain.handle('backups:openFolder', (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (p) shell.openPath(backupDir(p)); });

// ---------- Screenshots ----------
ipcMain.handle('shots:list', async (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) return [];
  const d = path.join(instanceDir(p), 'screenshots'); if (!fs.existsSync(d)) return [];
  const files = (await fsp.readdir(d)).filter(f => /\.png$/i.test(f)).map(f => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 40);
  return Promise.all(files.map(async x => ({ file: x.f, time: x.t, dataUrl: 'data:image/png;base64,' + (await fsp.readFile(path.join(d, x.f))).toString('base64') })));
});
ipcMain.handle('shots:open', (_e, { profileId, file }) => { const p = store.profiles.find(x => x.id === profileId); if (p) shell.openPath(path.join(instanceDir(p), 'screenshots', path.basename(file))); });
ipcMain.handle('shots:openFolder', (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (p) { const d = path.join(instanceDir(p), 'screenshots'); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); } });
ipcMain.handle('shots:delete', async (_e, { profileId, file }) => { const p = store.profiles.find(x => x.id === profileId); if (p) await fsp.rm(path.join(instanceDir(p), 'screenshots', path.basename(file)), { force: true }); });

// ---------- Server-Favoriten ----------
ipcMain.handle('favorites:list', () => store.favorites || []);
ipcMain.handle('favorites:save', (_e, list) => { store.favorites = list; saveStore(); return list; });

// ---------- Profil duplizieren / exportieren / importieren ----------
ipcMain.handle('profiles:duplicate', async (_e, id) => {
  const src = store.profiles.find(x => x.id === id); if (!src) throw new Error('Profil nicht gefunden');
  const p = { ...src, id: newId(), name: src.name + ' (Kopie)', playtimeMs: 0, linkVanilla: false };
  store.profiles.push(p); saveStore();
  await fsp.cp(instanceDir(src), instanceDir(p), { recursive: true, filter: (f) => !/[\\/](logs|crash-reports)$/.test(f), verbatimSymlinks: true });
  return store.profiles;
});
ipcMain.handle('profiles:export', async (_e, id) => {
  const p = store.profiles.find(x => x.id === id); if (!p) throw new Error('Profil nicht gefunden');
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `${p.name}.lellekprofile.zip`, filters: [{ name: 'LellekClient-Profil', extensions: ['zip'] }] });
  if (canceled) return false;
  const zip = new AdmZip();
  zip.addFile('lellek-profile.json', Buffer.from(JSON.stringify({ name: p.name, version: p.version, loader: p.loader, loaderVersion: p.loaderVersion, memory: p.memory, jvmArgs: p.jvmArgs || '', installed: p.installed || {} })));
  for (const sub of ['mods', 'config', 'shaderpacks', 'resourcepacks', 'datapacks']) { const d = path.join(instanceDir(p), sub); if (fs.existsSync(d) && !fs.lstatSync(d).isSymbolicLink()) zip.addLocalFolder(d, sub); }
  for (const f of ['options.txt', 'servers.dat', 'optionsof.txt']) { const fp = path.join(instanceDir(p), f); if (fs.existsSync(fp)) zip.addLocalFile(fp); }
  zip.writeZip(filePath); return true;
});
ipcMain.handle('profiles:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'LellekClient-Profil', extensions: ['zip'] }] });
  if (canceled) return null;
  const zip = new AdmZip(filePaths[0]); const meta = zip.getEntry('lellek-profile.json'); if (!meta) throw new Error('Kein LellekClient-Profil (lellek-profile.json fehlt)');
  const m = JSON.parse(zip.readAsText(meta));
  const p = { id: newId(), name: m.name, version: m.version, loader: m.loader || '', loaderVersion: m.loaderVersion || '', memory: m.memory || 4, javaPath: '', jvmArgs: m.jvmArgs || '', installed: m.installed || {} };
  store.profiles.push(p); saveStore();
  const dir = instanceDir(p); fs.mkdirSync(dir, { recursive: true });
  for (const e of zip.getEntries()) { if (e.isDirectory || e.entryName === 'lellek-profile.json') continue; const out = path.join(dir, e.entryName); if (!out.startsWith(dir)) continue; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.getData()); }
  return { profiles: store.profiles, id: p.id, name: p.name };
});

// ---------- Tray-Schnellstart ----------
let tray = null;
function buildTray() {
  const { Tray, Menu } = require('electron');
  if (store.settings.tray === false) { if (tray) { tray.destroy(); tray = null; } return; }
  if (!tray) { tray = new Tray(process.platform === 'darwin' ? require('electron').nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-256.png')).resize({ width: 18, height: 18 }) : path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon-256.png')); tray.setToolTip('LellekClient'); tray.on('click', () => { win?.show(); win?.focus(); }); }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'LellekClient öffnen', click: () => { win?.show(); win?.focus(); } }, { type: 'separator' },
    ...store.profiles.slice(0, 10).map(p => ({ label: `${running.has(p.id) ? '▶ ' : ''}${p.name} (${p.version})`, click: () => { win?.show(); win?.webContents.send('tray:launch', p.id); } })),
    { type: 'separator' }, { label: 'Beenden', click: () => app.quit() },
  ]));
}
app.whenReady().then(() => setTimeout(buildTray, 1500));

// ---------- NBT-Helfer (level.dat, servers.dat) ----------
const nbt = require('nbt');
function simplifyNbt(node) {
  if (node == null) return node;
  const t = node.type, v = node.value;
  if (t === 'compound') { const o = {}; for (const [k, c] of Object.entries(v)) o[k] = simplifyNbt(c); return o; }
  if (t === 'list') return (v.value || []).map(x => simplifyNbt({ type: v.type, value: x }));
  if (t === 'long') return Array.isArray(v) ? (BigInt(v[0] >>> 0) << 32n | BigInt(v[1] >>> 0)) : v;
  return v;
}
function readNbt(file) { return new Promise((resolve, reject) => { const buf = fs.readFileSync(file); nbt.parse(buf, (err, data) => err ? reject(err) : resolve(simplifyNbt({ type: 'compound', value: data.value }))); }); }
ipcMain.handle('worlds:info', async (_e, { profileId, name }) => {
  try {
    const d = await readNbt(path.join(savesDir(profileId), path.basename(name), 'level.dat')); const L = d.Data || d;
    const modes = ['Überleben', 'Kreativ', 'Abenteuer', 'Zuschauer'], diff = ['Friedlich', 'Einfach', 'Normal', 'Schwer'];
    const signed = (x) => typeof x === 'bigint' ? BigInt.asIntN(64, x).toString() : String(x ?? '');
    return { name: L.LevelName, seed: signed(L.WorldGenSettings?.seed ?? L.RandomSeed), mode: modes[L.GameType] || '?', difficulty: diff[L.Difficulty] || '?', hardcore: !!L.hardcore, version: L.Version?.Name || '', lastPlayed: typeof L.LastPlayed === 'bigint' ? Number(L.LastPlayed) : L.LastPlayed, spawn: `${L.SpawnX} ${L.SpawnY} ${L.SpawnZ}`, dayTime: L.DayTime, cheats: !!L.allowCommands };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('favorites:fromServersDat', async (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) return [];
  const f = path.join(instanceDir(p), 'servers.dat'); if (!fs.existsSync(f)) return [];
  try { const d = await readNbt(f); return (d.servers || []).map(s => ({ name: s.name || s.ip, ip: s.ip })); } catch { return []; }
});

// ---------- Mod-Details (Modrinth per Datei-Hash) ----------
ipcMain.handle('mods:info', async (_e, { profileId, kind, file }) => {
  const dir = kindDir(profileId, kind); const hash = await sha1(path.join(dir, file));
  try {
    const v = await getJson(`https://api.modrinth.com/v2/version_file/${hash}?algorithm=sha1`);
    const pr = await getJson(`https://api.modrinth.com/v2/project/${v.project_id}`);
    return { title: pr.title, description: pr.description, body: (pr.body || '').slice(0, 1500), icon: pr.icon_url, downloads: pr.downloads, version: v.version_number, url: `https://modrinth.com/${pr.project_type}/${pr.slug}`, source: pr.source_url, categories: pr.categories, loaders: pr.loaders, gameVersions: (pr.game_versions || []).slice(-6) };
  } catch { const info = modIdOf(path.join(dir, file)); return { title: file, description: info ? `Mod-ID ${info.id}, Version ${info.version}` : 'Keine Informationen gefunden (nicht auf Modrinth).', local: true }; }
});
// ---------- Pack-Vorschau (pack.png + pack.mcmeta) ----------
ipcMain.handle('packs:preview', async (_e, { profileId, kind, file }) => {
  try { const z = new AdmZip(path.join(kindDir(profileId, kind), file)); const png = z.getEntry('pack.png'); const meta = z.getEntry('pack.mcmeta'); const m = meta ? JSON.parse(z.readAsText(meta)) : null; const desc = m?.pack?.description; return { icon: png ? 'data:image/png;base64,' + png.getData().toString('base64') : null, description: typeof desc === 'string' ? desc : (desc?.text || (Array.isArray(desc) ? desc.map(x => x.text || x).join('') : '')), format: m?.pack?.pack_format }; } catch { return null; }
});
// ---------- Komplett-Backup aller Launcher-Daten ----------
ipcMain.handle('backup:all', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `LellekClient-Backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (canceled) return false;
  saveStoreNow(); const zip = new AdmZip(); zip.addLocalFile(STORE_FILE);
  for (const p of store.profiles) { const d = instanceDir(p); if (fs.existsSync(d)) { send('launch:progress', { task: `Backup ${p.name}`, percent: 0.5 }); for (const sub of ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'options.txt', 'servers.dat']) { const f = path.join(d, sub); if (!fs.existsSync(f) || fs.lstatSync(f).isSymbolicLink()) continue; if (fs.statSync(f).isDirectory()) zip.addLocalFolder(f, `instances/${p.id}/${sub}`); else zip.addLocalFile(f, `instances/${p.id}`); } } }
  if (fs.existsSync(SKINS_DIR)) zip.addLocalFolder(SKINS_DIR, 'skins');
  zip.writeZip(filePath); send('launch:progress', { task: 'Backup fertig', percent: 1 }); return true;
});
ipcMain.handle('backup:restoreAll', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (canceled) return false;
  const zip = new AdmZip(filePaths[0]); if (!zip.getEntry('lellek.json')) throw new Error('Kein LellekClient-Backup');
  const incoming = JSON.parse(zip.readAsText('lellek.json'));
  for (const p of incoming.profiles || []) if (!store.profiles.find(x => x.id === p.id)) store.profiles.push(p);
  store.favorites = [...(store.favorites || []), ...(incoming.favorites || []).filter(f => !(store.favorites || []).some(x => x.ip === f.ip))]; saveStore();
  for (const e of zip.getEntries()) { if (e.isDirectory || e.entryName === 'lellek.json') continue; const out = e.entryName.startsWith('skins/') ? path.join(SKINS_DIR, e.entryName.slice(6)) : e.entryName.startsWith('instances/') ? path.join(INSTANCES, e.entryName.slice(10)) : null; if (!out) continue; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.getData()); }
  return true;
});
// ---------- Benachrichtigungen & Screenshot in Zwischenablage ----------
const { Notification, clipboard, nativeImage } = require('electron');
function notify(title, body) { if (store.settings.notifications === false || (streamerActive() && store.settings.streamer?.mute !== false)) return; try { new Notification({ title, body, icon: path.join(__dirname, '..', 'assets', 'icon-256.png') }).show(); } catch {} }
ipcMain.handle('shots:copy', async (_e, { profileId, file }) => { const p = store.profiles.find(x => x.id === profileId); if (!p) return; clipboard.writeImage(nativeImage.createFromPath(path.join(instanceDir(p), 'screenshots', path.basename(file)))); });
ipcMain.handle('profiles:icon', (_e, { id, icon, color }) => { const p = store.profiles.find(x => x.id === id); if (p) { p.icon = icon; p.color = color; saveStore(); } return store.profiles; });

// ---------- 1. Update-Check (GitHub Releases oder eigene JSON-URL) ----------
ipcMain.handle('update:check', async () => {
  const url = (store.settings.updateUrl || '').trim() || DEFAULT_UPDATE_URL; if (!url) return { configured: false };
  try {
    const j = await getJson(url);
    const latest = (j.tag_name || j.version || '').replace(/^v/, ''); const dl = j.html_url || j.url || (j.assets?.[0]?.browser_download_url) || url;
    if (cmpVer(latest, CLIENT_VERSION) > 0) notify('LellekClient', `Version ${latest} ist verfügbar`);
    return { configured: true, current: CLIENT_VERSION, latest, newer: cmpVer(latest, CLIENT_VERSION) > 0, url: dl, notes: (j.body || j.notes || '').slice(0, 600) };
  } catch (e) { return { configured: true, error: e.message }; }
});
ipcMain.handle('update:open', (_e, url) => shell.openExternal(url));

// ---------- 2. Java-Verwaltung ----------
ipcMain.handle('java:list', async () => {
  const out = [];
  for (const d of (fs.existsSync(JAVA_DIR) ? await fsp.readdir(JAVA_DIR) : [])) { const full = path.join(JAVA_DIR, d); if (!fs.statSync(full).isDirectory()) continue; out.push({ name: d, path: javaBinary(full), size: await dirSize(full) }); }
  return out;
});
ipcMain.handle('java:delete', async (_e, name) => { await fsp.rm(path.join(JAVA_DIR, path.basename(name)), { recursive: true, force: true }); });
ipcMain.handle('java:install', async (_e, major) => { await ensureJava(Number(major), (m) => send('launch:log', { line: m })); return true; });

// ---------- 3. Speicherplatz & Aufräumen ----------
ipcMain.handle('disk:profile', async (_e, id) => { const p = store.profiles.find(x => x.id === id); if (!p) return null; const d = instanceDir(p); const parts = {}; for (const sub of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots', 'logs', 'crash-reports']) { const f = path.join(d, sub); parts[sub] = fs.existsSync(f) && !fs.lstatSync(f).isSymbolicLink() ? await dirSize(f) : 0; } return { total: await dirSize(d), parts }; });
ipcMain.handle('disk:clean', async (_e, id) => {
  const p = store.profiles.find(x => x.id === id); let freed = 0;
  const targets = p ? [path.join(instanceDir(p), 'logs'), path.join(instanceDir(p), 'crash-reports')] : [];
  targets.push(path.join(DATA_DIR, 'tmp'), path.join(DATA_DIR, 'logs'));
  for (const t of targets) { if (fs.existsSync(t)) { freed += await dirSize(t); await fsp.rm(t, { recursive: true, force: true }); fs.mkdirSync(t, { recursive: true }); } }
  return freed;
});

// ---------- 6. Import aus dem offiziellen Launcher und Prism/MultiMC ----------
ipcMain.handle('import:scan', async () => {
  const found = [];
  try { // Offizieller Launcher
    const lp = path.join(vanillaDir(), 'launcher_profiles.json');
    if (fs.existsSync(lp)) for (const [id, pr] of Object.entries(JSON.parse(fs.readFileSync(lp, 'utf8')).profiles || {})) {
      const v = pr.lastVersionId || ''; let loader = '', loaderVersion = '', version = v; let m;
      if ((m = /^fabric-loader-([\d.]+)-(.+)$/.exec(v))) { loader = 'fabric'; loaderVersion = m[1]; version = m[2]; }
      else if ((m = /^(.+)-forge-?([\d.]+)$/i.exec(v)) || (m = /^forge-(.+)$/.exec(v))) { loader = 'forge'; version = m[1]; loaderVersion = m[2] || ''; }
      else if (/latest-(release|snapshot)/.test(v)) continue;
      if (!version) continue;
      found.push({ source: 'Offizieller Launcher', name: pr.name || id, version, loader, loaderVersion, gameDir: pr.gameDir || vanillaDir() });
    }
  } catch {}
  for (const base of [path.join(app.getPath('appData'), 'PrismLauncher', 'instances'), path.join(app.getPath('appData'), 'MultiMC', 'instances'), path.join(app.getPath('home'), 'PrismLauncher', 'instances')]) { // Prism / MultiMC
    if (!fs.existsSync(base)) continue;
    for (const d of await fsp.readdir(base)) {
      try {
        const pack = path.join(base, d, 'mmc-pack.json'); if (!fs.existsSync(pack)) continue;
        const comps = JSON.parse(fs.readFileSync(pack, 'utf8')).components || [];
        const mc = comps.find(c => c.uid === 'net.minecraft'), fab = comps.find(c => c.uid === 'net.fabricmc.fabric-loader'), forge = comps.find(c => c.uid === 'net.minecraftforge'), neo = comps.find(c => c.uid === 'net.neoforged');
        if (!mc) continue;
        const cfg = fs.existsSync(path.join(base, d, 'instance.cfg')) ? fs.readFileSync(path.join(base, d, 'instance.cfg'), 'utf8') : '';
        const name = (cfg.match(/^name=(.*)$/m) || [])[1] || d;
        const gameDir = ['.minecraft', 'minecraft'].map(x => path.join(base, d, x)).find(fs.existsSync);
        found.push({ source: 'Prism/MultiMC', name, version: mc.version, loader: fab ? 'fabric' : neo ? 'neoforge' : forge ? 'forge' : '', loaderVersion: fab?.version || neo?.version || forge?.version || '', gameDir });
      } catch {}
    }
  }
  const home = app.getPath('home'), appdata = app.getPath('appData');
  for (const base of [path.join(home, 'curseforge', 'minecraft', 'Instances'), path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances')]) { // CurseForge-App
    if (!fs.existsSync(base)) continue;
    for (const d of await fsp.readdir(base)) { try { const j = JSON.parse(fs.readFileSync(path.join(base, d, 'minecraftinstance.json'), 'utf8')); const ml = parseLoader(j.baseModLoader?.name || ''); found.push({ source: 'CurseForge-App', name: j.name || d, version: j.gameVersion, loader: ml?.loader || '', loaderVersion: ml?.version || '', gameDir: path.join(base, d) }); } catch {} }
  }
  for (const base of [path.join(appdata, 'ModrinthApp', 'profiles'), path.join(appdata, 'com.modrinth.theseus', 'profiles')]) { // Modrinth-App
    if (!fs.existsSync(base)) continue;
    for (const d of await fsp.readdir(base)) { try { const pf = path.join(base, d, 'profile.json'); const j = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : null; const meta = j?.metadata || j || {}; const loader = (meta.loader || '').toLowerCase(); found.push({ source: 'Modrinth-App', name: meta.name || d, version: meta.game_version || meta.gameVersion || '', loader: loader === 'vanilla' ? '' : loader, loaderVersion: meta.loader_version?.id || meta.loader_version || '', gameDir: path.join(base, d) }); } catch {} }
  }
  for (const base of [path.join(appdata, 'ATLauncher', 'instances'), path.join(home, 'ATLauncher', 'instances')]) { // ATLauncher
    if (!fs.existsSync(base)) continue;
    for (const d of await fsp.readdir(base)) { try { const j = JSON.parse(fs.readFileSync(path.join(base, d, 'instance.json'), 'utf8')); const lt = (j.launcher?.loaderVersion?.type || '').toLowerCase(); found.push({ source: 'ATLauncher', name: j.launcher?.name || d, version: j.id || j.minecraft || '', loader: lt.includes('fabric') ? 'fabric' : lt.includes('forge') ? 'forge' : '', loaderVersion: j.launcher?.loaderVersion?.version || '', gameDir: path.join(base, d) }); } catch {} }
  }
  // Lunar Client: ~/.lunarclient/offline/multiver (gemeinsamer Spielordner für alle Versionen)
  for (const base of [path.join(home, '.lunarclient', 'offline', 'multiver'), path.join(home, '.lunarclient', 'offline')]) {
    if (!fs.existsSync(base)) continue;
    if (fs.existsSync(path.join(base, 'saves')) || fs.existsSync(path.join(base, 'options.txt'))) found.push({ source: 'Lunar Client', name: 'Lunar – Welten & Einstellungen', version: '1.8.9', loader: '', loaderVersion: '', gameDir: base, note: 'Lunar nutzt einen Ordner für alle Versionen; Version hier frei wählbar' });
    for (const d of (fs.existsSync(base) ? await fsp.readdir(base) : [])) { const sub = path.join(base, d); if (/^\d+\.\d+/.test(d) && fs.existsSync(path.join(sub, 'saves'))) found.push({ source: 'Lunar Client', name: `Lunar ${d}`, version: d, loader: '', loaderVersion: '', gameDir: sub }); }
    break;
  }
  // Feather Client: Instanzen unter .feather (bzw. .minecraft/feather)
  for (const base of [path.join(home, '.feather'), path.join(vanillaDir(), 'feather'), path.join(appdata, '.feather')]) {
    if (!fs.existsSync(base)) continue;
    for (const root of ['instances', 'versions', '.']) { const dir = path.join(base, root); if (!fs.existsSync(dir)) continue; for (const d of await fsp.readdir(dir)) { const sub = path.join(dir, d); try { if (!fs.statSync(sub).isDirectory() || !fs.existsSync(path.join(sub, 'mods')) && !fs.existsSync(path.join(sub, 'saves'))) continue; const ver = (d.match(/\d+\.\d+(\.\d+)?/) || [])[0] || ''; found.push({ source: 'Feather Client', name: `Feather ${d}`, version: ver || '1.8.9', loader: fs.existsSync(path.join(sub, 'mods')) ? (parseInt(ver.split('.')[1]) >= 14 ? 'fabric' : 'forge') : '', loaderVersion: '', gameDir: sub }); } catch {} } }
    break;
  }
  // NoRisk Client: Profile unter %APPDATA%/NoRiskClient/profiles bzw. gameDir/norisk
  for (const base of [path.join(appdata, 'NoRiskClient', 'profiles'), path.join(appdata, 'NoRiskClient', 'gameDir'), path.join(home, '.norisk', 'profiles')]) {
    if (!fs.existsSync(base)) continue;
    for (const d of await fsp.readdir(base)) { const sub = path.join(base, d); try { if (!fs.statSync(sub).isDirectory()) continue; const pj = ['profile.json', 'instance.json'].map(x => path.join(sub, x)).find(fs.existsSync); const j = pj ? JSON.parse(fs.readFileSync(pj, 'utf8')) : {}; const ver = j.game_version || j.gameVersion || j.version || (d.match(/\d+\.\d+(\.\d+)?/) || [])[0] || ''; const ld = (j.loader || j.mod_loader || '').toString().toLowerCase(); if (!ver && !fs.existsSync(path.join(sub, 'saves'))) continue; found.push({ source: 'NoRisk Client', name: j.name || `NoRisk ${d}`, version: ver || '1.8.9', loader: ld.includes('fabric') ? 'fabric' : ld.includes('forge') ? 'forge' : '', loaderVersion: j.loader_version || '', gameDir: sub }); } catch {} }
  }
  // Inhalte zählen, damit man weiß, was man importiert
  for (const f of found) {
    try { f.mods = f.gameDir && fs.existsSync(path.join(f.gameDir, 'mods')) ? (await fsp.readdir(path.join(f.gameDir, 'mods'))).filter(x => /\.jar$/i.test(x)).length : 0; } catch { f.mods = 0; }
    try { f.worlds = f.gameDir && fs.existsSync(path.join(f.gameDir, 'saves')) ? (await fsp.readdir(path.join(f.gameDir, 'saves'))).length : 0; } catch { f.worlds = 0; }
    f.hasOptions = !!(f.gameDir && fs.existsSync(path.join(f.gameDir, 'options.txt')));
  }
  return found.filter(f => f.version);
});
ipcMain.handle('import:profile', async (_e, item) => {
  let loaderVersion = item.loaderVersion;
  if (item.loader && !loaderVersion) {
    if (item.loader === 'fabric') loaderVersion = (await getJson(`https://meta.fabricmc.net/v2/versions/loader/${item.version}`))[0]?.loader.version || '';
    if (item.loader === 'forge') loaderVersion = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos[`${item.version}-recommended`] || '';
    if (item.loader === 'neoforge') loaderVersion = (await neoforgeVersions(item.version))[0] || '';
  }
  const p = { id: newId(), name: item.name, version: item.version, loader: item.loader || '', loaderVersion: loaderVersion || '', memory: 4, javaPath: '', installed: {} };
  store.profiles.push(p); saveStore();
  const dir = instanceDir(p); fs.mkdirSync(dir, { recursive: true });
  let copied = 0;
  const want = item.parts || { mods: true, worlds: true, settings: true, packs: true };
  const subs = [...(want.mods ? ['mods', 'config'] : []), ...(want.worlds ? ['saves'] : []), ...(want.packs ? ['resourcepacks', 'shaderpacks', 'screenshots'] : []), ...(want.settings ? ['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt'] : [])];
  if (item.gameDir && fs.existsSync(item.gameDir)) for (const sub of subs) {
    const from = path.join(item.gameDir, sub); if (!fs.existsSync(from)) continue;
    if (fs.statSync(from).isDirectory()) { if (sub === 'mods' && (item.source === 'Offizieller Launcher' && !item.loader || /Lunar|NoRisk/.test(item.source))) continue; send('launch:progress', { task: `Import ${item.name}: ${sub}`, percent: 0.5 }); await fsp.cp(from, path.join(dir, sub), { recursive: true }); } else await fsp.copyFile(from, path.join(dir, sub));
    copied++;
  }
  send('launch:progress', { task: 'Import fertig', percent: 1 });
  return { profiles: store.profiles, id: p.id, copied };
});

// ---------- 8. Autostart ----------
ipcMain.handle('autostart:set', (_e, enable) => { try { app.setLoginItemSettings({ openAtLogin: !!enable, openAsHidden: true }); } catch {} });

// ---------- 9. Mod-Konflikte & sicherer Start ----------
function modIdOf(jar) { try { const z = new AdmZip(jar); const fm = z.getEntry('fabric.mod.json'); if (fm) { const j = JSON.parse(z.readAsText(fm)); return { id: j.id, version: j.version }; } const mi = z.getEntry('mcmod.info'); if (mi) { const j = JSON.parse(z.readAsText(mi)); const m = Array.isArray(j) ? j[0] : j.modList?.[0]; return m ? { id: m.modid, version: m.version } : null; } const mt = z.getEntry('META-INF/mods.toml') || z.getEntry('META-INF/neoforge.mods.toml'); if (mt) { const t = z.readAsText(mt); return { id: (t.match(/modId\s*=\s*"([^"]+)"/) || [])[1], version: (t.match(/version\s*=\s*"([^"]+)"/) || [])[1] }; } } catch {} return null; }
ipcMain.handle('mods:conflicts', async (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) return [];
  const mods = path.join(instanceDir(p), 'mods'); if (!fs.existsSync(mods)) return [];
  const byId = {};
  for (const f of await fsp.readdir(mods)) { if (!/\.jar$/i.test(f)) continue; const info = modIdOf(path.join(mods, f)); if (info?.id) (byId[info.id] ??= []).push({ file: f, version: info.version }); }
  const out = Object.entries(byId).filter(([, arr]) => arr.length > 1).map(([id, arr]) => ({ id, files: arr }));
  const others = { fabric: ['forge', 'neoforge'], forge: ['fabric', 'neoforge'], neoforge: ['fabric'] }[p.loader] || [];
  for (const f of await fsp.readdir(mods)) { const n = f.toLowerCase(); if (/\.jar$/i.test(f) && others.some(o => n.includes('-' + o) || n.includes('_' + o)) && !n.includes(p.loader)) out.push({ id: `falscher Loader: ${f}`, files: [{ file: f }] }); }
  return out;
});
ipcMain.handle('mods:safeToggle', async (_e, { profileId, disable }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) return 0;
  const mods = path.join(instanceDir(p), 'mods'); if (!fs.existsSync(mods)) return 0; let n = 0;
  for (const f of await fsp.readdir(mods)) {
    if (disable && /\.jar$/i.test(f) && !/^LellekHUD-/i.test(f)) { await fsp.rename(path.join(mods, f), path.join(mods, f + '.safemode')); n++; }
    if (!disable && /\.jar\.safemode$/i.test(f)) { await fsp.rename(path.join(mods, f), path.join(mods, f.replace(/\.safemode$/i, ''))); n++; }
  }
  return n;
});

// ---------- 10. Server-Status (Server List Ping) ----------
function pingServer(host, port = 25565, timeout = 4000) {
  return new Promise((resolve) => {
    const net = require('net'); const socket = new net.Socket(); const start = Date.now(); let buf = Buffer.alloc(0); let done = false;
    const finish = (r) => { if (!done) { done = true; socket.destroy(); resolve(r); } };
    const varint = (n) => { const b = []; do { let t = n & 0x7f; n >>>= 7; if (n) t |= 0x80; b.push(t); } while (n); return Buffer.from(b); };
    const packet = (id, payload) => { const body = Buffer.concat([varint(id), payload]); return Buffer.concat([varint(body.length), body]); };
    const hostBuf = Buffer.from(host, 'utf8');
    socket.setTimeout(timeout, () => finish({ online: false, error: 'Zeitüberschreitung' }));
    socket.on('error', (e) => finish({ online: false, error: e.code || e.message }));
    socket.connect(port, host, () => {
      socket.write(packet(0, Buffer.concat([varint(47), varint(hostBuf.length), hostBuf, Buffer.from([port >> 8, port & 255]), varint(1)])));
      socket.write(packet(0, Buffer.alloc(0)));
    });
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      let i = 0, len = 0, shift = 0; while (i < buf.length) { const b = buf[i++]; len |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
      if (buf.length < i + len) return;
      let j = i; while (buf[j++] & 0x80); let sl = 0; shift = 0; while (j < buf.length) { const b = buf[j++]; sl |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
      try { const st = JSON.parse(buf.subarray(j, j + sl).toString('utf8')); const motd = typeof st.description === 'string' ? st.description : (st.description?.text || '') + (st.description?.extra || []).map(e => e.text || '').join(''); finish({ online: true, ping: Date.now() - start, players: st.players?.online ?? 0, max: st.players?.max ?? 0, version: st.version?.name || '', motd: motd.replace(/§./g, '').trim(), icon: st.favicon || null }); }
      catch (e) { finish({ online: false, error: 'Antwort unlesbar' }); }
    });
  });
}
ipcMain.handle('server:ping', (_e, address) => { const [host, port] = String(address).split(':'); return pingServer(host, Number(port) || 25565); });

// ---------- Lokaler Server ----------
const SERVERS = path.join(DATA_DIR, 'servers');
let serverProc = null, serverProfile = null;
function serverDir(profileId) { const d = path.join(SERVERS, profileId); fs.mkdirSync(d, { recursive: true }); return d; }
function lanIps() { const out = []; for (const list of Object.values(os.networkInterfaces())) for (const i of list) if (i.family === 'IPv4' && !i.internal) out.push(i.address); return out; }
ipcMain.handle('server:info', (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const d = serverDir(profileId), props = fs.existsSync(path.join(d, 'server.properties')) ? fs.readFileSync(path.join(d, 'server.properties'), 'utf8') : '';
  const port = (props.match(/^server-port=(\d+)/m) || [])[1] || '25565';
  return { installed: fs.existsSync(path.join(d, 'server.jar')), eula: fs.existsSync(path.join(d, 'eula.txt')) && /eula=true/.test(fs.readFileSync(path.join(d, 'eula.txt'), 'utf8')),
    running: !!serverProc && serverProfile === profileId, port, version: p.version, lanIps: lanIps(), memory: p.serverMemory || 2, hasWorld: fs.existsSync(path.join(d, 'world', 'level.dat')) };
});
ipcMain.handle('server:setup', async (_e, { profileId, port, memory, eulaAccepted }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  if (!eulaAccepted) throw new Error('Bitte die Minecraft-EULA bestätigen');
  const d = serverDir(profileId), vj = await versionJson(p.version);
  if (!vj.downloads?.server?.url) throw new Error('Für diese Version gibt es keinen offiziellen Server');
  if (!fs.existsSync(path.join(d, 'server.jar'))) { send('server:log', 'Server-Jar wird heruntergeladen…'); await download(vj.downloads.server.url, path.join(d, 'server.jar'), (x) => send('launch:progress', { task: 'Server', percent: x })); }
  await fsp.writeFile(path.join(d, 'eula.txt'), `# Bestätigt im LellekClient am ${new Date().toISOString()}\neula=true\n`);
  let props = fs.existsSync(path.join(d, 'server.properties')) ? await fsp.readFile(path.join(d, 'server.properties'), 'utf8') : 'online-mode=true\nmotd=LellekClient Server\n';
  props = /^server-port=/m.test(props) ? props.replace(/^server-port=.*$/m, `server-port=${port}`) : props + `server-port=${port}\n`;
  await fsp.writeFile(path.join(d, 'server.properties'), props);
  p.serverMemory = memory; saveStore();
  return true;
});
ipcMain.handle('server:importWorld', async (_e, { profileId, name }) => {
  const d = serverDir(profileId), src = path.join(savesDir(profileId), path.basename(name));
  if (serverProc && serverProfile === profileId) throw new Error('Server zuerst stoppen');
  await fsp.rm(path.join(d, 'world'), { recursive: true, force: true });
  await fsp.cp(src, path.join(d, 'world'), { recursive: true });
  return true;
});
ipcMain.handle('server:start', async (_e, profileId) => {
  if (serverProc) throw new Error('Es läuft bereits ein Server');
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const d = serverDir(profileId);
  if (!fs.existsSync(path.join(d, 'server.jar'))) throw new Error('Server zuerst einrichten');
  const vj = await versionJson(p.version);
  const java = p.javaPath || await ensureJava(vj.javaVersion?.majorVersion ?? 8, (m) => send('server:log', m));
  const javaBin = java.replace(/javaw\.exe$/i, 'java.exe');
  serverProc = spawn(javaBin, [`-Xmx${p.serverMemory || 2}G`, '-jar', 'server.jar', 'nogui'], { cwd: d });
  serverProfile = profileId;
  const pipe = (chunk) => { for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) send('server:log', streamerActive() && store.settings.streamer?.hideIps !== false ? maskText(line) : line); };
  serverProc.stdout.on('data', pipe); serverProc.stderr.on('data', pipe);
  serverProc.on('close', (code) => { send('server:log', `Server beendet (Code ${code})`); serverProc = null; serverProfile = null; send('server:state', { running: false }); });
  send('server:state', { running: true });
  return true;
});
ipcMain.handle('server:command', (_e, cmd) => { if (!serverProc) throw new Error('Kein Server aktiv'); serverProc.stdin.write(cmd + '\n'); });
ipcMain.handle('server:stop', () => { if (serverProc) serverProc.stdin.write('stop\n'); });
ipcMain.handle('server:openFolder', (_e, profileId) => shell.openPath(serverDir(profileId)));
app.on('before-quit', () => { if (serverProc) { try { serverProc.stdin.write('stop\n'); } catch {} } });

// ---------- Cosmetics-Server: Login + Cape-Upload ----------
let cosmeticsToken = null;
function cosmeticsBase() { const s = (store.settings.cosmeticsServer || 'http://127.0.0.1:8765').trim(); return s.replace(/\/$/, ''); }
async function cosmeticsLogin() {
  if (!currentAuth) throw new Error('Nicht eingeloggt');
  const serverId = crypto.randomBytes(20).toString('hex');
  const j = await fetch('https://sessionserver.mojang.com/session/minecraft/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: currentAuth.mclc.access_token, selectedProfile: currentAuth.profile.id.replace(/-/g, ''), serverId }) });
  if (j.status !== 204 && !j.ok) throw new Error(`Mojang-Login fehlgeschlagen (${j.status})`);
  const r = await fetch(cosmeticsBase() + '/v1/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: currentAuth.profile.name, serverId }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Cosmetics-Server ${r.status}`);
  cosmeticsToken = data.token;
}
async function cosmeticsFetch(method, path, body, type) {
  if (!cosmeticsToken) await cosmeticsLogin();
  let r = await fetch(cosmeticsBase() + path, { method, headers: { Authorization: `Bearer ${cosmeticsToken}`, ...(type ? { 'Content-Type': type } : {}) }, body });
  if (r.status === 401) { await cosmeticsLogin(); r = await fetch(cosmeticsBase() + path, { method, headers: { Authorization: `Bearer ${cosmeticsToken}`, ...(type ? { 'Content-Type': type } : {}) }, body }); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Cosmetics-Server ${r.status}`);
  return data;
}
ipcMain.handle('voice:status', async () => { const b = (store.settings.voiceServer || 'http://127.0.0.1:8766').trim().replace(/\/$/, ''); try { const r = await fetch(b + '/v1/stats'); const j = await r.json(); return { ...j, online: r.ok, players: j.online, server: b }; } catch { return { online: false, server: b }; } });
ipcMain.handle('cosmetics:status', async () => {
  try { const r = await fetch(cosmeticsBase() + '/v1/stats'); const j = await r.json(); return { online: r.ok, ...j, server: cosmeticsBase() }; } catch { return { online: false, server: cosmeticsBase() }; }
});
ipcMain.handle('cosmetics:myCape', async () => {
  if (!currentAuth) return null;
  try { const r = await fetch(`${cosmeticsBase()}/v1/capes/${currentAuth.profile.id.replace(/-/g, '')}.png`); if (!r.ok) return null; return 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); } catch { return null; }
});
ipcMain.handle('cosmetics:uploadCape', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Cape (PNG 64x32, 128x64, 256x128)', extensions: ['png'] }] });
  if (canceled) return false;
  const buf = await fsp.readFile(filePaths[0]);
  await cosmeticsFetch('PUT', '/v1/capes/me', buf, 'image/png');
  await cosmeticsFetch('PUT', '/v1/cosmetics/me', JSON.stringify({ cosmetic: 'customcape' }), 'application/json');
  return true;
});
ipcMain.handle('cosmetics:deleteCape', async () => { await cosmeticsFetch('DELETE', '/v1/capes/me'); return true; });

// ---------- Discord Rich Presence ----------
// Braucht eine Discord-App-ID (discord.com/developers → New Application → Application ID). Bilder: dort unter
// Rich Presence → Art Assets Bilder mit den Namen "logo", "forge", "fabric", "vanilla" hochladen (optional).
// Feste App-ID des LellekClient. Einmalig vom Betreiber unter discord.com/developers angelegt – Nutzer müssen nichts einrichten.
// Solange hier nichts steht, greift die ID aus den Optionen (Erweitert).
const DEFAULT_DISCORD_APP = '1547684547364392961';
const DEFAULT_DISCORD_IMAGE = ''; // z. B. https://raw.githubusercontent.com/<user>/LellekClient/main/assets/icon.png
let discord = null, discordReady = false, presence = { state: 'launcher' };
const gameContext = new Map(); // profileId → { server, world }
async function discordConnect() {
  const appId = store.settings.discordAppId || DEFAULT_DISCORD_APP;
  if (!appId || store.settings.discord === false) return;
  try {
    const { Client } = require('@xhayper/discord-rpc');
    discord = new Client({ clientId: appId });
    discord.on('ready', () => { discordReady = true; updatePresence(); });
    discord.on('disconnected', () => { discordReady = false; setTimeout(discordConnect, 30000); });
    await discord.login();
  } catch (e) { discordReady = false; discord = null; setTimeout(discordConnect, 60000); }
}
function updatePresence() {
  if (!discordReady || !discord?.user) return;
  const runningIds = [...running.keys()];
  let activity;
  const img = (store.settings.discordImageUrl || '').trim() || DEFAULT_DISCORD_IMAGE || 'logo'; // Discord akzeptiert auch direkte https-Bild-URLs
  if (!runningIds.length) activity = { details: 'Im Launcher', state: `${store.profiles.length} Profile`, largeImageKey: img, largeImageText: 'LellekClient', startTimestamp: launcherStart };
  else {
    const p = store.profiles.find(x => x.id === runningIds[0]); const ctx = gameContext.get(p.id) || {};
    const where = ctx.server ? `Auf ${ctx.server}` : ctx.world ? `Einzelspieler: ${ctx.world}` : 'Im Hauptmenü';
    activity = { details: `Spielt ${p.version} (${p.loader ? p.loader[0].toUpperCase() + p.loader.slice(1) : 'Vanilla'})`, state: where, largeImageKey: img, largeImageText: 'LellekClient', smallImageKey: (store.settings.discordImageUrl || '').trim() ? undefined : (p.loader || 'vanilla'), smallImageText: p.name, startTimestamp: ctx.since || Date.now() };
    if (runningIds.length > 1) activity.state += ` · +${runningIds.length - 1} weitere`;
  }
  if (streamerActive() && store.settings.streamer?.discordMinimal !== false && runningIds.length) { activity.state = 'Im Spiel'; activity.smallImageText = 'LellekClient'; }
  discord.user.setActivity(activity).catch(() => {});
}
const launcherStart = Date.now();
/** Server/Welt aus dem Spiel-Log erkennen (versionsunabhängig) */
function trackGameLog(p, line) {
  noteLine(p, line);
  const ctx = gameContext.get(p.id) || { since: Date.now() };
  let m;
  if ((m = /Connecting to ([^,\s]+)/.exec(line))) { ctx.server = m[1]; ctx.world = null; }
  else if ((m = /Preparing level "([^"]+)"/.exec(line))) { ctx.world = m[1]; ctx.server = null; }
  else if (/Stopping singleplayer server|Disconnecting|Stopping server|disconnect\.quitting/.test(line)) { ctx.server = null; ctx.world = null; }
  else return;
  gameContext.set(p.id, ctx); updatePresence();
}
app.whenReady().then(() => setTimeout(discordConnect, 3000));

// ---------- .minecraft-Anbindung ----------
function vanillaDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || app.getPath('appData'), '.minecraft');
  if (process.platform === 'darwin') return path.join(app.getPath('home'), 'Library', 'Application Support', 'minecraft');
  return path.join(app.getPath('home'), '.minecraft');
}
/** Einstellungen (options.txt, Serverliste, OptiFine/Shader-Optionen) aus .minecraft übernehmen, wenn das Profil noch keine hat */
async function importVanillaSettings(p, log = () => {}, force = false) {
  const src = vanillaDir(), dir = instanceDir(p);
  if (!fs.existsSync(src)) return false;
  let n = 0;
  for (const f of ['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt', 'hotbar.nbt']) {
    const from = path.join(src, f), to = path.join(dir, f);
    if (fs.existsSync(from) && (force || !fs.existsSync(to))) { await fsp.copyFile(from, to); n++; }
  }
  if (n) log(`${n} Einstellungsdatei(en) aus .minecraft übernommen`);
  return n > 0;
}
/** Welten, Resourcepacks, Screenshots mit .minecraft teilen (Junction/Symlink – kein Admin nötig) */
async function linkVanillaFolders(p, enable) {
  const src = vanillaDir(), dir = instanceDir(p);
  for (const f of ['saves', 'resourcepacks', 'screenshots']) {
    const target = path.join(src, f), link = path.join(dir, f);
    const st = fs.existsSync(link) ? fs.lstatSync(link) : null;
    if (enable) {
      if (st?.isSymbolicLink()) continue;
      if (st && fs.readdirSync(link).length) { await fsp.rename(link, link + '.lokal'); } else if (st) await fsp.rm(link, { recursive: true, force: true });
      fs.mkdirSync(target, { recursive: true });
      await fsp.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    } else if (st?.isSymbolicLink()) { await fsp.unlink(link); if (fs.existsSync(link + '.lokal')) await fsp.rename(link + '.lokal', link); else fs.mkdirSync(link, { recursive: true }); }
  }
}
ipcMain.handle('vanilla:info', () => { const d = vanillaDir(); return { dir: d, exists: fs.existsSync(d), hasOptions: fs.existsSync(path.join(d, 'options.txt')) }; });
ipcMain.handle('vanilla:importSettings', async (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden'); return importVanillaSettings(p, () => {}, true); });
ipcMain.handle('vanilla:link', async (_e, { profileId, enable }) => { const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden'); await linkVanillaFolders(p, enable); p.linkVanilla = enable; saveStore(); return true; });

// ---------- Einstellungen ----------
ipcMain.handle('settings:get', () => ({ ...store.settings, dataDir: DATA_DIR, portable: !!PORTABLE, totalMemoryGb: Math.round(os.totalmem() / 1e9), clientVersion: CLIENT_VERSION }));
ipcMain.handle('settings:save', (_e, s) => { setTimeout(buildTray, 100); const before = store.settings.discordAppId + '|' + store.settings.discordImageUrl; store.settings = { ...store.settings, ...s }; saveStore(); if (store.settings.discordAppId + '|' + store.settings.discordImageUrl !== before || !discord) { try { discord?.destroy(); } catch {} discord = null; discordReady = false; discordConnect(); } else updatePresence(); return store.settings; });
ipcMain.handle('settings:openDataDir', () => shell.openPath(DATA_DIR));

// ---------- Spielstart ----------
const running = new Map(); // profileId → Prozess
let lastLogFile = null;
const logWindows = new Map(); // profileId → BrowserWindow
ipcMain.handle('crash:open', (_e, file) => shell.openPath(file));
ipcMain.handle('launch:running', () => [...running.keys()]);
ipcMain.handle('launch:kill', (_e, profileId) => { const pr = running.get(profileId); if (pr) pr.kill(); });
ipcMain.handle('launch:openLog', (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (!p) return; const w = logWindows.get(p.id); if (w && !w.isDestroyed()) w.focus(); else openLogWindow(p); });
ipcMain.handle('logs:openFolder', () => shell.openPath(path.join(DATA_DIR, 'logs')));
ipcMain.handle('logs:openLast', () => lastLogFile ? shell.openPath(lastLogFile) : null);
function openLogWindow(p) {
  const w = new BrowserWindow({ width: 900, height: 520, title: `Log – ${p.name}`, backgroundColor: '#0F0B06', icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'log.html'), { query: { name: p.name, version: p.version } });
  w.on('closed', () => { if (logWindows.get(p.id) === w) logWindows.delete(p.id); });
  logWindows.set(p.id, w);
  return w;
}
const sendLog = (p, channel, payload) => { payload = maskPayload(payload); send(channel, { profileId: p.id, ...payload }); const w = logWindows.get(p.id); if (w && !w.isDestroyed()) w.webContents.send(channel, { profileId: p.id, ...payload }); };
ipcMain.handle('launch', async (_e, profileId, server) => {
  const p = store.profiles.find(x => x.id === profileId);
  if (!server && p?.autoServer) server = p.autoServer;
  if (!p) throw new Error('Profil nicht gefunden');
  if (running.has(profileId)) throw new Error(`„${p.name}“ läuft bereits`);
  resetSessionTracking(profileId);
  const authorization = await authFor(p.accountId);
  if (store.settings.logWindow !== false) openLogWindow(p);
  const LOG_DIR = path.join(DATA_DIR, 'logs');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = path.join(LOG_DIR, `${p.name.replace(/[^\w\- ]/g, '')}_${stamp}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  lastLogFile = logFile;
  const log = (m) => { const line = String(m).replace(/--accessToken \S+/g, '--accessToken ***'); logStream.write(line + '\n'); sendLog(p, 'launch:log', { line }); trackGameLog(p, line); };
  // alte Logs aufräumen (max. 30)
  try { const old = (await fsp.readdir(LOG_DIR)).filter(f => f.endsWith('.log')).sort(); for (const f of old.slice(0, Math.max(0, old.length - 30))) await fsp.rm(path.join(LOG_DIR, f)); } catch {}

  const vj = await versionJson(p.version);
  const javaMajor = vj.javaVersion?.majorVersion ?? 8;
  const javaPath = p.javaPath || await ensureJava(javaMajor, log, needsX64Java(p.version));
  if (needsX64Java(p.version) && !p.javaPath) log('Apple Silicon: Minecraft ' + p.version + ' läuft mit Intel-Java über Rosetta 2 (falls nötig, installiert macOS Rosetta beim ersten Start)');
  const dir = instanceDir(p);
  fs.mkdirSync(dir, { recursive: true });
  await writeSpotifyFile(dir);
  try { await ensureHud(p, log); } catch (e) { log('LellekHUD konnte nicht aktualisiert werden: ' + e.message); }
  if (store.settings.importVanilla !== false) { try { await importVanillaSettings(p, log); } catch {} }
  if (store.settings.autoUpdateMods && p.loader) { try { await autoUpdateMods(p, log); } catch (e) { log('Mod-Updates: ' + e.message); } }
  try { fs.mkdirSync(path.join(dir, 'lellek'), { recursive: true }); await fsp.writeFile(path.join(dir, 'lellek', 'cosmetics-server.txt'), cosmeticsBase()); await fsp.writeFile(path.join(dir, 'lellek', 'streamer.txt'), streamerActive() ? 'true' : 'false'); await fsp.writeFile(path.join(dir, 'lellek', 'voice-server.txt'), (store.settings.voiceServer || 'http://127.0.0.1:8766').trim().replace(/\/$/, '')); } catch {}

  if (store.settings.backupWorlds !== false) { try { await backupWorlds(p, log); } catch (e) { log('Backup fehlgeschlagen: ' + e.message); } }
  const launchStart = Date.now();
  const opts = {
    authorization,
    root: ROOT,
    overrides: { gameDirectory: dir },
    version: { number: p.version, type: (store.settings.ui?.menuBrand || '').trim().slice(0, 40) || `${CLIENT_NAME} ${CLIENT_VERSION}` }, // erscheint links unten im Hauptmenü
    memory: { max: `${p.memory || store.settings.memory || 4}G`, min: '1G' },
    javaPath,
    customArgs: (p.jvmArgs || '').split(/\s+/).filter(Boolean),
    window: { width: p.width || 854, height: p.height || 480, fullscreen: !!p.fullscreen },
  };
  if (server) { // Direktverbindung: neue Versionen über Quick Play, alte über --server
    const [ip, port] = server.split(':');
    if (mcMinor(p.version) >= 20 || p.version.startsWith('26')) opts.quickPlay = { type: 'multiplayer', identifier: server };
    else opts.customLaunchArgs = ['--server', ip, '--port', port || '25565'];
    log(`Verbinde direkt mit ${server}`);
  }
  if (p.loader === 'fabric') { opts.version.custom = await prepareFabric(p.version, p.loaderVersion); await ensureFabricApi(p, log); }
  if (p.loader === 'forge') opts.forge = await prepareForge(p.version, p.loaderVersion, log);
  if (p.loader === 'neoforge') opts.forge = await prepareNeoForge(p.version, p.loaderVersion, log);
  if (opts.forge) clearStaleForgeCache(p.version, opts.forge, log);

  const launcher = new Client();
  launcher.on('debug', (m) => log(m));
  launcher.on('data', (m) => log(String(m).trimEnd()));
  launcher.on('progress', (e) => sendLog(p, 'launch:progress', { task: e.type, percent: e.total ? e.task / e.total : 0 }));
  launcher.on('close', async (code) => {
    running.delete(profileId); gameContext.delete(profileId); updatePresence();
    p.playtimeMs = (p.playtimeMs || 0) + (Date.now() - launchStart); p.lastPlayed = Date.now(); recordSession(p, launchStart, code); saveStore();
    log(`Minecraft beendet mit Code ${code}`);
    let crash = null;
    if (code !== 0) notify('LellekClient', `${p.name} ist abgestürzt (Code ${code})`);
    if (code !== 0) { try { const cr = path.join(dir, 'crash-reports'); const files = (await fsp.readdir(cr)).map(f => ({ f, t: fs.statSync(path.join(cr, f)).mtimeMs })).filter(x => x.t > launchStart).sort((a, b) => b.t - a.t); if (files[0]) { crash = path.join(cr, files[0].f); log('Crash-Report: ' + crash); } } catch {} }
    logStream.end(); let analysis = null; if (code !== 0 && !userKilled.delete(p.id)) { try { analysis = analyzeCrash(p, crash); } catch {} } sendLog(p, 'launch:closed', { code, crash, analysis });
  });

  log(`Starte ${p.name} (${p.version}${p.loader ? ', ' + p.loader + ' ' + p.loaderVersion : ''}) mit Java ${javaMajor}`);
  const proc = await launcher.launch(opts);
  if (!proc) { running.delete(profileId); throw new Error('Minecraft konnte nicht gestartet werden – siehe Log'); }
  running.set(profileId, proc);
  gameContext.set(profileId, { since: Date.now() }); updatePresence();
  if (store.settings.closeOnLaunch) win.minimize();
  return true;
});

// =====================================================================
// LellekClient 1.8 – neue Funktionen
// =====================================================================

// ---------- Einzelinstanz + Startparameter (--launch=<profilId>) ----------
// Ein zweiter Start (z. B. über eine Desktop-Verknüpfung) holt das offene Fenster nach vorn und startet das Profil dort.
function launchArg(argv) { const a = (argv || []).find(x => /^--launch=/.test(String(x))); return a ? String(a).slice(9) : null; }
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on('second-instance', (_e, argv) => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    const id = launchArg(argv); if (id) launchFromShortcut(id);
  });
  const first = launchArg(process.argv);
  if (first) app.whenReady().then(() => { const go = () => launchFromShortcut(first); if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(go, 800)); else setTimeout(go, 800); });
}
/** Wartet kurz auf die Anmeldung (Token-Refresh beim Start) und reicht den Start an die Oberfläche weiter */
async function launchFromShortcut(id) {
  if (!store.profiles.some(p => p.id === id)) return;
  const until = Date.now() + 15000;
  while (!currentAuth && store.accounts.length && Date.now() < until) await new Promise(r => setTimeout(r, 300));
  send('tray:launch', id);
}

// ---------- Desktop-Verknüpfung pro Profil ----------
ipcMain.handle('shortcut:create', async (_e, id) => {
  const p = store.profiles.find(x => x.id === id); if (!p) throw new Error('Profil nicht gefunden');
  if (process.platform !== 'win32') throw new Error('Desktop-Verknüpfungen gibt es nur unter Windows');
  const safe = p.name.replace(/[<>:"/\\|?*]/g, '').trim() || 'Profil';
  const file = path.join(app.getPath('desktop'), `${safe} - LellekClient.lnk`);
  const ok = shell.writeShortcutLink(file, 'create', { target: process.execPath, args: `--launch=${p.id}`, description: `${p.name} (${p.version}) mit LellekClient starten`, icon: process.execPath, iconIndex: 0, cwd: path.dirname(process.execPath) });
  if (!ok) throw new Error('Verknüpfung konnte nicht erstellt werden');
  return file;
});

// ---------- Letzte Log-Zeilen pro Instanz (für Diagnose & Statistik) ----------
const recentLines = new Map();   // profileId → string[] (max. 400)
const sessionServers = new Map(); // profileId → Set(server)
const sessionWorlds = new Map();  // profileId → Set(welt)
function noteLine(p, line) {
  let arr = recentLines.get(p.id); if (!arr) { arr = []; recentLines.set(p.id, arr); }
  arr.push(String(line)); if (arr.length > 400) arr.splice(0, arr.length - 400);
  let m;
  if ((m = /Connecting to ([^,\s]+)/.exec(line))) { if (!sessionServers.has(p.id)) sessionServers.set(p.id, new Set()); sessionServers.get(p.id).add(m[1]); }
  if ((m = /Preparing level "([^"]+)"/.exec(line))) { if (!sessionWorlds.has(p.id)) sessionWorlds.set(p.id, new Set()); sessionWorlds.get(p.id).add(m[1]); }
}
function resetSessionTracking(id) { userKilled.delete(id); recentLines.set(id, []); sessionServers.delete(id); sessionWorlds.delete(id); }

// ---------- Absturz-Diagnose ----------
const CRASH_RULES = [
  { re: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i, title: 'Zu wenig Arbeitsspeicher', hint: 'Minecraft hatte nicht genug RAM. Gib dem Profil mehr Arbeitsspeicher (z. B. +2 GB) – aber nie mehr als etwa die Hälfte deines PC-RAMs.', action: 'memory' },
  { re: /Could not reserve enough space for (?:object heap|\d+KB object heap)|Invalid maximum heap size/i, title: 'RAM-Einstellung zu hoch', hint: 'Java konnte den eingestellten Arbeitsspeicher nicht reservieren. Stell im Profil weniger GB ein.', action: 'memoryDown' },
  { re: /UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime|class file version \d+/i, title: 'Falsche Java-Version', hint: 'Eine Mod oder das Spiel braucht ein neueres Java. Lass im Profil den eigenen Java-Pfad leer – dann lädt der Launcher automatisch das passende Java.', action: 'java' },
  { re: /Incompatible mods? (?:set|found)|Mod resolution encountered an incompatible mod set|Missing or unsupported mandatory dependencies|MissingModsException|requires (?:any version|version [^ ]+) of/i, title: 'Fehlende oder unpassende Abhängigkeit', hint: 'Mindestens eine Mod braucht eine andere Mod (oder eine andere Version davon). Die betroffenen Mods stehen unten – installiere sie über Mods → Modrinth oder entferne die Mod, die sie braucht.', action: 'deps' },
  { re: /DuplicateModsFoundException|Found duplicate mods|Duplicate mods? found|duplicate mod ids?/i, title: 'Mod doppelt installiert', hint: 'Dieselbe Mod liegt mehrfach im Mods-Ordner. Unter Mods → „Konflikte prüfen“ siehst du welche – lösch die ältere Datei.', action: 'conflicts' },
  { re: /Mixin apply (?:for mod \S+ )?failed|MixinApplyError|InvalidInjectionException|InvalidMixinException|Mixin transformation of .* failed/i, title: 'Mods vertragen sich nicht (Mixin-Fehler)', hint: 'Eine Mod kann sich nicht ins Spiel einklinken – meist ist sie für eine andere Minecraft-Version oder kollidiert mit einer anderen Mod. Deaktiviere die unten genannte Mod oder aktualisiere sie.', action: 'mods' },
  { re: /Pixel format not accelerated|GLFW error 65542|WGL: The driver does not appear to support OpenGL|No OpenGL context|OpenGL 3\.2 is required/i, title: 'Grafiktreiber-Problem', hint: 'Dein Grafiktreiber unterstützt das benötigte OpenGL nicht. Aktualisiere den Treiber (NVIDIA/AMD/Intel) und stell sicher, dass Minecraft die richtige Grafikkarte nutzt.', action: 'driver' },
  { re: /EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime/i, title: 'Absturz im Grafik- oder Java-Kern', hint: 'Meist verursacht durch Shader, Grafiktreiber oder Overlays (Discord, MSI Afterburner). Probier es ohne Shader, aktualisiere den Grafiktreiber oder starte im „Sicheren Start“.', action: 'safe' },
  { re: /Invalid session|Failed to verify username|Not authenticated with Minecraft\.net|401 Unauthorized/i, title: 'Anmeldung abgelaufen', hint: 'Deine Sitzung ist ungültig. Melde dich oben rechts ab und wieder an.', action: 'login' },
  { re: /NoClassDefFoundError|ClassNotFoundException/i, title: 'Klasse nicht gefunden', hint: 'Eine Mod sucht Code, der fehlt – meist fehlt eine Abhängigkeit (z. B. Fabric API, Cloth Config, Architectury) oder die Mod ist für den falschen Loader.', action: 'deps' },
  { re: /ConcurrentModificationException|StackOverflowError/i, title: 'Fehler in einer Mod', hint: 'Eine Mod hat einen internen Fehler ausgelöst. Schau im Crash-Report nach dem ersten Mod-Namen im Stacktrace und aktualisiere oder entferne diese Mod.', action: 'mods' },
];
/** Liefert Diagnosen zu einem Log-/Crash-Text */
function analyzeText(text, p) {
  const out = [];
  for (const r of CRASH_RULES) if (r.re.test(text) && !out.some(o => o.title === r.title)) out.push({ title: r.title, hint: r.hint, action: r.action });
  const details = new Set();
  // Fabric: "- Install fabric-api, any version." / "Mod 'X' (x) 1.0 requires version 2 of 'Y' (y)"
  for (const m of text.matchAll(/- (Install|Replace) ([\w\-.]+)(?:,| with)? ([^\n]*?)\.?$/gm)) details.add(`${m[1] === 'Install' ? 'Installieren' : 'Ersetzen'}: ${m[2]}${m[3] ? ' (' + m[3].trim() + ')' : ''}`);
  for (const m of text.matchAll(/Mod '([^']+)' \([^)]*\)[^\n]*?requires [^\n]*?of '?([^'\n(]+)'? ?(?:\(([^)]+)\))?/g)) details.add(`${m[1]} braucht ${m[2].trim()}${m[3] ? ' (' + m[3] + ')' : ''}`);
  // Forge: "Mod ID: 'x', Requested by: 'y', Expected range: '[1,)'"
  for (const m of text.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)'/g)) details.add(`${m[2]} braucht ${m[1]}`);
  // Mixin: "from mod xyz" / "xyz.mixins.json"
  for (const m of text.matchAll(/from mod ([\w\-]+)/g)) details.add(`Mod: ${m[1]}`);
  for (const m of text.matchAll(/([\w\-]+)\.mixins?\.json/g)) if (!/^(mixins|common)$/i.test(m[1])) details.add(`Mixin-Konfiguration: ${m[1]}`);
  const desc = (/^Description: (.+)$/m.exec(text) || [])[1];
  if (!out.length) out.push({ title: 'Unbekannte Ursache', hint: 'Keine bekannte Fehlerursache erkannt. Öffne den Crash-Report oder das Log und such nach dem ersten „Exception“ bzw. „Caused by“. Ein „Sicherer Start“ ohne Mods zeigt, ob eine Mod schuld ist.', action: p?.loader ? 'safe' : null });
  const cause = (/^Caused by: (.+)$/m.exec(text) || [])[1] || (/\b((?:[\w$]+\.)+[\w$]*(?:Exception|Error)\b[^\n]*)/.exec(text) || [])[1] || '';
  return { problems: out, details: [...details].slice(0, 12), description: desc || '', cause: cause.slice(0, 300) };
}
function analyzeCrash(p, crashFile) {
  let text = (recentLines.get(p.id) || []).join('\n');
  try { if (crashFile && fs.existsSync(crashFile)) text = fs.readFileSync(crashFile, 'utf8') + '\n' + text; } catch {}
  return { ...analyzeText(text, p), crash: crashFile || null, profileId: p.id, profileName: p.name };
}
ipcMain.handle('crash:analyzeLast', async (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  let text = '', crash = null;
  try { const cr = path.join(instanceDir(p), 'crash-reports'); const f = (await fsp.readdir(cr)).filter(x => x.endsWith('.txt')).map(x => ({ x, t: fs.statSync(path.join(cr, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0]; if (f) { crash = path.join(cr, f.x); text += await fsp.readFile(crash, 'utf8'); } } catch {}
  try { const LOG_DIR = path.join(DATA_DIR, 'logs'); const pre = p.name.replace(/[^\w\- ]/g, '') + '_'; const f = (await fsp.readdir(LOG_DIR)).filter(x => x.startsWith(pre) && x.endsWith('.log')).sort().pop(); if (f) text += '\n' + (await fsp.readFile(path.join(LOG_DIR, f), 'utf8')).slice(-200000); } catch {}
  if (!text && recentLines.get(p.id)?.length) text = recentLines.get(p.id).join('\n');
  if (!text) return { problems: [], details: [], empty: true, profileId: p.id, profileName: p.name };
  return { ...analyzeText(text, p), crash, profileId: p.id, profileName: p.name };
});
ipcMain.handle('profiles:adjustMemory', (_e, { id, delta }) => {
  const p = store.profiles.find(x => x.id === id); if (!p) throw new Error('Profil nicht gefunden');
  const maxGb = Math.max(2, Math.floor(os.totalmem() / 1e9 * 0.75));
  p.memory = Math.min(maxGb, Math.max(1, (p.memory || store.settings.memory || 4) + delta)); saveStore();
  return p.memory;
});
ipcMain.handle('profiles:clearJava', (_e, id) => { const p = store.profiles.find(x => x.id === id); if (p) { p.javaPath = ''; saveStore(); } return true; });

// ---------- Spielstatistik (Sitzungen) ----------
function recordSession(p, start, code) {
  store.sessions ??= [];
  const end = Date.now(); if (end - start < 5000 && code === 0) return; // Fehlstarts ignorieren
  store.sessions.push({ profileId: p.id, name: p.name, version: p.version, loader: p.loader || '', start, end, code,
    servers: [...(sessionServers.get(p.id) || [])].slice(0, 10), worlds: [...(sessionWorlds.get(p.id) || [])].slice(0, 10) });
  if (store.sessions.length > 1000) store.sessions.splice(0, store.sessions.length - 1000);
}
ipcMain.handle('stats:get', () => {
  const sessions = store.sessions || [];
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ key: dayKey(d), ms: 0, sessions: 0 }); }
  const byDay = Object.fromEntries(days.map(d => [d.key, d]));
  const servers = {}, worlds = {}, versions = {};
  let crashes = 0, sumMs = 0;
  for (const s of sessions) {
    const ms = Math.max(0, s.end - s.start); sumMs += ms; if (s.code !== 0) crashes++;
    const d = byDay[dayKey(s.start)]; if (d) { d.ms += ms; d.sessions++; }
    for (const sv of s.servers || []) servers[sv] = (servers[sv] || 0) + 1;
    for (const w of s.worlds || []) worlds[w] = (worlds[w] || 0) + 1;
    versions[s.version] = (versions[s.version] || 0) + ms;
  }
  const profiles = store.profiles.map(p => ({ id: p.id, name: p.name, version: p.version, icon: p.icon || '', color: p.color || '', ms: p.playtimeMs || 0, sessions: sessions.filter(s => s.profileId === p.id).length, lastPlayed: p.lastPlayed || 0 })).sort((a, b) => b.ms - a.ms);
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n }));
  // Serie: an wie vielen Tagen in Folge (bis heute/gestern) gespielt wurde
  const played = new Set(sessions.map(s => dayKey(s.start))); let streak = 0; const c = new Date(); if (!played.has(dayKey(c))) c.setDate(c.getDate() - 1); while (played.has(dayKey(c))) { streak++; c.setDate(c.getDate() - 1); }
  return { totalMs: store.profiles.reduce((a, p) => a + (p.playtimeMs || 0), 0), trackedMs: sumMs, sessionCount: sessions.length, crashes, streak, days, profiles,
    servers: top(servers), worlds: top(worlds), versions: top(versions), recent: sessions.slice(-25).reverse() };
});
ipcMain.handle('stats:reset', () => { store.sessions = []; saveStore(); return true; });

// ---------- Mod-Sets: Kombinationen aktiver Mods speichern und umschalten ----------
const baseName = (f) => f.replace(/\.(disabled|safemode)$/i, '');
ipcMain.handle('modsets:list', (_e, profileId) => { const p = store.profiles.find(x => x.id === profileId); if (!p) return []; return Object.entries(p.modSets || {}).map(([name, files]) => ({ name, count: files.length })); });
ipcMain.handle('modsets:save', async (_e, { profileId, name }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const n = String(name || '').trim().slice(0, 40); if (!n) throw new Error('Bitte einen Namen angeben');
  const dir = kindDir(profileId, 'mods');
  const files = (await fsp.readdir(dir)).filter(f => /\.jar$/i.test(f));
  p.modSets ??= {}; p.modSets[n] = files; saveStore();
  return { name: n, count: files.length };
});
ipcMain.handle('modsets:apply', async (_e, { profileId, name }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  if (running.has(profileId)) throw new Error('Profil läuft – erst beenden');
  const set = new Set(p.modSets?.[name] || []); if (!set.size && !p.modSets?.[name]) throw new Error('Mod-Set nicht gefunden');
  const dir = kindDir(profileId, 'mods'); let on = 0, off = 0;
  for (const f of await fsp.readdir(dir)) {
    if (!/\.jar(\.disabled|\.safemode)?$/i.test(f)) continue;
    const base = baseName(f), want = set.has(base) || /^LellekHUD-/i.test(base), isOn = /\.jar$/i.test(f);
    if (want && !isOn) { await fsp.rename(path.join(dir, f), path.join(dir, base)); on++; }
    else if (!want && isOn) { await fsp.rename(path.join(dir, f), path.join(dir, f + '.disabled')); off++; }
  }
  const present = new Set((await fsp.readdir(dir)).map(baseName));
  const missing = [...set].filter(f => !present.has(f));
  return { on, off, missing };
});
ipcMain.handle('modsets:delete', (_e, { profileId, name }) => { const p = store.profiles.find(x => x.id === profileId); if (p?.modSets) { delete p.modSets[name]; saveStore(); } return true; });

// ---------- Mod-Liste exportieren (Text in die Zwischenablage) ----------
ipcMain.handle('mods:exportList', async (_e, profileId) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const dir = kindDir(profileId, 'mods');
  const files = (await fsp.readdir(dir)).filter(f => /\.jar(\.disabled)?$/i.test(f)).sort((a, b) => a.localeCompare(b));
  const lines = [`${p.name} – Minecraft ${p.version}${p.loader ? ` (${p.loader} ${p.loaderVersion})` : ''}`, `${files.length} Mods · erstellt mit LellekClient ${CLIENT_VERSION}`, ''];
  for (const f of files) { const info = modIdOf(path.join(dir, f)); lines.push(`${f.endsWith('.disabled') ? '[aus] ' : '- '}${f.replace(/\.disabled$/, '')}${info?.version && !/\$\{/.test(info.version) ? `  (${info.id || '?'} ${info.version})` : ''}`); }
  const text = lines.join('\n'); clipboard.writeText(text);
  return { count: files.length, text };
});

// ---------- server.properties bearbeiten ----------
const PROP_KEYS = ['motd', 'gamemode', 'difficulty', 'max-players', 'pvp', 'online-mode', 'white-list', 'allow-flight', 'hardcore', 'view-distance', 'simulation-distance', 'spawn-protection', 'level-seed', 'enable-command-block'];
ipcMain.handle('serverprops:get', async (_e, profileId) => {
  const f = path.join(serverDir(profileId), 'server.properties');
  const txt = fs.existsSync(f) ? await fsp.readFile(f, 'utf8') : '';
  const out = {}; for (const line of txt.split(/\r?\n/)) { const m = /^([\w.\-]+)=(.*)$/.exec(line); if (m && PROP_KEYS.includes(m[1])) out[m[1]] = m[2]; }
  return { exists: !!txt, props: out };
});
ipcMain.handle('serverprops:save', async (_e, { profileId, props }) => {
  const f = path.join(serverDir(profileId), 'server.properties');
  if (!fs.existsSync(f)) throw new Error('Server zuerst einrichten');
  let txt = await fsp.readFile(f, 'utf8');
  for (const [k, v0] of Object.entries(props || {})) {
    if (!PROP_KEYS.includes(k)) continue;
    const v = String(v0 ?? '').replace(/[\r\n]/g, ' ');
    const re = new RegExp(`^${k.replace(/[.\-]/g, '\\$&')}=.*$`, 'm');
    txt = re.test(txt) ? txt.replace(re, () => `${k}=${v}`) : txt.replace(/\n?$/, `\n${k}=${v}\n`);
  }
  await fsp.writeFile(f, txt);
  return { restart: !!serverProc && serverProfile === profileId };
});

// Vom Nutzer beendete Instanzen nicht als Absturz diagnostizieren
const userKilled = new Set();
ipcMain.removeHandler('launch:kill');
ipcMain.handle('launch:kill', (_e, profileId) => { const pr = running.get(profileId); if (pr) { userKilled.add(profileId); pr.kill(); } });

// =====================================================================
// LellekClient 1.9 – NeoForge, Selbst-Updater, .mrpack-Export/-Import
// =====================================================================

// ---------- NeoForge ----------
/** NeoForge-Versionsschema: MC 1.21.1 → 21.1.x, MC 1.21 → 21.0.x, MC 26.1 → 26.1.x */
function neoPrefix(mc) { const p = String(mc).split('.'); return p[0] === '1' ? `${p[1]}.${p[2] || 0}.` : `${p[0]}.${p[1] || 0}.`; }
let neoCache = null;
async function neoforgeVersions(mc) {
  if (!neoCache || Date.now() - neoCache.at > 30 * 60000) neoCache = { at: Date.now(), list: (await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions || [] };
  const pre = neoPrefix(mc);
  const list = neoCache.list.filter(v => v.startsWith(pre));
  const stable = list.filter(v => !/beta|alpha/i.test(v)).sort((a, b) => cmpVer(b, a)), beta = list.filter(v => /beta|alpha/i.test(v)).sort((a, b) => cmpVer(b, a));
  return [...stable, ...beta].slice(0, 30);
}
ipcMain.handle('loaders:neoforge', async (_e, mc) => { try { return await neoforgeVersions(mc); } catch { return []; } });
async function prepareNeoForge(mc, version, log) {
  if (!version) throw new Error(`Keine NeoForge-Version für ${mc} gewählt`);
  const dest = path.join(ROOT, 'neoforge', `neoforge-${version}-installer.jar`);
  if (fs.existsSync(dest)) return dest;
  log(`NeoForge ${version} wird heruntergeladen…`);
  await download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`, dest);
  return dest;
}
/** MCLC speichert die erzeugte Forge-Versionsdatei pro Minecraft-Version – bei anderem Forge/NeoForge-Build veraltet sie */
function clearStaleForgeCache(mc, installerJar, log) {
  try {
    const cached = path.join(ROOT, 'forge', mc, 'version.json'); if (!fs.existsSync(cached)) return;
    const want = JSON.parse(new AdmZip(installerJar).readAsText('version.json')).id;
    const have = JSON.parse(fs.readFileSync(cached, 'utf8')).id;
    if (want && have && want !== have) { fs.rmSync(cached, { force: true }); log(`Loader gewechselt (${have} → ${want}) – Versionsdatei wird neu erzeugt`); }
  } catch {}
}

// ---------- Selbst-Updater ----------
// Fest eingebaute Update-Quelle für alle Nutzer, z. B. 'https://api.github.com/repos/DEIN-NAME/LellekClient/releases/latest'.
// Leer = nur die Adresse aus den Optionen.
const DEFAULT_UPDATE_URL = 'https://api.github.com/repos/conlog06/LellekClient/releases/latest';
let pendingUpdate = null; // { file, version }
async function downloadLong(url, dest, onProgress) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30 * 60000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'LellekClient', Accept: 'application/octet-stream' } });
    if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
    const total = Number(r.headers.get('content-length') || 0); let done = 0;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(dest + '.part'); const reader = r.body.getReader();
    while (true) { const { value, done: end } = await reader.read(); if (end) break; if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res)); done += value.length; if (onProgress && total) onProgress(done / total, done, total); }
    await new Promise(res => out.end(res));
    await fsp.rename(dest + '.part', dest);
    return { size: done, total };
  } finally { clearTimeout(t); }
}
ipcMain.handle('update:download', async () => {
  const url = (store.settings.updateUrl || '').trim() || DEFAULT_UPDATE_URL; if (!url) throw new Error('Keine Update-Quelle eingetragen (Optionen → Updates)');
  const j = await getJson(url);
  const latest = (j.tag_name || j.version || '').replace(/^v/, '');
  if (!latest || cmpVer(latest, CLIENT_VERSION) <= 0) throw new Error('Du hast schon die neueste Version');
  if (pendingUpdate?.version === latest && fs.existsSync(pendingUpdate.file)) return pendingUpdate;
  const assets = j.assets || [];
  const asset = assets.find(a => /\.exe$/i.test(a.name) && /setup/i.test(a.name)) || assets.find(a => /\.exe$/i.test(a.name) && !/portable/i.test(a.name));
  const dl = asset?.browser_download_url || j.installer || (/\.exe(\?|$)/i.test(j.url || '') ? j.url : null);
  if (!dl) throw new Error('Im Release wurde keine Setup-.exe gefunden – bitte manuell laden');
  if (process.platform === 'darwin') { const m = assets.find(a => new RegExp(`mac.*${process.arch === 'arm64' ? '(arm64|applesilicon)' : '(x64|intel)'}.*\\.(zip|dmg)$`, 'i').test(a.name)) || assets.find(a => /mac.*\.(zip|dmg)$/i.test(a.name)); shell.openExternal(m?.browser_download_url || j.html_url || url); return { external: true, version: latest }; }
  if (process.platform !== 'win32') throw new Error('Automatische Installation gibt es nur unter Windows');
  const dest = path.join(DATA_DIR, 'updates', `LellekClient-Setup-${latest}.exe`);
  await downloadLong(dl, dest, (x, done, total) => send('update:progress', { percent: x, done, total, version: latest }));
  if (asset?.size && fs.statSync(dest).size !== asset.size) { await fsp.rm(dest, { force: true }); throw new Error('Download unvollständig – bitte erneut versuchen'); }
  pendingUpdate = { file: dest, version: latest };
  try { for (const f of await fsp.readdir(path.dirname(dest))) if (f !== path.basename(dest)) await fsp.rm(path.join(path.dirname(dest), f), { force: true }); } catch {}
  return pendingUpdate;
});
ipcMain.handle('update:install', () => {
  if (!pendingUpdate || !fs.existsSync(pendingUpdate.file)) throw new Error('Kein heruntergeladenes Update');
  if (running.size) throw new Error('Bitte zuerst alle laufenden Minecraft-Instanzen beenden');
  if (serverProc) throw new Error('Bitte zuerst den lokalen Server stoppen');
  // Gleiche Parameter wie electron-updater: still installieren, danach LellekClient wieder starten
  const child = spawn(pendingUpdate.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 600);
  return true;
});

// ---------- .mrpack: Modrinth-Modpack installieren (Datei) ----------
async function installMrpackFile(packFile, name, removeAfter) {
  const progress = (task, percent) => send('launch:progress', { task, percent });
  const zip = new AdmZip(packFile);
  const idxEntry = zip.getEntry('modrinth.index.json'); if (!idxEntry) throw new Error('Keine modrinth.index.json – ist das ein .mrpack?');
  const index = JSON.parse(zip.readAsText(idxEntry)); const deps = index.dependencies || {};
  const loader = deps['fabric-loader'] ? 'fabric' : deps['neoforge'] ? 'neoforge' : deps['forge'] ? 'forge' : deps['quilt-loader'] ? 'quilt' : '';
  if (loader === 'quilt') throw new Error('Dieses Modpack braucht Quilt – der Launcher startet Fabric, Forge und NeoForge');
  if (!deps.minecraft) throw new Error('Modpack ohne Minecraft-Version');
  const p = await newProfileFrom(name || index.name || 'Modpack', deps.minecraft, loader, deps['fabric-loader'] || deps['neoforge'] || deps['forge'] || '');
  const dir = instanceDir(p), files = (index.files || []).filter(f => !f.env || f.env.client !== 'unsupported');
  let done = 0, failed = 0;
  await pool(files, 4, async (f) => {
    const out = path.join(dir, f.path); if (!out.startsWith(dir + path.sep)) return;
    try {
      await download(f.downloads[0], out);
      if (f.hashes?.sha1 && (await sha1(out)) !== f.hashes.sha1) { await fsp.rm(out, { force: true }); throw new Error('Prüfsumme falsch'); }
    } catch (e) { failed++; send('launch:log', { line: `Modpack: ${f.path} konnte nicht geladen werden (${e.message})` }); }
    progress(`Mod ${++done}/${files.length}`, done / files.length);
  });
  copyOverrides(zip, 'overrides/', dir); copyOverrides(zip, 'client-overrides/', dir);
  if (removeAfter) await fsp.rm(packFile, { force: true });
  progress('Fertig', 1); notify('LellekClient', `Modpack „${p.name}“ installiert`);
  return { profiles: store.profiles, id: p.id, name: p.name, version: p.version, loader, mods: files.length, skipped: failed };
}

// ---------- .mrpack: Profil als Modrinth-Modpack exportieren ----------
ipcMain.handle('profiles:exportMrpack', async (_e, id) => {
  const p = store.profiles.find(x => x.id === id); if (!p) throw new Error('Profil nicht gefunden');
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `${p.name.replace(/[<>:"/\\|?*]/g, '')}.mrpack`, filters: [{ name: 'Modrinth-Modpack', extensions: ['mrpack'] }] });
  if (canceled) return null;
  const dir = instanceDir(p), entries = [];
  for (const kind of ['mods', 'resourcepacks', 'shaderpacks']) {
    const d = path.join(dir, kind); if (!fs.existsSync(d) || fs.lstatSync(d).isSymbolicLink()) continue;
    for (const f of await fsp.readdir(d)) if (/\.(jar|zip)$/i.test(f)) {
      const abs = path.join(d, f), buf = await fsp.readFile(abs);
      entries.push({ kind, f, abs, size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex'), sha512: crypto.createHash('sha512').update(buf).digest('hex') });
    }
  }
  send('launch:progress', { task: 'Modrinth-Abgleich', percent: 0.3 });
  let known = {};
  if (entries.length) { try { const r = await fetch('https://api.modrinth.com/v2/version_files', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'LellekClient' }, body: JSON.stringify({ hashes: entries.map(e => e.sha1), algorithm: 'sha1' }) }); if (r.ok) known = await r.json(); } catch {} }
  const zip = new AdmZip(), files = []; let embedded = 0;
  for (const e of entries) {
    const v = known[e.sha1]; const vf = v?.files?.find(x => x.hashes?.sha1 === e.sha1);
    if (vf?.url) files.push({ path: `${e.kind}/${e.f}`, hashes: { sha1: e.sha1, sha512: e.sha512 }, env: { client: 'required', server: e.kind === 'mods' ? 'required' : 'unsupported' }, downloads: [vf.url], fileSize: e.size });
    else { zip.addLocalFile(e.abs, `overrides/${e.kind}`); embedded++; }
  }
  const cfg = path.join(dir, 'config'); if (fs.existsSync(cfg)) zip.addLocalFolder(cfg, 'overrides/config');
  for (const f of ['options.txt', 'optionsof.txt', 'optionsshaders.txt']) if (fs.existsSync(path.join(dir, f))) zip.addLocalFile(path.join(dir, f), 'overrides');
  const dependencies = { minecraft: p.version };
  if (p.loader === 'fabric') dependencies['fabric-loader'] = p.loaderVersion; else if (p.loader === 'forge') dependencies.forge = p.loaderVersion; else if (p.loader === 'neoforge') dependencies.neoforge = p.loaderVersion;
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: new Date().toISOString().slice(0, 10), name: p.name, summary: `Exportiert mit LellekClient ${CLIENT_VERSION}`, files, dependencies }, null, 2)));
  zip.writeZip(filePath);
  send('launch:progress', { task: 'Export fertig', percent: 1 });
  return { file: filePath, linked: files.length, embedded };
});

// ---------- Profil-Import: LellekClient-ZIP oder .mrpack ----------
ipcMain.removeHandler('profiles:import');
ipcMain.handle('profiles:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Profil oder Modpack', extensions: ['zip', 'mrpack'] }] });
  if (canceled) return null;
  const file = filePaths[0];
  const zip = new AdmZip(file);
  if (/\.mrpack$/i.test(file) || zip.getEntry('modrinth.index.json')) return installMrpackFile(file, null, false);
  const meta = zip.getEntry('lellek-profile.json'); if (!meta) throw new Error('Weder LellekClient-Profil noch Modrinth-Modpack');
  const m = JSON.parse(zip.readAsText(meta));
  const p = { id: newId(), name: m.name, version: m.version, loader: m.loader || '', loaderVersion: m.loaderVersion || '', memory: m.memory || 4, javaPath: '', jvmArgs: m.jvmArgs || '', installed: m.installed || {} };
  store.profiles.push(p); saveStore();
  const dir = instanceDir(p); fs.mkdirSync(dir, { recursive: true });
  for (const e of zip.getEntries()) { if (e.isDirectory || e.entryName === 'lellek-profile.json') continue; const out = path.join(dir, e.entryName); if (!out.startsWith(dir + path.sep)) continue; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.getData()); }
  return { profiles: store.profiles, id: p.id, name: p.name };
});

// =====================================================================
// LellekClient 2.0 – Streamer-Modus, Design, PC-Check, Discord-Screenshots, Projekt-Details
// =====================================================================
const { execFile } = require('child_process');

// ---------- Streamer-Modus ----------
let obsRunning = false;
const STREAM_APPS = /^(obs64|obs32|obs|streamlabs obs|streamlabs desktop|xsplit\.core|twitchstudio|meld studio|prismlivestudio)\.exe$/i;
function streamerActive() { const s = store.settings.streamer || {}; return !!(s.enabled || (s.auto && obsRunning)); }
function streamerState() { const s = store.settings.streamer || {}; return { ...s, active: streamerActive(), obsRunning }; }
function pollStreamApps() {
  if (process.platform !== 'win32' || !store.settings.streamer?.auto) { if (obsRunning) { obsRunning = false; streamerChanged(); } return; }
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    if (err) return;
    const now = String(out).split(/\r?\n/).some(l => STREAM_APPS.test((l.split('","')[0] || '').replace(/^"/, '')));
    if (now !== obsRunning) { obsRunning = now; streamerChanged(); }
  });
}
function streamerChanged() { send('streamer:state', streamerState()); try { updatePresence(); } catch {} try { publishPresence(); } catch {} }
app.whenReady().then(() => { setTimeout(pollStreamApps, 2000); setInterval(pollStreamApps, 20000); });
ipcMain.handle('streamer:get', () => streamerState());
ipcMain.handle('streamer:set', (_e, patch) => { store.settings.streamer = { hideName: true, hideIps: true, discordMinimal: true, mute: true, ...(store.settings.streamer || {}), ...patch }; saveStore(); pollStreamApps(); streamerChanged(); return streamerState(); });
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
function maskText(t) { return String(t).replace(/(Connecting to )([^,\s]+)/g, '$1•••').replace(IP_RE, '•••.•••.•••.•••').replace(/(--server|--quickPlayMultiplayer)\s+\S+/g, '$1 •••'); }
function maskPayload(payload) { if (!streamerActive() || store.settings.streamer?.hideIps === false || !payload || typeof payload.line !== 'string') return payload; return { ...payload, line: maskText(payload.line) }; }
{ // Seeds und LAN-Adressen im Streamer-Modus verbergen
  const origWorld = handlers['worlds:info']; ipcMain.removeHandler('worlds:info');
  ipcMain.handle('worlds:info', async (...a) => { const r = await origWorld(...a); if (streamerActive() && r && !r.error) { r.seed = '•••••• (Streamer-Modus)'; r.spawn = '•••'; } return r; });
  const origSrv = handlers['server:info']; ipcMain.removeHandler('server:info');
  ipcMain.handle('server:info', async (...a) => { const r = await origSrv(...a); if (streamerActive() && store.settings.streamer?.hideIps !== false) r.lanIps = r.lanIps.map(() => '•••.•••.•••.•••'); return r; });
}

// ---------- Design / Anpassung ----------
const BG_DIR = path.join(DATA_DIR, 'design');
ipcMain.handle('ui:get', async () => {
  const ui = { ...(store.settings.ui || {}) };
  if (ui.bgFile && fs.existsSync(path.join(BG_DIR, ui.bgFile))) { const ext = path.extname(ui.bgFile).slice(1).toLowerCase(); ui.bgData = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + (await fsp.readFile(path.join(BG_DIR, ui.bgFile))).toString('base64'); }
  return ui;
});
ipcMain.handle('ui:save', (_e, patch) => { store.settings.ui = { ...(store.settings.ui || {}), ...patch }; delete store.settings.ui.bgData; saveStore(); return store.settings.ui; });
ipcMain.handle('ui:pickBackground', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Bild', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (canceled) return null;
  if ((await fsp.stat(filePaths[0])).size > 15e6) throw new Error('Bild ist größer als 15 MB');
  fs.mkdirSync(BG_DIR, { recursive: true });
  for (const f of await fsp.readdir(BG_DIR)) if (f.startsWith('background.')) await fsp.rm(path.join(BG_DIR, f), { force: true });
  const name = 'background' + path.extname(filePaths[0]).toLowerCase(); await fsp.copyFile(filePaths[0], path.join(BG_DIR, name));
  store.settings.ui = { ...(store.settings.ui || {}), bgFile: name }; saveStore();
  return handlers['ui:get']();
});
ipcMain.handle('ui:clearBackground', async () => { if (store.settings.ui?.bgFile) { await fsp.rm(path.join(BG_DIR, store.settings.ui.bgFile), { force: true }); delete store.settings.ui.bgFile; saveStore(); } return true; });
ipcMain.handle('ui:zoom', (_e, z) => { const f = Math.min(1.5, Math.max(0.7, Number(z) || 1)); if (win && !win.isDestroyed()) win.webContents.setZoomFactor(f); return f; });

// ---------- PC-Check ----------
function gpuInfo() {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') return execFile('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 }, (err, out) => { if (err) return resolve([]); try { resolve((JSON.parse(out).SPDisplaysDataType || []).map(g => ({ name: g.sppci_model || g._name, driver: '', date: '', vram: parseInt(g.spdisplays_vram || g.sppci_vram) || null }))); } catch { resolve([]); } });
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,DriverDate,AdapterRAM | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15000 }, (err, out) => {
      if (err) return resolve([]);
      try { const j = JSON.parse(String(out).trim() || '[]'); resolve((Array.isArray(j) ? j : [j]).map(g => ({ name: g.Name, driver: g.DriverVersion, date: String(g.DriverDate || '').replace(/\D/g, '').slice(0, 8), vram: g.AdapterRAM > 0 ? Math.round(g.AdapterRAM / 1073741824) : null }))); } catch { resolve([]); }
    });
  });
}
ipcMain.handle('pc:check', async () => {
  const totalGb = Math.round(os.totalmem() / 1073741824), freeGb = Math.round(os.freemem() / 1073741824 * 10) / 10;
  const cpus = os.cpus(); const gpus = await gpuInfo();
  let diskFreeGb = null; try { const st = await fsp.statfs(DATA_DIR); diskFreeGb = Math.round(st.bavail * st.bsize / 1073741824); } catch {}
  const dedicated = gpus.find(g => /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc a|apple m\d/i.test(g.name || ''));
  const integrated = gpus.length && !dedicated;
  const maxModded = Math.max(2, Math.min(Math.floor(totalGb / 2), 10));
  const rec = { vanilla: Math.min(4, Math.max(2, Math.floor(totalGb / 4))), modded: Math.min(maxModded, Math.max(4, Math.floor(totalGb / 3))), max: maxModded };
  const tips = [];
  if (totalGb < 8) tips.push({ level: 'warn', text: `Nur ${totalGb} GB RAM: Vanilla mit 2–3 GB, große Modpacks sind kaum spielbar. Browser beim Spielen schließen.` });
  else tips.push({ level: 'ok', text: `${totalGb} GB RAM: Vanilla ${rec.vanilla} GB, Mod-Profile ${rec.modded} GB, höchstens ${rec.max} GB pro Instanz.` });
  if (integrated) tips.push({ level: 'warn', text: 'Nur integrierte Grafik erkannt: Sodium (Fabric/NeoForge) oder OptiFine nutzen, Sichtweite 8–10, keine Shader.' });
  else if (dedicated) tips.push({ level: 'ok', text: `Grafikkarte ${dedicated.name}: Shader (Iris/Complementary) laufen in der Regel flüssig.` });
  const old = gpus.find(g => g.date && Number(g.date.slice(0, 4)) < new Date().getFullYear() - 1);
  if (old) tips.push({ level: 'warn', text: `Grafiktreiber von ${old.date.slice(0, 4)} – ein Update behebt oft Abstürze und Ruckler.` });
  if (cpus.length < 4) tips.push({ level: 'warn', text: `Nur ${cpus.length} CPU-Threads: Simulationsdistanz auf 5–6 stellen, Lithium/FerriteCore installieren.` });
  if (diskFreeGb != null && diskFreeGb < 10) tips.push({ level: 'warn', text: `Nur ${diskFreeGb} GB frei auf dem Laufwerk der Launcher-Daten – Modpacks und Backups brauchen Platz.` });
  const profiles = store.profiles.map(p => { const want = p.loader ? (mcMinor(p.version) <= 12 ? Math.min(rec.modded, 3) : rec.modded) : rec.vanilla; const m = p.memory || store.settings.memory || 4; return { id: p.id, name: p.name, memory: m, recommended: want, status: m > rec.max ? 'high' : m < Math.min(want, 3) && p.loader ? 'low' : 'ok' }; });
  return { totalGb, freeGb, cpu: cpus[0]?.model?.trim() || '?', threads: cpus.length, gpus, diskFreeGb, rec, tips, profiles, os: `${os.type()} ${os.release()}` };
});
ipcMain.handle('profiles:setMemory', (_e, { id, memory }) => { const p = store.profiles.find(x => x.id === id); if (!p) throw new Error('Profil nicht gefunden'); p.memory = Math.max(1, Math.min(32, Number(memory) || 4)); saveStore(); return store.profiles; });

// ---------- Screenshots an Discord ----------
ipcMain.handle('shots:discord', async (_e, { profileId, file }) => {
  const hook = (store.settings.discordWebhook || '').trim();
  if (!/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(hook)) throw new Error('Kein gültiger Discord-Webhook in den Optionen');
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const fp = path.join(instanceDir(p), 'screenshots', path.basename(file)); const buf = await fsp.readFile(fp);
  if (buf.length > 24e6) throw new Error('Screenshot zu groß für Discord');
  const who = streamerActive() || !currentAuth ? '' : ` von ${currentAuth.profile.name}`;
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ username: 'LellekClient', content: `📸 Screenshot${who} · ${p.name} (${p.version})` }));
  form.append('files[0]', new Blob([buf], { type: 'image/png' }), path.basename(fp));
  const r = await fetch(hook, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Discord hat abgelehnt (${r.status})`);
  return true;
});

// ---------- Projekt-Details mit Galerie, Changelogs ----------
ipcMain.handle('browse:details', async (_e, { source, id }) => {
  if (source === 'modrinth') {
    const pr = await getJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`);
    return { title: pr.title, summary: pr.description, body: (pr.body || '').slice(0, 4000), icon: pr.icon_url, downloads: pr.downloads, followers: pr.followers, url: `https://modrinth.com/${pr.project_type}/${pr.slug}`, source: pr.source_url, discord: pr.discord_url, categories: pr.categories || [], loaders: pr.loaders || [], versions: (pr.game_versions || []).slice(-8), updated: pr.updated,
      gallery: (pr.gallery || []).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.ordering - b.ordering).slice(0, 12).map(g => ({ url: g.url, raw: g.raw_url || g.url, title: g.title || '' })) };
  }
  const r = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(id)}`, { headers: cfHeaders(), signal: withTimeout() });
  if (!r.ok) throw new Error(`CurseForge-Fehler ${r.status}`);
  const m = (await r.json()).data;
  return { title: m.name, summary: m.summary, body: '', icon: m.logo?.thumbnailUrl, downloads: m.downloadCount, url: m.links?.websiteUrl, source: m.links?.sourceUrl, categories: (m.categories || []).map(c => c.name), loaders: [], versions: (m.latestFilesIndexes || []).slice(0, 8).map(f => f.gameVersion), updated: m.dateModified,
    gallery: (m.screenshots || []).slice(0, 12).map(s => ({ url: s.thumbnailUrl || s.url, raw: s.url, title: s.title || '' })) };
});
ipcMain.handle('mods:changelog', async (_e, { source, cfModId, cfFileId, changelog }) => {
  if (source !== 'curseforge') return changelog || '';
  const r = await fetch(`https://api.curseforge.com/v1/mods/${cfModId}/files/${cfFileId}/changelog`, { headers: cfHeaders(), signal: withTimeout() });
  if (!r.ok) return '';
  const html = (await r.json()).data || '';
  return html.replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
});

// ---------- Freunde (LellekPresence 2): Anfragen, Status, Einladungen ----------
// Freundschaft ist gegenseitig: Anfrage schicken → der andere nimmt an. Jede Liste gehört zum jeweiligen
// Minecraft-Konto. Die Listen liegen lokal und werden bei jeder Meldung an den Server übertragen.
const DEFAULT_PRESENCE = 'https://render-friends-lellek-client-v1.onrender.com';
const dashUuid = (id) => String(id).toLowerCase().replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
function myAccountId() { return currentAuth?.profile?.id || store.currentAccount || null; }
function myFriends() {
  store.friendsByAccount ??= {};
  const id = myAccountId(); if (!id) return [];
  if (Array.isArray(store.friends)) { // Migration: alte gemeinsame Liste → aktuelles Konto
    const have = store.friendsByAccount[id] ||= [];
    for (const f of store.friends) if (!have.some(x => x.uuid === f.uuid)) have.push(f);
    delete store.friends; saveStore();
  }
  return store.friendsByAccount[id] ||= [];
}
function setMyFriends(list) { const id = myAccountId(); if (!id) throw new Error('Bitte zuerst mit deinem Microsoft-Konto anmelden'); store.friendsByAccount ??= {}; store.friendsByAccount[id] = list; saveStore(); }
function social() {
  store.socialByAccount ??= {};
  const id = myAccountId(); if (!id) return { outgoing: [], blocked: [], status: 'online', note: '' };
  const s = store.socialByAccount[id] ||= {}; s.outgoing ??= []; s.blocked ??= []; s.status ??= 'online'; s.note ??= '';
  return s;
}
function presenceBase() { return (store.settings.presenceServer || DEFAULT_PRESENCE).trim().replace(/\/(v1\/stats)?\/?$/, '').replace(/\/$/, ''); }
let presenceToken = null, presenceTokenFor = null, friendState = {}, presenceOnline = false, incomingReqs = [], lastPoll = 0;
const seenIncoming = new Set(), seenInvites = new Set();
async function presenceLogin() {
  if (!currentAuth) throw new Error('Nicht eingeloggt');
  const serverId = crypto.randomBytes(20).toString('hex');
  const j = await fetch('https://sessionserver.mojang.com/session/minecraft/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: currentAuth.mclc.access_token, selectedProfile: currentAuth.profile.id.replace(/-/g, ''), serverId }) });
  if (j.status !== 204 && !j.ok) throw new Error(`Mojang-Login fehlgeschlagen (${j.status})`);
  const r = await fetch(presenceBase() + '/v1/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: currentAuth.profile.name, serverId }), signal: withTimeout(15000) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Freunde-Server ${r.status}`);
  presenceToken = d.token; presenceTokenFor = currentAuth.profile.id;
}
/** Aufruf mit Anmeldung; bei abgelaufenem Token einmal neu anmelden */
async function presenceCall(method, path, payload) {
  if (!currentAuth) throw new Error('Bitte zuerst mit deinem Microsoft-Konto anmelden');
  if (presenceToken && presenceTokenFor !== currentAuth.profile.id) { const old = presenceToken; presenceToken = null; fetch(presenceBase() + '/v1/presence/me', { method: 'DELETE', headers: { Authorization: `Bearer ${old}` } }).catch(() => {}); }
  if (!presenceToken) await presenceLogin();
  const go = () => fetch(presenceBase() + path, { method, headers: { Authorization: `Bearer ${presenceToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: withTimeout(15000) });
  let r = await go();
  if (r.status === 401) { await presenceLogin(); r = await go(); }
  return r;
}
function myPresence() {
  const s = social(), ids = [...running.keys()];
  // Freunde, die uns (noch) nicht haben (z. B. aus 2.1 übernommen), gehen zusätzlich als Anfrage raus
  const fr = myFriends().map(f => f.uuid), out = new Set(s.outgoing.map(f => f.uuid));
  for (const id of fr) if (friendState[id]?.pending) out.add(id);
  const lists = { friends: fr, outgoing: [...out], blocked: s.blocked.map(f => f.uuid),
    status: store.settings.sharePresence === false ? 'invisible' : s.status, note: streamerActive() ? '' : s.note };
  if (!ids.length) return { state: 'launcher', ...lists };
  const p = store.profiles.find(x => x.id === ids[0]) || {}; const ctx = gameContext.get(ids[0]) || {};
  const hide = streamerActive();
  return { state: 'playing', version: p.version, loader: p.loader || '', server: hide ? null : (ctx.server || null), world: hide ? null : (ctx.world ? 'Einzelspieler' : null), since: ctx.since || Date.now(), ...lists };
}
let lastPresenceSent = 0, publishing = null;
async function publishPresence(force) {
  if (!currentAuth) return;
  if (!force && Date.now() - lastPresenceSent < 3000) return publishing; lastPresenceSent = Date.now();
  publishing = (async () => { try { const r = await presenceCall('PUT', '/v1/presence/me', myPresence()); presenceOnline = r.ok; } catch { presenceOnline = false; } })();
  return publishing;
}
const notifyFriends = (text) => { if (store.settings.friendNotify !== false) notify('LellekClient', text); };
async function pollFriends(again) {
  if (!currentAuth) { send('friends:update', friendList()); return; }
  lastPoll = Date.now();
  try {
    let r = await presenceCall('GET', '/v1/friends?social=1');
    if (r.status === 409) { await publishPresence(true); r = await presenceCall('GET', '/v1/friends?social=1'); }
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json(); presenceOnline = true;
    try { friendsHook(d); } catch {}
    const s = social(); let friends = myFriends(), changed = false;
    // Entfernt worden
    for (const x of d.removed || []) { if (friends.some(f => f.uuid === x.uuid)) { friends = friends.filter(f => f.uuid !== x.uuid); changed = true; } }
    // Angenommen
    for (const x of d.accepted || []) {
      if (!friends.some(f => f.uuid === x.uuid)) { friends.push({ uuid: x.uuid, name: x.name || s.outgoing.find(o => o.uuid === x.uuid)?.name || '?', added: Date.now() }); notifyFriends(`${x.name} hat deine Freundschaftsanfrage angenommen`); }
      s.outgoing = s.outgoing.filter(o => o.uuid !== x.uuid); changed = true;
    }
    // Abgelehnt
    for (const x of d.declined || []) { if (s.outgoing.some(o => o.uuid === x.uuid)) { s.outgoing = s.outgoing.filter(o => o.uuid !== x.uuid); changed = true; } }
    // Eingehend: wer schon in der Liste oder selbst angefragt ist → automatisch annehmen
    incomingReqs = [];
    for (const x of d.incoming || []) {
      if (friends.some(f => f.uuid === x.uuid) || s.outgoing.some(o => o.uuid === x.uuid)) {
        presenceCall('POST', '/v1/friends/respond', { uuid: x.uuid, accept: true }).catch(() => {});
        if (!friends.some(f => f.uuid === x.uuid)) friends.push({ uuid: x.uuid, name: x.name, added: Date.now() });
        s.outgoing = s.outgoing.filter(o => o.uuid !== x.uuid); changed = true; continue;
      }
      incomingReqs.push(x);
      if (!seenIncoming.has(x.uuid)) { seenIncoming.add(x.uuid); notifyFriends(`Freundschaftsanfrage von ${x.name}`); }
    }
    // Online-Benachrichtigung
    for (const f of friends) {
      const was = friendState[f.uuid]?.online, now = d.friends?.[f.uuid]?.online;
      if (now && was === false) notifyFriends(`${f.name} ist jetzt online${d.friends[f.uuid].server ? ' auf ' + d.friends[f.uuid].server : ''}`);
      if (d.friends?.[f.uuid]?.name && d.friends[f.uuid].name !== f.name) { f.name = d.friends[f.uuid].name; changed = true; }
    }
    // Einladungen
    for (const inv of d.invites || []) {
      const key = inv.from + inv.at; if (seenInvites.has(key)) continue; seenInvites.add(key);
      const f = myFriends().find(x => x.uuid === inv.from); const who = f?.nick || inv.name;
      notifyFriends(`${who} lädt dich ein${inv.server ? ' auf ' + inv.server : ''}${inv.message ? ': „' + inv.message + '“' : ''}`);
      send('friends:invite', { ...inv, name: who });
    }
    const pk = (st) => Object.keys(st).filter(k => st[k]?.pending).sort().join();
    if (pk(friendState) !== pk(d.friends || {})) changed = true;
    friendState = d.friends || {};
    if (changed) { setMyFriends(friends); saveStore(); await publishPresence(true); if (!again) return pollFriends(true); }
  } catch { presenceOnline = false; }
  send('friends:update', friendList());
}
function friendList() {
  const s = social(), ids = [...running.keys()], ctx = ids.length ? gameContext.get(ids[0]) || {} : {};
  return { server: presenceBase(), reachable: presenceOnline, account: currentAuth?.profile?.name || null, loggedIn: !!currentAuth,
    status: s.status, note: s.note, sharePresence: store.settings.sharePresence !== false, myServer: ctx.server || null,
    friends: myFriends().map(f => ({ ...f, ...(friendState[f.uuid] || { online: false }), name: f.name })),
    incoming: incomingReqs, outgoing: s.outgoing, blocked: s.blocked };
}
app.whenReady().then(() => { setTimeout(async () => { await publishPresence(true); pollFriends(); }, 6000); setInterval(async () => { await publishPresence(true); pollFriends(); }, 45000); });
// Bei Start/Ende/Serverwechsel sofort melden
{ const _up = updatePresence; updatePresence = function () { _up(); publishPresence(); }; }
async function lookupPlayer(name) {
  const n = String(name || '').trim(); if (!/^\w{2,16}$/.test(n)) throw new Error('Ungültiger Minecraft-Name');
  const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(n)}`, { signal: withTimeout(10000) });
  if (r.status === 404 || r.status === 204) throw new Error(`Spieler „${n}“ gibt es nicht`);
  if (!r.ok) throw new Error(`Mojang-Fehler ${r.status}`);
  const j = await r.json(); return { uuid: dashUuid(j.id), name: j.name };
}
const after = async () => { await publishPresence(true); await pollFriends(); return friendList(); };
ipcMain.handle('friends:list', async () => { if (Date.now() - lastPoll > 4000) await pollFriends(); return friendList(); });
ipcMain.handle('friends:add', async (_e, name) => {
  if (!myAccountId() || !currentAuth) throw new Error('Bitte zuerst mit deinem Microsoft-Konto anmelden');
  const p = await lookupPlayer(name);
  if (p.uuid === dashUuid(currentAuth.profile.id)) throw new Error('Das bist du selbst');
  const s = social();
  if (myFriends().some(f => f.uuid === p.uuid)) throw new Error(`${p.name} ist schon dein Freund`);
  if (s.outgoing.some(o => o.uuid === p.uuid)) throw new Error(`Anfrage an ${p.name} ist schon unterwegs`);
  s.blocked = s.blocked.filter(b => b.uuid !== p.uuid);
  if (incomingReqs.some(x => x.uuid === p.uuid)) { // hat uns schon angefragt → direkt Freunde
    await presenceCall('POST', '/v1/friends/respond', { uuid: p.uuid, accept: true });
    setMyFriends([...myFriends(), { uuid: p.uuid, name: p.name, added: Date.now() }]);
    return { ...(await after()), result: 'friends', name: p.name };
  }
  s.outgoing.push({ uuid: p.uuid, name: p.name, at: Date.now() }); saveStore();
  return { ...(await after()), result: 'sent', name: p.name };
});
ipcMain.handle('friends:respond', async (_e, { uuid, accept }) => {
  const x = incomingReqs.find(r => r.uuid === uuid);
  await presenceCall('POST', '/v1/friends/respond', { uuid, accept: !!accept });
  if (accept && !myFriends().some(f => f.uuid === uuid)) setMyFriends([...myFriends(), { uuid, name: x?.name || '?', added: Date.now() }]);
  incomingReqs = incomingReqs.filter(r => r.uuid !== uuid);
  return after();
});
ipcMain.handle('friends:cancel', async (_e, uuid) => { const s = social(); s.outgoing = s.outgoing.filter(o => o.uuid !== uuid); saveStore(); return after(); });
ipcMain.handle('friends:remove', async (_e, uuid) => {
  setMyFriends(myFriends().filter(f => f.uuid !== uuid));
  try { await presenceCall('POST', '/v1/friends/remove', { uuid }); } catch {}
  return after();
});
ipcMain.handle('friends:block', async (_e, { uuid, name }) => {
  const s = social();
  if (!s.blocked.some(b => b.uuid === uuid)) s.blocked.push({ uuid, name: name || '?', at: Date.now() });
  s.outgoing = s.outgoing.filter(o => o.uuid !== uuid);
  if (myFriends().some(f => f.uuid === uuid)) { setMyFriends(myFriends().filter(f => f.uuid !== uuid)); try { await presenceCall('POST', '/v1/friends/remove', { uuid }); } catch {} }
  if (incomingReqs.some(r => r.uuid === uuid)) { try { await presenceCall('POST', '/v1/friends/respond', { uuid, accept: false }); } catch {} }
  incomingReqs = incomingReqs.filter(r => r.uuid !== uuid); saveStore();
  return after();
});
ipcMain.handle('friends:unblock', async (_e, uuid) => { const s = social(); s.blocked = s.blocked.filter(b => b.uuid !== uuid); saveStore(); return after(); });
ipcMain.handle('friends:setStatus', async (_e, { status, note }) => {
  const s = social();
  if (['online', 'away', 'dnd', 'invisible'].includes(status)) s.status = status;
  if (typeof note === 'string') s.note = note.trim().slice(0, 80);
  saveStore(); await publishPresence(true); return friendList();
});
ipcMain.handle('friends:edit', (_e, { uuid, nick, fav }) => {
  const list = myFriends(); const f = list.find(x => x.uuid === uuid); if (!f) throw new Error('Nicht in deiner Liste');
  if (nick !== undefined) f.nick = String(nick || '').trim().slice(0, 24) || undefined;
  if (fav !== undefined) f.fav = !!fav;
  setMyFriends(list); return friendList();
});
ipcMain.handle('friends:invite', async (_e, { uuid, message }) => {
  const ids = [...running.keys()], ctx = ids.length ? gameContext.get(ids[0]) || {} : {}, p = ids.length ? store.profiles.find(x => x.id === ids[0]) : null;
  const r = await presenceCall('POST', '/v1/friends/invite', { uuid, message: String(message || '').slice(0, 120), server: streamerActive() ? null : (ctx.server || null), version: p?.version || null });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `Einladung fehlgeschlagen (${r.status})`); }
  return true;
});
ipcMain.handle('friends:status', async () => { try { const r = await fetch(presenceBase() + '/v1/stats', { signal: withTimeout(8000) }); const j = await r.json(); return { ...j, online: r.ok, server: presenceBase() }; } catch { return { online: false, server: presenceBase() }; } });
app.on('before-quit', () => { if (presenceToken) fetch(presenceBase() + '/v1/presence/me', { method: 'DELETE', headers: { Authorization: `Bearer ${presenceToken}` } }).catch(() => {}); });

// ---------- Server: Vanilla / Paper / Fabric ----------
const UA = { 'User-Agent': 'LellekClient/2.0 (Minecraft-Launcher)' };
function installedServerType(profileId) { try { return fs.readFileSync(path.join(serverDir(profileId), 'server-type.txt'), 'utf8').split('|')[0] || 'vanilla'; } catch { return fs.existsSync(path.join(serverDir(profileId), 'server.jar')) ? 'vanilla' : null; } }
async function serverJarFor(type, p) {
  const mc = p.version;
  if (type === 'paper') {
    try {
      const builds = await (await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${mc}/builds`, { headers: UA, signal: withTimeout() })).json();
      const list = (Array.isArray(builds) ? builds : []).filter(b => b.downloads?.['server:default']?.url).sort((a, b) => b.id - a.id);
      const b = list.find(x => x.channel === 'STABLE') || list[0];
      if (b) return { url: b.downloads['server:default'].url, tag: `paper|${mc}|${b.id}` };
    } catch {}
    const j = await getJson(`https://api.papermc.io/v2/projects/paper/versions/${mc}/builds`);
    const b = (j.builds || []).slice().reverse().find(x => x.channel === 'default') || (j.builds || []).slice(-1)[0];
    if (!b) throw new Error(`Kein Paper für ${mc} verfügbar`);
    return { url: `https://api.papermc.io/v2/projects/paper/versions/${mc}/builds/${b.build}/downloads/${b.downloads.application.name}`, tag: `paper|${mc}|${b.build}` };
  }
  if (type === 'fabric') {
    const inst = (await getJson('https://meta.fabricmc.net/v2/versions/installer'))[0]?.version;
    const loader = p.loader === 'fabric' && p.loaderVersion ? p.loaderVersion : (await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}`))[0]?.loader.version;
    if (!inst || !loader) throw new Error(`Kein Fabric-Server für ${mc}`);
    return { url: `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${inst}/server/jar`, tag: `fabric|${mc}|${loader}` };
  }
  const vj = await versionJson(mc);
  if (!vj.downloads?.server?.url) throw new Error('Für diese Version gibt es keinen offiziellen Server');
  return { url: vj.downloads.server.url, tag: `vanilla|${mc}|` };
}
ipcMain.removeHandler('server:setup');
ipcMain.handle('server:setup', async (_e, { profileId, port, memory, eulaAccepted, serverType }) => {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  if (!eulaAccepted) throw new Error('Bitte die Minecraft-EULA bestätigen');
  if (serverProc && serverProfile === profileId) throw new Error('Server zuerst stoppen');
  const type = ['paper', 'fabric'].includes(serverType) ? serverType : 'vanilla';
  const d = serverDir(profileId), jar = path.join(d, 'server.jar'), tf = path.join(d, 'server-type.txt');
  const have = fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : (fs.existsSync(jar) ? `vanilla|${p.version}|` : '');
  const [hType, hVer] = have.split('|');
  if (!fs.existsSync(jar) || hType !== type || (hVer && hVer !== p.version)) {
    const { url, tag } = await serverJarFor(type, p);
    send('server:log', `${type === 'vanilla' ? 'Vanilla' : type === 'paper' ? 'Paper' : 'Fabric'}-Server ${p.version} wird heruntergeladen…`);
    await downloadLong(url, jar, (x) => send('launch:progress', { task: 'Server', percent: x }));
    await fsp.writeFile(tf, tag);
  }
  await fsp.writeFile(path.join(d, 'eula.txt'), `# Bestätigt im LellekClient am ${new Date().toISOString()}\neula=true\n`);
  let props = fs.existsSync(path.join(d, 'server.properties')) ? await fsp.readFile(path.join(d, 'server.properties'), 'utf8') : 'online-mode=true\nmotd=LellekClient Server\n';
  props = /^server-port=/m.test(props) ? props.replace(/^server-port=.*$/m, `server-port=${port}`) : props + `server-port=${port}\n`;
  await fsp.writeFile(path.join(d, 'server.properties'), props);
  p.serverMemory = memory; p.serverType = type; saveStore();
  return true;
});
{
  const origInfo = handlers['server:info']; ipcMain.removeHandler('server:info');
  ipcMain.handle('server:info', async (...a) => {
    const r = await origInfo(...a); const p = store.profiles.find(x => x.id === a[1]);
    const hide = streamerActive() && store.settings.streamer?.hideIps !== false;
    return { ...r, serverType: installedServerType(a[1]) || p?.serverType || 'vanilla', publicAddress: hide && p?.publicAddress ? '••••••' : (p?.publicAddress || ''), tunnel: !!tunnelProc };
  });
}

// ---------- Server-Plugins (Paper) / Server-Mods (Fabric) von Modrinth ----------
const PLUGIN_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur'];
function serverContent(profileId) {
  const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden');
  const type = installedServerType(profileId);
  if (type !== 'paper' && type !== 'fabric') throw new Error('Plugins gibt es für Paper-Server, Mods für Fabric-Server – Server-Typ unter „Einrichten“ wählen');
  const dir = path.join(serverDir(profileId), type === 'paper' ? 'plugins' : 'mods'); fs.mkdirSync(dir, { recursive: true });
  return { p, type, dir };
}
async function serverVersionsOf(projectId, p, type) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([p.version]), loaders: JSON.stringify(type === 'paper' ? PLUGIN_LOADERS : ['fabric']) });
  return getJson(`https://api.modrinth.com/v2/project/${projectId}/version?${q}`);
}
ipcMain.handle('servercontent:list', async (_e, profileId) => {
  let sc; try { sc = serverContent(profileId); } catch (e) { return { type: installedServerType(profileId), files: [], error: e.message }; }
  const files = (await fsp.readdir(sc.dir)).filter(f => /\.jar(\.disabled)?$/i.test(f)).map(f => ({ file: f, enabled: !f.endsWith('.disabled'), size: fs.statSync(path.join(sc.dir, f)).size }));
  return { type: sc.type, files };
});
ipcMain.handle('servercontent:search', async (_e, { profileId, query }) => {
  const { p, type } = serverContent(profileId);
  const facets = type === 'paper' ? [PLUGIN_LOADERS.map(l => `categories:${l}`), [`versions:${p.version}`]] : [['categories:fabric'], [`versions:${p.version}`], ['server_side:required', 'server_side:optional'], ['project_type:mod']];
  const r = await getJson(`https://api.modrinth.com/v2/search?limit=20&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}${query ? '' : '&index=downloads'}`);
  return { type, total: r.total_hits, items: r.hits.map(h => ({ id: h.project_id, name: h.title, author: h.author, summary: h.description, icon: h.icon_url, downloads: h.downloads, source: 'modrinth' })) };
});
ipcMain.handle('servercontent:install', async (_e, { profileId, projectId }) => {
  const { p, type, dir } = serverContent(profileId);
  const done = [], seen = new Set();
  const inst = async (pid, depth) => {
    if (seen.has(pid) || depth > 2) return; seen.add(pid);
    const v = pickVersion(await serverVersionsOf(pid, p, type)); if (!v) { if (depth === 0) throw new Error(`Keine Version für ${p.version} (${type === 'paper' ? 'Paper/Spigot' : 'Fabric'})`); return; }
    for (const dep of v.dependencies || []) if (dep.dependency_type === 'required' && dep.project_id) { try { await inst(dep.project_id, depth + 1); } catch {} }
    const f = v.files.find(x => x.primary) || v.files[0]; if (!f) return;
    if (!fs.existsSync(path.join(dir, f.filename))) await download(f.url, path.join(dir, f.filename));
    done.push(f.filename);
  };
  await inst(projectId, 0);
  if (type === 'fabric' && !(await fsp.readdir(dir)).some(f => /^fabric-api/i.test(f))) { try { await inst('P7dR8mSH', 1); } catch {} }
  return done;
});
ipcMain.handle('servercontent:remove', async (_e, { profileId, file }) => { const { dir } = serverContent(profileId); await fsp.rm(path.join(dir, path.basename(file)), { force: true }); return true; });
ipcMain.handle('servercontent:toggle', async (_e, { profileId, file }) => { const { dir } = serverContent(profileId); const f = path.basename(file); await fsp.rename(path.join(dir, f), path.join(dir, f.endsWith('.disabled') ? f.slice(0, -9) : f + '.disabled')); return true; });
ipcMain.handle('servercontent:openFolder', (_e, profileId) => { const { dir } = serverContent(profileId); shell.openPath(dir); });

// ---------- playit.gg-Tunnel: Freunde von außen ohne Portfreigabe ----------
let tunnelProc = null;
ipcMain.handle('tunnel:start', async () => {
  if (process.platform !== 'win32') { shell.openExternal('https://playit.gg/download'); throw new Error('Auf dem Mac den playit-Agent von playit.gg/download installieren und starten – die Seite ist geöffnet'); }
  if (tunnelProc) return { running: true };
  const exe = path.join(DATA_DIR, 'tools', 'playit.exe');
  if (!fs.existsSync(exe)) {
    const rel = await getJson('https://api.github.com/repos/playit-cloud/playit-agent/releases/latest');
    const assets = rel.assets || [];
    const a = assets.find(x => /windows.*x86_64.*signed.*\.exe$/i.test(x.name)) || assets.find(x => /windows.*x86_64.*\.exe$/i.test(x.name));
    if (!a) throw new Error('playit-Agent für Windows nicht im Release gefunden');
    await downloadLong(a.browser_download_url, exe, (x) => send('launch:progress', { task: 'playit.gg-Agent', percent: x }));
  }
  tunnelProc = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  tunnelProc.on('exit', () => { tunnelProc = null; send('tunnel:state', { running: false }); });
  tunnelProc.on('error', (e) => { tunnelProc = null; send('tunnel:state', { running: false, error: e.message }); });
  send('tunnel:state', { running: true });
  return { running: true };
});
ipcMain.handle('tunnel:stop', () => { if (tunnelProc) { try { execFile('taskkill', ['/PID', String(tunnelProc.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch {} try { tunnelProc.kill(); } catch {} tunnelProc = null; } send('tunnel:state', { running: false }); return { running: false }; });
ipcMain.handle('server:setAddress', (_e, { profileId, address }) => { const p = store.profiles.find(x => x.id === profileId); if (!p) throw new Error('Profil nicht gefunden'); p.publicAddress = String(address || '').trim().slice(0, 120); saveStore(); return p.publicAddress; });
app.on('before-quit', () => { if (tunnelProc) { try { execFile('taskkill', ['/PID', String(tunnelProc.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch {} } });

// =====================================================================
// LellekClient 2.5 – Party, Chat, Profil-Codes, Zeitmaschine, Session-Rückblick,
// Level & Erfolge, Server-Radar, Performance-Autopilot
// =====================================================================
const zlib = require('zlib');
let friendsHook = () => {};
const dnsp = require('dns').promises;
app.on('will-quit', () => saveStoreNow());
/** Vorhandenen IPC-Handler umhüllen: fn(original, event, ...args) */
function wrapHandler(ch, fn) { const orig = handlers[ch]; if (!orig) return; ipcMain.removeHandler(ch); ipcMain.handle(ch, (e, ...a) => fn(orig, e, ...a)); }
function bump(key, n = 1) { store.counters ??= {}; store.counters[key] = (store.counters[key] || 0) + n; saveStore(); setTimeout(checkAchievements, 200); }
const profileById = (id) => store.profiles.find(x => x.id === id);

// ---------- Zeitmaschine: Schnappschüsse von Mods & Configs (inhaltsbasiert, ohne Doppelungen) ----------
const TM_DIR = path.join(DATA_DIR, 'timemachine'), TM_OBJ = path.join(TM_DIR, 'objects'), TM_MAX = 20;
const TM_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'];
const tmFile = (id) => path.join(TM_DIR, `${id}.json`);
function tmLoad(id) { try { const d = JSON.parse(fs.readFileSync(tmFile(id), 'utf8')); d.snaps ??= []; d.cache ??= {}; return d; } catch { return { snaps: [], cache: {} }; } }
function tmSave(id, d) { fs.mkdirSync(TM_DIR, { recursive: true }); const f = tmFile(id); fs.writeFileSync(f + '.tmp', JSON.stringify(d)); fs.renameSync(f + '.tmp', f); }
const tmLocks = new Map();
function tmLocked(_id, fn) { const prev = tmLocks.get('all') || Promise.resolve(); const next = prev.catch(() => {}).then(fn); tmLocks.set('all', next.catch(() => {})); return next; } // ein Schloss für Sichern, Zurücksetzen und Aufräumen
async function tmScan(p, cache) {
  const dir = instanceDir(p), out = {};
  const add = async (rel) => {
    const abs = path.join(dir, rel); let st; try { st = await fsp.stat(abs); } catch { return; }
    if (!st.isFile() || st.size > 64e6) return;
    const k = `${rel}|${st.size}|${Math.floor(st.mtimeMs)}`;
    out[rel] = { h: cache[k] || await sha1(abs), k };
  };
  const walk = async (rel, depth) => {
    let ents; try { ents = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const r = `${rel}/${e.name}`; if (e.isDirectory()) { if (depth < 5) await walk(r, depth + 1); } else if (e.isFile()) await add(r); }
  };
  for (const root of ['mods', 'config']) { try { if (!fs.lstatSync(path.join(dir, root)).isSymbolicLink()) await walk(root, 0); } catch {} }
  for (const f of TM_FILES) await add(f);
  return out;
}
const tmManifest = (files) => Object.fromEntries(Object.entries(files).map(([r, f]) => [r, f.h]));
function tmSame(a, b) { const ka = Object.keys(a || {}), kb = Object.keys(b || {}); return ka.length === kb.length && ka.every(k => a[k] === b[k]); }
function tmDiff(a, b) {
  const added = [], removed = [], changed = [], disabled = [], enabled = []; let config = 0;
  for (const r of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[r], y = b?.[r]; if (x === y) continue;
    if (/^mods\/[^/]+$/.test(r)) { const n = r.slice(5); if (!x) added.push(n); else if (!y) removed.push(n); else changed.push(n); } else config++;
  }
  for (const n of [...added]) { if (n.endsWith('.disabled') && removed.includes(n.slice(0, -9))) { disabled.push(n.slice(0, -9)); added.splice(added.indexOf(n), 1); removed.splice(removed.indexOf(n.slice(0, -9)), 1); } else if (removed.includes(n + '.disabled')) { enabled.push(n); added.splice(added.indexOf(n), 1); removed.splice(removed.indexOf(n + '.disabled'), 1); } }
  return { added, removed, changed, disabled, enabled, config };
}
let tmGcTimer = null;
function tmGcSoon() {
  clearTimeout(tmGcTimer);
  tmGcTimer = setTimeout(() => tmLocked('gc', async () => {
    try {
      const used = new Set();
      for (const f of await fsp.readdir(TM_DIR)) if (f.endsWith('.json')) { const d = JSON.parse(await fsp.readFile(path.join(TM_DIR, f), 'utf8')); for (const s of d.snaps || []) for (const h of Object.values(s.files)) used.add(h); }
      const now = Date.now();
      for (const o of await fsp.readdir(TM_OBJ)) { if (used.has(o) || o.endsWith('.tmp')) continue; const st = await fsp.stat(path.join(TM_OBJ, o)); if (now - st.mtimeMs > 10 * 60000) await fsp.rm(path.join(TM_OBJ, o), { force: true }); }
    } catch {} // bei unlesbarer Liste lieber nichts löschen
  }), 4000);
}
/** Schnappschuss, wenn sich seit dem letzten etwas geändert hat (force: immer) */
function tmSnapshot(p, reason, force = false) { return tmLocked(p.id, () => tmSnapshotInner(p, reason, force)); }
async function tmSnapshotInner(p, reason, force = false, keepId = null) {
  {
    const d = tmLoad(p.id); const files = await tmScan(p, d.cache);
    d.cache = Object.fromEntries(Object.values(files).map(f => [f.k, f.h]));
    const manifest = tmManifest(files), last = d.snaps[d.snaps.length - 1];
    if (!Object.keys(manifest).length || (!force && last && tmSame(last.files, manifest))) { tmSave(p.id, d); return null; }
    fs.mkdirSync(TM_OBJ, { recursive: true });
    const todo = Object.entries(manifest).filter(([, h]) => !fs.existsSync(path.join(TM_OBJ, h))); let n = 0;
    for (const [r, h] of todo) { const o = path.join(TM_OBJ, h); try { await fsp.copyFile(path.join(instanceDir(p), r), o + '.tmp'); await fsp.rename(o + '.tmp', o); } catch { delete manifest[r]; } if (todo.length > 20 && ++n % 10 === 0) send('launch:progress', { task: `Zeitmaschine sichert ${n}/${todo.length}`, percent: n / todo.length }); }
    if (todo.length > 20) send('launch:progress', { task: 'Zeitmaschine: gesichert', percent: 0 });
    const snap = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), reason: String(reason || 'Schnappschuss').slice(0, 60), files: manifest };
    d.snaps.push(snap); let pruned = false;
    while (d.snaps.length > TM_MAX) { const i = d.snaps.findIndex(x => x.id !== keepId); d.snaps.splice(i, 1); pruned = true; }
    tmSave(p.id, d); if (pruned) tmGcSoon();
    return snap;
  }
}
async function tmSnapshotQuiet(profileId, reason) { const p = profileById(profileId); if (!p) return; try { await tmSnapshot(p, reason); } catch {} }
ipcMain.handle('tm:list', async (_e, profileId) => {
  const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden');
  const d = tmLoad(p.id); let pending = null;
  try { const cur = tmManifest(await tmScan(p, d.cache)); const last = d.snaps[d.snaps.length - 1]; if (last && !tmSame(last.files, cur)) pending = tmDiff(last.files, cur); } catch {}
  let size = 0; try { for (const o of await fsp.readdir(TM_OBJ)) size += (await fsp.stat(path.join(TM_OBJ, o))).size; } catch {}
  const snaps = d.snaps.map((s, i) => ({ id: s.id, at: s.at, reason: s.reason, mods: Object.keys(s.files).filter(r => /^mods\/[^/]+\.jar$/.test(r)).length, files: Object.keys(s.files).length, diff: tmDiff(d.snaps[i - 1]?.files || {}, s.files), first: i === 0 })).reverse();
  return { snaps, pending, size, running: running.has(p.id) };
});
ipcMain.handle('tm:snapshot', async (_e, { profileId, reason }) => { const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden'); const s = await tmSnapshot(p, reason || 'Von Hand gesichert', true); return !!s; });
ipcMain.handle('tm:delete', async (_e, { profileId, id }) => tmLocked(profileId, async () => { const d = tmLoad(profileId); d.snaps = d.snaps.filter(s => s.id !== id); tmSave(profileId, d); tmGcSoon(); return true; }));
ipcMain.handle('tm:restore', async (_e, { profileId, id }) => {
  const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden');
  return tmLocked(p.id, async () => {
    if (running.has(p.id)) throw new Error('Bitte erst Minecraft für dieses Profil beenden');
    const target = tmLoad(p.id).snaps.find(s => s.id === id); if (!target) throw new Error('Schnappschuss nicht gefunden');
    await tmSnapshotInner(p, 'Vor dem Zurücksetzen', false, target.id);
    const dir = instanceDir(p), d = tmLoad(p.id); const cur = await tmScan(p, d.cache);
    const missing = Object.values(target.files).filter(h => !fs.existsSync(path.join(TM_OBJ, h))).length;
    if (missing) throw new Error(`${missing} Dateien dieses Stands fehlen im Speicher – Zurücksetzen abgebrochen, nichts wurde verändert`);
    let removedN = 0, written = 0;
    for (const r of Object.keys(cur)) if (!(r in target.files)) { await fsp.rm(path.join(dir, r), { force: true }); removedN++; }
    for (const [r, h] of Object.entries(target.files)) {
      if (cur[r]?.h === h) continue;
      const out = path.join(dir, r); if (!out.startsWith(dir + path.sep)) continue;
      await fsp.mkdir(path.dirname(out), { recursive: true }); await fsp.copyFile(path.join(TM_OBJ, h), out); written++;
    }
    updateCache.clear?.();
    await tmSnapshotInner(p, `Zurückgesetzt auf ${new Date(target.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, false, target.id);
    bump('tmRestores');
    return { removed: removedN, written, missing: 0 };
  });
});
// Automatisch sichern, bevor etwas Größeres passiert
wrapHandler('launch', async (orig, e, profileId, server) => { await tmSnapshotQuiet(profileId, 'Vor dem Spielstart'); return orig(e, profileId, server); });
for (const [ch, reason] of [['mods:update', 'Vor einem Mod-Update'], ['content:remove', 'Vor dem Löschen einer Datei'], ['modsets:apply', 'Vor dem Wechsel des Mod-Sets'], ['browse:install', 'Vor einer Installation'], ['bundle:install', 'Vor der Ausstattung']])
  wrapHandler(ch, async (orig, e, arg, ...rest) => { if (e && arg?.profileId && (ch !== 'content:remove' || arg.kind === 'mods')) await tmSnapshotQuiet(arg.profileId, reason); return orig(e, arg, ...rest); });

// ---------- Profil-Codes: Profil als kurzer Text teilen ----------
const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const codeHash = (code) => crypto.createHash('sha1').update(String(code).trim()).digest('hex').slice(0, 16);
function encodeShare(obj) { return 'LC1-' + b64u(zlib.deflateRawSync(Buffer.from(JSON.stringify(obj)), { level: 9 })); }
function decodeShare(code) {
  const m = /^LC1-([\w-]+)$/.exec(String(code || '').replace(/\s+/g, '')); if (!m) throw new Error('Das ist kein LellekClient-Code (er beginnt mit „LC1-“)');
  let j; try { j = JSON.parse(zlib.inflateRawSync(unb64u(m[1])).toString('utf8')); } catch { throw new Error('Der Code ist unvollständig oder beschädigt'); }
  if (!j || typeof j.mc !== 'string' || !/^[\w.\-]{1,24}$/.test(j.mc)) throw new Error('Der Code enthält keine Minecraft-Version');
  for (const k of ['m', 'r', 's']) j[k] = (Array.isArray(j[k]) ? j[k] : []).filter(x => /^[A-Za-z0-9]{8}$/.test(x)).slice(0, 600);
  j.l = ['fabric', 'forge', 'neoforge'].includes(j.l) ? j.l : ''; j.lv = String(j.lv || ''); if (j.lv && !/^[\w.+-]{1,40}$/.test(j.lv)) throw new Error('Ungültige Loader-Version im Code'); j.n = String(j.n || 'Geteiltes Profil').replace(/[\u0000-\u001f]/g, '').slice(0, 40); j.i = String(j.i || '').slice(0, 4);
  return j;
}
async function buildShareCode(p) {
  const dir = instanceDir(p), entries = [];
  for (const [kind, key] of [['mods', 'm'], ['resourcepacks', 'r'], ['shaderpacks', 's']]) {
    const d = path.join(dir, kind); let list = []; try { list = await fsp.readdir(d); } catch {}
    for (const f of list) if (/\.(jar|zip)$/i.test(f) && !/^LellekHUD/i.test(f)) { try { entries.push({ key, f, sha1: await sha1(path.join(d, f)) }); } catch {} }
  }
  let known = {};
  if (entries.length) {
    const r = await fetch('https://api.modrinth.com/v2/version_files', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'LellekClient' }, body: JSON.stringify({ hashes: entries.map(e => e.sha1), algorithm: 'sha1' }), signal: withTimeout(20000) });
    if (!r.ok) throw new Error(`Modrinth nicht erreichbar (${r.status})`);
    known = await r.json();
  }
  const obj = { v: 1, n: p.name, mc: p.version, l: p.loader || '', lv: p.loaderVersion || '', i: p.icon || '', mem: p.memory || 4, m: [], r: [], s: [] };
  const missing = [];
  for (const e of entries) { const v = known[e.sha1]; if (v?.id) { if (!obj[e.key].includes(v.id)) obj[e.key].push(v.id); } else missing.push(e.f); }
  const code = encodeShare(obj);
  return { code, matched: obj.m.length + obj.r.length + obj.s.length, missing, name: p.name, version: p.version, loader: p.loader || '', mods: obj.m.length };
}
async function modrinthVersionsByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) { const part = ids.slice(i, i + 200); out.push(...await getJson(`https://api.modrinth.com/v2/versions?ids=${encodeURIComponent(JSON.stringify(part))}`)); }
  return out;
}
ipcMain.handle('share:create', async (_e, profileId) => { const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden'); const r = await buildShareCode(p); bump('shares'); return r; });
ipcMain.handle('share:preview', async (_e, code) => {
  const j = decodeShare(code); const ids = [...j.m, ...j.r, ...j.s];
  const versions = ids.length ? await modrinthVersionsByIds(ids) : [];
  const projIds = [...new Set(versions.map(v => v.project_id))];
  let projects = []; if (projIds.length) { try { for (let i = 0; i < projIds.length; i += 200) projects.push(...await getJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(projIds.slice(i, i + 200)))}`)); } catch {} }
  const byP = Object.fromEntries(projects.map(x => [x.id, x]));
  const kindOf = (id) => j.m.includes(id) ? 'mods' : j.r.includes(id) ? 'resourcepacks' : 'shaderpacks';
  const items = versions.map(v => { const pr = byP[v.project_id]; const f = (v.files || []).find(x => x.primary) || v.files?.[0]; return { kind: kindOf(v.id), title: pr?.title || f?.filename || v.name, icon: pr?.icon_url || null, size: f?.size || 0, version: v.version_number }; }).sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  const existing = store.shareImports?.[codeHash(code)]; const have = existing && profileById(existing);
  return { name: j.n, version: j.mc, loader: j.l, loaderVersion: j.lv, icon: j.i || '', items, unknown: ids.length - versions.length, size: items.reduce((a, x) => a + x.size, 0), existing: have ? { id: have.id, name: have.name } : null };
});
async function importShareCode(code, name) {
  const j = decodeShare(code);
  if (j.l && !j.lv) throw new Error('Im Code fehlt die Loader-Version');
  const ids = [...j.m, ...j.r, ...j.s];
  const versions = ids.length ? await modrinthVersionsByIds(ids) : [];
  const p = await newProfileFrom(String(name || j.n).slice(0, 40), j.mc, j.l, j.lv);
  p.icon = j.i || p.icon; p.memory = Math.max(2, Math.min(16, Number(j.mem) || 4)); p.installed = {};
  let done = 0, failed = 0;
  await pool(versions, 4, async (v) => {
    const kind = j.m.includes(v.id) ? 'mods' : j.r.includes(v.id) ? 'resourcepacks' : 'shaderpacks';
    const f = kind === 'mods' ? pickFile(v, p.loader) : ((v.files || []).find(x => x.primary) || v.files?.[0]);
    try { if (!f) throw new Error('keine Datei'); f.filename = path.basename(f.filename); await download(f.url, path.join(kindDir(p.id, kind), f.filename)); if (kind === 'mods') p.installed[v.project_id] = f.filename; }
    catch (e) { failed++; send('launch:log', { line: `Profil-Code: ${f?.filename || v.id} konnte nicht geladen werden (${e.message})` }); }
    send('launch:progress', { task: `Profil wird eingerichtet ${++done}/${versions.length}`, percent: done / Math.max(1, versions.length) });
  });
  store.shareImports ??= {}; store.shareImports[codeHash(code)] = p.id; saveStore();
  send('launch:progress', { task: 'Fertig', percent: 1 });
  return { id: p.id, name: p.name, profiles: store.profiles, files: versions.length, failed, unknown: ids.length - versions.length };
}
ipcMain.handle('share:import', (_e, { code, name }) => importShareCode(code, name));

// ---------- Session-Rückblick: Tode, Kills, Fortschritte, Screenshots aus dem Spiel-Log ----------
const sessionRecap = new Map(); // profileId → Zwischenstand
const newRecap = () => ({ player: null, deaths: 0, causes: {}, kills: 0, victims: {}, advancements: [], chats: 0, screenshots: 0 });
const DEATH_RE = /^(?:was (?:slain|shot|killed|blown up|fireballed|pummeled|squashed|squished|impaled|skewered|stung|poked to death|pricked to death|struck by lightning|obliterated|doomed to fall|frozen to death|knocked into the void|roasted|burnt|sniped|smashed|stomped)|blew up|drowned|died|fell |hit the ground too hard|burned to death|went up in flames|walked into |tried to swim in lava|starved to death|suffocated|experienced kinetic energy|froze to death|withered away|discovered the floor was lava|went off with a bang|left the confines of this world|didn't want to live)/;
const KILL_RE = /^(\w{2,16}) (?:was (?:slain|shot|killed|blown up|fireballed|pummeled|impaled|skewered|knocked into the void|doomed to fall|struck by lightning|obliterated)|drowned|burned to death|tried to swim in lava|fell|hit the ground too hard|walked into)[^\n]*? (?:by|escape|fighting) (\w{2,16})(?:\W|$)/;
function recapLine(p, line) {
  let r = sessionRecap.get(p.id); if (!r) { r = newRecap(); sessionRecap.set(p.id, r); }
  let m;
  if (!r.player && (m = /Setting user: (\w{2,16})/.exec(line))) { r.player = m[1]; return; }
  if (/Saved screenshot as /.test(line)) { r.screenshots++; return; }
  const ci = line.indexOf('[CHAT] '); if (ci < 0 || !r.player) return;
  const msg = line.slice(ci + 7).replace(/§./g, '').trim(), me = r.player;
  if (msg.startsWith(`<${me}> `)) { r.chats++; return; }
  if ((m = new RegExp(`^${me} has (?:made the advancement|completed the challenge|reached the goal|just earned the achievement) \\[(.+?)\\]`).exec(msg))) { if (r.advancements.length < 60 && !r.advancements.includes(m[1])) r.advancements.push(m[1]); return; }
  if (msg.startsWith(me + ' ') && DEATH_RE.test(msg.slice(me.length + 1))) {
    r.deaths++; const rest = msg.slice(me.length + 1); const by = (/ by (.+?)(?: using .*)?$/.exec(rest) || [])[1];
    const key = (by || rest.replace(/ (whilst|while) .*$/, '')).slice(0, 40); r.causes[key] = (r.causes[key] || 0) + 1; return;
  }
  if ((m = KILL_RE.exec(msg)) && m[2] === me && m[1] !== me) { r.kills++; r.victims[m[1]] = (r.victims[m[1]] || 0) + 1; }
}
{ const _t = trackGameLog; trackGameLog = function (p, line) { _t(p, line); try { recapLine(p, String(line)); } catch {} }; }
{ const _r = resetSessionTracking; resetSessionTracking = function (id) { _r(id); sessionRecap.delete(id); }; }
const topOf = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
{
  const _rs = recordSession;
  recordSession = function (p, start, code) {
    _rs(p, start, code);
    const r = sessionRecap.get(p.id) || newRecap(); sessionRecap.delete(p.id);
    const s = store.sessions?.[store.sessions.length - 1]; if (!s || s.profileId !== p.id || s.start !== start) return;
    s.recap = { player: r.player, deaths: r.deaths, kills: r.kills, advancements: r.advancements.slice(0, 30), chats: r.chats, screenshots: r.screenshots, topDeath: topOf(r.causes), topVictim: topOf(r.victims) };
    const before = new Set(Object.keys(store.achievements || {}));
    setTimeout(() => {
      checkAchievements();
      const unlocked = Object.keys(store.achievements || {}).filter(k => !before.has(k)).map(k => ACHIEVEMENTS.find(a => a.id === k)).filter(Boolean).map(a => ({ id: a.id, icon: a.icon, title: a.title }));
      if (s.end - s.start >= 60000 && store.settings.sessionRecap !== false) send('session:recap', { ...s, unlocked, level: levelInfo() });
    }, 300);
  };
}

// ---------- Level & Erfolge ----------
const ACHIEVEMENTS = [
  { id: 'first', icon: '🎮', title: 'Erster Start', desc: 'Minecraft mit LellekClient gestartet', test: m => m.sessions >= 1 },
  { id: 'h10', icon: '⏱️', title: 'Warmgespielt', desc: '10 Stunden Spielzeit', goal: m => [m.hours, 10] },
  { id: 'h50', icon: '🔥', title: 'Dauerbrenner', desc: '50 Stunden Spielzeit', goal: m => [m.hours, 50] },
  { id: 'h100', icon: '💎', title: 'Veteran', desc: '100 Stunden Spielzeit', goal: m => [m.hours, 100] },
  { id: 'h500', icon: '👑', title: 'Legende', desc: '500 Stunden Spielzeit', goal: m => [m.hours, 500] },
  { id: 'marathon', icon: '🏃', title: 'Marathon', desc: 'Eine Sitzung über 4 Stunden', goal: m => [m.longestH, 4] },
  { id: 'streak7', icon: '📅', title: 'Eine Woche am Stück', desc: 'An 7 Tagen hintereinander gespielt', goal: m => [m.bestStreak, 7] },
  { id: 'night', icon: '🦉', title: 'Nachteule', desc: 'Zwischen 2 und 5 Uhr nachts gespielt', test: m => m.night },
  { id: 'versions5', icon: '🧭', title: 'Zeitreisender', desc: '5 verschiedene Minecraft-Versionen gespielt', goal: m => [m.versions, 5] },
  { id: 'loaders', icon: '🧩', title: 'Allrounder', desc: 'Vanilla, Fabric und Forge oder NeoForge gespielt', goal: m => [m.loaders, 3] },
  { id: 'mods50', icon: '📦', title: 'Modder', desc: '50 Mods installiert (alle Profile zusammen)', goal: m => [m.mods, 50] },
  { id: 'servers10', icon: '🌍', title: 'Weltenbummler', desc: 'Auf 10 verschiedenen Servern gewesen', goal: m => [m.servers, 10] },
  { id: 'friend1', icon: '🤝', title: 'Nicht allein', desc: 'Den ersten Freund hinzugefügt', goal: m => [m.friends, 1] },
  { id: 'friend10', icon: '🎉', title: 'Beliebt', desc: '10 Freunde', goal: m => [m.friends, 10] },
  { id: 'party', icon: '🥳', title: 'Party-Starter', desc: 'Mit dem Party-Modus gemeinsam gestartet', goal: m => [m.partyLaunches, 1] },
  { id: 'chat', icon: '💬', title: 'Quasselstrippe', desc: '100 Nachrichten im Launcher-Chat', goal: m => [m.chatSent, 100] },
  { id: 'share', icon: '🔗', title: 'Großzügig', desc: 'Ein Profil per Code geteilt', goal: m => [m.shares, 1] },
  { id: 'host', icon: '🖥️', title: 'Gastgeber', desc: 'Einen eigenen Server gestartet', goal: m => [m.serverStarts, 1] },
  { id: 'adv25', icon: '🏆', title: 'Fortschritt', desc: '25 Fortschritte erreicht', goal: m => [m.advancements, 25] },
  { id: 'kills100', icon: '⚔️', title: 'Kämpfer', desc: '100 Gegner besiegt', goal: m => [m.kills, 100] },
  { id: 'deaths100', icon: '💀', title: 'Unsterblich? Nö.', desc: '100-mal gestorben', goal: m => [m.deaths, 100] },
  { id: 'shots50', icon: '📸', title: 'Fotograf', desc: '50 Screenshots gemacht', goal: m => [m.screenshots, 50] },
  { id: 'comeback', icon: '🩹', title: 'Stehaufmännchen', desc: 'Nach einem Absturz sofort weitergespielt', test: m => m.comeback },
  { id: 'timemachine', icon: '⏪', title: 'Zeitreise', desc: 'Ein Profil mit der Zeitmaschine zurückgesetzt', goal: m => [m.tmRestores, 1] },
  { id: 'autopilot', icon: '🚀', title: 'Turbo', desc: 'Den Performance-Autopiloten benutzt', goal: m => [m.autopilot, 1] },
];
function achievementMetrics() {
  const S = store.sessions || [], c = store.counters || {};
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const days = [...new Set(S.map(s => dayKey(s.start)))].map(k => { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo, d).getTime(); }).sort((a, b) => a - b);
  let best = 0, run = 0; for (let i = 0; i < days.length; i++) { run = i && Math.round((days[i] - days[i - 1]) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); }
  let mods = 0; for (const p of store.profiles) { try { mods += fs.readdirSync(path.join(instanceDir(p), 'mods')).filter(f => /\.jar$/i.test(f)).length; } catch {} }
  const loaders = new Set(S.map(s => s.loader === 'neoforge' ? 'forge' : (s.loader || 'vanilla')));
  let comeback = false; for (let i = 1; i < S.length; i++) if (S[i - 1].code !== 0 && S[i].start - S[i - 1].end < 10 * 60000 && S[i].end - S[i].start > 10 * 60000) comeback = true;
  const sum = (k) => S.reduce((a, s) => a + (s.recap?.[k] || 0), 0);
  let friends = 0; try { for (const l of Object.values(store.friendsByAccount || {})) friends = Math.max(friends, l.length); } catch {}
  return {
    sessions: S.length, hours: Math.floor(store.profiles.reduce((a, p) => a + (p.playtimeMs || 0), 0) / 36e5),
    longestH: Math.floor(S.reduce((a, s) => Math.max(a, s.end - s.start), 0) / 36e5 * 10) / 10, bestStreak: best,
    night: S.some(s => { const h = new Date(s.start).getHours(), h2 = new Date(s.end).getHours(); return (h >= 2 && h < 5) || (h2 >= 2 && h2 < 5 && s.end - s.start < 12 * 36e5); }),
    versions: new Set(S.map(s => s.version)).size, loaders: loaders.size, mods, servers: new Set(S.flatMap(s => s.servers || [])).size, friends,
    partyLaunches: c.partyLaunches || 0, chatSent: c.chatSent || 0, shares: c.shares || 0, serverStarts: c.serverStarts || 0, tmRestores: c.tmRestores || 0, autopilot: c.autopilot || 0,
    advancements: S.reduce((a, s) => a + (s.recap?.advancements?.length || 0), 0), kills: sum('kills'), deaths: sum('deaths'), screenshots: sum('screenshots'), comeback,
  };
}
function levelFor(xp) { const level = Math.floor(Math.sqrt(xp / 40)) + 1; const cur = 40 * (level - 1) ** 2, next = 40 * level ** 2; return { level, xp, cur, next, progress: (xp - cur) / (next - cur) }; }
function levelInfo() { const minutes = Math.floor(store.profiles.reduce((a, p) => a + (p.playtimeMs || 0), 0) / 60000); const n = Object.keys(store.achievements || {}).length; return { ...levelFor(minutes + n * 100), unlocked: n, total: ACHIEVEMENTS.length }; }
let achInit = false;
function checkAchievements() {
  let m; try { m = achievementMetrics(); } catch { return; }
  const first = !store.achievements; store.achievements ??= {};
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (store.achievements[a.id]) continue;
    const ok = a.test ? a.test(m) : (() => { const [v, g] = a.goal(m); return v >= g; })();
    if (ok) { store.achievements[a.id] = Date.now(); fresh.push(a); }
  }
  if (!fresh.length) return;
  saveStore();
  if (first || !achInit) return; // beim allerersten Abgleich still freischalten
  for (const a of fresh) { send('ach:unlocked', { id: a.id, icon: a.icon, title: a.title, desc: a.desc, level: levelInfo() }); notify('Erfolg freigeschaltet', `${a.icon} ${a.title} – ${a.desc}`); }
  publishPresence?.(true);
}
app.whenReady().then(() => setTimeout(() => { checkAchievements(); achInit = true; }, 3000));
ipcMain.handle('ach:get', () => {
  let m = {}; try { m = achievementMetrics(); } catch {}
  return { ...levelInfo(), badge: store.settings.badge || null, list: ACHIEVEMENTS.map(a => { const g = a.goal ? a.goal(m) : null; return { id: a.id, icon: a.icon, title: a.title, desc: a.desc, at: store.achievements?.[a.id] || null, progress: g ? Math.min(1, g[0] / g[1]) : null, value: g ? `${Math.min(g[0], g[1])}/${g[1]}` : null }; }) };
});
ipcMain.handle('ach:setBadge', (_e, id) => { const a = ACHIEVEMENTS.find(x => x.id === id); store.settings.badge = a && store.achievements?.[a.id] ? `${a.icon} ${a.title}` : null; saveStore(); publishPresence?.(true); return store.settings.badge; });
wrapHandler('server:start', async (orig, e, ...a) => { const r = await orig(e, ...a); bump('serverStarts'); return r; });
{ const _mp = myPresence; myPresence = function () { const out = _mp(); try { out.level = levelInfo().level; out.badge = store.settings.badge || null; } catch {} return out; }; }

// ---------- Chat mit Freunden ----------
let chatOpenFor = null;
function chatBox() { const id = myAccountId(); if (!id) return null; store.chatByAccount ??= {}; return (store.chatByAccount[id] ??= { threads: {}, unread: {} }); }
function friendName(uuid) { return myFriends().find(f => f.uuid === uuid)?.name || friendState[uuid]?.name || '?'; }
function addIncoming(list) {
  const c = chatBox(); if (!c || !list?.length) return;
  for (const m of list) {
    if (social().blocked.some(b => b.uuid === m.from)) continue;
    const t = (c.threads[m.from] ??= []); if (t.some(x => x.id === m.id)) continue;
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
    const data = m.kind === 'profile' && m.data ? { code: str(m.data.code, 6000), name: str(m.data.name, 40), version: str(m.data.version, 24), loader: str(m.data.loader, 12), mods: Number(m.data.mods) || 0 } : m.kind === 'server' && m.data ? { ip: str(m.data.ip, 100), name: str(m.data.name, 60) } : null;
    t.push({ id: String(m.id), from: m.from, text: str(m.text, 1000), kind: data ? m.kind : 'text', data, at: Number(m.at) || Date.now(), in: true }); if (t.length > 300) t.splice(0, t.length - 300);
    const open = chatOpenFor === m.from && win?.isFocused();
    if (!open) c.unread[m.from] = (c.unread[m.from] || 0) + 1;
    const nick = myFriends().find(f => f.uuid === m.from)?.nick || m.name;
    if (!open && store.settings.chatNotify !== false) notify(nick, m.kind === 'profile' ? `hat dir ein Profil geschickt: ${m.data?.name || ''}` : m.kind === 'server' ? `schlägt einen Server vor: ${m.data?.ip || ''}` : String(m.text).slice(0, 140));
    send('chat:message', { ...t[t.length - 1], name: nick });
  }
  saveStore(); send('chat:unread', chatUnread());
}
function chatUnread() { const c = chatBox(); return c ? Object.values(c.unread).reduce((a, n) => a + n, 0) : 0; }
ipcMain.handle('chat:threads', () => {
  const c = chatBox(); if (!c) return [];
  return Object.entries(c.threads).map(([uuid, t]) => ({ uuid, name: friendName(uuid), last: t[t.length - 1] || null, unread: c.unread[uuid] || 0 })).filter(x => x.last).sort((a, b) => b.last.at - a.last.at);
});
ipcMain.handle('chat:thread', (_e, uuid) => { const c = chatBox(); if (!c) return []; chatOpenFor = uuid || null; if (uuid && c.unread[uuid]) { delete c.unread[uuid]; saveStore(); send('chat:unread', chatUnread()); } return (c.threads[uuid] || []).slice(-200); });
ipcMain.handle('chat:close', () => { chatOpenFor = null; return true; });
ipcMain.handle('chat:unread', () => chatUnread());
ipcMain.handle('chat:send', async (_e, { to, text, kind, data }) => {
  const c = chatBox(); if (!c) throw new Error('Bitte zuerst anmelden');
  text = String(text || '').trim().slice(0, 1000); if (!text && !data) return null;
  const r = await presenceCall('POST', '/v1/chat/send', { to, text, kind: kind || 'text', data: data || null });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Senden fehlgeschlagen (${r.status})`);
  const m = { id: d.id, from: dashUuid(currentAuth.profile.id), text, kind: kind || 'text', data: data || null, at: d.at || Date.now(), in: false };
  const t = (c.threads[to] ??= []); t.push(m); if (t.length > 300) t.splice(0, t.length - 300);
  store.counters ??= {}; store.counters.chatSent = (store.counters.chatSent || 0) + 1; saveStore(); if (store.counters.chatSent === 100) setTimeout(checkAchievements, 100);
  return m;
});
ipcMain.handle('chat:clear', (_e, uuid) => { const c = chatBox(); if (c) { delete c.threads[uuid]; delete c.unread[uuid]; saveStore(); } return true; });

// ---------- Party: gemeinsam mit demselben Profil auf denselben Server ----------
let partyState = null, partyInvites = [], partyLaunchHandled = null, serverOffset = 0;
const seenPartyInvites = new Set();
function applySocial(d) {
  if (!d) return;
  if (Array.isArray(d.messages) && d.messages.length) addIncoming(d.messages);
  if ('party' in d) {
    const before = JSON.stringify(partyState); partyState = d.party || null;
    if (partyState) serverOffset = partyState.serverTime - Date.now();
    if (JSON.stringify(partyState) !== before) send('party:update', partyView());
    handlePartyLaunch();
  }
  if (Array.isArray(d.partyInvites)) {
    const before = partyInvites.map(i => i.id).join(); partyInvites = d.partyInvites;
    for (const i of partyInvites) if (!seenPartyInvites.has(i.id + i.at)) { seenPartyInvites.add(i.id + i.at); notifyFriends(`${i.byName} lädt dich in eine Party ein${i.plan?.server ? ' – ' + i.plan.server : ''}`); send('party:invite', i); }
    if (partyInvites.map(i => i.id).join() !== before) send('party:update', partyView());
  }
}
friendsHook = (d) => applySocial(d);
function partyProfileId(P = partyState) {
  if (!P?.plan) return null;
  if (P.leader === P.me && store.partyProfile && profileById(store.partyProfile)) return store.partyProfile;
  if (P.plan.code) { const id = store.shareImports?.[codeHash(P.plan.code)]; if (id && profileById(id)) return id; }
  const own = store.partyChoice?.[P.id]; if (own && profileById(own)) return own;
  if (!P.plan.mods && !P.plan.loader) { const v = store.profiles.find(p => p.version === P.plan.version && !p.loader); if (v) return v.id; }
  return null;
}
function partyView() { const id = partyProfileId(); return { party: partyState, invites: partyInvites, profileId: id, profileName: id ? profileById(id)?.name : null }; }
function handlePartyLaunch() {
  const P = partyState; const key = P ? `${P.id}:${P.launchId}` : null;
  if (!P?.launchAt || key === partyLaunchHandled) return;
  if (P.launchAt < P.serverTime - 15000) return; // alter Start (z. B. nach Neustart) – nicht nachholen
  const me = P.members.find(m => m.uuid === P.me); if (!me?.ready) return;
  partyLaunchHandled = key;
  const wait = Math.max(0, P.launchAt - (Date.now() + serverOffset));
  send('party:countdown', { inMs: wait, server: P.plan?.server || null });
  setTimeout(async () => {
    if (partyState?.launchId !== P.launchId || !partyState?.launchAt) { send('party:launched', { ok: false, error: 'Start abgebrochen' }); return; }
    try {
      const id = partyProfileId(P); if (!id) throw new Error('Kein Party-Profil – erst „Bereit“ drücken');
      if (!running.has(id)) await handlers['launch'](null, id, P.plan?.server || undefined);
      bump('partyLaunches'); send('party:launched', { ok: true, profileId: id });
    } catch (e) { send('party:launched', { ok: false, error: e.message }); }
  }, wait);
}
async function socialPoll() {
  if (!currentAuth) return partyView();
  try { const r = await presenceCall('GET', '/v1/social'); if (r.ok) applySocial(await r.json()); } catch {}
  return partyView();
}
async function partyAction(act, payload) {
  const r = await presenceCall('POST', `/v1/party/${act}`, payload || {}); const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Party-Fehler (${r.status})`);
  applySocial(d); return partyView();
}
setInterval(() => { if (partyState || chatOpenFor) socialPoll(); }, 4000);
ipcMain.handle('social:poll', () => socialPoll());
ipcMain.handle('party:get', () => partyView());
ipcMain.handle('party:create', () => partyAction('create'));
ipcMain.handle('party:invite', async (_e, uuid) => { if (!partyState) await partyAction('create'); return partyAction('invite', { uuid }); });
ipcMain.handle('party:join', (_e, id) => partyAction('join', { id }));
ipcMain.handle('party:decline', (_e, id) => partyAction('decline', { id }));
ipcMain.handle('party:leave', async () => { const v = await partyAction('leave'); return v; });
ipcMain.handle('party:kick', (_e, uuid) => partyAction('kick', { uuid }));
ipcMain.handle('party:promote', (_e, uuid) => partyAction('promote', { uuid }));
ipcMain.handle('party:launch', (_e, seconds) => partyAction('launch', { seconds: seconds || 10 }));
ipcMain.handle('party:cancel', () => partyAction('cancel'));
ipcMain.handle('party:plan', async (_e, { profileId, server }) => {
  const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden');
  if (!partyState) await partyAction('create');
  send('launch:progress', { task: 'Party-Profil wird vorbereitet', percent: 0.3 });
  const s = await buildShareCode(p);
  store.partyProfile = p.id; saveStore();
  send('launch:progress', { task: 'Bereit', percent: 0 });
  return partyAction('plan', { name: p.name, code: s.code, server: String(server || '').trim() || null, version: p.version, loader: p.loader || '', mods: s.mods });
});
ipcMain.handle('party:choose', (_e, profileId) => { if (!partyState) return partyView(); store.partyChoice ??= {}; store.partyChoice[partyState.id] = profileId; saveStore(); return partyView(); });
ipcMain.handle('party:ready', async (_e, ready) => {
  if (!partyState) throw new Error('Du bist in keiner Party');
  if (ready && !partyProfileId()) {
    const code = partyState.plan?.code; if (!code) throw new Error('Wähle ein passendes Profil');
    await importShareCode(code, `Party: ${partyState.plan.name}`.slice(0, 40));
  }
  return partyAction('ready', { ready: !!ready });
});

// ---------- Server-Radar: Ping mit SRV-Auflösung, parallel ----------
async function resolveMc(address) {
  const [host, portStr] = String(address).trim().split(':');
  if (portStr) return { host, port: Number(portStr) || 25565 };
  try { const srv = await dnsp.resolveSrv(`_minecraft._tcp.${host}`); if (srv?.[0]) return { host: srv[0].name, port: srv[0].port }; } catch {}
  return { host, port: 25565 };
}
ipcMain.handle('radar:scan', async (_e, list) => {
  const out = {}; const ips = [...new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean))].slice(0, 40);
  await pool(ips, 8, async (ip) => { try { const { host, port } = await resolveMc(ip); out[ip] = await pingServer(host, port, 5000); } catch (e) { out[ip] = { online: false, error: e.message }; } });
  return out;
});

// ---------- Performance-Autopilot ----------
const PERF_MODS = {
  fabric: [['sodium', 'Sodium', 'Neue Grafik-Engine – oft doppelte bis dreifache FPS'], ['lithium', 'Lithium', 'Schnellere Spiellogik (Mobs, Redstone, Chunks)'], ['ferrite-core', 'FerriteCore', 'Deutlich weniger RAM-Verbrauch'], ['entityculling', 'EntityCulling', 'Verdeckte Tiere und Truhen werden nicht gezeichnet'], ['immediatelyfast', 'ImmediatelyFast', 'Schnelleres HUD, Text und Partikel'], ['modernfix', 'ModernFix', 'Schnellerer Start, weniger RAM'], ['dynamic-fps', 'Dynamic FPS', 'Spart Leistung, wenn das Spiel im Hintergrund ist']],
  neoforge: [['sodium', 'Sodium', 'Neue Grafik-Engine – oft doppelte FPS'], ['ferrite-core', 'FerriteCore', 'Deutlich weniger RAM-Verbrauch'], ['entityculling', 'EntityCulling', 'Verdeckte Objekte werden nicht gezeichnet'], ['immediatelyfast', 'ImmediatelyFast', 'Schnelleres HUD und Text'], ['modernfix', 'ModernFix', 'Schnellerer Start, weniger RAM'], ['dynamic-fps', 'Dynamic FPS', 'Spart Leistung im Hintergrund']],
  forge: [['embeddium', 'Embeddium', 'Sodium-Grafik-Engine für Forge'], ['ferrite-core', 'FerriteCore', 'Weniger RAM-Verbrauch'], ['entityculling', 'EntityCulling', 'Verdeckte Objekte werden nicht gezeichnet'], ['modernfix', 'ModernFix', 'Schnellerer Start, weniger RAM']],
};
const PERF_CLASH = { sodium: /optifine|embeddium|rubidium/i, embeddium: /optifine|sodium|rubidium/i };
const PERF_JVM = '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1';
const perfPlans = new Map();
ipcMain.handle('perf:plan', async (_e, profileId) => {
  const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden');
  const totalGb = Math.round(os.totalmem() / 1073741824), threads = os.cpus().length;
  let jars = []; try { jars = (await fsp.readdir(path.join(instanceDir(p), 'mods'))).filter(f => /\.jar$/i.test(f)); } catch {}
  const n = jars.length, cap = Math.max(2, Math.floor(totalGb / 2));
  const want = !p.loader ? Math.min(4, Math.max(2, Math.floor(totalGb / 4))) : n > 150 ? 8 : n > 80 ? 6 : n > 30 ? 5 : 4;
  const memory = Math.max(2, Math.min(cap, want));
  const others = (p.jvmArgs || '').split(/\s+/).filter(a => a && !/^-XX:/.test(a) && !/^-Xm[sx]/.test(a));
  const jvm = [...others, PERF_JVM].join(' ').trim();
  const list = PERF_MODS[p.loader] || [];
  const mods = [];
  await pool(list, 4, async ([slug, title, why]) => {
    const installed = jars.some(f => f.toLowerCase().replace(/[^a-z]/g, '').startsWith(slug.replace(/[^a-z]/g, ''))) || !!(p.installed && Object.values(p.installed).some(f => f && f.toLowerCase().startsWith(slug.split('-')[0])));
    const clash = PERF_CLASH[slug] && jars.find(f => PERF_CLASH[slug].test(f));
    let version = null; if (!installed && !clash) { try { version = pickVersion(await modrinthVersions(slug, p, 'mods')); } catch {} }
    mods.push({ slug, title, why, installed, clash: clash || null, available: !!version, version: version?.version_number || null, _v: version });
  });
  mods.sort((a, b) => list.findIndex(x => x[0] === a.slug) - list.findIndex(x => x[0] === b.slug));
  perfPlans.set(p.id, Object.fromEntries(mods.filter(m => m._v).map(m => [m.slug, m._v])));
  const tips = [];
  if (!p.loader) tips.push('Vanilla-Profil: Performance-Mods brauchen Fabric oder NeoForge. Tipp: Profil duplizieren und als Fabric-Profil anlegen.');
  if (p.loader === 'forge' && mcMinor(p.version) <= 12) tips.push(`Für ${p.version} gibt es die modernen Performance-Mods nicht auf Modrinth – LellekHUD und OptiFine sind hier die beste Wahl.`);
  if (totalGb < 8) tips.push(`Nur ${totalGb} GB RAM: Browser und Discord-Overlay beim Spielen schließen.`);
  if (threads < 4) tips.push('Wenige CPU-Kerne: Simulationsdistanz im Spiel auf 5–6 stellen.');
  return { profile: { id: p.id, name: p.name, version: p.version, loader: p.loader || '' }, ramGb: totalGb, threads, modCount: n,
    memory: { current: p.memory || store.settings.memory || 4, recommended: memory, max: cap }, jvm: { current: p.jvmArgs || '', recommended: jvm, changed: (p.jvmArgs || '').trim() !== jvm },
    mods: mods.map(({ _v, ...m }) => m), tips };
});
ipcMain.handle('perf:apply', async (_e, { profileId, memory, jvm, mods }) => {
  const p = profileById(profileId); if (!p) throw new Error('Profil nicht gefunden');
  if (running.has(p.id)) throw new Error('Bitte erst Minecraft für dieses Profil beenden');
  await tmSnapshotQuiet(p.id, 'Vor dem Performance-Autopiloten');
  const plan = perfPlans.get(p.id) || {}; const done = [], failed = [];
  if (memory) p.memory = Math.max(1, Math.min(32, Number(memory)));
  if (typeof jvm === 'string') p.jvmArgs = jvm.trim();
  const wanted = (mods || []).filter(s => plan[s]);
  if (wanted.length) await ensureFabricApi(p);
  let i = 0;
  for (const slug of wanted) {
    send('launch:progress', { task: `Autopilot: ${slug}`, percent: ++i / wanted.length });
    try { const files = await installModrinthVersion(p, 'mods', plan[slug], new Set()); done.push(...files); } catch (e) { failed.push(`${slug}: ${e.message}`); }
  }
  saveStore(); send('launch:progress', { task: 'Autopilot fertig', percent: 1 });
  bump('autopilot');
  return { done, failed, memory: p.memory, profiles: store.profiles };
});

// ---------- Startseite: alles Wichtige in einem Abruf ----------
ipcMain.handle('home:summary', () => {
  const S = store.sessions || [];
  const last = [...S].reverse().find(s => s.end - s.start > 60000) || null;
  const lastServers = [...new Set([...S].reverse().flatMap(s => s.servers || []))].slice(0, 4);
  return { level: levelInfo(), lastSession: last, lastServers, unread: chatUnread(), party: partyView() };
});
