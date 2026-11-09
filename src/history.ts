// Imports past sessions: Claude Code transcripts and Codex rollouts. Reads only tool names, command
// names, timestamps and ids; no prompt or answer text is kept. Incremental by byte offset.
import { constants } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { add, classify, dayOf, emptyStats, KEEP_DAYS, parseStats, projKey, type Stats } from './usage'

/** Version of the stored format; an older one is imported again (the project attribution is new). */
export const HISTORY_VERSION = 2

export type HistoryState = {
  /** Format version, see HISTORY_VERSION. */
  v: number
  /** Bytes already processed per session file (see `FileRef.key`). */
  offsets: Record<string, number>
  /** Short ids of recent skill/MCP/agent calls, so a resumed session that copies old lines counts once. */
  seen: string[]
  /** Lines older than this (ms) are ignored; set by "reset". */
  from: number
  stats: Stats
  /** Project folder name -> project name (last segment of the first `cwd` seen); never the full path. */
  projects: Record<string, string>
}

export const emptyHistory = (): HistoryState => ({ v: HISTORY_VERSION, offsets: {}, seen: [], from: 0, stats: emptyStats(), projects: Object.create(null) })

const CHUNK = 4 * 1024 * 1024
/** A line without a newline longer than this is skipped, so a hostile file cannot fill memory. */
const MAX_LINE = 8 * 1024 * 1024
const MAX_SEEN = 20_000
const MAX_OFFSETS = 20_000
const MAX_FILES = 12_000
const COMMAND = /^\s*<command-name>\/?([^<\s]{1,120})<\/command-name>/
const CODEX_CALL = /"type":"(?:function_call|custom_tool_call|local_shell_call)"/

/** Calls are remembered by the last 12 characters of their id (collisions are negligible, storage stays small). */
export const shortId = (id: string): string => id.slice(-12)

export type FileRef = {
  path: string
  /** File name. */
  name: string
  /** Unique key: agent, project folder and path inside it (two projects may hold the same file name). */
  key: string
  /** Claude project folder; empty for Codex. */
  dir: string
  /** Session id (file name without extension, or the parent session of a subagent file). */
  session: string
  /** A subagent file (`<project>/<session>/subagents/*.jsonl`). */
  sub: boolean
  size: number
  mtime: number
  agent: 'claude' | 'codex'
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function ref(path: string, base: Pick<FileRef, 'name' | 'key' | 'dir' | 'session' | 'sub' | 'agent'>, oldest: number): Promise<FileRef | null> {
  try {
    const info = await stat(path)
    return info.isFile() && info.mtimeMs >= oldest ? { ...base, path, size: info.size, mtime: info.mtimeMs } : null
  } catch {
    return null
  }
}

/** Recent session files, newest first: Claude sessions with their subagent files, and Codex rollouts (year/month/day folders). */
export async function listSessionFiles(home: string, now: number): Promise<FileRef[]> {
  const oldest = now - KEEP_DAYS * 86_400_000
  const out: (FileRef | null)[] = []
  const claudeRoot = join(home, '.claude', 'projects')
  for (const project of await listDir(claudeRoot)) {
    for (const entry of await listDir(join(claudeRoot, project))) {
      if (entry.endsWith('.jsonl')) {
        const session = entry.slice(0, -'.jsonl'.length)
        out.push(await ref(join(claudeRoot, project, entry), { name: entry, key: `claude:${project}/${entry}`, dir: project, session, sub: false, agent: 'claude' }, oldest))
      } else if (!entry.startsWith('.')) {
        // A folder named after a session holds the files of its subagents.
        for (const file of await listDir(join(claudeRoot, project, entry, 'subagents'))) {
          if (file.endsWith('.jsonl')) {
            out.push(await ref(join(claudeRoot, project, entry, 'subagents', file), { name: file, key: `claude:${project}/${entry}/subagents/${file}`, dir: project, session: entry, sub: true, agent: 'claude' }, oldest))
          }
        }
      }
    }
  }
  const codexRoot = join(home, '.codex', 'sessions')
  for (const y of await listDir(codexRoot)) {
    for (const m of await listDir(join(codexRoot, y))) {
      for (const d of await listDir(join(codexRoot, y, m))) {
        for (const file of await listDir(join(codexRoot, y, m, d))) {
          if (file.endsWith('.jsonl')) out.push(await ref(join(codexRoot, y, m, d, file), { name: file, key: `codex:${file}`, dir: '', session: file, sub: false, agent: 'codex' }, oldest))
        }
      }
    }
  }
  return (out.filter(Boolean) as FileRef[]).sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES)
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const part of content) {
      const t = (part as { text?: unknown } | null)?.text
      if (typeof t === 'string') return t
    }
  }
  return null
}

