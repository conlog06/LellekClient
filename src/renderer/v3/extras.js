// LellekClient 3.0 – Galerie, Lellek Wrapped, Skin per Spielername, neue Optionen, „Was ist neu in 3.0“

// ---------- Galerie ----------
let galAll = [];
async function renderGallery() {
  const grid = $('#galGrid'), sel = $('#galFilter'); grid.innerHTML = '';
  try { galAll = await api.extras.gallery(); } catch (e) { grid.append(h('p.danger', e.message)); return; }
  const keep = sel.value; sel.innerHTML = ''; sel.add(new Option(`Alle Instanzen (${galAll.length})`, ''));
  const by = {}; for (const s of galAll) by[s.profileId] = (by[s.profileId] || 0) + 1;
  for (const p of state.profiles) if (by[p.id]) sel.add(new Option(`${p.name} (${by[p.id]})`, p.id));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
  sel.onchange = () => galDraw();
  galDraw();
}
function galDraw() {
  const grid = $('#galGrid'), f = $('#galFilter').value; grid.innerHTML = '';
  const list = galAll.filter(s => !f || s.profileId === f);
  if (!list.length) { grid.append(h('div.empty-state', { style: { gridColumn: '1 / -1' } }, h('span.big', '📸'), h('b', 'Noch keine Screenshots'), h('span', 'Im Spiel F2 drücken – alle Bilder aus allen Instanzen landen automatisch hier.'))); return; }
  const dayName = (t) => { const d = new Date(t), today = new Date(); const diff = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5); return diff === 0 ? 'Heute' : diff === 1 ? 'Gestern' : d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }); };
  let last = '';
  list.forEach((s, i) => {
    const day = dayName(s.time); if (day !== last) { grid.append(h('div.gal-day', day)); last = day; }
    grid.append(h('div.gal-item', { onclick: () => openShot(list, i), title: s.file }, h('img', { src: s.url, loading: 'lazy', alt: '' }), h('span', f ? new Date(s.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : s.profileName)));
  });
}

