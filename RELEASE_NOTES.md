## Downloads

- **Windows 10/11:** `LellekClient-Setup-Windows.exe`
- **Mac mit M1–M4 (Apple Silicon):** `LellekClient-Mac-AppleSilicon.dmg` (oder `.zip`)
- **Mac mit Intel:** `LellekClient-Mac-Intel.dmg` (oder `.zip`)

## Neu in 3.2 – Log-Fenster und Benachrichtigungen

**Neues Log-Fenster**
- Ein Fenster für alle Instanzen (Liste rechts mit Laufzeit, Konto, Status)
- Filter: Fehler, Warnung, Info, Debug – mit Zählern; Suche mit Hervorhebung (Strg+F)
- Stacktraces werden eingeklappt, sehr lange Zeilen gekürzt
- Bekannte harmlose Meldungen werden erkannt, erklärt und standardmäßig ausgeblendet (Skin-Signaturen von Servern, veraltete Xaero-Daten, optionale JEI-Klassen, fehlende Texturen u. v. m.)
- Echte Probleme (Mod-Konflikt, fehlende Abhängigkeit, zu wenig RAM, falsches Java, doppelte Mods) bekommen einen Hinweis mit Lösung
- RAM- und CPU-Anzeige, Beenden/Neu starten, Instanz-Ordner, „Mitlaufen“, Kopieren
- Log mit einem Klick auf mclo.gs hochladen (Link wird kopiert, Zugangsdaten werden entfernt)

**Benachrichtigungen einstellbar**
- Optionen → Benachrichtigungen: pro Art „Aus“, „Launcher“ oder „Launcher + Windows“
- „Nicht stören, während Minecraft läuft“ (nur Absturz, Party und Pausen-Erinnerung kommen durch)
- Schnell-Voreinstellung „Nur das Wichtigste“; Rechtsklick auf die Glocke öffnet die Einstellungen

**Behoben**
- Knöpfe in den Optionen haben das Formular nicht mehr versehentlich abgeschickt

## Neu in 3.1 – schneller, sparsamer, stabiler

**Spielstart & Leistung**
- Spieldateien (Assets, Bibliotheken) werden nur noch beim ersten Mal per Prüfsumme geprüft – danach gemerkt. Vorher: bei jedem Start alle ~4000 Dateien
- Welt-Backups nur, wenn sich eine Welt seit dem letzten Backup geändert hat, und ohne den Launcher einzufrieren (zwei Backups in derselben Minute überschreiben sich nicht mehr)
- Spiel-Log gebündelt statt Zeile für Zeile – der Launcher wurde bei langen Sessions vorher immer langsamer
- Versionsdaten von der Platte statt jedes Mal aus dem Netz; Versionsliste auch offline
- Raster-Animation der Startseite läuft über die Grafikkarte (vorher Neuzeichnen jedes Frame), pausiert im Hintergrund
- Skin-Bibliothek: statische Vorschaubilder statt einer 3D-Ansicht pro Skin

**Neu**
- Spielmodus: Launcher schläft, solange Minecraft läuft; Minecraft bekommt höhere Priorität
- Java automatisch optimieren (G1, kurze Pausen) – eigene Java-Argumente haben Vorrang
- Startzeit-Messung pro Instanz (Klick bis Hauptmenü) mit Verlauf und „bereit in …“-Meldung
- Live-RAM-Anzeige, während Minecraft läuft
- Mod-Detektiv: findet die Mod hinter einem Absturz per Halbierung, abhängige Mods werden mit abgeschaltet
- Instanzen vergleichen und fehlende Mods übernehmen
- Merkliste im Mod-Browser
- Notizen pro Instanz
- Screenshot-Meldung und optional automatisch in die Zwischenablage
- Schnellstart der zuletzt gespielten Instanzen aus der Windows-Taskleiste
- Instanz-Seite: Mod-Sets, Konflikt-Check (doppelte Mods mit einem Klick lösen), .mrpack-Export, Desktop-Verknüpfung

**Behoben**
- Grauer Fensterblitz beim Start; Fenstergröße und -position werden gemerkt
- „Was ist neu“-Fenster legt sich nicht mehr über andere Dialoge

## Neu in 3.0.1

