// Counts agent calls (skills, MCP, subagents, tools), imports past sessions and compares both with the inventory.
import type { Snapshot, View } from 'orca'
import type { OrcaWorkerApi } from 'orca/worker'
import { homedir } from 'node:os'
import { emptyHistory, importHistory, listProjects, listSessionFiles, pickSession, type FileRef, type HistoryState, type Progress } from './history'
import { scanInventory, type Item } from './inventory'
import { mergeRows } from './merge'
import { add, classify, countIn, dayOf, emptyStats, mergeStats, parseStats, prune, type Stats } from './usage'

const HIST = 'hist'
const LIVE = 'live'
const SCAN_TTL = 60_000
const DAY = 86_400_000
const RANGES = [7, 30, 90]
const SLICE_MS = 3000

function parseHistory(raw: unknown): HistoryState {
  const base = emptyHistory()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Record<string, unknown>
  const offsets: Record<string, number> = Object.create(null)
  if (typeof r.offsets === 'object' && r.offsets !== null) {
    for (const [k, v] of Object.entries(r.offsets)) if (typeof v === 'number' && Number.isFinite(v)) offsets[k] = v
  }
  const seen = Array.isArray(r.seen) ? r.seen.filter((x): x is string => typeof x === 'string') : []
  const projects: Record<string, string> = Object.create(null)
  if (typeof r.projects === 'object' && r.projects !== null) {
    for (const [k, v] of Object.entries(r.projects)) if (typeof v === 'string') projects[k] = v
  }
  return { offsets, seen, from: typeof r.from === 'number' ? r.from : 0, stats: parseStats(r.stats), projects }
}

