// Counts agent calls (skills, MCP, subagents, tools), imports past sessions and compares both with the inventory.
import type { Snapshot, View } from 'orca'
import { basename } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { homedir } from 'node:os'
import { emptyHistory, importHistory, listProjects, listSessionFiles, parseHistory, pickSession, type FileRef, type HistoryState, type Progress } from './history'
import { scanInventory, scanProjectNames, scanProjectParents, type Item } from './inventory'
import { loadJson, saveJson } from './store'
import { demoSnapshot } from './demo'
import { mergeRows } from './merge'
import { add, classify, countIn, dayOf, emptyStats, mergeStats, parseStats, projKey, prune, type Stats } from './usage'

const HIST = 'hist'
const LIVE = 'live'
const SCAN_TTL = 60_000
const DAY = 86_400_000
const RANGES = [7, 30, 90]
const SLICE_MS = 3000

/** The panel is untrusted input: only known values get through. */
function normalizeView(raw: unknown): View {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { range: typeof v.range === 'number' ? v.range : 30, scope: typeof v.scope === 'string' ? v.scope.slice(0, 300) : 'all' }
}

/** The home folder to read. `SKILL_USAGE_HOME` exists for tests only. */
const homeDir = (): string => process.env.SKILL_USAGE_HOME ?? homedir()

