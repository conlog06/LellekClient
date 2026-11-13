// LellekClient 3.0 – Einrichtung beim ersten Start: Willkommen → Konto → Design → erste Instanz → Fertig
const OB_STEPS = ['Willkommen', 'Konto', 'Design', 'Erste Instanz', 'Fertig'];

async function openOnboarding(force) {
  if (!force && (ui.onboarded || $('#v25Dialog')?.open)) return;
  let step = 0, preset = null, presets = [], created = null;
  const { d, body, foot, close } = v25Dialog('ob-dlg');
  d.onclose = () => { d.onclose = null; setUi({ onboarded: true }); LS.set('seen30', true); LS.set('seen31', true); };
  const draw = async () => {
    body.innerHTML = ''; foot.innerHTML = ''; foot.classList.add('hidden');
    const side = h('div.ob-side', h('img', { src: 'logo.png', alt: '' }));
    OB_STEPS.forEach((t, i) => side.append(h('div.ob-step' + (i === step ? '.on' : i < step ? '.done' : ''), h('i', i < step ? '✓' : String(i + 1)), t)));
    const main = h('div.ob-main'); const content = h('div.ob-body'); const nav = h('div.ob-foot');
    body.append(h('div.ob-wrap', side, main));
    const next = (label = 'Weiter', fn) => h('button.primary', { onclick: async (e) => { if (fn && (await fn(e)) === false) return; step++; draw(); } }, label);
    const back = () => step > 0 ? h('button.ghost', { onclick: () => { step--; draw(); } }, 'Zurück') : h('button.ghost', { onclick: close }, 'Überspringen');
    if (step === 0) {
      main.append(h('h1.ob-title', 'Willkommen bei LellekClient'), h('p.muted', 'In einer Minute ist alles bereit: Konto verbinden, Look wählen, erste Instanz anlegen.'));
      content.append(h('div.wn-grid', ...[['🧭 Entdecken', 'Tausende Mods, Shader und Resourcepacks – passend gefiltert.'], ['🎒 Fertig ausgestattet', 'Vorlagen mit Performance-Mods, Minimap, FreeCam & Zoom.'], ['🥳 Party & Freunde', 'Zusammen starten, gleiche Mods, gleicher Server.'], ['⏪ Sicher', 'Zeitmaschine und Backups – nichts geht verloren.']].map(([t, x]) => h('div.wn', h('b', t), h('span', x)))));
      nav.append(back(), next('Los geht’s'));
    }
    if (step === 1) {
      main.append(h('h1.ob-title', 'Microsoft-Konto'), h('p.muted', 'Zum Spielen brauchst du ein Minecraft: Java Edition-Konto. Die Anmeldung läuft im offiziellen Microsoft-Fenster – dein Passwort sieht LellekClient nie.'));
      let acc = null; try { acc = await api.auth.current(); } catch {}
      if (acc) content.append(h('div.perf-item', h('span', '✅'), h('div', h('b', `Angemeldet als ${acc.name}`), h('span', 'Weitere Konten kannst du jederzeit oben rechts hinzufügen.')), h('span')));
      else content.append(h('button.primary', { style: { padding: '12px 20px', fontSize: '15px' }, onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Microsoft-Fenster ist offen …'; try { state.account = await api.auth.login(); toast('Angemeldet'); try { renderAccount(); renderSkins(); } catch {} } catch (err) { toast('Anmeldung abgebrochen: ' + err.message, true); } draw(); } }, 'Mit Microsoft anmelden'), h('p.muted', { style: { marginTop: '10px' } }, 'Du kannst das auch später machen.'));
      nav.append(back(), next(acc ? 'Weiter' : 'Später'));
    }
    if (step === 2) {
      main.append(h('h1.ob-title', 'Dein Look'), h('p.muted', 'Farbe des Launchers – unter „Design“ gibt es später noch Hintergründe, Schriftgröße und mehr.'));
      const g = h('div.ob-themes');
      for (const [k, t] of Object.entries(THEMES)) {
        const sw = h('div', { style: { display: 'flex', gap: '3px', marginBottom: '6px' } }, ...t.sw.map(c => h('span', { style: { width: '18px', height: '18px', borderRadius: '5px', background: c, border: '1px solid rgba(255,255,255,.12)' } })));
        g.append(h('button.ob-preset' + ((ui.theme || 'gold') === k ? '.on' : ''), { onclick: async () => { await pickTheme(k); draw(); } }, sw, h('b', t.name)));
      }
      content.append(g);
      nav.append(back(), next());
    }
    if (step === 3) {
      main.append(h('h1.ob-title', 'Erste Instanz'), h('p.muted', 'Eine Vorlage – fertig eingerichtet mit Performance-Mods, Minimap, FreeCam und Zoom. Du kannst jederzeit weitere anlegen.'));
      if (state.profiles.length && !created) content.append(h('p.muted', `Du hast schon ${state.profiles.length} Instanz(en) – du kannst diesen Schritt überspringen.`));
      if (!presets.length) { try { presets = await api.presets.list(); } catch {} }
      if (!preset) preset = presets.find(p => p.latest)?.key || presets[0]?.key || null;
      const g = h('div.ob-presets');
      for (const t of presets) g.append(h('button.ob-preset' + (preset === t.key ? '.on' : ''), { onclick: () => { preset = t.key; draw(); } }, h('b', t.name, t.latest ? h('span.pill.ok', { style: { marginLeft: '6px' } }, 'neu') : null), h('span', `${t.version} · ${loaderName(t.loader)} – ${t.hint}`)));
      g.append(h('button.ob-preset' + (preset === null ? '.on' : ''), { onclick: () => { preset = null; draw(); } }, h('b', 'Keine Vorlage'), h('span', 'Ich lege selbst an oder importiere ein Modpack')));
      content.append(g);
      const prog = h('p.muted');
      content.append(prog);
      nav.append(back(), next(preset ? 'Anlegen' : 'Weiter', async (e) => {
        if (!preset) return true;
        e.target.disabled = true; e.target.textContent = 'Wird eingerichtet …'; prog.textContent = 'Lädt Minecraft-Infos und Mods – das kann eine Minute dauern.';
        try { const r = await api.presets.create(preset); created = r; state.current = r.id; await loadProfiles(); return true; }
        catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Anlegen'; prog.textContent = ''; return false; }
      }));
    }
    if (step === 4) {
      main.append(h('h1.ob-title', 'Fertig! 🎉'), h('p.muted', created ? `„${created.name || 'Deine Instanz'}“ ist bereit${created.kit?.ok ? ` – mit ${created.kit.ok} Mods` : ''}.` : 'Alles eingerichtet.'));
      content.append(h('div.wn-grid', ...[['Strg + K', 'Befehlspalette – alles in Sekunden finden'], ['Instanz-Seite', 'Klick auf eine Instanz zeigt Mods, Welten, Screenshots & mehr'], ['Entdecken', 'Neue Mods passend zur Instanz'], ['Party', 'Freunde einladen und zusammen starten']].map(([t, x]) => h('div.wn', h('b', t), h('span', x)))));
      nav.append(h('button.ghost', { onclick: () => { close(); showView('discover'); } }, 'Mods entdecken'), h('button.primary', { onclick: () => { close(); if (created?.id) openInstance(created.id); else showView('play'); } }, created ? 'Instanz öffnen' : 'Zum Launcher'));
    }
    main.append(content, nav);
  };
  draw();
}

// Beim ersten Start automatisch – bestehende Nutzer werden still als eingerichtet markiert
setTimeout(async () => {
  try {
    if (ui.onboarded) return;
    if (!state.profiles.length) { try { await loadProfiles(); } catch {} }
    let accs = []; try { accs = await api.auth.list(); } catch {}
    if (state.profiles.length || accs.length) { setUi({ onboarded: true }); return; }
    openOnboarding();
  } catch {}
}, 1200);
