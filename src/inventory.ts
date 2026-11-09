// Inventory: what does Claude Code load that costs context? Read-only.
import { constants } from 'node:fs'
import { open, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'

export type Item = {
  kind: 'skill' | 'mcp' | 'agent' | 'plugin' | 'memory'
  id: string
  label: string
  source: string
  tokens: number | null
  manual: boolean
  /** `project` items only load while working in that project, so they stay out of the global totals. */
  scope: 'global' | 'project'
  /** The AIs this entry is installed for: claude, codex, gemini, agents (shared `.agents` folder). */
  agents: string[]
  /** Other projects that hold the same project-level entry. */
  also?: string[]
  note?: string
}

type Base = Omit<Item, 'agents'>

const MAX_FILE = 256 * 1024
const MAX_JSON = 16 * 1024 * 1024
const MAX_ITEMS = 400
const MAX_NAME = 120
const MAX_PROJECTS = 200

/** Rough estimate: 4 characters per token. */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4)

/** Reads `name`, `description` and `disable-model-invocation` from the frontmatter. */
export function parseFrontmatter(text: string): { name?: string; description?: string; manual: boolean } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return { manual: false }
  const lines = m[1].split(/\r?\n/)
  const get = (key: string): string | undefined => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (i < 0) return undefined
    let v = lines[i].slice(key.length + 1).trim()
    // Collect multi-line values (> or |) and their continuation lines
    if (v === '>' || v === '|' || v === '>-' || v === '|-') v = ''
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) v += ` ${lines[j].trim()}`
    return v.replace(/^["']|["']$/g, '').trim()
  }
  return {
    name: get('name'),
    description: get('description'),
    manual: ['true', 'yes'].includes((get('disable-model-invocation') ?? '').toLowerCase())
  }
}