// ---------- Lellek Wrapped ----------
async function openWrapped(year) {
  year = year || new Date().getFullYear();
  const { body, foot, close } = v25Dialog('wrapped-dlg');
  let w; try { w = await api.extras.wrapped(year); } catch (e) { body.append(h('p.danger', e.message)); foot.append(h('button.ghost', { onclick: close }, 'Schließen')); return; }
  const ys = h('select.select', { onchange: () => openWrapped(Number(ys.value)) }); for (let y = new Date().getFullYear(); y >= 2024; y--) ys.add(new Option(String(y), y)); ys.value = year;
  body.append(h('div.row.gap', h('h2', { style: { margin: 0 } }, `🎁 Lellek Wrapped ${w.year}`), h('span.grow'), ys));
  if (!w.sessions) { body.append(h('div.empty-state', { style: { marginTop: '14px' } }, h('span.big', '🌱'), h('b', `${w.year} noch nicht gespielt`), h('span', 'Jede Runde über LellekClient zählt – am Jahresende wartet hier dein Rückblick.'))); foot.append(h('button.primary', { onclick: close }, 'Schließen')); return; }
  const hours = Math.round(w.totalMs / 36e5);
  const card = (cls, label, big, small) => h('div.wrap-card' + cls, h('span', label), h('b.wrap-big', big), small ? h('small', small) : null);
  body.append(h('div.wrap-cards',
    card('.big', 'Gesamt gespielt', `${hours} Stunden`, `in ${w.sessions} Sitzungen an ${w.days} Tagen`),
    card('', 'Level', String(w.level?.level ?? '–'), w.level ? `${w.level.unlocked}/${w.level.total} Erfolge` : ''),
    card('', 'Lieblings-Instanz', w.topProfile?.name || '–', w.topProfile ? fmtH(w.topProfile.ms) : ''),
    card('', 'Lieblings-Version', w.topVersion || '–', `${w.versions} Versionen gespielt`),
    card('', 'Längste Sitzung', w.longest ? fmtH(w.longest.ms) : '–', w.longest ? `${w.longest.name} · ${new Date(w.longest.at).toLocaleDateString('de-DE')}` : ''),
    card('.big', 'Top-Server', w.topServers[0]?.name || 'Einzelspieler', w.topServers.slice(1).map(s => s.name).join(' · ') || ''),
    card('', 'Fortschritte', String(w.advancements), `${w.kills} Kills · ${w.deaths} Tode`),
    card('', 'Lieblingstag', w.weekday || '–', w.month ? `stärkster Monat: ${w.month}` : ''),
    card('', 'Nachtschichten', String(w.nights), 'Starts zwischen 23 und 5 Uhr'),
    card('', 'Screenshots', String(w.screenshots), w.crashes ? `${w.crashes} Abstürze überlebt` : 'keine Abstürze 🎉'),
  ));
  if (w.achievements.length) body.append(h('div.row.gap', { style: { flexWrap: 'wrap' } }, h('span.muted', `Erfolge ${w.year}:`), ...w.achievements.map(a => h('span.pill.acc', `${a.icon} ${a.title}`))));
  const img = async () => wrappedImage(w);
  foot.append(h('button.ghost', { onclick: async () => { const c = await img(); c.toBlob(b => navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(() => toast('Bild kopiert – einfach in Discord einfügen'), () => toast('Kopieren ging nicht', true))); } }, 'Als Bild kopieren'),
    h('button.ghost', { onclick: async () => { const c = await img(); const a = h('a', { href: c.toDataURL('image/png'), download: `Lellek-Wrapped-${w.year}.png` }); a.click(); } }, 'Bild speichern'), h('span.grow'), h('button.primary', { onclick: close }, 'Schließen'));
}
async function wrappedImage(w) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d');
  const css = getComputedStyle(document.documentElement); const acc = (css.getPropertyValue('--accent') || '#FFB400').trim();
  try { await document.fonts.ready; } catch {}
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, '#17110A'); g.addColorStop(1, '#2B1C08'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  const rg = x.createRadialGradient(200, 120, 10, 200, 120, 700); rg.addColorStop(0, acc + '66'); rg.addColorStop(1, 'transparent'); x.fillStyle = rg; x.fillRect(0, 0, 1080, 1350);
  const F = (s, wgt = 700, fam = 'Bricolage Grotesque') => `${wgt} ${s}px "${fam}", Inter, sans-serif`;
  x.fillStyle = acc; x.font = F(40, 700, 'Inter'); x.fillText('LELLEK WRAPPED', 80, 130);
  x.fillStyle = '#fff'; x.font = F(150, 800); x.fillText(String(w.year), 74, 280);
  x.font = F(120, 800); x.fillText(`${Math.round(w.totalMs / 36e5)} h`, 80, 470);
  x.fillStyle = '#CDBFA8'; x.font = F(36, 500, 'Inter'); x.fillText(`gespielt · ${w.sessions} Sitzungen · ${w.days} Tage`, 84, 525);
  const rows = [['Lieblings-Instanz', w.topProfile?.name], ['Version', w.topVersion], ['Top-Server', w.topServers[0]?.name || 'Einzelspieler'], ['Längste Sitzung', w.longest ? fmtH(w.longest.ms) : null], ['Fortschritte', String(w.advancements)], ['Lieblingstag', w.weekday]].filter(r => r[1]);
  let y = 610;
  for (const [k, v] of rows) { x.fillStyle = '#9C8E78'; x.font = F(30, 500, 'Inter'); x.fillText(k, 84, y); x.fillStyle = '#fff'; x.font = F(54, 750); x.fillText(String(v).slice(0, 26), 84, y + 56); y += 104; }
  x.fillStyle = acc; x.font = F(30, 600, 'Inter'); x.fillText(`Level ${w.level?.level ?? ''}  ·  LellekClient`, 84, 1290);
  return c;
}

