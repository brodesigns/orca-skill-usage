# Skill Usage (Orca-Plugin)

## Zweck

- Orca-Plugin: zeigt, welche Skills, MCP-Server, Agents und Plugins von Claude Code, Codex und Gemini wirklich genutzt werden, pro Projekt.
- Zeigt die Kontextkosten (Tokens) ungenutzter Einträge.
- Nur lesend: ändert keine Dateien, kein Netzwerk, keine Empfehlungen zum Löschen. Einzige Aktion: "Ordner öffnen" auf Klick (macOS `open`, Windows `explorer.exe`, Linux `xdg-open`), nur für Pfade aus dem eigenen Inventar-Scan.
- Öffentliches Repo (MIT), Autor BroDesigns (https://brodesigns.de).

## Tech Stack

- TypeScript + TSX, Orca Plugin API v1 (`trusted-worker`), Orca ab 1.4.248.
- Kein `package.json`, kein Build-Schritt. Orca lädt `src/worker.ts` und `src/panel.tsx` direkt.
- Typen kommen aus `.orca/types/` (generiert, gitignored).
- Tests: `src/*.test.ts`, Panel-Check: `src/panel.check.ts`.

## Wichtige Pfade

| Pfad | Inhalt |
|---|---|
| `orca-plugin.json` | Manifest: Version, Capabilities, Hook `agent.tool.after`, Event `workspace.changed`, Screenshots |
| `src/worker.ts` | Hook, Storage, Import-Steuerung |
| `src/history.ts` | Import der Session-Dateien (Claude `~/.claude/projects`, Codex `~/.codex/sessions`) |
| `src/inventory.ts` | Scan von Skills, Agents, Plugins, MCP-Configs, CLAUDE.md/AGENTS.md/GEMINI.md |
| `src/merge.ts` | Inventar + Nutzung zusammenführen; Einordnung nicht installierter Einträge (`goneSkillSource`, Listen `CLAUDE_SKILLS`/`CLAUDE_AGENTS` von Hand gepflegt) |
| `src/usage.ts`, `src/totals.ts` | Zähler, Summen |
| `src/store.ts` | Storage in Chunks |
| `src/panel.tsx` | UI |
| `src/i18n.ts` | Texte EN/DE/ES |
| `src/protocol.ts` | Nachrichten Worker ↔ Panel |
| `src/demo.ts` | Fake-Zahlen für Screenshots (Storage-Key `demo` = `true`) |
| `assets/` | Cover und Screenshots (im Manifest und README referenziert) |
| `tools/build-assets.py` | Baut die Bildkarten in `assets/` aus Panel-Shots (Headless Chrome) |

## Befehle

```bash
orca plugin types .      # Typen erzeugen (.orca/types)
orca plugin validate .   # Manifest prüfen
orca plugin test .       # Tests
orca plugin dev watch .  # Entwicklung mit Reload
orca plugin dev load .   # Plugin lokal laden
```

## Konventionen

- Alles auf Englisch: Code, Kommentare, Commits, README, UI-Basistexte. Ausnahme: deutsche UI-Texte in `i18n.ts` (echte Umlaute).
- Neue UI-Texte immer in EN, DE und ES in `i18n.ts` (`es` ist als `typeof en` getypt, fehlende Keys fallen beim Compiler auf).
- Keine Co-Authored-By-Zeile in Commits. Commit und Push nur auf Zuruf.
- Zu jeder Logik-Datei gehört eine `*.test.ts`. Neue Logik mit Test.
- Versionsänderung: `orca-plugin.json` und README zusammen prüfen.
- Datenschutz halten: aus Sessions nur Tool-Namen, Befehlsnamen, Zeitstempel, IDs, Projektnamen. Nie Prompts, Antworten, Dateiinhalte, Env-Werte oder Tokens speichern.

## Gotchas

- Orca begrenzt einen Storage-Wert auf 256 KiB: Daten nur über `store.ts` in Chunks schreiben (ca. 1 MB gesamt, 100 Tage pro Tag gezählt).
- Tokens sind Schätzungen (4 Zeichen pro Token). MCP-Tool-Listen sind unbekannt, MCP zeigt nur Nutzung.
- Codex: nur Skill-Reads zählen. Gemini: keine Nutzungsdaten, dort "no usage data" statt "unused".
- Claude Code wird aus den Session-Dateien gezählt, der Hook zählt nur andere AIs. Sonst doppelte Zählung.
- Eingebaute Slash-Commands (`/model`) zählen nicht, selbst getippte Skill-Commands schon.
- Zählung: Aufrufe pro Tag **und** pro KI (`Entry.ag`), damit "Genutzt von" dem Zeitraum folgt. Formatänderung im Verlauf: `HISTORY_VERSION` erhöhen (löst einen vollständigen Neuimport aus, ca. 3000 Dateien).
- "Genutzt in" folgt dem gewählten Zeitraum und erscheint nur bei "Alle Projekte" und Zeitraum > Letzte Sitzung, sonst widerspricht es dem Badge "ungenutzt".
- Kosten-Zeilen: `tokens` = Beschreibung je Session, `note content:N` = ganze SKILL.md je Aufruf. Im Zeitraum: Tokens × Sessions (Obergrenze, Session = letzte Aktivität im Zeitraum) bzw. Größe × Aufrufe.
- Quelle `orca` für Orcas eigene Skills: feste Liste `ORCA_SKILLS` in `inventory.ts`. Neue Orca-Skills dort ergänzen.
- Das Panel sieht Pfade nur mit `~`; `folder.open` nimmt nur Pfade, die der Scan gefunden hat.
- Listen sind auf 100 Karten pro Seite begrenzt (Orca lehnt Renders über 5000 Nodes ab).
- Screenshots neu erzeugen: Orca minimieren (`--scenario` und `--act` brauchen ein verstecktes Fenster), je Szenario `orca plugin shot . --panel skill-usage --scenario <name> --width 520 --height 1000 --theme dark --out <dir>/panels/<name>.png` (demo, details, project, mcp, unused, gone), dann `python3 tools/build-assets.py <dir>` und die PNGs aus `<dir>/out` nach `assets/` kopieren.
- Vor einem Release `orca plugin validate .` und `orca plugin test .` laufen lassen.
