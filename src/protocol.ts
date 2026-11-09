// The panel <-> worker contract, declared once.
export {}

declare module 'orca' {
  interface PluginRequests {
    /** Rows for a period (`range`: 0 = latest session, else the last 7, 30 or 90 days) and a `scope` (`all`, `current` or a project folder name). */
    'usage.get': { input: View; output: Snapshot }
    /** Re-reads the inventory from disk, then answers like `usage.get`. */
    'inventory.scan': { input: View; output: Snapshot }
    /** Starts counting from now: clears counters and ignores older history. */
    'usage.reset': { input: View; output: Snapshot }
  }
  interface PluginPanelEvents {
    /** Signal only; the panel then asks `usage.get`. */
    'usage.changed': Record<string, never>
  }

  interface View {
    range: number
    scope: string
  }

  type Kind = 'skill' | 'mcp' | 'agent' | 'plugin' | 'memory'

  /** One entry from the inventory, or from usage alone (then not installed). */
  interface Row {
    kind: Kind
    id: string
    label: string
    /** Source code: user, global, projects:N, project:name, plugin:name, marketplace:name, elsewhere, builtin, connector, or a folder name. */
    source: string
    /** Project items load only inside that project and stay out of the global totals. */
    scope: 'global' | 'project'
    /** The AIs the entry is installed for (claude, codex, gemini, agents); empty when only seen in use. */
    agents: string[]
    /** Estimated tokens the entry keeps in context permanently; null = unknown. */
    tokens: number | null
    /** Manual invocation only (costs nothing in context). */
    manual: boolean
    /** Found by the inventory scan. */
    installed: boolean
    /** Calls in the chosen range made by the model / typed by the person. */
    auto: number
    direct: number
    last: number | null
    /** Calls per AI in the period, as reported by the transcripts and hooks. */
    byAgent: Record<string, number>
    /** Note code: content:N, tools:N:list, enabled, disabled. The panel translates it. */
    note?: string
  }

  interface Snapshot {
    range: number
    /** The project the numbers belong to; null = all projects. */
    project: { slug: string; label: string } | null
    /** Recently active projects, newest first, for the picker. */
    projects: { slug: string; label: string }[]
    /** Latest session of the shown project (range 0): last activity in ms. */
    session: { last: number } | null
    scannedAt: number | null
    rows: Row[]
    /** Calls of the other tools (Bash, Read ...) in the range, by count. */
    tools: { name: string; count: number }[]
    /** Progress of the session import (history, project or session). */
    importing: { done: boolean; files: number; total: number }
  }
}
