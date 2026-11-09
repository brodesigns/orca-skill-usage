// Pure logic, no Orca API (easy to test).
/** Calls per day: [made by the model, typed by the person]. */
export type Day = [number, number]
export type Entry = { last: number; by: Record<string, number>; days: Record<string, Day> }
export type Bucket = Record<string, Entry>
/** `cmds` holds slash commands the person typed; they are matched to skills when rows are built. */
export type Stats = { skills: Bucket; mcp: Bucket; agents: Bucket; tools: Bucket; cmds: Bucket }
export type BucketName = keyof Stats
export type Mode = 'auto' | 'direct'

const BUCKETS: BucketName[] = ['skills', 'mcp', 'agents', 'tools', 'cmds']

export const emptyStats = (): Stats => ({
  skills: Object.create(null),
  mcp: Object.create(null),
  agents: Object.create(null),
  tools: Object.create(null),
  cmds: Object.create(null)
})

const MAX_PER_BUCKET = 500
const EVICT_AT = 650
const MAX_NAME = 120
const MAX_AGENTS = 20
export const KEEP_DAYS = 100

export type Call =
  | { bucket: 'skills' | 'agents' | 'tools'; id: string }
  | { bucket: 'mcp'; id: string; server: string }

function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/^\//, '').slice(0, MAX_NAME)
  return s === '' ? null : s
}

function field(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)[key]
    : undefined
}

const SKILL_FILE = /skills\/([A-Za-z0-9._-]{1,120})\/SKILL\.md/

/** `YYYY-MM-DD` (UTC) of a timestamp, or null. */
export function dayOf(ts: number | string): string | null {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * Sorts a tool call into skill, MCP server, subagent or plain tool.
 * Agents without a Skill tool (Codex) load a skill by reading its SKILL.md, which counts as a skill call.
 */
export function classify(tool: string, input: unknown, agent = 'claude'): Call | null {
  if (typeof tool !== 'string') return null
  const lower = tool.toLowerCase()
  if (lower === 'skill') {
    const id = clean(field(input, 'skill') ?? field(input, 'name'))
    return id === null ? null : { bucket: 'skills', id }
  }
  if (lower.startsWith('mcp__')) {
    const [, server, ...rest] = tool.split('__')
    const name = clean(server)
    if (name === null) return null
    return { bucket: 'mcp', id: `${name}/${rest.join('__')}`.slice(0, MAX_NAME * 2), server: name }
  }
  if (lower === 'agent' || lower === 'task') {
    const id = clean(field(input, 'subagent_type')) ?? 'general-purpose'
    return { bucket: 'agents', id }
  }
  if (!/claude/i.test(agent)) {
    let text = ''
    try {
      text = JSON.stringify(input ?? '').slice(0, 4000)
    } catch {
      /* not JSON-safe: not a skill read */
    }
    const m = SKILL_FILE.exec(text)
    if (m) return { bucket: 'skills', id: m[1] }
  }
  const id = clean(tool)
  return id === null ? null : { bucket: 'tools', id }
}

/** Adds one call to `stats` IN PLACE (a large import must not copy the bucket per call). */
export function add(stats: Stats, bucket: BucketName, id: string, agent: string, ts: number, mode: Mode = 'auto'): void {
  const day = dayOf(ts)
  if (day === null) return
  const b = stats[bucket]
  const e = (b[id] ??= { last: 0, by: Object.create(null), days: Object.create(null) })
  const who = String(agent).slice(0, 40)
  if (who in e.by || Object.keys(e.by).length < MAX_AGENTS) e.by[who] = (e.by[who] ?? 0) + 1
  const d = (e.days[day] ??= [0, 0])
  d[mode === 'auto' ? 0 : 1] += 1
  if (ts > e.last) e.last = ts
  if (Object.keys(b).length > EVICT_AT) evict(b)
}

/** The rarest and oldest entries go first. */
function evict(b: Bucket): void {
  const total = (e: Entry) => Object.values(e.days).reduce((n, d) => n + d[0] + d[1], 0)
  const ids = Object.keys(b).sort((x, y) => total(b[x]) - total(b[y]) || b[x].last - b[y].last)
  for (const id of ids.slice(0, ids.length - MAX_PER_BUCKET)) delete b[id]
}

/** Drops day counters older than KEEP_DAYS and entries without any left. */
export function prune(stats: Stats, now: number): void {
  const oldest = dayOf(now - KEEP_DAYS * 86_400_000) ?? ''
  for (const name of BUCKETS) {
    for (const [id, e] of Object.entries(stats[name])) {
      for (const day of Object.keys(e.days)) if (day < oldest) delete e.days[day]
      if (Object.keys(e.days).length === 0) delete stats[name][id]
    }
  }
}

/** Calls of one entry since `sinceDay` (inclusive); null counts everything. */
export function countIn(e: Entry | undefined, sinceDay: string | null): { auto: number; direct: number } {
  let auto = 0
  let direct = 0
  if (e) {
    for (const [day, d] of Object.entries(e.days)) {
      if (sinceDay === null || day >= sinceDay) {
        auto += d[0]
        direct += d[1]
      }
    }
  }
  return { auto, direct }
}

/** Sum of two stats (history plus live counters) as a new object. */
export function mergeStats(a: Stats, b: Stats): Stats {
  const out = emptyStats()
  for (const name of BUCKETS) {
    for (const src of [a[name], b[name]]) {
      for (const [id, e] of Object.entries(src)) {
        const t = (out[name][id] ??= { last: 0, by: Object.create(null), days: Object.create(null) })
        t.last = Math.max(t.last, e.last)
        for (const [who, n] of Object.entries(e.by)) t.by[who] = (t.by[who] ?? 0) + n
        for (const [day, d] of Object.entries(e.days)) {
          const x = (t.days[day] ??= [0, 0])
          x[0] += d[0]
          x[1] += d[1]
        }
      }
    }
  }
  return out
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** Reads stored data defensively (old formats, broken values). */
export function parseStats(raw: unknown): Stats {
  const out = emptyStats()
  if (typeof raw !== 'object' || raw === null) return out
  for (const key of BUCKETS) {
    const b = (raw as Record<string, unknown>)[key]
    if (typeof b !== 'object' || b === null) continue
    for (const [id, e] of Object.entries(b)) {
      const v = e as Partial<Entry>
      if (typeof v !== 'object' || v === null || typeof v.days !== 'object' || v.days === null) continue
      const days: Record<string, Day> = Object.create(null)
      for (const [day, d] of Object.entries(v.days)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(d)) days[day] = [num(d[0]), num(d[1])]
      }
      const by: Record<string, number> = Object.create(null)
      if (typeof v.by === 'object' && v.by !== null) {
        for (const [a, n] of Object.entries(v.by)) if (typeof n === 'number' && Number.isFinite(n)) by[a] = n
      }
      out[key][id] = { last: num(v.last), by, days }
    }
  }
  return out
}