- LellekHUD kommt nur noch auf Wunsch: neue Vorlagen ohne HUD, entfernt bleibt entfernt
- Instanz-Seite: „LellekHUD hinzufügen/entfernen“ (Übersicht und ⋯-Menü)
- Optionen → Spiel & Leistung: „LellekHUD bei neuen Vorlagen hinzufügen“ (Standard: aus)

## Neu in 3.0 – das große Update

**Entdecken – neuer Mod-Browser**
- Mods, Modpacks, Resourcepacks, Shader und Datapacks von Modrinth mit Bildern, Kategorien und Sortierung
- Ziel-Instanz wählen: es werden nur passende Projekte gezeigt (Version & Loader), Abhängigkeiten werden geprüft
- Projektseite mit Galerie, Beschreibung, allen Versionen und Links; Modpacks werden als neue Instanz angelegt

**Instanz-Seiten**
- Jede Instanz hat eine eigene Seite mit Banner: Übersicht, Mods, Resourcepacks, Welten, Screenshots, Einstellungen, Protokoll
- Resourcepacks aktivieren und Reihenfolge festlegen, Welten direkt laden, Protokoll mit Suche und Fehler-Filter

**Neue Funktionen**
- Version upgraden: Kopie für eine neue Minecraft-Version, alle Mods werden neu gesucht
- Mods übertragen und Einstellungen (Tasten, Grafik, Sound) in andere Instanzen kopieren
- Grafik-Presets: Leistung, Ausgewogen, Schön – ein Klick
- Galerie: alle Screenshots aus allen Instanzen, nach Tagen sortiert; als Banner setzen, kopieren, an Discord
- Skin per Spielername übernehmen
- Lellek Wrapped: Jahresrückblick als teilbares Bild
- Pausen-Erinnerung, Backup-Spiegel in einen Cloud-Ordner, Server-Radar-Favoriten automatisch in der Serverliste im Spiel

**Design & Technik**
- Frisches Design mit neuer Schrift (Inter & Bricolage Grotesque), Einrichtungs-Assistent beim ersten Start
- Hauptprozess in Module aufgeteilt, automatische Tests laufen vor jedem Release

## Neu in 2.7 – stabiler und aufgeräumter

**Stabilität**
- Einstellungen werden regelmäßig gesichert; ist die Datei beschädigt, stellt der Launcher sie automatisch aus der Sicherung wieder her
- Downloads laden erst in eine Teil-Datei, prüfen die Größe und versuchen es bis zu dreimal – keine halben Mods mehr
- Selbstheilung vor jedem Start: defekte Mod-Dateien werden deaktiviert, halbe Downloads entfernt, fehlender Java-Pfad zurückgesetzt, Warnung bei vollem Laufwerk
- Launcher-Protokoll (logs/launcher.log) mit allen Fehlern; abgestürzte Oberfläche lädt sich selbst neu

**Neu**
- Hilfe & Diagnose (Optionen): prüft Internet, Konto, Java, Speicher und jedes Profil – mit Reparatur auf Knopfdruck und Fehlerbericht zum Kopieren
- Weiterspielen auf der Startseite: letzte Welt (ab 1.20 direkt geladen) oder letzter Server mit einem Klick
- Update-Center: Mod-Updates aller Profile auf einen Blick, einzeln oder alle aktualisieren; tägliche Prüfung im Hintergrund
- Benachrichtigungen (Glocke oben rechts) mit Verlauf

**Aufgeräumt**
- Mods & Packs: echte Namen, Symbole und Versionen, Suche, Filter (Aktiv/Aus/Updates), Werkzeug-Menü statt Knopfreihe
- Server hosten in Reitern: Server & Konsole, Einstellungen, Plugins/Mods, Freunde von außen
- Profile anheften, Vorlagen einklappbar

## Neu in 2.6.2

- **LellekHUD 1.4.2 für 26.3** – in der Vorlage „Lellek 26.3“ und automatisch in allen 26.3-Fabric-Profilen; der Fabric-Loader wird bei Bedarf auf 0.19.5+ angehoben
- Zoomify ist bei Profilen mit LellekHUD nicht mehr vorausgewählt (LellekHUD hat einen eigenen Zoom)


## Neu in 2.6.1

- Ausstattung wieder entfernen: installierte Mods ausschalten → „Übernehmen“, oder „Empfohlene entfernen“ auf einen Klick; im Profil-Menü „Ausstattung entfernen“
- Optionen → Spiel & Leistung: automatische Ausstattung neuer Vorlagen abschaltbar
- Vor jedem Entfernen wird ein Zeitmaschinen-Stand gesichert

