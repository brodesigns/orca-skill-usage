# Skill Usage (Orca plugin)

A sidebar panel that shows which skills, MCP servers, agents and plugins your coding agents really use, and which ones only cost context tokens. Use it to find what you can remove.

## What it shows

- **Tiles:** tokens always loaded per session, potential savings, unused skills / MCP servers / agents, number of recorded calls.
- **Period and project:** everything (tiles, lists, cleanup list) follows two pickers. Period: latest session, last 7, 30 or 90 days. Project: all projects, the current project (the most recently active one) or any recent project. "Latest session" is the newest session file of the chosen project (Orca does not tell the plugin which session has focus), so it needs a project: "all projects" is not offered with it. "Unused" always refers to the chosen period and project; project-level items of other projects are hidden. Project and session numbers are computed on demand from the session files and not stored.
- **Tabs:** Skills, MCP, Agents, Plugins, Other. Each entry is a card with its source, estimated tokens, calls, last use and calls per agent. Skills show how often the model called them and how often you typed them as a slash command. Search, sorting (most used, token cost, name, last used), a global/project filter and an "unused only" switch help with long lists.
- **Which AI:** every card shows the AIs an entry is installed for (Claude, Codex (ChatGPT), Gemini, or the shared `.agents` folder) and which AI actually used it, with counts. A filter shows one AI's entries only, so you can see what to keep, move or remove per AI.
- **Cleanup list:** a Markdown list of everything installed but unused in the period, ready to copy.
- **Other:** size of your global `CLAUDE.md`, the most used tools (Bash, Read, ...), reset, language (English or German).

## How it works

- **History:** on start the plugin reads your past sessions once (Claude Code: `~/.claude/projects/*/*.jsonl`, Codex: `~/.codex/sessions`), then only new lines. From each line it keeps tool names, slash command names, timestamps and call ids. **No prompt, answer or file text is stored or shown.** Counters are kept per day for 100 days.
- **Live:** the `agent.tool.after` hook sees tool calls of agents in Orca terminals. Claude Code is counted from its session files (they also hold the commands you type), the hook counts other agents. Agents without a Skill tool (Codex) count as using a skill when they read its `SKILL.md`.
- **Inventory:** it reads `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, `~/.claude/agents`, enabled plugins, the MCP server names in `~/.claude.json`, `~/.codex/config.toml` and `~/.gemini/settings.json`, your global `CLAUDE.md`, `AGENTS.md` and `GEMINI.md`, and for every project Claude Code knows: `.claude/skills`, `CLAUDE.md` and the server names in `.mcp.json`.
- **Tokens** are an estimate (4 characters per token) of what sits in context: name and description of every skill the model may call itself. Skills with `disable-model-invocation: true` cost nothing. Project items load only inside their project, so they are not part of the totals.

## Limits

- MCP tool definitions cost context, but their size is unknown without starting the server, so MCP entries show usage only.
- Slash commands are matched to skills by name; built-in commands such as `/model` are ignored.
- History covers the last 90 days of session files that still exist on disk. Resumed sessions that copy old lines are de-duplicated for skills, MCP servers and agents, not for plain tools.
- Disabled MCP servers are not detected. MCP servers whose names differ only in `-` vs `_` or case count as one.
- "Unused" is only meaningful with enough data for the chosen period.

## Why "Full access"?

Every plugin with a worker gets this label in Orca. This one:

- reads files in `~/.claude`, below `~/.claude/plugins` for enabled plugins, `~/.codex`, `~/.gemini`, `~/.agents`, `~/.claude.json` (only MCP server **names**, never env values, headers or tokens) and the few known files of your projects (`.claude/skills`, `CLAUDE.md`, `.mcp.json`); it reads regular files only and with size limits,
- from session files it uses only tool names, command names, timestamps and ids,
- reads the name, branch and folder of the focused workspace, only to switch "Current project" when you change workspace,
- makes no network requests and sends nothing anywhere,
- writes only its own counters to the plugin's storage (about 1 MB with a long history),
- runs no programs and touches no terminals.

## Install

Orca, Settings, Plugins, add the marketplace, search "Skill Usage", review the access and approve.

## Develop

```bash
orca plugin types .
orca plugin validate .
orca plugin test .
orca plugin dev watch .
```

Code layout (`src/`): `worker.ts` (hook, storage, import loop), `usage.ts` (classify, per-day counters), `history.ts` (session import), `inventory.ts` (disk scan), `merge.ts` (inventory + usage), `panel.tsx` (UI), `i18n.ts` (English and German), `protocol.ts` (panel <-> worker contract).

## About

Built and maintained by [BroDesigns](https://brodesigns.de), a web agency.

## License

MIT
