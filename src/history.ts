// Imports past sessions: Claude Code transcripts and Codex rollouts. Reads only tool names, command
// names, timestamps and ids; no prompt or answer text is kept. Incremental by byte offset.
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { add, classify, dayOf, emptyStats, KEEP_DAYS, type Stats } from './usage'

export type HistoryState = {
  /** Bytes already processed per file name. */
  offsets: Record<string, number>
  /** Ids of recent skill/MCP/agent calls, so a resumed session that copies old lines counts once. */
  seen: string[]
  /** Lines older than this (ms) are ignored; set by "reset". */
  from: number
  stats: Stats
  /** Project folder name -> real path (first `cwd` seen), to label projects. */
  projects: Record<string, string>
}

export const emptyHistory = (): HistoryState => ({ offsets: {}, seen: [], from: 0, stats: emptyStats(), projects: Object.create(null) })

const CHUNK = 4 * 1024 * 1024
const MAX_SEEN = 20_000
const MAX_OFFSETS = 20_000
const MAX_FILES = 6000
const COMMAND = /^\s*<command-name>\/?([^<\s]{1,120})<\/command-name>/

export type FileRef = { path: string; name: string; /** Claude project folder; empty for Codex. */ dir: string; size: number; mtime: number; agent: 'claude' | 'codex' }

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function ref(path: string, name: string, dir: string, agent: FileRef['agent'], oldest: number): Promise<FileRef | null> {
  try {
    const info = await stat(path)
    return info.isFile() && info.mtimeMs >= oldest ? { path, name, dir, size: info.size, mtime: info.mtimeMs, agent } : null
  } catch {
    return null
  }
}

