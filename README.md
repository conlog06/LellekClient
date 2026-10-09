# LellekClient 2.1.1 – Quellcode

Minecraft-Launcher (Electron) für alle Versionen mit Profilen, Mod-Manager, Skins, Server-Hosting und LellekHUD.

## Download

Immer die neueste Version: **https://github.com/conlog06/LellekClient/releases/latest**

- Windows: `LellekClient-Setup-Windows.exe`
- Mac (Apple Silicon, M1–M4): `LellekClient-Mac-AppleSilicon.zip`
- Mac (Intel): `LellekClient-Mac-Intel.zip`

## macOS

- **Fertige App**: `LellekClient-Mac-AppleSilicon.zip` (Apple Silicon, M1–M4) bzw. `LellekClient-Mac-Intel.zip` (Intel-Mac). Entpacken, `LellekClient.app` in „Programme“ ziehen.
- **Erster Start**: Die App ist nicht von Apple notarisiert. Rechtsklick auf die App → „Öffnen“ → „Öffnen“. Falls macOS „beschädigt“ meldet, einmal im Terminal: `xattr -cr /Applications/LellekClient.app`
- **Apple Silicon & alte Versionen**: 1.8.9–1.18 starten automatisch mit Intel-Java über Rosetta 2 (macOS fragt beim ersten Mal, ob Rosetta installiert werden soll). Ab 1.19 läuft alles nativ.
- **Selbst bauen auf einem Mac** (inkl. .dmg): `npm install` und `npm run dist:mac`.
- Nur unter Windows: Desktop-Verknüpfungen pro Profil, automatische Update-Installation (auf dem Mac öffnet sich der Download), playit-Agent aus dem Launcher.

## Starten & bauen (Windows)

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer.

```bat
npm install
npm start            :: Launcher im Entwicklungsmodus starten
npm run dist         :: Installer bauen → dist\LellekClient-Setup-2.1.1.exe
npm run dist:portable :: eine einzelne portable .exe → dist\
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/main.js` | Hauptprozess: Versionen, Java, Profile, Mods, Login, Spielstart, Server … (ab „LellekClient 1.8“ unten die neuen Funktionen) |
| `src/preload.js` | Brücke zwischen Oberfläche und Hauptprozess (`window.lellek`) |
| `src/renderer/index.html`, `app.js`, `style.css` | Oberfläche |
| `src/renderer/features.js`, `features.css` | Neue Oberfläche aus 1.8 (Statistik, Befehlspalette, Diagnose, Mod-Sets …) |
| `src/renderer/features2.js`, `features2.css` | Oberfläche aus 2.0 (Streamer-Modus, Design, Freunde, Server-Plugins, PC-Check, Galerie) |
| `server/presence-server.js` | Kleiner Server für die Freundesliste (läuft getrennt, nicht im Launcher) |
| `assets/mods/` | Mitgelieferte LellekHUD-Jars |

## Neu in 2.1.1

- 2.2: Freundschaftsanfragen (gegenseitig), Status + Notiz, Einladungen, Favoriten, Spitznamen, Blockieren
- Jedes Minecraft-Konto hat seine eigene Freundesliste (alte Liste wird dem aktuellen Konto zugeordnet)
- Update-Quelle fest eingebaut: GitHub Releases von conlog06/LellekClient

## Neu in 2.1.0

- **macOS-Version** für Apple Silicon und Intel, ⌘-Tastenkürzel, Menüleisten-Symbol, Intel-Java über Rosetta für Minecraft vor 1.19, Java-Fallback, PC-Check mit Apple-Chips

## Neu in 2.0.0

- **Freunde**: Freundesliste per Minecraft-Name, Online-Status (Launcher / spielt Version X auf Server Y), „Beitreten“-Knopf, Benachrichtigung wenn jemand online kommt, „Freunde online“ auf der Startseite
- **Streamer-Modus** (Strg+Umschalt+S oder automatisch bei OBS/Streamlabs/XSplit/Twitch Studio): verbirgt Namen, Server-Adressen, IPs, Seeds und Log-Adressen, Discord-Status ohne Server, keine Benachrichtigungen; schreibt `lellek/streamer.txt` ins Spielverzeichnis (für LellekHUD)
- **Design-Seite**: 8 Farbschemas (inkl. hell), Akzentfarbe, eigenes Hintergrundbild mit Abdunkeln/Unschärfe, Gitter an/aus, UI-Größe 80–130 %, kompakter Modus, Neuigkeiten-Spalte, Animationen reduzieren, Skin-Animation (Stehen/Gehen/Rennen/Fliegen), Drehen, eigener Titel, eigener Text im Minecraft-Hauptmenü, eigenes CSS
- **Server**: Vanilla, Paper oder Fabric; Plugins (Paper) bzw. Server-Mods (Fabric) direkt von Modrinth inkl. Abhängigkeiten; playit.gg-Tunnel für Freunde von außen ohne Portfreigabe; öffentliche Adresse speichern & kopieren
- **Screenshots an Discord** per Webhook, **PC-Check** mit RAM-Empfehlung pro Profil, **Bilder-Galerie** und Details bei Mods/Modpacks/Plugins, **Changelogs** bei Mod-Updates (Modrinth & CurseForge)

