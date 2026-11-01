// LellekClient 3.0 – Instanz-Seite: Übersicht, Mods, Resourcepacks, Welten, Screenshots, Einstellungen, Protokoll
const INST_TABS = [['overview', 'Übersicht'], ['mods', 'Mods'], ['packs', 'Resourcepacks'], ['worlds', 'Welten'], ['shots', 'Screenshots'], ['settings', 'Einstellungen'], ['log', 'Protokoll']];

async function renderInstance() {
  const root = $('#instRoot'); const p = state.profiles.find(x => x.id === V3.inst);
  if (!p) { root.innerHTML = ''; root.append(h('div.empty-state', h('b', 'Instanz nicht gefunden'), h('button.primary', { onclick: () => showView('profiles') }, 'Zu den Profilen'))); return; }
  let ov = null; try { ov = await api.instance.overview(p.id); } catch (e) { toast(e.message, true); }
  if (ov) { try { ov.hud = await api.hud.status(p.id); } catch {} }
  if (V3.inst !== p.id) return;
  const run = runningSet.has(p.id);
  root.innerHTML = '';
  // Kopf
  const head = h('div.inst-head'); if (p.color) head.style.setProperty('--pc', p.color);
  if (ov?.banner) { const b = h('div.inst-banner'); b.style.backgroundImage = `url("${ov.banner}")`; head.append(b); }
  head.append(h('button.inst-back', { onclick: () => showView('profiles') }, '← Profile'));
  head.append(h('div.inst-ic', profIcon(p)));
  const pills = h('div.inst-meta', h('span.pill', p.version), h('span.pill', loaderName(p.loader) + (p.loaderVersion ? ' ' + p.loaderVersion : '')), h('span.pill', `${p.memory || 4} GB RAM`));
  if (run) pills.append(h('span.pill.ok', '● läuft'));
  head.append(h('div.inst-title', h('h1.inst-name', p.name), pills, h('div.inst-sub', `${fmtH(p.playtimeMs)} gespielt${p.lastPlayed ? ' · zuletzt ' + ago(p.lastPlayed) : ''}${ov ? ` · ${ov.counts.mods} Mods · ${ov.counts.worlds} Welten` : ''}`)));
  const more = h('button.ghost.icon-btn', { title: 'Mehr' }, '⋯');
  more.onclick = () => popMenu(more, [
    { label: '⬆️ Auf neue Version upgraden', run: () => openUpgrade(p.id) },
    { label: '🚀 Performance-Autopilot', run: () => openAutopilot(p.id) },
    { label: '🎒 Ausstattung', run: () => openBundle(p) },
    { label: '⏪ Zeitmaschine', run: () => openTimeMachine(p.id) },
    { label: '🔗 Als Code teilen', run: () => openShareCreate(p.id) },
    { label: '🖼️ Banner ändern …', run: () => pickBanner(p) },
    ...(ov?.hud?.available ? [{ label: ov.hud.state === 'on' ? '🧩 LellekHUD entfernen' : '🧩 LellekHUD hinzufügen', run: () => toggleHud(p, ov.hud.state !== 'on') }] : []),
    '-',
    { label: 'Ordner öffnen', run: () => api.profiles.openFolder(p.id) },
    { label: 'Duplizieren', run: async () => { state.profiles = await api.profiles.duplicate(p.id); toast('Profil kopiert'); } },
  ]);
  const play = h('button.inst-play' + (run ? '.running' : ''), { onclick: async () => { if (runningSet.has(p.id)) { api.launchOpenLog(p.id); return; } play.disabled = true; play.textContent = 'Startet …'; await launchProfile(p.id); renderInstance(); } }, run ? 'Läuft – Log' : 'Spielen');
  head.append(h('div.inst-actions', more, play));
  root.append(head);
  // Reiter
  const tabs = h('div.inst-tabs');
  const cnt = { mods: ov?.counts.mods, packs: ov?.counts.resourcepacks, worlds: ov?.counts.worlds, shots: ov?.counts.screenshots };
  for (const [k, t] of INST_TABS) tabs.append(h('button' + (V3.instTab === k ? '.active' : ''), { onclick: () => { V3.instTab = k; renderInstance(); } }, t, cnt[k] ? h('span.cnt', String(cnt[k])) : null));
  root.append(tabs);
  const body = h('div.inst-body'); root.append(body);
  const fn = { overview: instOverview, mods: instMods, packs: instPacks, worlds: instWorlds, shots: instShots, settings: instSettings, log: instLog }[V3.instTab] || instOverview;
  try { await fn(p, body, ov); } catch (e) { body.append(h('p.danger', e.message)); }
}
api.onClosed(() => { if (state.view === 'instance') setTimeout(renderInstance, 400); });

