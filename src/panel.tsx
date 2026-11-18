import { atom, Badge, Button, Callout, Card, Collapsible, EmptyState, Grid, Heading, Input, plugin, Progress, read, RelativeTime, Row as Line, Select, Separator, set, Stack, Switch, Tab, Tabs, Text, type PanelContext } from 'orca'
import { totalCalls } from './totals'
import { agentName, agentNames, dateLocale, note, source, t, type Key, type Lang } from './i18n'

const snap = atom<Snapshot | null>(null)
const tab = atom('tab', 'skill', { persist: 'plugin' })
const onlyUnused = atom('onlyUnused', false, { persist: 'plugin' })
const onlyGone = atom('onlyGone', false, { persist: 'plugin' })
const lang = atom<Lang>('lang', 'en', { persist: 'plugin' })
const range = atom('range', 30, { persist: 'plugin' })
const project = atom('project', 'all', { persist: 'plugin' })
const sortBy = atom('sortBy', 'usage', { persist: 'plugin' })
const scopeBy = atom('scopeBy', 'all', { persist: 'plugin' })
const agentSel = atom('agentSel', 'all', { persist: 'plugin' })
const query = atom('query', '')
const failed = atom('failed', false)
const showTiles = atom('showTiles', true, { persist: 'plugin' })
// The page of a list; another tab, filter, search or sort starts again at the first page.
// Cards with open details, by kind:id.
const openCards = atom<Record<string, boolean>>('openCards', {}, { persist: 'plugin' })
const page = atom<{ key: string; n: number }>('page', { key: '', n: 0 })

const view = (): View => ({ range: read(range), scope: read(project) })

function load(): void {
  void plugin
    .request('usage.get', view())
    .then((s) => {
      set(failed, false)
      set(snap, s)
    })
    .catch(() => set(failed, true))
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('usage.changed', load))
  load()
}

// Orca refuses a whole render past 5000 nodes and the fullest card takes about 26, so a page draws at most this many.
const MAX_CARDS = 100

const fmt = (n: number, l: Lang): string => n.toLocaleString(dateLocale(l))
const calls = (r: Row): number => r.auto + r.direct
const isTail = (r: Row): boolean => !r.installed || r.source === 'claudeBuiltin'
// Used, but no longer in the inventory: removed or moved (not the built-in and connector entries).
const isGone = (r: Row): boolean => !r.installed && r.source.startsWith('removed')

/** Unused = installed but never called in the period (only where usage data exists). */
const isUnused = (r: Row): boolean => r.installed && r.tracked && r.kind !== 'memory' && calls(r) === 0

const SORTS: Record<string, (a: Row, b: Row) => number> = {
  usage: (a, b) => calls(b) - calls(a) || (b.tokens ?? 0) - (a.tokens ?? 0),
  tokens: (a, b) => (b.tokens ?? 0) - (a.tokens ?? 0) || calls(b) - calls(a),
  name: (a, b) => a.label.localeCompare(b.label),
  recent: (a, b) => (b.last ?? 0) - (a.last ?? 0)
}

