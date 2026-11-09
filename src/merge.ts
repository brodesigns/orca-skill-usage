// Joins the inventory and the usage counts into panel rows (pure, testable).
import type { Item } from './inventory'
import { countIn, type Entry, type Stats } from './usage'

export type Row = {
  kind: Item['kind']
  id: string
  label: string
  source: string
  scope: Item['scope']
  /** The AIs the entry is installed for. */
  agents: string[]
  tokens: number | null
  manual: boolean
  installed: boolean
  /** Calls in the chosen range: made by the model / typed by the person. */
  auto: number
  direct: number
  last: number | null
  byAgent: Record<string, number>
  note?: string
}

/** Claude Code normalizes MCP names (hyphens become underscores). */
export const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '_')

type Use = { auto: number; direct: number; last: number | null; byAgent: Record<string, number> }

function use(entries: { e: Entry | undefined; since: string | null }[]): Use {
  const out: Use = { auto: 0, direct: 0, last: null, byAgent: Object.create(null) }
  for (const { e, since } of entries) {
    if (!e) continue
    const c = countIn(e, since)
    if (c.auto + c.direct === 0) continue
    out.auto += c.auto
    out.direct += c.direct
    out.last = Math.max(out.last ?? 0, e.last)
    for (const [a, n] of Object.entries(e.by)) out.byAgent[a] = (out.byAgent[a] ?? 0) + n
  }
  return out
}

const plain = (u: Use): Use => ({ ...u, byAgent: { ...u.byAgent } })

export function mergeRows(items: Item[], stats: Stats, since: string | null = null): Row[] {
  const rows: Row[] = []
  const claimed = { skills: new Set<string>(), cmds: new Set<string>(), agents: new Set<string>(), mcp: new Set<string>() }

  for (const it of items) {
    let u: Use = { auto: 0, direct: 0, last: null, byAgent: {} }
    let note = it.note
    if (it.kind === 'skill') {
      // Exact name first; the bare name only if no other row has claimed that key yet.
      const bare = it.id.split(':').pop() ?? it.id
      const pick = (bucket: 'skills' | 'cmds'): string[] => {
        if (stats[bucket][it.id]) return [it.id]
        return stats[bucket][bare] && !claimed[bucket].has(bare) ? [bare] : []
      }
      const sk = pick('skills')
      const cm = pick('cmds')
      sk.forEach((k) => claimed.skills.add(k))
      cm.forEach((k) => claimed.cmds.add(k))
      u = use([...sk.map((k) => ({ e: stats.skills[k], since })), ...cm.map((k) => ({ e: stats.cmds[k], since }))])
    } else if (it.kind === 'agent') {
      if (stats.agents[it.id]) claimed.agents.add(it.id)
      u = use([{ e: stats.agents[it.id], since }])
    } else if (it.kind === 'mcp') {
      const key = normalize(it.id)
      const hit = Object.entries(stats.mcp).filter(([id]) => !claimed.mcp.has(id) && normalize(id.split('/')[0]) === key)
      hit.forEach(([id]) => claimed.mcp.add(id))
      u = use(hit.map(([, e]) => ({ e, since })))
      const used = hit.filter(([, e]) => {
        const c = countIn(e, since)
        return c.auto + c.direct > 0
      })
      if (used.length) note = `tools:${used.length}:${used.map(([id]) => id.split('/').slice(1).join('/')).slice(0, 4).join(', ')}`
    }
    rows.push({ ...it, note, installed: true, ...plain(u) })
  }

  // Used but not found in the inventory (built-in agents, project skills, plugin servers).
  const orphan = (kind: Row['kind'], id: string, source: string, u: Use): void => {
    if (u.auto + u.direct > 0) rows.push({ kind, id, label: id, source, scope: 'global', agents: [], tokens: null, manual: false, installed: false, ...plain(u) })
  }
  for (const [id, e] of Object.entries(stats.skills)) {
    if (!claimed.skills.has(id)) orphan('skill', id, 'elsewhere', use([{ e, since }, { e: claimed.cmds.has(id) ? undefined : stats.cmds[id], since }]))
  }
  for (const [id, e] of Object.entries(stats.agents)) {
    if (!claimed.agents.has(id)) orphan('agent', id, 'builtin', use([{ e, since }]))
  }
  const servers = new Map<string, { e: Entry; since: string | null }[]>()
  for (const [id, e] of Object.entries(stats.mcp)) {
    if (claimed.mcp.has(id)) continue
    const server = id.split('/')[0]
    servers.set(server, [...(servers.get(server) ?? []), { e, since }])
  }
  for (const [server, list] of servers) orphan('mcp', server, 'connector', use(list))
  return rows
}
