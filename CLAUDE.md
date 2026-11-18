# Skill Usage (Orca-Plugin)

## Zweck

- Orca-Plugin: zeigt, welche Skills, MCP-Server, Agents und Plugins von Claude Code, Codex und Gemini wirklich genutzt werden, pro Projekt.
- Zeigt die Kontextkosten (Tokens) ungenutzter Einträge.
- Nur lesend: ändert keine Dateien, kein Netzwerk, keine Empfehlungen zum Löschen.
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
| `src/merge.ts` | Inventar + Nutzung zusammenführen |
| `src/usage.ts`, `src/totals.ts` | Zähler, Summen |
| `src/store.ts` | Storage in Chunks |
| `src/panel.tsx` | UI |
| `src/i18n.ts` | Texte EN/DE |
| `src/protocol.ts` | Nachrichten Worker ↔ Panel |
| `src/demo.ts` | Fake-Zahlen für Screenshots (Storage-Key `demo` = `true`) |
| `assets/` | Cover und Screenshots (im Manifest und README referenziert) |

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
- Neue UI-Texte immer in EN und DE in `i18n.ts`.
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
- Vor einem Release `orca plugin validate .` und `orca plugin test .` laufen lassen.