// ---------- Übersicht ----------
async function instOverview(p, body, ov) {
  if (!ov) return;
  const k = (l, v) => h('div.inst-kpi', h('span', l), h('b', v));
  body.append(h('div.inst-kpis', k('Spielzeit', fmtH(ov.playtimeMs)), k('Sitzungen', String(ov.sessionCount)), k('Mods', `${ov.counts.mods}${ov.counts.modsOff ? ' (+' + ov.counts.modsOff + ' aus)' : ''}`), k('Welten', String(ov.counts.worlds)), k('Speicher', ov.disk ? fmtSize(ov.disk.total) : '–')));
  const left = h('div'), right = h('div');
  // Grafik-Presets
  left.append(h('h3', 'Grafik mit einem Klick'));
  const g = (key, t, d) => h('button.ghost', { onclick: async () => { try { await api.tools.gfx({ id: p.id, preset: key }); toast(`Grafik „${t}“ gesetzt – gilt beim nächsten Start`); } catch (e) { toast(e.message, true); } } }, h('b', t), h('span', d));
  left.append(h('div.gfx-row', g('leistung', '⚡ Leistung', 'Sichtweite 8, schnelle Grafik'), g('ausgewogen', '⚖️ Ausgewogen', 'Sichtweite 12, schön & flüssig'), g('schoen', '✨ Schön', 'Sichtweite 18, alle Effekte')));
  // Werkzeuge
  left.append(h('h3', 'Werkzeuge'));
  const t = (i, title, d, fn) => h('button.act-tile', { onclick: fn }, h('i', i), h('b', title), h('span', d));
  left.append(h('div.inst-actions-grid',
    t('⬆️', 'Version upgraden', 'Neue Minecraft-Version, Mods werden neu gesucht', () => openUpgrade(p.id)),
    t('📦', 'Mods übertragen', 'Mods in ein anderes Profil kopieren', () => openModTransfer(p.id)),
    t('⌨️', 'Einstellungen übertragen', 'Tasten, Grafik, Sound in andere Profile', () => openOptsTransfer(p.id)),
    t('🧭', 'Mods entdecken', 'Modrinth – passend zu dieser Instanz', () => { V3.disc.target = p.id; showView('discover'); }),
    t('🚀', 'Autopilot', 'RAM, Java und Performance-Mods', () => openAutopilot(p.id)),
    t('⏪', 'Zeitmaschine', 'Früheren Stand wiederherstellen', () => openTimeMachine(p.id)),
    ov.hud?.available ? t('🧩', ov.hud.state === 'on' ? 'LellekHUD entfernen' : 'LellekHUD hinzufügen', ov.hud.state === 'on' ? `Version ${ov.hud.version || '?'} ist drin – mit einem Klick raus` : 'Optional: FPS, CPS, Keystrokes & Co. – nur wenn du willst', () => toggleHud(p, ov.hud.state !== 'on')) : null,
  ));
  // Letzte Sitzungen
  right.append(h('h3', 'Letzte Sitzungen'));
  const sl = h('div.sess-list');
  if (!ov.recent.length) sl.append(h('p.muted', 'Noch nicht gespielt.'));
  for (const s of ov.recent) { const r = s.recap || {}; sl.append(h('div.sess-row', { onclick: () => showRecap(s), title: 'Rückblick' }, h('span', s.code === 0 ? '🏁' : '💥'), h('div.grow', h('b', fmtDate(s.start)), h('div.muted', [...(s.servers || []), ...(s.worlds || [])].join(', ') || 'Launcher')), h('span.muted', fmtH(s.end - s.start)), r.advancements?.length ? h('span.pill.acc', `🏆 ${r.advancements.length}`) : null)); }
  right.append(sl);
  if (ov.servers.length) { right.append(h('h3', 'Zuletzt besucht')); for (const sv of ov.servers) right.append(h('div.mini-row.cont-row', { onclick: () => launchProfile(p.id, sv) }, h('span.cont-ic', '🖧'), h('span.grow', sv), h('span.cont-go', '▶'))); }
  body.append(h('div.inst-grid', left, right));
}