/** Reads a regular file, at most `limit` bytes; never follows devices or pipes, never buffers more than the limit. */
async function read(path: string, limit = MAX_FILE): Promise<string | null> {
  let handle
  try {
    // Non-blocking open: a FIFO must not hang the worker; the regular-file check follows on the open handle.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const info = await handle.stat()
    if (!info.isFile()) return null
    const buffer = Buffer.alloc(Math.min(info.size, limit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function names(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => !n.startsWith('.')).sort().slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

/** Skills in `root`; folders without SKILL.md are searched one level deeper (e.g. `synced`). */
async function scanSkills(root: string, source: string, prefix: string, scope: Item['scope'] = 'global', depth = 0): Promise<Base[]> {
  const out: Base[] = []
  for (const dir of await names(root)) {
    const text = await read(join(root, dir, 'SKILL.md'))
    if (text === null) {
      if (depth === 0) out.push(...(await scanSkills(join(root, dir), source, prefix, scope, 1)))
      continue
    }
    const fm = parseFrontmatter(text)
    const name = (fm.name || dir).slice(0, MAX_NAME)
    // Only name and description sit in context, and only if the model may invoke the skill itself.
    const listed = `${name}: ${fm.description ?? ''}`.length
    out.push({
      kind: 'skill',
      id: `${prefix}${name}`,
      label: `${prefix}${name}`,
      source,
      tokens: fm.manual ? 0 : estimateTokens(listed),
      manual: fm.manual,
      scope,
      note: `content:${estimateTokens(text.length)}`
    })
  }
  return out
}

async function scanAgents(root: string, source: string, prefix: string): Promise<Base[]> {
  const out: Base[] = []
  for (const file of await names(root)) {
    if (!file.endsWith('.md')) continue
    const text = await read(join(root, file))
    if (text === null) continue
    const fm = parseFrontmatter(text)
    const name = (fm.name || file.replace(/\.md$/, '')).slice(0, MAX_NAME)
    out.push({
      kind: 'agent',
      id: `${prefix}${name}`,
      label: `${prefix}${name}`,
      source,
      tokens: estimateTokens(`${name}: ${fm.description ?? ''}`.length),
      manual: false,
      scope: 'global',
    })
  }
  return out
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  // Whole file up to the JSON limit: a cut-off file would never parse.
  const text = await read(path, MAX_JSON)
  if (text === null) return {}
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return {}
  }
}

/** MCP servers from `~/.claude.json`: global, and one entry per project. Never reads or outputs values (env, headers, tokens). */
async function scanMcp(home: string): Promise<Base[]> {
  const cfg = await readJson(join(home, '.claude.json'))
  const out: Base[] = []
  const base = { tokens: null, manual: false }
  for (const n of Object.keys(asRecord(cfg.mcpServers)).slice(0, MAX_ITEMS)) {
    // A server's tool definitions cost context, but their size is unknown without starting the server.
    out.push({ kind: 'mcp', id: n.slice(0, MAX_NAME), label: n.slice(0, MAX_NAME), source: 'global', scope: 'global', ...base })
  }
  for (const [path, project] of Object.entries(asRecord(cfg.projects)).slice(0, MAX_PROJECTS)) {
    if (!isAbsolute(path)) continue
    const name = basename(path).slice(0, MAX_NAME)
    for (const n of Object.keys(asRecord(asRecord(project).mcpServers)).slice(0, 50)) {
      out.push({ kind: 'mcp', id: n.slice(0, MAX_NAME), label: n.slice(0, MAX_NAME), source: `project:${name}`, scope: 'project', ...base })
    }
  }
  return out
}

/** The install path only counts if it really lies below ~/.claude/plugins (a plugin file is untrusted input). */
async function insidePlugins(home: string, raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return null
  try {
    const base = await realpath(join(home, '.claude', 'plugins'))
    const real = await realpath(raw)
    return real.startsWith(base + sep) ? real : null
  } catch {
    return null
  }
}

/** Enabled plugins with their skills and agents. */
async function scanPlugins(home: string): Promise<Base[]> {
  const claude = join(home, '.claude')
  const installed = asRecord((await readJson(join(claude, 'plugins', 'installed_plugins.json'))).plugins)
  const enabled = asRecord((await readJson(join(claude, 'settings.json'))).enabledPlugins)
  const out: Base[] = []
  for (const [key, versions] of Object.entries(installed)) {
    const plugin = key.split('@')[0].slice(0, MAX_NAME)
    const on = enabled[key] === true
    const first = Array.isArray(versions) ? asRecord(versions[0]) : {}
    const path = await insidePlugins(home, first.installPath)
    let tokens = 0
    if (on && path !== null) {
      const skills = await scanSkills(join(path, 'skills'), `plugin:${plugin}`, `${plugin}:`)
      const agents = await scanAgents(join(path, 'agents'), `plugin:${plugin}`, `${plugin}:`)
      out.push(...skills, ...agents)
      tokens = [...skills, ...agents].reduce((n, i) => n + (i.tokens ?? 0), 0)
    }
    out.push({
      kind: 'plugin',
      id: plugin,
      label: plugin,
      source: `marketplace:${(key.split('@')[1] ?? '').slice(0, MAX_NAME)}`,
      tokens: on ? tokens : 0,
      manual: false,
      scope: 'global',
      note: on ? 'enabled' : 'disabled'
    })
  }
  return out
}

/** Permanently loaded instructions (CLAUDE.md), roughly in tokens. */
async function scanMemory(home: string): Promise<Base[]> {
  const text = await read(join(home, '.claude', 'CLAUDE.md'))
  if (text === null) return []
  return [
    { kind: 'memory', id: 'CLAUDE.md', label: 'Global CLAUDE.md', source: 'user', tokens: estimateTokens(text.length), manual: false, scope: 'global' }
  ]
}

/** Project-level skills, CLAUDE.md and .mcp.json (server names only) of the projects Claude Code knows. */
async function scanProjects(home: string): Promise<Base[]> {
  const cfg = await readJson(join(home, '.claude.json'))
  const paths = Object.keys(asRecord(cfg.projects))
    .filter((p) => isAbsolute(p) && p !== home && !p.includes('\0'))
    .slice(0, MAX_PROJECTS)
  const out: Base[] = []
  for (const path of paths) {
    const name = basename(path).slice(0, MAX_NAME)
    const source = `project:${name}`
    out.push(...(await scanSkills(join(path, '.claude', 'skills'), source, '', 'project')))
    const memory = await read(join(path, 'CLAUDE.md'))
    if (memory !== null) {
      out.push({ kind: 'memory', id: `${name}/CLAUDE.md`, label: `${name}/CLAUDE.md`, source, tokens: estimateTokens(memory.length), manual: false, scope: 'project' })
    }
    for (const server of Object.keys(asRecord((await readJson(join(path, '.mcp.json'))).mcpServers)).slice(0, 50)) {
      out.push({ kind: 'mcp', id: server.slice(0, MAX_NAME), label: server.slice(0, MAX_NAME), source, tokens: null, manual: false, scope: 'project' })
    }
  }
  return out
}

/** Names of MCP servers in Codex (`config.toml`) and Gemini (`settings.json`); never their values. */
async function scanOtherMcp(home: string): Promise<Item[]> {
  const out: Item[] = []
  const toml = await read(join(home, '.codex', 'config.toml'))
  if (toml !== null) {
    for (const m of toml.matchAll(/^\[mcp_servers\.(?:"([^"\n]{1,120})"|([A-Za-z0-9_-]{1,120}))(?:\.[^\]\n]*)?\]/gm)) {
      const name = m[1] ?? m[2]
      if (!out.some((i) => i.id === name)) out.push({ kind: 'mcp', id: name, label: name, source: 'global', tokens: null, manual: false, scope: 'global', agents: ['codex'] })
    }
  }
  const gemini = await readJson(join(home, '.gemini', 'settings.json'))
  for (const name of Object.keys(asRecord(gemini.mcpServers)).slice(0, 50)) {
    out.push({ kind: 'mcp', id: name.slice(0, MAX_NAME), label: name.slice(0, MAX_NAME), source: 'global', tokens: null, manual: false, scope: 'global', agents: ['gemini'] })
  }
  return out
}

/** Global instruction files of the other AIs. */
async function scanOtherMemory(home: string): Promise<Item[]> {
  const out: Item[] = []
  for (const [file, label, agent] of [['.codex/AGENTS.md', 'Global AGENTS.md', 'codex'], ['.gemini/GEMINI.md', 'Global GEMINI.md', 'gemini']] as const) {
    const text = await read(join(home, file))
    if (text !== null) out.push({ kind: 'memory', id: file.split('/')[1], label, source: 'user', tokens: estimateTokens(text.length), manual: false, scope: 'global', agents: [agent] })
  }
  return out
}

const tag = (items: Base[], agents: string[]): Item[] => items.map((i) => ({ ...i, agents }))

/** Project folder name (as Claude Code derives it from the path) -> name of the folder, for projects registered in `~/.claude.json`. */
export async function scanProjectNames(home: string = homedir()): Promise<Record<string, string>> {
  const cfg = await readJson(join(home, '.claude.json'))
  const out: Record<string, string> = Object.create(null)
  for (const path of Object.keys(asRecord(cfg.projects)).slice(0, MAX_PROJECTS)) {
    if (isAbsolute(path) && !path.includes('\0')) out[path.replace(/[^a-zA-Z0-9]/g, '-')] = basename(path).slice(0, 60)
  }
  return out
}

/** Folder name as Claude Code derives it -> name of the folder that holds the project, to tell apart projects with the same name. */
export async function scanProjectParents(home: string = homedir()): Promise<Record<string, string>> {
  const cfg = await readJson(join(home, '.claude.json'))
  const out: Record<string, string> = Object.create(null)
  for (const path of Object.keys(asRecord(cfg.projects)).slice(0, MAX_PROJECTS)) {
    if (isAbsolute(path) && !path.includes('\0')) out[path.replace(/[^a-zA-Z0-9]/g, '-')] = basename(dirname(path)).slice(0, 60)
  }
  return out
}

export async function scanInventory(home: string = homedir()): Promise<Item[]> {
  const [claudeSkills, codexSkills, sharedSkills, claudeAgents, plugins, mcp, memory, projects, otherMcp, otherMemory] = await Promise.all([
    scanSkills(join(home, '.claude', 'skills'), 'user', ''),
    // Other AIs keep skills in their own folders (same SKILL.md format).
    scanSkills(join(home, '.codex', 'skills'), 'codex', ''),
    scanSkills(join(home, '.agents', 'skills'), 'agents', ''),
    scanAgents(join(home, '.claude', 'agents'), 'user', ''),
    scanPlugins(home),
    scanMcp(home),
    scanMemory(home),
    scanProjects(home),
    scanOtherMcp(home),
    scanOtherMemory(home)
  ])
  const all: Item[] = [
    ...tag(claudeSkills, ['claude']),
    ...tag(codexSkills, ['codex']),
    ...tag(sharedSkills, ['agents']),
    ...tag(claudeAgents, ['claude']),
    ...tag(plugins, ['claude']),
    ...tag(mcp, ['claude']),
    ...tag(memory, ['claude']),
    ...tag(projects, ['claude']),
    ...otherMcp,
    ...otherMemory
  ]
  // One entry per kind and id: global entries come first and win, and the AIs they are installed for add up.
  const byKey = new Map<string, Item>()
  for (const item of all.sort((a, b) => Number(a.scope === 'project') - Number(b.scope === 'project'))) {
    const key = `${item.kind}:${item.id}`
    const first = byKey.get(key)
    if (first === undefined) byKey.set(key, item)
    else {
      for (const a of item.agents) if (!first.agents.includes(a)) first.agents.push(a)
      // The same project-level entry in another project: remember where it also applies.
      if (first.scope === 'project' && item.scope === 'project' && item.source !== first.source && (first.also?.length ?? 0) < 20) {
        first.also = [...(first.also ?? []), item.source]
      }
    }
  }
  return [...byKey.values()].slice(0, MAX_ITEMS * 3)
}