// ---------- Skin von einem Spieler übernehmen ----------
safe('skin-from-player', () => {
  const bar = $('#skinAdd')?.parentElement; if (!bar) return;
  const b = h('button.ghost', { onclick: () => {
    const { body, foot, close } = v25Dialog();
    const inp = h('input.input', { placeholder: 'Spielername, z. B. Dream', maxLength: 16, onkeydown: (e) => e.key === 'Enter' && go.click() });
    body.append(h('h2', 'Skin von Spieler übernehmen'), h('p.muted', 'Lädt den aktuellen Skin eines Java-Spielers in deine Bibliothek. Anwenden musst du ihn danach selbst.'), inp);
    const go = h('button.primary', { onclick: async () => { const n = inp.value.trim(); if (!n) return; go.disabled = true; go.textContent = 'Sucht …'; try { const r = await api.extras.skinFromPlayer(n); close(); toast(`Skin von ${r.name} gespeichert${r.slim ? ' (Slim)' : ''}`); renderSkins(); } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = 'Übernehmen'; } } }, 'Übernehmen');
    foot.append(h('button.ghost', { onclick: close }, 'Abbrechen'), go); setTimeout(() => inp.focus(), 50);
  } }, 'Von Spieler …');
  bar.prepend(b);
});

// ---------- Statistik: Wrapped-Knopf ----------
safe('stats-wrapped', () => { const bar = $('#statsReset')?.parentElement; if (bar) bar.prepend(h('button.primary', { onclick: () => openWrapped() }, '🎁 Lellek Wrapped')); });

// ---------- Neue Optionen ----------
safe('opts-v3', () => {
  const row = (title, sub, ctrl) => h('div.opt-row', h('div', h('b', title), h('span', sub)), ctrl);
  const game = $('.opt-sec[data-cat="game"]'), data = $('.opt-sec[data-cat="data"]'), general = $('.opt-sec[data-cat="general"]');
  const pause = h('select.select#optPause', { onchange: () => api.settings.save({ pauseReminder: Number(pause.value) }).then(flashSaved) });
  for (const [v, t] of [[0, 'Aus'], [45, 'nach 45 min'], [60, 'nach 1 Stunde'], [90, 'nach 1,5 Stunden'], [120, 'nach 2 Stunden']]) pause.add(new Option(t, v));
  const sync = h('input.sw#optServersSync', { type: 'checkbox', onchange: () => api.settings.save({ serversSync: sync.checked }).then(flashSaved) });
  const fill = h('button.ghost', { onclick: async () => { try { const r = await api.tools.serversSync(); toast(r.added ? `${r.added} Server in ${r.profiles} Instanz(en) eingetragen` : 'Alle Serverlisten sind schon aktuell'); } catch (e) { toast(e.message, true); } } }, 'Jetzt eintragen');
  const hudAuto = h('input.sw#optHudAuto', { type: 'checkbox', onchange: () => api.settings.save({ hudAuto: hudAuto.checked }).then(flashSaved) });
  if (game) { const kr = $('#optKitAuto')?.closest('.opt-row'); const row = h('label.opt-row', h('div', h('b', 'LellekHUD bei neuen Vorlagen hinzufügen'), h('span', 'Standard: aus. Pro Instanz jederzeit auf der Instanz-Seite hinzufügen oder entfernen – entfernt bleibt entfernt')), hudAuto); if (kr) kr.after(row); else game.append(row); }
  if (game) {
    const h3 = h('h3', 'Gesund spielen & Serverliste');
    game.append(h3, row('Pausen-Erinnerung', 'Eine kurze Windows-Meldung, wenn du lange am Stück spielst', pause),
      h('label.opt-row', h('div', h('b', 'Server-Radar-Favoriten in die Serverliste'), h('span', 'Deine Favoriten erscheinen in jeder Instanz im Mehrspieler-Menü – vor jedem Start')), sync),
      row('Serverlisten jetzt füllen', 'Trägt alle Favoriten sofort in alle Instanzen ein (laufende werden übersprungen)', fill));
  }
  const mirrorInfo = h('span#mirrorInfo', 'Aus – Backups liegen nur lokal');
  const mirrorBtns = h('div.row.gap', h('button.ghost', { onclick: async () => { const r = await api.extras.pickMirror(); drawMirror(r); if (r) toast('Backup-Spiegel aktiv'); } }, 'Ordner wählen …'), h('button.ghost#mirrorOff', { onclick: async () => { drawMirror(await api.extras.clearMirror()); } }, 'Aus'));
  const drawMirror = (dir) => { mirrorInfo.textContent = dir ? `Kopien landen in ${dir}\\LellekClient-Backups (je Instanz die letzten 5)` : 'Aus – Backups liegen nur lokal. Wähle z. B. deinen OneDrive- oder Google-Drive-Ordner.'; $('#mirrorOff')?.classList.toggle('hidden', !dir); };
  if (data) { const anchor = [...data.querySelectorAll('h3')].find(x => /Komplett/.test(x.textContent)); const els = [h('h3', 'Backup-Spiegel (Cloud)'), h('div.opt-row', h('div', h('b', 'Welt-Backups zusätzlich in einen Cloud-Ordner kopieren'), mirrorInfo), mirrorBtns)]; if (anchor) anchor.before(...els); else data.append(...els); }
  if (general) general.append(h('h3', 'Einrichtung'), row('Einrichtung erneut starten', 'Der Willkommens-Assistent: Konto, Design und erste Instanz', h('button.ghost', { onclick: () => openOnboarding(true) }, 'Starten')));
  const _ls = loadSettings;
  loadSettings = async function (...a) { const r = await _ls.apply(this, a); try { const s = await api.settings.get(); pause.value = String(s.pauseReminder || 0); if (!pause.value) pause.value = '0'; sync.checked = s.serversSync !== false; hudAuto.checked = s.hudAuto === true; drawMirror(s.backupMirror); } catch {} return r; };
});