// ---------- Mods ----------
async function instMods(p, body) {
  if (!p.loader) { body.append(h('div.empty-state', h('span.big', '🧩'), h('b', 'Vanilla-Instanz'), h('span', 'Für Mods braucht die Instanz Fabric, Forge oder NeoForge. Tipp: Vorlage anlegen oder „Version upgraden“.'))); return; }
  const q = h('input.input', { placeholder: 'Mods durchsuchen …' });
  const list = h('div.inst-mods');
  const upd = h('button.ghost', 'Updates prüfen');
  body.append(h('div.inst-bar', q, h('span.grow'), upd, h('button.ghost', { onclick: () => openBundle(p) }, '🎒 Ausstattung'), h('button.primary', { onclick: () => { V3.disc.target = p.id; showView('discover'); } }, '+ Mods hinzufügen')), list);
  const draw = async () => {
    const files = await api.content.list({ profileId: p.id, kind: 'mods' });
    let meta = {}; try { meta = await api.contentMeta({ profileId: p.id, kind: 'mods' }); } catch {}
    list.innerHTML = '';
    if (!files.length) list.append(h('p.muted', 'Noch keine Mods. „+ Mods hinzufügen“ öffnet den Mod-Browser für diese Instanz.'));
    for (const f of files) {
      const m = meta[f.file] || {}; const ic = h('span.mod-ic', '🧩'); if (m.icon) { ic.textContent = ''; ic.append(h('img', { src: m.icon, alt: '', loading: 'lazy' })); }
      const tg = h('input.sw', { type: 'checkbox', checked: f.enabled, title: f.enabled ? 'Aktiv' : 'Aus', onchange: async () => { await api.content.toggle({ profileId: p.id, kind: 'mods', file: f.file }); draw(); } });
      const rm = h('button.ghost.danger', { onclick: async () => { if (confirm(`${m.title || f.name} löschen? (Die Zeitmaschine sichert vorher)`)) { await api.content.remove({ profileId: p.id, kind: 'mods', file: f.file }); draw(); } } }, 'Löschen');
      const row = h('div.imod' + (f.enabled ? '' : '.off'), { dataset: { file: f.file } }, ic, h('div', h('b', m.title || f.name), h('span.sub', [m.version, f.name, fmtSize(f.size)].filter(Boolean).join(' · '))), h('span.upd-slot'), h('div.acts', tg, rm));
      if (m.desc) row.title = m.desc; list.append(row);
    }
    filter();
  };
  const filter = () => { const s = q.value.trim().toLowerCase(); for (const r of list.querySelectorAll('.imod')) r.classList.toggle('hidden', !!s && !r.textContent.toLowerCase().includes(s)); };
  q.oninput = filter;
  upd.onclick = async () => {
    upd.disabled = true; upd.textContent = 'Prüft …';
    try {
      const res = await api.content.checkUpdates({ profileId: p.id, kind: 'mods', force: true }); let n = 0;
      for (const r of res) { const row = list.querySelector(`.imod[data-file="${CSS.escape(r.file)}"]`); if (!row || r.status !== 'update') continue; n++; const slot = row.querySelector('.upd-slot'); slot.innerHTML = ''; slot.append(h('button.primary.small', { onclick: async (e) => { e.target.disabled = true; try { await api.content.update({ profileId: p.id, kind: 'mods', file: r.file, url: r.url, newFile: r.newFile, projectId: r.projectId }); draw(); } catch (err) { toast(err.message, true); } } }, `→ ${r.newVersion}`)); }
      toast(n ? `${n} Updates gefunden` : 'Alles aktuell');
    } catch (e) { toast(e.message, true); }
    upd.disabled = false; upd.textContent = 'Updates prüfen';
  };
  await draw();
}