/** Recent session files, newest first. Codex files live in year/month/day folders. */
export async function listSessionFiles(home: string, now: number): Promise<FileRef[]> {
  const oldest = now - KEEP_DAYS * 86_400_000
  const out: (FileRef | null)[] = []
  const claudeRoot = join(home, '.claude', 'projects')
  for (const project of await listDir(claudeRoot)) {
    for (const file of await listDir(join(claudeRoot, project))) {
      if (file.endsWith('.jsonl')) out.push(await ref(join(claudeRoot, project, file), file, project, 'claude', oldest))
    }
  }
  const codexRoot = join(home, '.codex', 'sessions')
  for (const y of await listDir(codexRoot)) {
    for (const m of await listDir(join(codexRoot, y))) {
      for (const d of await listDir(join(codexRoot, y, m))) {
        for (const file of await listDir(join(codexRoot, y, m, d))) {
          if (file.endsWith('.jsonl')) out.push(await ref(join(codexRoot, y, m, d, file), file, '', 'codex', oldest))
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
      if (!line.includes('SKILL.md') || !line.includes('function_call') || line.includes('"session_meta"')) return
      if (line.includes('function_call_output')) return
      const ts = /^\{"timestamp":"([^"]+)"/.exec(line)?.[1]
      const call = classify('shell', line.slice(0, 4000), 'codex')
      const time = ts ? Date.parse(ts) : NaN
      if (call?.bucket === 'skills' && time >= state.from) add(state.stats, 'skills', call.id, 'codex', time)
      return
    }
    const isCommand = line.includes('<command-name>') && line.includes('"type":"user"')
    if (!isCommand && !line.includes('"tool_use"')) return
    const d = JSON.parse(line) as { type?: string; timestamp?: string; cwd?: unknown; message?: { content?: unknown } }
    if (dir !== '' && typeof d.cwd === 'string' && d.cwd.startsWith('/') && !(dir in state.projects)) state.projects[dir] = d.cwd.slice(0, 300)
    const time = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : NaN
    if (Number.isNaN(time) || time < state.from) return
    if (isCommand && d.type === 'user') {
      const m = COMMAND.exec(textOf(d.message?.content) ?? '')
      if (m) add(state.stats, 'cmds', m[1], 'claude', time, 'direct')
      return
    }
    if (d.type !== 'assistant' || !Array.isArray(d.message?.content)) return
    for (const part of d.message.content as { type?: string; id?: string; name?: string; input?: unknown }[]) {
      if (part?.type !== 'tool_use' || typeof part.name !== 'string') continue
      const call = classify(part.name, part.input, 'claude')
      if (call === null) continue
      // Resumed sessions copy old lines: skill, MCP and agent calls are counted once per id.
      if (call.bucket !== 'tools' && typeof part.id === 'string') {
        if (seen.has(part.id)) continue
        seen.add(part.id)
        state.seen.push(part.id)
      }
      add(state.stats, call.bucket, call.id, 'claude', time)
    }
  } catch {
    /* a broken line is skipped */
  }
}

/** Reads the new complete lines of a file from `start`; returns the new offset. */
async function readFrom(file: FileRef, start: number, onLine: (line: string) => void): Promise<number> {
  const handle = await open(file.path, 'r')
  try {
    let pos = start
    let carry = Buffer.alloc(0)
    const buf = Buffer.alloc(CHUNK)
    while (pos < file.size) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(CHUNK, file.size - pos), pos)
      if (bytesRead === 0) break
      pos += bytesRead
      let data = Buffer.concat([carry, buf.subarray(0, bytesRead)])
      const cut = data.lastIndexOf(0x0a)
      if (cut < 0) {
        carry = data
        continue
      }
      carry = Buffer.from(data.subarray(cut + 1))
      data = data.subarray(0, cut)
      for (const line of data.toString('utf8').split('\n')) if (line !== '') onLine(line)
      // Let other work (requests, hooks) run between chunks.
      await new Promise((r) => setImmediate(r))
    }
    return pos - carry.length
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export type Progress = { done: boolean; files: number; total: number }

/** Works through the files within `budgetMs`; call again until `done`. Mutates `state`. */
export async function importHistory(state: HistoryState, home: string, now: number, budgetMs: number, only?: (f: FileRef) => boolean): Promise<Progress> {
  const files = (await listSessionFiles(home, now)).filter((f) => only === undefined || only(f))
  const started = Date.now()
  const seen = new Set(state.seen)
  const todo = files.filter((f) => (state.offsets[f.name] ?? 0) < f.size)
  let processed = 0
  for (const f of todo) {
    if (Date.now() - started > budgetMs) break
    try {
      state.offsets[f.name] = await readFrom(f, state.offsets[f.name] ?? 0, (line) => processLine(state, line, f.agent, seen, f.dir))
    } catch {
      state.offsets[f.name] = f.size
    }
    processed++
  }
  if (state.seen.length > MAX_SEEN) state.seen = state.seen.slice(-MAX_SEEN)
  const names = Object.keys(state.offsets)
  if (names.length > MAX_OFFSETS) for (const n of names.slice(0, names.length - MAX_OFFSETS)) delete state.offsets[n]
  return { done: processed === todo.length, files: files.length - (todo.length - processed), total: files.length }
}

/** The newest top-level transcript of a project: its current session. */
export function pickSession(files: FileRef[], dir: string): FileRef | null {
  return files.filter((f) => f.agent === 'claude' && f.dir === dir).sort((a, b) => b.mtime - a.mtime)[0] ?? null
}

/** Projects by recent activity: folder name, label (last path segment) and last activity. */
export function listProjects(files: FileRef[], paths: Record<string, string>): { slug: string; label: string; last: number }[] {
  const last = new Map<string, number>()
  for (const f of files) if (f.agent === 'claude') last.set(f.dir, Math.max(last.get(f.dir) ?? 0, f.mtime))
  return [...last]
    .map(([slug, l]) => ({ slug, label: projectLabel(slug, paths[slug]), last: l }))
    .sort((a, b) => b.last - a.last)
}

/** Last segment of the real path; falls back to the folder name (path with slashes turned into hyphens). */
export function projectLabel(slug: string, path?: string): string {
  const segment = (path ?? '').split('/').filter(Boolean).pop()
  return (segment ?? slug.split('-').filter(Boolean).pop() ?? slug).slice(0, 60)
}

export { dayOf }