// ---------- Was ist neu in 3.0 (einmal für bestehende Nutzer) ----------
async function whatsNew30() {
  const s = await api.settings.get(); if (!/^3\./.test(s.clientVersion || '') || LS.get('seen30', false)) return;
  if (!state.profiles.length) return; // neue Nutzer bekommen die Einrichtung
  LS.set('seen30', true);
  const { body, foot, close } = v25Dialog('whatsnew');
  body.append(h('h2', `LellekClient ${s.clientVersion}`), h('p.muted', 'Das größte Update bisher – neu gebaut, schneller und übersichtlicher:'));
  const g = h('div.wn-grid');
  for (const [i, t, d] of [['🧭', 'Entdecken', 'Neuer Mod-Browser: Modrinth mit Bildern, Kategorien, Versionen und Abhängigkeiten – passend zur gewählten Instanz.'], ['🗂️', 'Instanz-Seiten', 'Jedes Profil hat jetzt eine eigene Seite: Mods, Resourcepacks, Welten, Screenshots, Einstellungen und Protokoll.'], ['⬆️', 'Version upgraden', 'Instanz auf eine neue Minecraft-Version heben – alle Mods werden automatisch neu gesucht.'], ['⌨️', 'Übertragen', 'Tastenbelegung, Grafik und Mods mit einem Klick in andere Instanzen kopieren.'], ['🖼️', 'Galerie & Banner', 'Alle Screenshots an einem Ort – und dein Lieblingsbild als Banner der Instanz.'], ['🎁', 'Lellek Wrapped', 'Dein Jahresrückblick als teilbares Bild.']]) g.append(h('div.wn', h('b', `${i} ${t}`), h('span', d)));
  body.append(g);
  foot.append(h('button.ghost', { onclick: () => { close(); showView('discover'); } }, 'Mods entdecken'), h('button.primary', { onclick: () => { close(); if (state.current) openInstance(state.current); } }, 'Instanz-Seite ansehen'));
}
setTimeout(() => whatsNew30().catch(() => {}), 2600);