/** Handles one transcript line; never throws. */
export function processLine(state: HistoryState, line: string, agent: FileRef['agent'], seen: Set<string>, dir = ''): void {
  try {
    if (agent === 'codex') {
      // Only the model's own tool call counts: not the session header, not the call's output, not the duplicate event.
      if (!line.includes('SKILL.md') || !line.includes('"type":"response_item"') || !CODEX_CALL.test(line)) return
      const ts = /^\{"timestamp":"([^"]+)"/.exec(line)?.[1]
      const call = classify('shell', line.slice(0, 4000), 'codex')
      const time = ts ? Date.parse(ts) : NaN
      if (call?.bucket === 'skills' && time >= state.from) add(state.stats, 'skills', call.id, 'codex', time)
      return
    }
    const isCommand = line.includes('<command-name>') && line.includes('"type":"user"')
    if (!isCommand && !line.includes('"tool_use"')) return
    const d = JSON.parse(line) as { type?: string; timestamp?: string; cwd?: unknown; message?: { content?: unknown } }
    if (dir !== '' && typeof d.cwd === 'string' && isAbsolute(d.cwd)) {
      // The project root is the folder the session started in (its folder name encodes that path). A session can
      // cd into a sub folder later: such a folder only names the project while no root line has been seen.
      const isRoot = d.cwd.replace(/[^a-zA-Z0-9]/g, '-') === dir
      if (isRoot || !(dir in state.projects)) state.projects[dir] = basename(d.cwd).slice(0, 60)
    }
    const time = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : NaN
    if (Number.isNaN(time) || time < state.from) return
    if (isCommand && d.type === 'user') {
      const m = COMMAND.exec(textOf(d.message?.content) ?? '')
      if (m) add(state.stats, 'cmds', m[1], 'claude', time, 'direct', dir === '' ? undefined : projKey(dir))
      return
    }
    if (d.type !== 'assistant' || !Array.isArray(d.message?.content)) return
    for (const part of d.message.content as { type?: string; id?: string; name?: string; input?: unknown }[]) {
      if (part?.type !== 'tool_use' || typeof part.name !== 'string') continue
      const call = classify(part.name, part.input, 'claude')
      if (call === null) continue
      // Resumed sessions copy old lines: skill, MCP and agent calls are counted once per id.
      if (call.bucket !== 'tools' && typeof part.id === 'string') {
        const id = shortId(part.id)
        if (seen.has(id)) continue
        seen.add(id)
        state.seen.push(id)
      }
      add(state.stats, call.bucket, call.id, 'claude', time, 'auto', dir === '' ? undefined : projKey(dir))
    }
  } catch {
    /* a broken line is skipped */
  }
}

/** Reads the new complete lines of a file from `start` until `deadline`; returns the offset reached and whether the end was reached. */
async function readFrom(file: FileRef, start: number, onLine: (line: string) => void, deadline: number): Promise<{ offset: number; complete: boolean }> {
  // Non-blocking open: a FIFO must not hang the worker. Only regular files are read.
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    if (!(await handle.stat()).isFile()) return { offset: file.size, complete: true }
    let pos = start
    let carry: Buffer = Buffer.alloc(0)
    let skipping = false
    const buf = Buffer.alloc(CHUNK)
    while (pos < file.size) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(CHUNK, file.size - pos), pos)
      if (bytesRead === 0) break
      pos += bytesRead
      let chunk = buf.subarray(0, bytesRead)
      if (skipping) {
        // Inside an over-long line: drop everything up to its end.
        const nl = chunk.indexOf(0x0a)
        if (nl < 0) continue
        chunk = chunk.subarray(nl + 1)
        skipping = false
      }
      let data = Buffer.concat([carry, chunk])
      const cut = data.lastIndexOf(0x0a)
      if (cut < 0) {
        carry = data.length > MAX_LINE ? Buffer.alloc(0) : data
        skipping = data.length > MAX_LINE
        continue
      }
      carry = Buffer.from(data.subarray(cut + 1))
      data = data.subarray(0, cut)
      for (const line of data.toString('utf8').split('\n')) if (line !== '') onLine(line)
      // Let other work (requests, hooks) run between chunks.
      await new Promise((r) => setImmediate(r))
      if (Date.now() > deadline && pos < file.size) return { offset: pos - carry.length, complete: false }
    }
    return { offset: pos - carry.length, complete: true }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export type Progress = { done: boolean; files: number; total: number; /** New lines were read in this run, so the state has to be saved. */ changed?: boolean }