// ---------- Resourcepacks ----------
async function instPacks(p, body) {
  let d = await api.tools.rpList(p.id); let active = d.active.slice(), avail = d.available.slice();
  const save = h('button.primary', 'Übernehmen'); save.disabled = true;
  body.append(h('div.inst-bar', h('span.muted', 'Oben in „Aktiv“ = höchste Priorität. Gilt ab dem nächsten Start.' + (d.running ? ' (Minecraft läuft gerade – erst beenden)' : '')), h('span.grow'), h('button.ghost', { onclick: () => api.content.openFolder({ profileId: p.id, kind: 'resourcepacks' }) }, 'Ordner'), h('button.ghost', { onclick: () => { V3.disc.target = p.id; V3.disc.kind = 'resourcepacks'; showView('discover'); } }, '+ Packs entdecken'), save));
  const colA = h('div'), colB = h('div'); body.append(h('div.rp-cols', colA, colB));
  const item = (x, i, isActive) => {
    const ic = x.icon ? h('img', { src: x.icon, alt: '' }) : h('div.noi');
    const acts = h('div.acts');
    if (isActive) { acts.append(h('button.ghost', { title: 'Höher', disabled: i === 0, onclick: () => { [active[i - 1], active[i]] = [active[i], active[i - 1]]; dirty(); } }, '↑'), h('button.ghost', { title: 'Tiefer', disabled: i === active.length - 1, onclick: () => { [active[i + 1], active[i]] = [active[i], active[i + 1]]; dirty(); } }, '↓'), h('button.ghost', { onclick: () => { avail.push(active.splice(i, 1)[0]); dirty(); } }, 'Aus')); }
    else acts.append(h('button.ghost', { onclick: () => { active.unshift(avail.splice(i, 1)[0]); dirty(); } }, 'Aktivieren'));
    return h('div.rp-item', ic, h('div', h('b', isActive ? h('span.rp-prio', `#${i + 1} `) : null, x.file.replace(/\.zip$/i, '')), h('span', x.desc || '')), acts);
  };
  const draw = () => { colA.innerHTML = ''; colB.innerHTML = ''; colA.append(h('h3', `Aktiv (${active.length})`)); if (!active.length) colA.append(h('p.muted', 'Keins aktiv – Minecraft nutzt die Standard-Texturen.')); active.forEach((x, i) => colA.append(item(x, i, true))); colB.append(h('h3', `Verfügbar (${avail.length})`)); if (!avail.length) colB.append(h('p.muted', 'Keine weiteren Packs installiert.')); avail.forEach((x, i) => colB.append(item(x, i, false))); };
  const dirty = () => { save.disabled = false; draw(); };
  save.onclick = async () => { try { await api.tools.rpSave({ id: p.id, active: active.map(x => x.file) }); save.disabled = true; toast('Resourcepacks gespeichert'); } catch (e) { toast(e.message, true); } };
  draw();
}

// ---------- Welten ----------
async function instWorlds(p, body) {
  const list = await api.worlds.list(p.id);
  const direct = Number(String(p.version).split('.')[1]) >= 20 || /^2\d\./.test(p.version);
  body.append(h('div.inst-bar', h('span.muted', `${list.length} Welten · Backups entstehen automatisch vor jedem Start`), h('span.grow'), h('button.ghost', { onclick: async () => { try { await api.backups.now(p.id); toast('Backup erstellt'); } catch (e) { toast(e.message, true); } } }, 'Jetzt sichern'), h('button.ghost', { onclick: () => api.worlds.openFolder(p.id) }, 'Ordner')));
  const g = h('div.wgrid'); body.append(g);
  if (!list.length) g.append(h('p.muted', 'Noch keine Welten.'));
  for (const w of list.sort((a, b) => b.modified - a.modified)) {
    const ic = w.icon ? h('img', { src: w.icon, alt: '' }) : h('div.noicon', '🌍');
    g.append(h('div.wcard', ic, h('div', h('b', w.name), h('div.meta', `${fmtSize(w.size)} · zuletzt ${ago(w.modified)}`), h('div.actions',
      h('button.primary', { title: direct ? 'Welt direkt laden' : 'Profil starten (Welt im Menü öffnen)', onclick: () => launchProfile(p.id, direct ? 'world:' + w.name : undefined) }, '▶ Spielen'),
      h('button.ghost', { onclick: async () => { try { const r = await api.worlds.export({ profileId: p.id, name: w.name }); if (r) toast('Welt exportiert'); } catch (e) { toast(e.message, true); } } }, 'Export'),
      h('button.ghost.danger', { onclick: async () => { if (confirm(`Welt „${w.name}“ löschen? Ein Backup liegt unter Welten → Backups.`)) { await api.worlds.delete({ profileId: p.id, name: w.name }); renderInstance(); } } }, 'Löschen')))));
  }
}