## Freundesliste: Presence-Server

Standard ist der LellekClient-Server auf Render: `https://render-friends-lellek-client-v1.onrender.com` (fest in `src/main.js` bei `DEFAULT_PRESENCE`). Spieler müssen nichts einstellen. Eigener Server nur bei Bedarf:

Damit Freunde sich gegenseitig sehen, läuft irgendwo ein kleiner Server (eine Datei, keine Pakete):

```bat
cd server
node presence-server.js
```

Standard-Port 8767 (`set PORT=…` zum Ändern). Für Freunde im Internet auf einem kleinen VPS starten oder Port 8767 (TCP) freigeben. Adresse in LellekClient → Optionen → „Freunde & Online-Status“ eintragen (z. B. `http://dein-server:8767`). Die Anmeldung läuft wie bei Minecraft-Servern über Mojang (hasJoined) – der Server bekommt keine Passwörter.

## Neu in 1.9.0

- **NeoForge**: Profile, Mod-Browser (Modrinth & CurseForge), Ausstattung, Mod-Updates und NeoForge-Modpacks
- **Selbst-Updater**: lädt neue Versionen aus GitHub Releases und installiert sie mit einem Klick (still, danach Neustart)
- **Export als Modrinth-Modpack (.mrpack)**: Mods von Modrinth werden verlinkt, alles andere eingebettet – öffnet sich in Prism, Modrinth-App, CurseForge-App und LellekClient
- **.mrpack-Dateien importieren** (Profile → „Profil / .mrpack importieren“), mit Prüfsummen-Kontrolle
- Fix: Wechsel zwischen Forge-Versionen derselben Minecraft-Version (veraltete Versionsdatei wurde weiterbenutzt)

## Updates an alle verteilen

1. Auf GitHub ein Repository anlegen, z. B. `LellekClient`.
2. Version in `package.json` erhöhen, `npm run dist` ausführen.
3. Auf GitHub → Releases → „Draft a new release“: Tag `v2.0.1` (gleiche Nummer wie in `package.json`), die Datei `dist\LellekClient-Setup-2.1.1.exe` anhängen, veröffentlichen.
4. Die Update-Quelle ist fest eingebaut (`DEFAULT_UPDATE_URL` in `src/main.js`): `https://api.github.com/repos/conlog06/LellekClient/releases/latest`. Asset-Namen beibehalten: `LellekClient-Setup-Windows.exe`, `LellekClient-Mac-AppleSilicon.zip`, `LellekClient-Mac-Intel.zip`.

Der Launcher prüft beim Start, zeigt oben rechts „Update x.y.z“ und installiert auf Klick.

## Neu in 1.8.0

- **Statistik-Seite**: Spielzeit pro Tag (14 Tage), Serie, Abstürze, Profile nach Spielzeit, meistbesuchte Server/Welten, Sitzungsverlauf
- **Befehlspalette (Strg+K)**: Profile starten, auf Favoriten-Server verbinden, Ansichten öffnen, Aktionen ausführen
- **Tastenkürzel**: Strg+Enter = Spielen, Strg+1–8 = Ansicht wechseln
- **Desktop-Verknüpfung pro Profil**: startet das Profil direkt (`LellekClient.exe --launch=<profilId>`); der Launcher läuft dabei nur einmal
- **Absturz-Diagnose**: erkennt RAM-Mangel, falsche Java-Version, fehlende Abhängigkeiten, doppelte Mods, Mixin-Fehler, Grafiktreiber, abgelaufene Anmeldung – mit Ein-Klick-Lösungen
- **Mod-Sets**: Kombinationen aktiver Mods speichern und umschalten (z. B. „PvP“ / „Survival“)
- **Mod-Liste kopieren**: Text mit allen Mods für Discord
- **Server-Einstellungen**: MOTD, Spielmodus, Schwierigkeit, Spielerzahl, PvP, Whitelist … direkt im Launcher
- **Optimierte JVM-Flags** (G1GC) mit einem Klick im Profil-Dialog
- Fix: Namens-Eingaben (Skin speichern, Welt kopieren) – `prompt()` gibt es in Electron nicht, jetzt eigener Dialog
