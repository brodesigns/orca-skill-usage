// Demo numbers for screenshots and the README. Generic names only, no real skills, projects or customers.
// Switched on by the storage key `demo` (set it to true), never by default.
import type { Snapshot, View } from 'orca'

const NOW = (): number => Date.now()
type Row = Snapshot['rows'][number]

const base = { scope: 'global' as const, tracked: true, manual: false, installed: true, auto: 0, direct: 0, last: null, byAgent: {}, agents: ['claude'] }

function row(r: Partial<Row> & Pick<Row, 'kind' | 'id'>): Row {
  return { ...base, label: r.id, source: 'user', tokens: 0, ...r } as Row
}

export function demoSnapshot(view: View): Snapshot {
  const projects = [
    { slug: '-demo-shop-site', label: 'shop-site' },
    { slug: '-demo-docs-portal', label: 'docs-portal' },
    { slug: '-demo-newsletter', label: 'newsletter' }
  ]
  const rows: Row[] = [
    row({ kind: 'skill', id: 'seo-audit', tokens: 96, auto: 24, direct: 3, byAgent: { claude: 27 }, usedIn: [{ label: 'shop-site', n: 41 }, { label: 'docs-portal', n: 9 }], agents: ['claude', 'codex'], note: 'content:1420' }),
    row({ kind: 'skill', id: 'pdf-export', tokens: 81, auto: 11, direct: 0, byAgent: { claude: 8, codex: 3 }, usedIn: [{ label: 'docs-portal', n: 36 }], agents: ['claude', 'codex'], note: 'content:880' }),
    row({ kind: 'skill', id: 'release-notes', tokens: 74, auto: 6, direct: 2, byAgent: { claude: 8 }, usedIn: [{ label: 'newsletter', n: 12 }, { label: 'shop-site', n: 3 }], note: 'content:640' }),
    row({ kind: 'skill', id: 'image-resize', tokens: 62, auto: 0, direct: 0, usedIn: [{ label: 'shop-site', n: 4 }], note: 'content:520' }),
    row({ kind: 'skill', id: 'data-migration', tokens: 88, auto: 0, direct: 0, note: 'content:1210' }),
    row({ kind: 'skill', id: 'quarterly-report', tokens: 0, manual: true, auto: 0, direct: 0, note: 'content:700' }),
    row({ kind: 'skill', id: 'invoice-helper', tokens: 70, scope: 'project', source: 'project:shop-site', auto: 7, direct: 0, byAgent: { claude: 7 }, usedIn: [{ label: 'shop-site', n: 7 }], note: 'content:560' }),
    row({ kind: 'mcp', id: 'docs-server', tokens: null, auto: 15, direct: 0, source: 'global', byAgent: { claude: 15 }, usedIn: [{ label: 'docs-portal', n: 58 }, { label: 'newsletter', n: 4 }], note: 'tools:2:search, fetch' }),
    row({ kind: 'mcp', id: 'ticket-tracker', tokens: null, auto: 0, direct: 0, source: 'global' }),
    row({ kind: 'mcp', id: 'cms-connector', tokens: null, scope: 'project', source: 'project:shop-site', auto: 9, direct: 0, byAgent: { claude: 9 }, usedIn: [{ label: 'shop-site', n: 33 }] }),
    row({ kind: 'agent', id: 'code-reviewer', tokens: 54, auto: 4, direct: 0, byAgent: { claude: 4 }, usedIn: [{ label: 'shop-site', n: 10 }, { label: 'docs-portal', n: 6 }] }),
    row({ kind: 'agent', id: 'research-helper', tokens: 47, auto: 0, direct: 0 }),
    row({ kind: 'plugin', id: 'frontend-tools', source: 'marketplace:community', tokens: 312, auto: 5, direct: 0, byAgent: { claude: 5 }, note: 'enabled' }),
    row({ kind: 'memory', id: 'CLAUDE.md', label: 'Global CLAUDE.md', tokens: 640 })
  ]
  const range = view.range === 0 || [7, 30, 90].includes(view.range) ? view.range : 30
  // One project chosen: its own entries only, and the calls that happened there.
  const chosen = view.scope === 'all' ? null : projects.find((p) => p.slug === view.scope || (view.scope === 'current' && p.slug === projects[0].slug)) ?? null
  const shown = chosen === null
    ? rows
    : rows
        .filter((r) => r.scope === 'global' || r.source === `project:${chosen.label}`)
        .map((r) => {
          const n = r.usedIn?.find((p) => p.label === chosen.label)?.n ?? 0
          return { ...r, auto: n, direct: 0, byAgent: n > 0 ? { claude: n } : {} }
        })
  return {
    range,
    project: chosen,
    current: projects[0],
    projects,
    session: null,
    scannedAt: NOW(),
    rows: shown,
    // One project sees only a part of the tool calls.
    tools: [
      { name: 'Bash', count: 1840 },
      { name: 'Read', count: 1210 },
      { name: 'Edit', count: 640 },
      { name: 'Grep', count: 410 },
      { name: 'Write', count: 120 }
    ].map((x) => ({ ...x, count: chosen === null ? x.count : Math.round(x.count * 0.35) })),
    toolCalls: chosen === null ? 4220 : 1480,
    importing: { done: true, files: 1, total: 1 }
  }
}