// ---------- Screenshots ----------
async function instShots(p, body) {
  const all = (await api.extras.gallery()).filter(s => s.profileId === p.id);
  body.append(h('div.inst-bar', h('span.muted', `${all.length} Screenshots`), h('span.grow'), h('button.ghost', { onclick: () => api.shots.openFolder(p.id) }, 'Ordner')));
  const g = h('div.gal-grid'); body.append(g);
  if (!all.length) g.append(h('p.muted', 'Noch keine Screenshots – im Spiel mit F2.'));
  all.forEach((s, i) => g.append(h('div.gal-item', { onclick: () => openShot(all, i) }, h('img', { src: s.url, loading: 'lazy', alt: '' }), h('span', ago(s.time)))));
}
function openShot(list, i) {
  lightbox(list.map(s => ({ ...s, caption: `${s.profileName} · ${new Date(s.time).toLocaleString('de-DE')}` })), i, () => [
    ['Kopieren', (s) => api.shotCopy({ profileId: s.profileId, file: s.file }).then(() => toast('In die Zwischenablage kopiert'))],
    ['Discord', (s) => api.shotDiscord({ profileId: s.profileId, file: s.file }).then(() => toast('An Discord geschickt')).catch(e => toast(e.message, true))],
    ['Als Banner', (s) => api.instance.setBanner({ id: s.profileId, screenshot: s.file }).then(() => { toast('Banner gesetzt'); if (state.view === 'instance') renderInstance(); })],
    ['Im Ordner', (s) => api.extras.reveal({ profileId: s.profileId, file: s.file })],
    ['Löschen', (s, close) => { if (confirm('Screenshot löschen?')) api.shots.delete({ profileId: s.profileId, file: s.file }).then(() => { close(); if (state.view === 'gallery') renderGallery(); else renderInstance(); }); }],
  ]);
}
async function pickBanner(p) {
  const all = (await api.extras.gallery()).filter(s => s.profileId === p.id).slice(0, 24);
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(h('h2', 'Banner wählen'), h('p.muted', 'Ein Screenshot aus dieser Instanz oder ein eigenes Bild – erscheint oben auf der Instanz-Seite und auf der Startseite.'));
  const g = h('div.gal-grid'); for (const s of all) g.append(h('div.gal-item', { onclick: async () => { await api.instance.setBanner({ id: p.id, screenshot: s.file }); close(); renderInstance(); toast('Banner gesetzt'); } }, h('img', { src: s.url, alt: '' })));
  if (!all.length) g.append(h('p.muted', 'Noch keine Screenshots in dieser Instanz.'));
  body.append(g);
  foot.append(h('button.ghost.danger', { onclick: async () => { await api.instance.clearBanner(p.id); close(); renderInstance(); } }, 'Banner entfernen'), h('button.ghost', { onclick: async () => { try { if (await api.instance.setBanner({ id: p.id, pick: true })) { close(); renderInstance(); } } catch (e) { toast(e.message, true); } } }, 'Eigenes Bild …'), h('button.primary', { onclick: close }, 'Fertig'));
}

