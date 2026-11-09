// Two languages, English first. The panel picks one; the worker only sends language-neutral codes.
export type Lang = 'en' | 'de'

const en = {
  title: 'Context balance',
  rescan: 'Rescan',
  language: 'Language',
  loading: 'Loading…',
  showTiles: 'Show summary tiles',
  loadFailed: 'Could not load the numbers.',
  retry: 'Retry',
  alwaysLoaded: 'Always loaded',
  alwaysLoadedHint: 'tokens per session for {ai} (skills, agents, instructions)',
  savings: 'Loaded but unused',
  savingsHint: 'tokens in {n} entries not called in this period',
  skills: 'Skills',
  mcp: 'MCP',
  agents: 'Agents',
  plugins: 'Plugins',
  other: 'Other',
  calls: 'Calls',
  unused: 'unused',
  alwaysBadge: 'always loaded',
  area: 'Section',
  noSkills: 'No skills found',
  noMcp: 'No MCP servers found',
  noAgents: 'No agents found',
  noPlugins: 'No plugins found',
  tokens: '≈ {n} tokens',
  tokensUnknown: 'tokens unknown',
  manualOnly: 'manual only',
  usedTimes: 'used {n}×',
  notInstalled: 'not installed',
  freeBadge: 'costs nothing',
  usageOnly: 'seen in use only',
  lastUsed: 'last used',
  toolsByCalls: 'Tools by calls',
  noCalls: 'No calls yet',
  reset: 'Reset counters',
  footer: 'Tokens are estimates (4 characters per token). MCP cost is unknown without starting the server. Project items load only inside their project, so they are not in the totals.',
  range: 'Period',
  'range.0': 'Latest session',
  'range.7': 'Last 7 days',
  'range.30': 'Last 30 days',
  'range.90': 'Last 90 days',
  search: 'Search',
  searchPlaceholder: 'Filter by name',
  sort: 'Sort by',
  'sort.usage': 'Most used',
  'sort.tokens': 'Token cost',
  'sort.name': 'Name',
  'sort.recent': 'Last used',
  scope: 'Level',
  projectSel: 'Project',
  scopeAll: 'All projects',
  scopeCurrent: 'Current project: {name}',
  'period.0': 'latest session',
  'period.n': 'last {n} days',
  sessionInfo: 'Latest session of {name}, last activity',
  'scope.all': 'All',
  'scope.global': 'Global',
  'scope.project': 'Project',
  importingTitle: 'Reading past sessions…',
  importing: '{done} of {total} session files. Counts grow while this runs.',
  split: '{a} by the model · {d} typed by you',
  noData: 'no usage data',
  installedFor: 'Installed for',
  usedBy: 'Used by',
  agentFilter: 'AI',
  allAgents: 'All AIs',
  onlyUnused: 'Show unused only',
  existsIn: 'Exists in',
  existsGlobal: 'global (loaded in every project)',
  existsProject: 'project {name}',
  alsoIn: '+{n} more',
  usedInLabel: 'Used in (since first import)',
  infoTitle: 'Reduce context',
  infoNote: 'This plugin only shows facts and never changes a file. Ways to reduce what is loaded:',
  'tip.1': 'A skill that is manual-only (disable-model-invocation: true in its SKILL.md) loads only when you call it by name; its description then costs no context.',
  'tip.2': 'A skill used in one project only belongs in that project\'s own skills folder, not in the global one: it then loads only there. The card shows where an entry exists and where it is used.',
  'tip.3': 'A plugin can be switched off in the settings: all its skills and agents stop loading.',
  'tip.4': 'MCP servers can be added per project instead of globally. Every server\'s tool list costs context in every session.',
  'tip.5': 'Entries that come with Orca or with a plugin are managed by them: leave them as they are.',
  'src.user': 'user',
  'src.codex': 'Codex',
  'src.agents': 'Shared (.agents)',
  'src.global': 'global',
  'src.projects': '{n} project(s)',
  'src.elsewhere': 'project or elsewhere',
  'src.builtin': 'built-in or elsewhere',
  'src.connector': 'plugin or connector',
  'src.plugin': 'plugin {n}',
  'src.project': 'project {n}',
  'src.marketplace': '{n}',
  'note.content': 'Content on use: about {n} tokens',
  'note.tools': '{n} tool(s) used: {list}',
  'note.enabled': 'enabled',
  'note.disabled': 'disabled'
}