export default function activate(orca: OrcaWorkerApi): void {
  // All writes run one after another, otherwise parallel calls would be lost (reset included).
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job)
    queue = run.catch(() => undefined)
    return run
  }
  let items: Item[] = []
  let projectNames: Record<string, string> = {}
  let projectParents: Record<string, string> = {}
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
    hist = parseHistory(await loadJson(orca.storage, HIST))
    live = parseStats(await loadJson(orca.storage, LIVE))
  })

  async function rescan(force: boolean): Promise<void> {
    if (!force && scannedAt !== null && Date.now() - scannedAt < SCAN_TTL) return
    try {
      items = await scanInventory(homeDir())
      projectNames = await scanProjectNames(homeDir())
      projectParents = await scanProjectParents(homeDir())
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

  let lastSave = 0
  let dirty = false

  async function saveHist(): Promise<void> {
    if (hist === null) return
    prune(hist.stats, Date.now())
    await saveJson(orca.storage, HIST, hist)
    lastSave = Date.now()
    dirty = false
  }

  async function saveLive(): Promise<void> {
    if (live === null) return
    prune(live, Date.now())
    await saveJson(orca.storage, LIVE, live)
  }

  /** Live counters are small but arrive often: write them at most every 5 seconds. */
  let liveTimer: ReturnType<typeof setTimeout> | null = null
  function saveLiveSoon(): void {
    if (liveTimer !== null) return
    liveTimer = setTimeout(() => {
      liveTimer = null
      void enqueue(saveLive).catch(() => orca.log('could not save live counters'))
    }, 5000)
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
        progress = await importHistory(state, homeDir(), Date.now(), SLICE_MS)
        // The history is large: save only when something was read, every 15 seconds during the first import and at the end.
        if (progress.changed) dirty = true
        if (dirty && (progress.done || Date.now() - lastSave > 15_000)) await enqueue(saveHist)
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
  type Scoped = { state: HistoryState; progress: Progress; running: boolean; checked: number; cancelled: boolean }
  const scoped = new Map<string, Scoped>()
  let files: FileRef[] = []
  let filesAt = 0

  async function currentFiles(): Promise<FileRef[]> {
    if (Date.now() - filesAt > 10_000) {
      files = await listSessionFiles(homeDir(), Date.now())
      filesAt = Date.now()
    }
    return files
  }

  /** Stops a running import and forgets the entry. */
  function dropScoped(key: string): void {
    const e = scoped.get(key)
    if (e !== undefined) e.cancelled = true
    scoped.delete(key)
  }
  function clearScoped(): void {
    for (const key of [...scoped.keys()]) dropScoped(key)
  }

  /** Starts (or refreshes) the background import for one project or session; returns what is there so far. */
  function scopedState(key: string, only: (f: FileRef) => boolean): Scoped {
    let entry = scoped.get(key)
    if (entry === undefined) {
      // A reset moves `from`, so project and session numbers start from it as well.
      entry = { state: { ...emptyHistory(), from: hist?.from ?? 0 }, progress: { done: false, files: 0, total: 0 }, running: false, checked: 0, cancelled: false }
      scoped.set(key, entry)
      // Keep a few only; the oldest goes first.
      if (scoped.size > 6) dropScoped(scoped.keys().next().value as string)
    }
    const e = entry
    if (!e.running && Date.now() - e.checked > 10_000) {
      e.running = true
      void (async () => {
        try {
          for (;;) {
            e.progress = await importHistory(e.state, homeDir(), Date.now(), SLICE_MS, only)
            if (e.cancelled) break
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
    // Demo numbers for screenshots: only when the storage key `demo` is true.
    if ((await orca.storage.get('demo')) === true) return demoSnapshot(normalizeView(view))
    await rescan(force)
    view = normalizeView(view)
    const range = view.range === 0 || RANGES.includes(view.range) ? view.range : 30
    const since = range === 0 ? null : dayOf(Date.now() - (range - 1) * DAY)
    const all = await currentFiles()
    // A project is named after the folder you work in: the name seen in its sessions, else the one registered in
    // ~/.claude.json, and for the focused workspace the folder of that workspace.
    // The registered folder wins: a session can cd into a sub folder, which would then show up as the name.
    // Null prototype: a folder named like an object method must not break the lookup.
    const names: Record<string, string> = Object.assign(Object.create(null), hist?.projects ?? {}, projectNames)
    const focusedSlug = focusedPath === null ? null : focusedPath.replace(/[^a-zA-Z0-9]/g, '-')
    const named = listProjects(all, names).map((p) => ({ ...p, base: p.slug === focusedSlug && focusedPath !== null ? basename(focusedPath).slice(0, 60) : p.label }))
    // Two projects with the same folder name get their parent folder (or a short mark) so the picker can tell them apart.
    const sameName = new Map<string, number>()
    for (const p of named) sameName.set(p.base, (sameName.get(p.base) ?? 0) + 1)
    const projects = named.map((p) => ({ ...p, label: (sameName.get(p.base) ?? 0) > 1 ? (projectParents[p.slug] ? `${projectParents[p.slug]}/${p.base}` : `${p.base} #${projKey(p.slug).slice(0, 3)}`) : p.base }))
    // "Current" follows the focused workspace; without a match the project with the newest session counts.
    const focused = focusedSlug === null ? null : projects.find((p) => p.slug === focusedSlug) ?? null
    const current = focused ?? projects[0] ?? null
    const wanted = view.scope === 'all' ? null : view.scope === 'current' ? current : projects.find((p) => p.slug === view.scope) ?? null
    // A session always belongs to a project: with "all projects" the newest one is used.
    const project = wanted ?? (range === 0 ? current : null)
    const sessionFile = range === 0 && project !== null ? pickSession(all, project.slug) : null

    let stats: Stats
    let importing = progress
    if (sessionFile !== null) {
      // The session file and the files of its subagents.
      const e = scopedState(`session:${sessionFile.key}`, (f) => f.agent === 'claude' && f.dir === sessionFile.dir && f.session === sessionFile.session)
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
    const base = project === null ? null : project.base
    const shown = items.filter((i) => i.scope === 'global' || base === null || i.source === `project:${base}` || (i.also ?? []).includes(`project:${base}`))
    const counted = Object.entries(stats.tools)
      .map(([name, e]) => {
        const c = countIn(e, since)
        return { name, count: c.auto + c.direct }
      })
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count)
    const tools = counted.slice(0, 12)
    // The total covers every tool, not just the twelve shown.
    const toolCalls = counted.reduce((n, t) => n + t.count, 0)
    const rowsOut = mergeRows(shown, stats, since)
    // Where an entry was used: all projects, whatever period or project the pickers show.
    const everywhere = mergeStats(hist?.stats ?? emptyStats(), live ?? emptyStats())
    const wherever = new Map(mergeRows(shown, everywhere, dayOf(Date.now() - 89 * DAY)).map((r) => [`${r.kind}:${r.id}`, r]))
    const projectByKey = new Map(projects.map((p) => [projKey(p.slug), p.label]))
    for (const r of rowsOut) {
      const keys = wherever.get(`${r.kind}:${r.id}`)?.usedInKeys ?? []
      const usedIn = keys.flatMap(([key, n]) => (projectByKey.has(key) ? [{ label: projectByKey.get(key) as string, n }] : []))
      if (usedIn.length > 0) r.usedIn = usedIn
      delete r.usedInKeys
    }
    const out = {
      range,
      project: project === null ? null : { slug: project.slug, label: project.label },
      current: current === null ? null : { slug: current.slug, label: current.label },
      projects: projects.slice(0, 20).map((p) => ({ slug: p.slug, label: p.label })),
      session: sessionFile === null ? null : { last: sessionFile.mtime },
      scannedAt,
      rows: rowsOut,
      tools,
      toolCalls,
      importing
    }
    // The JSON round trip drops `undefined`, which the host API rejects in an answer.
    return JSON.parse(JSON.stringify(out)) as Snapshot
  }

  /** Looks up the folder of the focused workspace; the panel then reloads its numbers. */
  let focusSeq = 0
  async function followFocus(context: { branch: string; displayName: string } | null): Promise<void> {
    const seq = ++focusSeq
    let next: string | null = null
    if (context !== null) {
      try {
        const { workspaces } = await orca.host.call('workspace.list')
        const sameName = workspaces.filter((w) => w.name === context.displayName)
        // The branch decides between workspaces of the same name; a lone name match is enough.
        const hit = sameName.find((w) => (w.branch ?? '') === context.branch) ?? (sameName.length === 1 ? sameName[0] : undefined)
        next = hit?.path ?? null
      } catch {
        // The host did not answer: keep what we know instead of forgetting the focus.
        return
      }
    }
    // A later event may have answered first.
    if (seq !== focusSeq || next === focusedPath) return
    focusedPath = next
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
    // Codex writes rollouts that the importer reads, so its skill reads are not counted live as well.
    if (call === null || (call.bucket === 'skills' && /codex/i.test(event.agent))) return
    void enqueue(async () => {
      await ready
      if (live !== null) add(live, call.bucket, call.id, event.agent, Date.now())
    })
      .then(() => {
        saveLiveSoon()
        signal()
      })
      .catch(() => orca.log('could not record a call'))
  })

  orca.panels.handle('usage.get', (view: View) => {
    // Read new session lines in the background (first look, or when the last import is a minute old).
    if (!importing && Date.now() - lastImport > 60_000) scheduleImport(200)
    return snapshot(normalizeView(view))
  })
  orca.panels.handle('inventory.scan', (view) => {
    scheduleImport(200)
    clearScoped()
    return snapshot(normalizeView(view), true)
  })
  orca.panels.handle('usage.reset', (view) =>
    enqueue(async () => {
      await ready
      // In place: a running import keeps writing into the same object, so nothing old sneaks back in.
      if (hist !== null) {
        hist.stats = emptyStats()
        hist.seen = []
        hist.from = Date.now()
      }
      live = emptyStats()
      clearScoped()
      dirty = true
      await saveHist()
      await saveLive()
    }).then(() => snapshot(normalizeView(view)))
  )
}