// ---------- Einstellungen ----------
async function instSettings(p, body) {
  const s = await api.settings.get(); const maxMem = Math.max(4, Math.floor((s.totalMemoryGb || 8) * 0.75));
  const f = { name: h('input.input', { value: p.name, maxLength: 40 }), icon: h('input.input', { value: p.icon || '', maxLength: 2, style: { width: '70px', textAlign: 'center' } }), color: h('input', { type: 'color', value: p.color || '#FFB400' }),
    mem: h('input', { type: 'range', min: 1, max: maxMem, step: 1, value: p.memory || 4 }), java: h('input.input', { value: p.javaPath || '', placeholder: 'leer = automatisch passendes Java' }), jvm: h('input.input', { value: p.jvmArgs || '', placeholder: 'z. B. -XX:+UseG1GC' }),
    w: h('input.input', { type: 'number', value: p.width || '', placeholder: '854', style: { width: '100px' } }), hgt: h('input.input', { type: 'number', value: p.height || '', placeholder: '480', style: { width: '100px' } }), full: h('input.sw', { type: 'checkbox', checked: !!p.fullscreen }),
    server: h('input.input', { value: p.autoServer || '', placeholder: 'leer = Hauptmenü' }) };
  const memV = h('b', `${f.mem.value} GB`); f.mem.oninput = () => memV.textContent = `${f.mem.value} GB`;
  const lab = (t, ...c) => h('label', t, ...c);
  const form = h('div.inst-form',
    h('div.grid2', lab('Name', f.name), h('div.row.gap', lab('Symbol', f.icon), lab('Farbe', f.color))),
    lab('Arbeitsspeicher', h('div.mem-row', f.mem, memV)), h('span.muted.small-note', `Empfohlen: Vanilla 2–4 GB, mit Mods 4–8 GB. Dein PC hat ${s.totalMemoryGb} GB.`),
    h('div.grid2', lab('Java-Pfad', f.java), lab('Java-Argumente', f.jvm)),
    h('div.grid2', lab('Fenstergröße', h('div.row.gap', f.w, '×', f.hgt)), h('label.row.gap', { style: { flexDirection: 'row', alignItems: 'center', marginTop: '20px' } }, f.full, 'Im Vollbild starten')),
    lab('Beim Start direkt verbinden mit', f.server),
    h('div.row.gap', { style: { marginTop: '14px' } }, h('button.primary', { onclick: async () => {
      const patch = { id: p.id, name: f.name.value.trim() || p.name, icon: f.icon.value.trim(), color: f.color.value, memory: Number(f.mem.value), javaPath: f.java.value.trim(), jvmArgs: f.jvm.value.trim(), width: Number(f.w.value) || 0, height: Number(f.hgt.value) || 0, fullscreen: f.full.checked, autoServer: f.server.value.trim() };
      try { state.profiles = await api.profiles.save(patch); toast('Gespeichert'); renderInstance(); renderLaunch(); } catch (e) { toast(e.message, true); }
    } }, 'Speichern'), h('button.ghost', { onclick: () => openProfileDialog(p) }, 'Erweitert (Version, Loader, Konto) …')),
    h('div.danger-zone', h('b', 'Gefahrenzone'), h('p.muted', 'Löscht die Instanz aus der Liste. Der Spielordner bleibt erhalten, bis du ihn selbst entfernst.'), h('button.ghost.danger', { onclick: async () => { if (!confirm(`„${p.name}“ wirklich entfernen?`)) return; state.profiles = await api.profiles.delete(p.id); if (state.current === p.id) state.current = state.profiles[0]?.id || null; renderLaunch(); showView('profiles'); } }, 'Instanz entfernen')));
  body.append(form);
}

// ---------- Protokoll ----------
async function instLog(p, body) {
  const d = await api.instance.log(p.id);
  const q = h('input.input', { placeholder: 'Im Protokoll suchen …' });
  const onlyErr = h('input.sw', { type: 'checkbox' });
  const view = h('pre.log-view');
  body.append(h('div.inst-bar', q, h('label.row.gap', onlyErr, 'Nur Warnungen & Fehler'), h('span.grow'), h('span.muted', d.file || 'Noch kein Protokoll'), h('button.ghost', { onclick: () => diagnoseProfile(p.id) }, 'Absturz analysieren'), h('button.ghost', { onclick: () => api.logs.openFolder() }, 'Ordner')), view);
  const lines = (d.text || 'Noch kein Spielstart mit dieser Instanz.').split('\n');
  const draw = () => {
    const s = q.value.trim().toLowerCase(); view.innerHTML = ''; let n = 0;
    for (const l of lines) {
      const err = /ERROR|Exception|FATAL|Caused by/i.test(l), warn = /WARN/i.test(l);
      if (onlyErr.checked && !err && !warn) continue; if (s && !l.toLowerCase().includes(s)) continue;
      if (++n > 4000) break;
      const e = h('span' + (err ? '.le' : warn ? '.lw' : ''), l + '\n'); view.append(e);
    }
    view.scrollTop = view.scrollHeight;
  };
  q.oninput = draw; onlyErr.onchange = draw; draw();
}