const de: typeof en = {
  title: 'Kontext-Bilanz',
  rescan: 'Neu einlesen',
  language: 'Sprache',
  loading: 'Lade…',
  showTiles: 'Zusammenfassung anzeigen',
  loadFailed: 'Die Zahlen konnten nicht geladen werden.',
  retry: 'Erneut versuchen',
  alwaysLoaded: 'Immer geladen',
  alwaysLoadedHint: 'Token je Sitzung für {ai} (Skills, Agenten, Anweisungen)',
  savings: 'Geladen, aber ungenutzt',
  savingsHint: 'Token in {n} Einträgen, die in diesem Zeitraum nie aufgerufen wurden',
  skills: 'Skills',
  mcp: 'MCP',
  agents: 'Agenten',
  plugins: 'Plugins',
  other: 'Sonstiges',
  calls: 'Aufrufe',
  unused: 'ungenutzt',
  alwaysBadge: 'immer geladen',
  area: 'Bereich',
  noSkills: 'Keine Skills gefunden',
  noMcp: 'Keine MCP-Server gefunden',
  noAgents: 'Keine Agenten gefunden',
  noPlugins: 'Keine Plugins gefunden',
  tokens: '≈ {n} Token',
  tokensUnknown: 'Token unbekannt',
  manualOnly: 'nur manuell',
  usedTimes: '{n}× genutzt',
  notInstalled: 'nicht installiert',
  freeBadge: 'kostet nichts',
  usageOnly: 'nur in Nutzung',
  lastUsed: 'zuletzt',
  toolsByCalls: 'Werkzeuge nach Aufrufen',
  noCalls: 'Noch keine Aufrufe',
  reset: 'Zähler zurücksetzen',
  footer: 'Token sind Schätzungen (4 Zeichen je Token). MCP-Kosten sind ohne Serverstart unbekannt. Projekt-Einträge laden nur im jeweiligen Projekt und stehen deshalb nicht in den Summen.',
  range: 'Zeitraum',
  'range.0': 'Letzte Sitzung',
  'range.7': 'Letzte 7 Tage',
  'range.30': 'Letzte 30 Tage',
  'range.90': 'Letzte 90 Tage',
  search: 'Suche',
  searchPlaceholder: 'Nach Namen filtern',
  sort: 'Sortieren nach',
  'sort.usage': 'Meistgenutzt',
  'sort.tokens': 'Token-Kosten',
  'sort.name': 'Name',
  'sort.recent': 'Zuletzt genutzt',
  scope: 'Ebene',
  projectSel: 'Projekt',
  scopeAll: 'Alle Projekte',
  scopeCurrent: 'Aktuelles Projekt: {name}',
  'period.0': 'letzte Sitzung',
  'period.n': 'letzte {n} Tage',
  sessionInfo: 'Letzte Sitzung von {name}, zuletzt aktiv',
  'scope.all': 'Alle',
  'scope.global': 'Global',
  'scope.project': 'Projekt',
  importingTitle: 'Lese frühere Sitzungen…',
  importing: '{done} von {total} Sitzungsdateien. Die Zahlen wachsen währenddessen.',
  split: '{a} durchs Modell · {d} von dir getippt',
  noData: 'keine Nutzungsdaten',
  installedFor: 'Installiert für',
  usedBy: 'Genutzt von',
  agentFilter: 'KI',
  allAgents: 'Alle KIs',
  onlyUnused: 'Nur ungenutzte zeigen',
  existsIn: 'Vorhanden in',
  existsGlobal: 'global (in jedem Projekt geladen)',
  existsProject: 'Projekt {name}',
  alsoIn: '+{n} weitere',
  usedInLabel: 'Genutzt in (seit erstem Import)',
  infoTitle: 'Kontext senken',
  infoNote: 'Dieses Plugin zeigt nur Fakten und ändert nie eine Datei. So lässt sich senken, was geladen wird:',
  'tip.1': 'Ein Skill, der nur manuell aufrufbar ist (disable-model-invocation: true in seiner SKILL.md), lädt nur, wenn du ihn beim Namen rufst; seine Beschreibung kostet dann keinen Kontext.',
  'tip.2': 'Ein Skill, den nur ein Projekt nutzt, gehört in den eigenen Skills-Ordner dieses Projekts statt in den globalen: Dann lädt er nur dort. Die Karte zeigt, wo ein Eintrag vorhanden ist und wo er genutzt wird.',
  'tip.3': 'Ein Plugin lässt sich in den Einstellungen abschalten: Alle seine Skills und Agenten laden dann nicht mehr.',
  'tip.4': 'MCP-Server lassen sich pro Projekt statt global einrichten. Die Werkzeugliste jedes Servers kostet in jeder Sitzung Kontext.',
  'tip.5': 'Einträge, die zu Orca oder zu einem Plugin gehören, werden von ihnen verwaltet: lass sie, wie sie sind.',
  'src.user': 'Nutzer',
  'src.codex': 'Codex',
  'src.agents': 'Gemeinsam (.agents)',
  'src.global': 'global',
  'src.projects': '{n} Projekt(e)',
  'src.elsewhere': 'Projekt oder anderswo',
  'src.builtin': 'eingebaut oder anderswo',
  'src.connector': 'Plugin oder Connector',
  'src.plugin': 'Plugin {n}',
  'src.project': 'Projekt {n}',
  'src.marketplace': '{n}',
  'note.content': 'Inhalt beim Aufruf: ca. {n} Token',
  'note.tools': '{n} Tool(s) genutzt: {list}',
  'note.enabled': 'aktiviert',
  'note.disabled': 'deaktiviert'
}