function Tile(p: { title: string; value: string; hint: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return (
    <Card title={p.title}>
      <Stack gap="xs">
        <Text size="md" weight="semibold" tone={p.tone}>{p.value}</Text>
        <Text muted size="xs">{p.hint}</Text>
      </Stack>
    </Card>
  )
}

/** Where an entry exists: global (loaded in every project) or in named projects. */
function existsText(r: Row, l: Lang): string {
  if (r.scope === 'global') return t(l, 'existsGlobal')
  const first = r.source.startsWith('project:') ? r.source.slice('project:'.length) : r.source
  const more = r.also?.length ?? 0
  return `${t(l, 'existsProject', { name: first })}${more > 0 ? ` ${t(l, 'alsoIn', { n: more })}` : ''}`
}

/** Where an entry was used, most calls first: `shop 40×, blog 3×`. */
function usedInText(r: Row, l: Lang): string {
  const list = r.usedIn ?? []
  const shown = list.slice(0, 4).map((p) => `${p.label} ${fmt(p.n, l)}×`).join(', ')
  return list.length > 4 ? `${shown} ${t(l, 'alsoIn', { n: list.length - 4 })}` : shown
}

function Tile2({ r, l }: { r: Row; l: Lang }) {
  const unused = isUnused(r)
  const n = calls(r)
  // Usage per AI, summed over raw names that map to the same AI.
  const used: Record<string, number> = {}
  for (const [a, c] of Object.entries(r.byAgent)) used[agentName(a)] = (used[agentName(a)] ?? 0) + c
  const usedBy = Object.entries(used).map(([a, c]) => `${a} ${c}×`).join(', ')
  const installed = agentNames(r.agents)
  // Without a file there is nothing to measure; an MCP server's cost depends on its tools.
  const tokens = r.tokens !== null ? t(l, 'tokens', { n: fmt(r.tokens, l) }) : !r.installed ? '' : r.kind === 'mcp' ? t(l, 'tokensMcp') : t(l, 'tokensUnknown')
  const parts = [source(l, r.source), tokens, r.manual ? t(l, 'manualOnly') : ''].filter(Boolean)
  const usedIn = usedInText(r, l)
  // The full text of a skill is loaded on each call: it costs something only in a period with calls (then calls x size).
  const content = r.note?.startsWith('content:') ? Number(r.note.slice(8)) : null
  const noteText = r.note === undefined ? '' : content === null ? note(l, r.note) : n > 0 && Number.isFinite(content) ? note(l, r.note, { total: fmt(content * n, l), calls: fmt(n, l) }) : ''
  // Name and description sit in every session of the AIs the entry is installed for: tokens x sessions in the period.
  const ss = read(snap)?.sessions ?? { claude: 0, codex: 0 }
  const sessionsOf = (r.agents.includes('claude') ? ss.claude : 0) + (r.agents.some((a) => a === 'codex' || a === 'agents') ? ss.codex : 0)
  const alwaysText = r.installed && r.scope === 'global' && r.kind !== 'plugin' && r.tokens !== null && r.tokens > 0 && sessionsOf > 0
    ? t(l, 'alwaysInPeriod', { n: fmt(r.tokens, l), sessions: fmt(sessionsOf, l), total: fmt(r.tokens * sessionsOf, l) })
    : ''
  const open = read(openCards)[`${r.kind}:${r.id}`] === true
  // Only open cards are kept, so the stored value stays small.
  const toggle = () => {
    const next = { ...read(openCards) }
    if (open) delete next[`${r.kind}:${r.id}`]
    else next[`${r.kind}:${r.id}`] = true
    set(openCards, next)
  }
  return (
    <Stack gap="xs">
      <Stack gap="xs">
        <Line justify="between" align="center" gap="xs">
          <Line gap="xs" align="center" wrap>
            <Text weight="semibold">{r.label}</Text>
            <Badge tone={unused ? 'warning' : n > 0 ? 'success' : 'neutral'}>
              {n > 0 ? t(l, 'usedTimes', { n: fmt(n, l) }) : r.kind === 'memory' ? t(l, 'alwaysBadge') : r.installed ? (r.tracked ? t(l, 'unused') : t(l, 'noData')) : t(l, 'notInstalled')}
            </Badge>
            {r.manual ? <Badge>{t(l, 'freeBadge')}</Badge> : null}
            {!r.installed ? <Badge>{t(l, 'usageOnly')}</Badge> : null}
          </Line>
          <Button variant="ghost" size="sm" onPress={toggle}>{`${t(l, 'details')} ${open ? '▴' : '▾'}`}</Button>
        </Line>
        <Text muted size="xs">{parts.join(' · ')}</Text>
        {r.direct > 0 ? <Text muted size="xs">{t(l, 'split', { a: fmt(r.auto, l), d: fmt(r.direct, l) })}</Text> : null}
        {open ? (
          <Stack gap="xs">
            {r.last !== null ? (
              <Line gap="xs">
                <Text muted size="xs">{t(l, 'lastUsed')}</Text>
                <RelativeTime at={r.last} />
              </Line>
            ) : null}
            {r.installed ? <Text muted size="xs">{`${t(l, 'existsIn')}: ${existsText(r, l)}`}</Text> : null}
            {(r.dirs ?? []).map((d) => (
              <Line key={d} justify="between" align="center" gap="xs">
                <Text muted size="xs" truncate>{d}</Text>
                <Button variant="ghost" size="sm" icon="folder" onPress={() => void plugin.request('folder.open', { path: d })}>{t(l, 'openFolder')}</Button>
              </Line>
            ))}
            {isGone(r) ? <Text muted size="xs">{t(l, 'goneHint')}</Text> : null}
            {alwaysText !== '' ? <Text muted size="xs">{alwaysText}</Text> : null}
            {usedIn !== '' ? <Text muted size="xs">{`${t(l, 'usedInLabel')}: ${usedIn}`}</Text> : null}
            {installed.length > 0 ? (
              <Line gap="xs" wrap>
                <Text muted size="xs">{t(l, 'installedFor')}</Text>
                {installed.map((a) => <Badge key={a}>{a}</Badge>)}
              </Line>
            ) : null}
            {usedBy !== '' ? <Text muted size="xs">{`${t(l, 'usedBy')}: ${usedBy}`}</Text> : null}
            {noteText !== '' ? <Text muted size="xs">{noteText}</Text> : null}
          </Stack>
        ) : null}
      </Stack>
      <Separator />
    </Stack>
  )
}

function List({ rows, empty, l }: { rows: Row[]; empty: Key; l: Lang }) {
  const only = read(onlyUnused)
  const gone = read(onlyGone)
  const q = read(query).trim().toLowerCase()
  const scope = read(scopeBy)
  const sort = SORTS[read(sortBy)] ?? SORTS.usage
  const agent = read(agentSel)
  const hasAgent = (r: Row): boolean => agent === 'all' || agentNames([...r.agents, ...Object.keys(r.byAgent)]).includes(agent)
  const shown = rows
    .filter((r) => hasAgent(r) && (!only || isUnused(r)) && (!gone || !r.installed) && (scope === 'all' || r.scope === scope) && (q === '' || r.label.toLowerCase().includes(q)))
    // Entries that are not installed and the ones Claude Code brings itself come last, whatever the sort.
    .sort((a, b) => Number(isTail(a)) - Number(isTail(b)) || sort(a, b) || a.label.localeCompare(b.label))
  const key = [read(tab), q, scope, read(sortBy), only, gone, agent].join('|')
  const pages = Math.ceil(shown.length / MAX_CARDS)
  const p = read(page).key === key ? Math.min(read(page).n, pages - 1) : 0
  const go = (n: number) => () => set(page, { key, n })
  const pager = pages > 1 ? (
    <Line justify="between">
      <Button variant="ghost" size="sm" disabled={p === 0} onPress={go(p - 1)}>{t(l, 'prev')}</Button>
      <Text muted size="xs">{t(l, 'pageRange', { from: fmt(p * MAX_CARDS + 1, l), to: fmt(Math.min((p + 1) * MAX_CARDS, shown.length), l), total: fmt(shown.length, l) })}</Text>
      <Button variant="ghost" size="sm" disabled={p === pages - 1} onPress={go(p + 1)}>{t(l, 'next')}</Button>
    </Line>
  ) : null
  return (
    <Stack gap="md">
      <Input label={t(l, 'search')} labelHidden type="search" placeholder={t(l, 'searchPlaceholder')} value={read(query)} onChange={(v) => set(query, v)} maxLength={80} />
      <Grid columns={2} gap="sm">
        <Select
          label={t(l, 'sort')}
          value={read(sortBy)}
          options={(['usage', 'tokens', 'name', 'recent'] as const).map((k) => ({ value: k, label: t(l, `sort.${k}`) }))}
          onChange={(v) => set(sortBy, v)}
        />
        <Select
          label={t(l, 'scope')}
          value={scope}
          options={(['all', 'global', 'project'] as const).map((k) => ({ value: k, label: t(l, `scope.${k}`) }))}
          onChange={(v) => set(scopeBy, v)}
        />
      </Grid>
      <Switch label={t(l, 'onlyUnused')} checked={only} onChange={(v) => set(onlyUnused, v)} />
      <Switch label={t(l, 'onlyGone')} checked={gone} onChange={(v) => set(onlyGone, v)} />
      {pager}
      {shown.length === 0 ? <EmptyState title={t(l, empty)} /> : (
        <Grid columns={1} gap="sm">
          {shown.slice(p * MAX_CARDS, (p + 1) * MAX_CARDS).map((r) => <Tile2 key={`${r.kind}:${r.id}`} r={r} l={l} />)}
        </Grid>
      )}
      {pager}
    </Stack>
  )
}

/** Plain hints on how to reduce what is loaded. No recommendation about a specific entry. */
function InfoBox({ l }: { l: Lang }) {
  return (
    <Collapsible title={t(l, 'infoTitle')} description={t(l, 'infoNote')}>
      <Stack gap="xs">
        {(['tip.1', 'tip.2', 'tip.3', 'tip.4', 'tip.5'] as const).map((k) => (
          <Text key={k} size="xs">{`• ${t(l, k)}`}</Text>
        ))}
      </Stack>
    </Collapsible>
  )
}

export default function Panel() {
  const l = read(lang)
  const s = read(snap)
  if (s === null) {
    return read(failed) ? (
      <Stack gap="sm">
        <Text muted>{t(l, 'loadFailed')}</Text>
        <Button size="sm" onPress={load}>{t(l, 'retry')}</Button>
      </Stack>
    ) : (
      <Text muted>{t(l, 'loading')}</Text>
    )
  }
  const by = (k: Row['kind']) => s.rows.filter((r) => r.kind === k)
  const skills = by('skill')
  const mcp = by('mcp')
  const agents = by('agent')
  const plugins = by('plugin')
  const memory = by('memory')

  // The AI filter also decides what the tiles add up: one AI's context, never a mix. "All" means Claude here.
  const ais = agentNames(s.rows.flatMap((r) => [...r.agents, ...Object.keys(r.byAgent)]))
  const tileAi = read(agentSel) === 'all' ? 'Claude' : read(agentSel)
  const forAi = (r: Row): boolean => agentNames(r.agents).includes(tileAi)
  // Totals count global items only: project items load just inside their project.
  const global = s.rows.filter((r) => r.scope === 'global' && r.installed && forAi(r))
  const loaded = global.reduce((n, r) => n + (r.kind !== 'plugin' ? r.tokens ?? 0 : 0), 0)
  const unusedRows = global.filter((r) => isUnused(r) && r.kind !== 'plugin' && r.kind !== 'memory')
  const unusedTokens = unusedRows.reduce((n, r) => n + (r.tokens ?? 0), 0)
  const total = totalCalls(s.rows, s.toolCalls)
  const maxTool = Math.max(1, ...s.tools.map((x) => x.count))
  const period = s.range === 0 ? t(l, 'period.0') : t(l, 'period.n', { n: s.range })
  const warn = (n: number) => (n > 0 ? 'warning' : 'success')
  const unusedOf = (rows: Row[]) => rows.filter((r) => r.scope === 'global' && forAi(r) && isUnused(r)).length
  const globalOf = (rows: Row[]) => rows.filter((r) => r.scope === 'global' && r.installed && forAi(r)).length

  return (
    <Stack gap="md">
      <Line justify="between">
        <Heading>{t(l, 'title')}</Heading>
        <Button variant="ghost" size="sm" icon="refresh" onPress={() => void plugin.request('inventory.scan', view()).then((x) => set(snap, x))}>
          {t(l, 'rescan')}
        </Button>
      </Line>

      {!s.importing.done ? (
        <Callout tone="neutral" title={t(l, 'importingTitle')}>
          <Stack gap="xs">
            {s.importing.total > 0 ? <Text size="sm">{t(l, 'importing', { done: s.importing.files, total: s.importing.total })}</Text> : null}
            <Progress label={t(l, 'importingTitle')} labelHidden value={s.importing.total > 0 ? Math.round((s.importing.files / s.importing.total) * 100) : 0} />
          </Stack>
        </Callout>
      ) : null}

      {read(showTiles) ? (
      <Grid columns={2} gap="sm">
        <Tile title={t(l, 'alwaysLoaded')} value={`≈ ${fmt(loaded, l)}`} hint={t(l, 'alwaysLoadedHint', { ai: tileAi })} />
        <Tile title={t(l, 'savings')} value={`≈ ${fmt(unusedTokens, l)}`} hint={t(l, 'savingsHint', { n: unusedRows.length })} tone={warn(unusedTokens)} />
        <Tile title={t(l, 'skills')} value={`${unusedOf(skills)} / ${globalOf(skills)}`} hint={t(l, 'unused')} tone={warn(unusedOf(skills))} />
        <Tile title={t(l, 'mcp')} value={`${unusedOf(mcp)} / ${globalOf(mcp)}`} hint={t(l, 'unused')} tone={warn(unusedOf(mcp))} />
        <Tile title={t(l, 'calls')} value={fmt(total, l)} hint={period} />
        <Tile title={t(l, 'agents')} value={`${unusedOf(agents)} / ${globalOf(agents)}`} hint={t(l, 'unused')} />
      </Grid>
      ) : null}

      <InfoBox l={l} />

      <Select
        label={t(l, 'projectSel')}
        // A session always belongs to one project, so "all projects" is not offered then.
        value={read(range) === 0 && read(project) === 'all' ? 'current' : read(project)}
        options={[
          ...(read(range) === 0 ? [] : [{ value: 'all', label: t(l, 'scopeAll') }]),
          { value: 'current', label: t(l, 'scopeCurrent', { name: s.current?.label ?? '–' }) },
          ...s.projects.map((p) => ({ value: p.slug, label: p.label }))
        ]}
        onChange={(v) => {
          set(project, v)
          load()
        }}
      />
      <Grid columns={2} gap="sm">
        <Select
          label={t(l, 'range')}
          value={String(read(range))}
          options={[0, 7, 30, 90].map((d) => ({ value: String(d), label: t(l, `range.${d}` as Key) }))}
          onChange={(v) => {
            set(range, Number(v))
            load()
          }}
        />
        <Select
          label={t(l, 'agentFilter')}
          value={read(agentSel)}
          options={[{ value: 'all', label: t(l, 'allAgents') }, ...ais.map((a) => ({ value: a, label: a }))]}
          onChange={(v) => set(agentSel, v)}
        />
      </Grid>
      {s.session !== null && s.project !== null ? (
        <Line gap="xs" wrap>
          <Text muted size="xs">{t(l, 'sessionInfo', { name: s.project.label })}</Text>
          <RelativeTime at={s.session.last} />
        </Line>
      ) : null}

      <Tabs label={t(l, 'area')} value={read(tab)} onChange={(v) => set(tab, v)}>
        <Tab value="skill" label={`${t(l, 'skills')} ${skills.length}`}>
          <List rows={skills} empty="noSkills" l={l} />
        </Tab>
        <Tab value="mcp" label={`${t(l, 'mcp')} ${mcp.length}`}>
          <List rows={mcp} empty="noMcp" l={l} />
        </Tab>
        <Tab value="agent" label={`${t(l, 'agents')} ${agents.length}`}>
          <List rows={agents} empty="noAgents" l={l} />
        </Tab>
        <Tab value="plugin" label={`${t(l, 'plugins')} ${plugins.length}`}>
          <List rows={plugins} empty="noPlugins" l={l} />
        </Tab>
        <Tab value="other" label={t(l, 'other')}>
          <Stack gap="md">
            <Switch label={t(l, 'showTiles')} checked={read(showTiles)} onChange={(v) => set(showTiles, v)} />
            <Select
              label={t(l, 'language')}
              value={l}
              options={[{ value: 'en', label: 'English' }, { value: 'de', label: 'Deutsch' }, { value: 'es', label: 'Español' }]}
              onChange={(v) => set(lang, v === 'de' ? 'de' : v === 'es' ? 'es' : 'en')}
            />
            {memory.length > 0 ? <Grid columns={1} gap="sm">{memory.map((r) => <Tile2 key={r.id} r={r} l={l} />)}</Grid> : null}
            <Heading level={3}>{t(l, 'toolsByCalls')}</Heading>
            {s.tools.length === 0 ? <EmptyState title={t(l, 'noCalls')} /> : s.tools.map((x) => (
              <Progress key={x.name} label={`${x.name} · ${fmt(x.count, l)}×`} value={Math.round((x.count / maxTool) * 100)} />
            ))}
            <Button variant="ghost" tone="danger" size="sm" onPress={() => void plugin.request('usage.reset', view()).then((x) => set(snap, x))}>
              {t(l, 'reset')}
            </Button>
          </Stack>
        </Tab>
      </Tabs>
      <Text muted size="xs">{t(l, 'footer')}</Text>
    </Stack>
  )
}