// ---------- Upgrade-Assistent ----------
async function openUpgrade(id) {
  const p = state.profiles.find(x => x.id === id); if (!p) return;
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(h('h2', `⬆️ „${p.name}“ upgraden`), h('p.muted', 'Legt eine Kopie für die neue Minecraft-Version an – mit Configs, Resourcepacks, Shadern und Einstellungen. Jede Mod wird für die neue Version neu gesucht. Das alte Profil bleibt unverändert.'));
  const sel = h('select.select'); const name = h('input.input'); const worlds = h('input.sw', { type: 'checkbox' });
  const box = h('div'); const go = h('button.primary', 'Upgrade starten'); go.disabled = true;
  body.append(h('div.row.gap', h('span.muted', `${p.version} →`), sel, name), h('label.row.gap', { style: { margin: '10px 0', display: 'flex', flexWrap: 'nowrap', alignItems: 'center' } }, worlds, h('span', { style: { flex: '1' } }, 'Welten mitnehmen (Minecraft wandelt sie beim Öffnen um – nicht rückgängig, das Original bleibt im alten Profil)')), box);
  foot.append(h('button.ghost', { onclick: close }, 'Abbrechen'), go);
  let t; try { t = await api.tools.upgradeTargets(p.id); } catch (e) { box.append(h('p.danger', e.message)); return; }
  if (!t.newer.length) { box.append(h('p.muted', `${p.version} ist schon die neueste Version.`)); return; }
  for (const v of t.newer) sel.add(new Option(v + (v === t.latest ? ' (neueste)' : ''), v));
  const load = async () => {
    name.value = `${p.name.replace(/\s*\d+\.\d+(\.\d+)?$/, '')} ${sel.value}`; go.disabled = true; box.innerHTML = ''; box.append(h('p.muted', 'Suche Mods für ' + sel.value + ' …'));
    let plan; try { plan = await api.tools.upgradePlan({ id: p.id, version: sel.value }); } catch (e) { box.innerHTML = ''; box.append(h('p.danger', e.message)); return; }
    box.innerHTML = '';
    if (plan.loaderMissing) { box.append(h('p.danger', `${loaderName(plan.loader)} gibt es für ${sel.value} noch nicht.`)); return; }
    box.append(h('div.row.gap', h('span.pill.ok', `${plan.ok} passen`), plan.missing ? h('span.pill.bad', `${plan.missing} noch nicht für ${sel.value}`) : null, plan.manual ? h('span.pill.warn', `${plan.manual} nicht auf Modrinth`) : null, plan.loader ? h('span.pill', `${loaderName(plan.loader)} ${plan.loaderVersion}`) : null));
    const l = h('div.perf-list', { style: { maxHeight: '38vh', overflowY: 'auto' } });
    for (const it of plan.items.sort((a, b) => ({ ok: 2, missing: 0, manual: 1 }[a.status] - { ok: 2, missing: 0, manual: 1 }[b.status]))) l.append(h('div.perf-item', h('span', it.status === 'ok' ? '✅' : it.status === 'missing' ? '⛔' : '✋'), h('div', h('b', it.title), h('span', it.status === 'ok' ? `→ ${it.newVersion}` : it.status === 'missing' ? `gibt es noch nicht für ${sel.value}` : 'nicht auf Modrinth – bitte selbst prüfen')), it.disabled ? h('span.pill', 'aus') : h('span')));
    box.append(l); go.disabled = false;
  };
  sel.onchange = load; load();
  go.onclick = async () => { go.disabled = true; go.textContent = 'Wird angelegt …'; try { const r = await api.tools.upgradeRun({ id: p.id, version: sel.value, name: name.value.trim(), copyWorlds: worlds.checked }); state.profiles = r.profiles; close(); toast(`„${r.name}“ ist bereit – ${r.installed} Mods${r.missing.length ? `, ${r.missing.length} fehlen noch` : ''}`); await loadProfiles(); openInstance(r.id); } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Upgrade starten'; } };
}

// ---------- Mods übertragen ----------
async function openModTransfer(id) {
  const p = state.profiles.find(x => x.id === id); if (!p) return;
  const { body, foot, close } = v25Dialog('wide-dlg');
  body.append(h('h2', '📦 Mods übertragen'), h('p.muted', 'Wähle Mods aus und ein Ziel-Profil – jede Mod wird passend zur Version des Ziels neu geladen.'));
  const to = h('select.select'); for (const x of state.profiles.filter(x => x.id !== p.id && x.loader)) to.add(new Option(`${x.name} (${x.version} ${loaderName(x.loader)})`, x.id));
  if (!to.options.length) { body.append(h('p.muted', 'Kein anderes Mod-Profil vorhanden.')); foot.append(h('button.ghost', { onclick: close }, 'Schließen')); return; }
  const list = h('div.perf-list', { style: { maxHeight: '42vh', overflowY: 'auto' } }, h('p.muted', 'Lese Mods …'));
  const go = h('button.primary', 'Übertragen');
  body.append(h('div.row.gap', h('span.muted', 'Ziel'), to), list); foot.append(h('button.ghost', { onclick: close }, 'Abbrechen'), go);
  const mods = await api.tools.modsIdentify(p.id); list.innerHTML = '';
  for (const m of mods) list.append(h('label.perf-item', h('input.sw', { type: 'checkbox', checked: true, dataset: { file: m.file } }), h('div', h('b', m.title), h('span', m.projectId ? 'Modrinth' : 'eigene Datei – nur bei gleicher Version')), h('span')));
  go.onclick = async () => { const files = [...list.querySelectorAll('input:checked')].map(c => c.dataset.file); if (!files.length) return; go.disabled = true; go.textContent = 'Überträgt …'; try { const r = await api.tools.modsTransfer({ from: p.id, to: to.value, files }); close(); toast(`${r.ok.length + r.copied.length} Mods übertragen${r.missing.length ? ` – nicht verfügbar: ${r.missing.join(', ')}` : ''}`, !!r.missing.length); } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Übertragen'; } };
}

// ---------- Einstellungen übertragen ----------
function openOptsTransfer(id) {
  const p = state.profiles.find(x => x.id === id); if (!p) return;
  const { body, foot, close } = v25Dialog();
  body.append(h('h2', '⌨️ Einstellungen übertragen'), h('p.muted', `Überträgt Spiel-Einstellungen aus „${p.name}“ in andere Profile. Vorher sichert die Zeitmaschine.`));
  const parts = [['keys', 'Tastenbelegung'], ['video', 'Grafik & Ansicht'], ['sound', 'Sound'], ['other', 'Maus, Chat & Sprache']].map(([k, t]) => h('label.perf-item', h('input.sw', { type: 'checkbox', checked: k !== 'other', dataset: { k } }), h('div', h('b', t)), h('span')));
  const targets = state.profiles.filter(x => x.id !== p.id).map(x => h('label.perf-item', h('input.sw', { type: 'checkbox', dataset: { id: x.id } }), h('div', h('b', x.name), h('span', `${x.version} ${loaderName(x.loader)}`)), h('span')));
  body.append(h('h3', 'Was'), h('div.perf-list', parts), h('h3', 'Wohin'), h('div.perf-list', { style: { maxHeight: '30vh', overflowY: 'auto' } }, targets));
  const go = h('button.primary', { onclick: async () => {
    const ps = parts.map(x => x.querySelector('input')).filter(c => c.checked).map(c => c.dataset.k), ts = targets.map(x => x.querySelector('input')).filter(c => c.checked).map(c => c.dataset.id);
    if (!ps.length || !ts.length) { toast('Bitte auswählen, was und wohin', true); return; }
    try { const r = await api.tools.optsTransfer({ from: p.id, to: ts, parts: ps }); close(); const skip = r.filter(x => x.skippedKeys).map(x => x.name); toast(`Übertragen in ${r.filter(x => x.ok).length} Profil(e)${skip.length ? ` – Tasten bei ${skip.join(', ')} übersprungen (anderes Format)` : ''}`); } catch (e) { toast(e.message, true); }
  } }, 'Übertragen');
  foot.append(h('button.ghost', { onclick: close }, 'Abbrechen'), go);
}

async function toggleHud(p, on) {
  if (!on && !confirm(`LellekHUD aus „${p.name}“ entfernen? Es wird beim Start nicht wieder hinzugefügt.`)) return;
  try { const r = await api.hud.set({ id: p.id, on }); toast(on ? `LellekHUD ${r.version || ''} hinzugefügt` : 'LellekHUD entfernt – kommt nicht wieder'); renderInstance(); } catch (e) { toast(e.message, true); }
}