export type Key = keyof typeof en
const dict: Record<Lang, typeof en> = { en, de }

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  // A missing text must never break the panel: fall back to English, then to the key itself.
  return ((dict[lang] ?? dict.en)[key] ?? dict.en[key] ?? String(key)).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** Übersetzt einen Quell-Code (`projects:3`, `user`, sonst der Name selbst). */
export function source(lang: Lang, code: string): string {
  const [head, ...rest] = code.split(':')
  const key = `src.${head}` as Key
  return key in en ? t(lang, key, { n: rest.join(':') }) : code
}

/** Übersetzt einen Notiz-Code (`content:12`, `tools:2:a, b`, `enabled`). */
export function note(lang: Lang, code: string): string {
  const [head, n, ...rest] = code.split(':')
  const key = `note.${head}` as Key
  return key in en ? t(lang, key, { n: n ?? '', list: rest.join(':') }) : code
}

export const dateLocale = (lang: Lang): string => (lang === 'de' ? 'de-DE' : 'en-US')

/** Display name of an AI as reported by a transcript, a hook or the inventory. */
export function agentName(raw: string): string {
  const k = raw.toLowerCase()
  if (k.includes('claude')) return 'Claude'
  if (k.includes('codex') || k.includes('chatgpt') || k.includes('openai')) return 'Codex (ChatGPT)'
  if (k.includes('gemini')) return 'Gemini'
  if (k === 'agents') return 'Shared (.agents)'
  return raw.slice(0, 30)
}

/** The same AI can arrive under several raw names (`claude`, `claude-code`); one name each, sorted. */
export function agentNames(raws: string[]): string[] {
  return [...new Set(raws.map(agentName))].sort()
}