export default function activate(orca: OrcaWorkerApi): void {
  // All writes run one after another, otherwise parallel calls would be lost (reset included).
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job)
    queue = run.catch(() => undefined)
    return run
  }
  let items: Item[] = []
  let scannedAt: number | null = null
  let hist: HistoryState | null = null
  let live: Stats | null = null
  let progress: Progress = { done: false, files: 0, total: 0 }
  let importing = false
  let lastImport = 0
  let importTimer: ReturnType<typeof setTimeout> | null = null
  let signalTimer: ReturnType<typeof setTimeout> | null = null
  // Folder of the workspace that has focus in Orca; null = unknown, then the newest session decides.
  let focusedPath: string | null = null

  const ready = enqueue(async () => {
    hist = parseHistory(await orca.storage.get(HIST))
    live = parseStats(await orca.storage.get(LIVE))
  })

  async function rescan(force: boolean): Promise<void> {
    if (!force && scannedAt !== null && Date.now() - scannedAt < SCAN_TTL) return
    try {
      items = await scanInventory()
      scannedAt = Date.now()
    } catch {
      orca.log('inventory scan failed')
    }
  }

  /** At most one small signal per second; the panel then asks for the data itself. */
  function signal(): void {
    if (signalTimer !== null) return
    signalTimer = setTimeout(() => {
      signalTimer = null
      orca.panels.post('usage.changed', {})
    }, 1000)
  }

  async function save(): Promise<void> {
    if (hist === null || live === null) return
    prune(hist.stats, Date.now())
    prune(live, Date.now())
    await orca.storage.set(HIST, JSON.parse(JSON.stringify(hist)))
    await orca.storage.set(LIVE, JSON.parse(JSON.stringify(live)))
  }

  /** Imports past sessions in slices, so requests stay responsive. */
  async function runImport(): Promise<void> {
    if (importing) return
    importing = true
    try {
      await ready
      for (;;) {
        const state = hist
        if (state === null) return
        progress = await importHistory(state, homedir(), Date.now(), SLICE_MS)
        await enqueue(save)
        signal()
        if (progress.done) break
      }
    } catch (error) {
      orca.log(`history import failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`)
      progress = { ...progress, done: true }
    } finally {
      importing = false
      lastImport = Date.now()
    }
  }

  function scheduleImport(delay: number): void {
    if (importTimer !== null) return
    importTimer = setTimeout(() => {
      importTimer = null
      void runImport()
    }, delay)
  }

  // Project and session numbers are computed on demand from the session files and kept in memory only.
  type Scoped = { state: HistoryState; progress: Progress; running: boolean; checked: number }
  const scoped = new Map<string, Scoped>()
  let files: FileRef[] = []
  let filesAt = 0

  async function currentFiles(): Promise<FileRef[]> {
    if (Date.now() - filesAt > 10_000) {
      files = await listSessionFiles(homedir(), Date.now())
      filesAt = Date.now()
    }
    return files
  }

  /** Starts (or refreshes) the background import for one project or session; returns what is there so far. */
  function scopedState(key: string, only: (f: FileRef) => boolean): Scoped {
    let entry = scoped.get(key)
    if (entry === undefined) {
      entry = { state: emptyHistory(), progress: { done: false, files: 0, total: 0 }, running: false, checked: 0 }
      scoped.set(key, entry)
      // Keep a few only; the oldest goes first.
      if (scoped.size > 6) scoped.delete(scoped.keys().next().value as string)
    }
    const e = entry
    if (!e.running && Date.now() - e.checked > 10_000) {
      e.running = true
      void (async () => {
        try {
          for (;;) {
            e.progress = await importHistory(e.state, homedir(), Date.now(), SLICE_MS, only)
            signal()
            if (e.progress.done) break
          }
        } catch {
          orca.log('scoped import failed')
          e.progress = { ...e.progress, done: true }
        } finally {
          e.running = false
          e.checked = Date.now()
        }
      })()
    }
    return e
  }

  async function snapshot(view: View, force = false): Promise<Snapshot> {
    await ready
    await rescan(force)
    const range = view.range === 0 || RANGES.includes(view.range) ? view.range : 30
    const since = range === 0 ? null : dayOf(Date.now() - (range - 1) * DAY)
    const all = await currentFiles()
    const paths = hist?.projects ?? {}
    const projects = listProjects(all, paths)
    // "Current" follows the focused workspace; without a match the project with the newest session counts.
    const focused = focusedPath === null ? null : projects.find((p) => paths[p.slug] === focusedPath || p.slug === focusedPath!.replace(/[^a-zA-Z0-9]/g, '-')) ?? null
    const current = focused ?? projects[0] ?? null
    const wanted = view.scope === 'all' ? null : view.scope === 'current' ? current : projects.find((p) => p.slug === view.scope) ?? null
    // A session always belongs to a project: with "all projects" the newest one is used.
    const project = wanted ?? (range === 0 ? current : null)
    const sessionFile = range === 0 && project !== null ? pickSession(all, project.slug) : null

    let stats: Stats
    let importing = progress
    if (sessionFile !== null) {
      const e = scopedState(`session:${sessionFile.path}`, (f) => f.path === sessionFile.path)
      stats = e.state.stats
      importing = e.progress
    } else if (project !== null) {
      const slug = project.slug
      const e = scopedState(`project:${slug}`, (f) => f.dir === slug)
      stats = e.state.stats
      importing = e.progress
    } else {
      stats = mergeStats(hist?.stats ?? emptyStats(), live ?? emptyStats())
    }

    // Other projects' own skills do not apply here.
    const label = project === null ? null : project.label
    const shown = items.filter((i) => i.scope === 'global' || label === null || i.source === `project:${label}`)
    const tools = Object.entries(stats.tools)
      .map(([name, e]) => {
        const c = countIn(e, since)
        return { name, count: c.auto + c.direct }
      })
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
    const out = {
      range,
      project: project === null ? null : { slug: project.slug, label: project.label },
      projects: projects.slice(0, 20).map((p) => ({ slug: p.slug, label: p.label })),
      session: sessionFile === null ? null : { last: sessionFile.mtime },
      scannedAt,
      rows: mergeRows(shown, stats, since),
      tools,
      importing
    }
    // The JSON round trip drops `undefined`, which the host API rejects in an answer.
    return JSON.parse(JSON.stringify(out)) as Snapshot
  }

  /** Looks up the folder of the focused workspace; the panel then reloads its numbers. */
  async function followFocus(context: { branch: string; displayName: string } | null): Promise<void> {
    let next: string | null = null
    try {
      if (context !== null) {
        const { workspaces } = await orca.host.call('workspace.list')
        const hit = workspaces.find((w) => w.name === context.displayName && (w.branch ?? '') === context.branch) ?? workspaces.find((w) => w.name === context.displayName)
        next = hit?.path ?? null
      }
    } catch {
      next = null
    }
    if (next === focusedPath) return
    focusedPath = next
    scoped.clear()
    signal()
  }
  orca.events.on('workspace.changed', (e) => followFocus(e.context))

  orca.hooks.on('agent.tool.after', (event) => {
    // Claude Code is read from its session files (they also hold typed commands), so live calls count only for other agents.
    if (/claude/i.test(event.agent)) {
      scheduleImport(15_000)
      return
    }
    const call = classify(event.tool, event.input, event.agent)
    if (call === null) return
    void enqueue(async () => {
      await ready
      if (live !== null) add(live, call.bucket, call.id, event.agent, Date.now())
      await save()
    })
      .then(signal)
      .catch(() => orca.log('could not record a call'))
  })

  orca.panels.handle('usage.get', (view) => {
    // Read new session lines in the background (first look, or when the last import is a minute old).
    if (!importing && Date.now() - lastImport > 60_000) scheduleImport(200)
    return snapshot(view)
  })
  orca.panels.handle('inventory.scan', (view) => {
    scheduleImport(200)
    scoped.clear()
    return snapshot(view, true)
  })
  orca.panels.handle('usage.reset', (view) =>
    enqueue(async () => {
      await ready
      if (hist !== null) hist = { ...hist, stats: emptyStats(), seen: [], from: Date.now() }
      live = emptyStats()
      await save()
    }).then(() => snapshot(view))
  )
}