/** Works through the files within `budgetMs`; call again until `done`. Mutates `state`. Oldest files first, so the newest ids are the ones kept for de-duplication. */
export async function importHistory(state: HistoryState, home: string, now: number, budgetMs: number, only?: (f: FileRef) => boolean): Promise<Progress> {
  const files = (await listSessionFiles(home, now)).filter((f) => only === undefined || only(f))
  const deadline = Date.now() + budgetMs
  const seen = new Set(state.seen)
  // Offsets used to be keyed by file name only: take such an old offset over once, then drop the old key.
  for (const f of files) {
    if (state.offsets[f.key] === undefined && state.offsets[f.name] !== undefined) state.offsets[f.key] = state.offsets[f.name]
  }
  for (const f of files) delete state.offsets[f.name]
  const offsetOf = (f: FileRef): number => state.offsets[f.key] ?? 0
  const todo = files.filter((f) => offsetOf(f) < f.size).sort((a, b) => a.mtime - b.mtime)
  let processed = 0
  for (const f of todo) {
    if (Date.now() > deadline) break
    try {
      const r = await readFrom(f, offsetOf(f), (line) => processLine(state, line, f.agent, seen, f.dir), deadline)
      state.offsets[f.key] = r.offset
      if (!r.complete) break
    } catch {
      state.offsets[f.key] = f.size
    }
    processed++
  }
  if (state.seen.length > MAX_SEEN) state.seen = state.seen.slice(-MAX_SEEN)
  // Files that left the window (or were deleted) need no offset any more.
  if (only === undefined && files.length > 0) {
    const live = new Set(files.map((f) => f.key))
    for (const k of Object.keys(state.offsets)) if (!live.has(k)) delete state.offsets[k]
  }
  const keys = Object.keys(state.offsets)
  if (keys.length > MAX_OFFSETS) for (const k of keys.slice(0, keys.length - MAX_OFFSETS)) delete state.offsets[k]
  return { done: processed === todo.length, files: files.length - (todo.length - processed), total: files.length, changed: processed > 0 }
}

/** The newest top-level transcript of a project: its current session. */
export function pickSession(files: FileRef[], dir: string): FileRef | null {
  return files.filter((f) => f.agent === 'claude' && f.dir === dir && !f.sub).sort((a, b) => b.mtime - a.mtime)[0] ?? null
}

/** Projects by recent activity: folder name, label and last activity. */
export function listProjects(files: FileRef[], names: Record<string, string>): { slug: string; label: string; last: number }[] {
  const last = new Map<string, number>()
  for (const f of files) if (f.agent === 'claude') last.set(f.dir, Math.max(last.get(f.dir) ?? 0, f.mtime))
  return [...last]
    .map(([slug, l]) => ({ slug, label: projectLabel(slug, names[slug]), last: l }))
    .sort((a, b) => b.last - a.last)
}

/** The project name seen in the transcripts; until one is known, the folder name without its leading hyphen. */
export function projectLabel(slug: string, name?: string): string {
  return (name && name !== '' ? name : slug.replace(/^-+/, '')).slice(0, 60)
}


/** Reads stored history defensively; an older format is dropped (it lacks the project attribution) but the reset point stays. */
export function parseHistory(raw: unknown): HistoryState {
  const base = emptyHistory()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Record<string, unknown>
  const from = typeof r.from === 'number' && Number.isFinite(r.from) ? r.from : 0
  if (r.v !== HISTORY_VERSION) return { ...base, from }
  const offsets: Record<string, number> = Object.create(null)
  if (typeof r.offsets === 'object' && r.offsets !== null) {
    for (const [k, v] of Object.entries(r.offsets)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) offsets[k] = v
  }
  const seen = Array.isArray(r.seen) ? r.seen.filter((x): x is string => typeof x === 'string').map(shortId) : []
  const projects: Record<string, string> = Object.create(null)
  if (typeof r.projects === 'object' && r.projects !== null) {
    // Older versions stored whole paths; keep the project name only.
    for (const [k, v] of Object.entries(r.projects)) if (typeof v === 'string') projects[k] = basename(v).slice(0, 60)
  }
  return { v: HISTORY_VERSION, offsets, seen, from, stats: parseStats(r.stats), projects }
}