## Neu in 2.6

- **Vorlagen** für 1.8.9, 1.12.2, 26.2 und automatisch für die neueste Minecraft-Version (aktuell 26.3)
- Jede Vorlage wird **fertig ausgestattet**: Performance (Sodium, Lithium, FerriteCore, Entity Culling …), Xaero's Minimap & World Map, **FreeCam**, Zoom, Mod Menu, Mouse Tweaks, AppleSkin, Iris – bei 1.8.9 zusätzlich PolyPatcher
- **Ausstattung mit über 45 Mods** in Gruppen (Performance, Karten, FreeCam & Kamera, HUD, Komfort, Shader & Optik, Social), Suche, „Empfohlene/Alle/Keine“ und Anzeige, was es für die Version gibt

## Neu in 2.5.2

- Party: „Plan festlegen“ wiederholt bei Verbindungsaussetzern automatisch; ohne Modrinth wird der Plan trotzdem festgelegt (Mitspieler wählen ihr eigenes Profil)
- Verständliche Fehlermeldungen statt „fetch failed“

## Neu in 2.5.1

- **Zweites Fenster:** Konto-Menü oben rechts → „Zweites Fenster (anderes Konto)“. Jedes Fenster hat eigene Konto-Wahl, Freunde und Chat; Profile, Mods und Server-Favoriten kommen vom Hauptfenster. Dasselbe Profil kann nicht in zwei Fenstern gleichzeitig laufen.

## Neu in 2.5 – die große Überarbeitung

**Neue Oberfläche:** Seitenleiste mit Gruppen (Bibliothek · Community · Fortschritt · Werkzeuge), einklappbar; Optionen in Kategorien mit Suche und automatischem Speichern; aufgeräumte Profilkarten; schwebende Hinweise; Leistungsmodus für schwache PCs; die 3D-Vorschau pausiert, wenn sie nicht zu sehen ist.

**Neue Funktionen:**
- **Party-Modus:** Freunde einladen, Profil und Server festlegen – wer „Bereit“ drückt, bekommt fehlende Mods automatisch, dann starten alle nach einem Countdown gleichzeitig
- **Chat** mit Freunden im Launcher – auch Profile und Server zum direkten Übernehmen
- **Profil-Codes:** ganzes Modpack als kurzer Text („LC1-…“) teilen und einfügen
- **Zeitmaschine:** automatische Sicherung von Mods & Configs vor jedem Start, Update und jeder Installation – ein Klick zurück
- **Session-Rückblick** nach jeder Runde: Dauer, Fortschritte, Tode, Kills, Screenshots
- **Level & 25 Erfolge**, Level und Abzeichen für Freunde sichtbar
- **Server-Radar:** Live-Ping, Spielerzahl, Version – und welche Freunde gerade drauf sind
- **Performance-Autopilot:** RAM, Java-Einstellungen und Performance-Mods (Sodium, Lithium, FerriteCore …) mit einem Klick

## Neu in 2.2

- Freundschaftsanfragen: Der andere muss annehmen, erst dann seht ihr euch (Anfragen annehmen, ablehnen, zurückziehen)
- Eigener Status: Online, Abwesend, Bitte nicht stören, Unsichtbar – plus kurze Notiz („Suche Leute für Bedwars“)
- Freunde einladen: Nachricht + dein aktueller Server, kommt beim Freund als Benachrichtigung an
- Favoriten (★) oben, Spitznamen, Blockieren, Zähler für offene Anfragen
- Bestehende Freundeslisten aus 2.1 werden übernommen; wer dich noch nicht hat, bekommt automatisch eine Anfrage

## Neu in 2.1.1

- Jedes Minecraft-Konto hat seine eigene Freundesliste – beim Kontowechsel wechselt die Liste mit
- Updates kommen ab jetzt automatisch über diese Release-Seite

## Neu in 2.1

- LellekClient für macOS (Apple Silicon & Intel); 1.8.9–1.18 laufen auf Apple Silicon über Rosetta

## Mac – erster Start

DMG öffnen und `LellekClient` auf „Programme“ ziehen. Dann Rechtsklick auf die App → „Öffnen“ → „Öffnen“.
Meldet macOS „beschädigt“, einmal im Terminal: `xattr -cr /Applications/LellekClient.app`

Prüfsummen: `SHA256SUMS.txt`
