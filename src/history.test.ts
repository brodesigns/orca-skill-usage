import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { emptyHistory, importHistory, listProjects, listSessionFiles, parseHistory, pickSession, projectLabel } from './history'
import { countIn, projKey } from './usage'

const ts = (): string => new Date().toISOString()
const line = (o: unknown): string => `${JSON.stringify(o)}\n`
const toolUse = (id: string, name: string, input: unknown) => line({ type: 'assistant', timestamp: ts(), message: { content: [{ type: 'tool_use', id, name, input }] } })
const typed = (name: string) => line({ type: 'user', timestamp: ts(), message: { content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>` } })

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-usage-h-'))
}

test('imports Claude sessions: skills, typed commands, MCP, agents; ignores noise and duplicates', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', 'p1')
    await mkdir(dir, { recursive: true })
    const noise = line({ type: 'api-request-shape', timestamp: ts(), shape: '<command-name>/fake</command-name> "tool_use"' })
    const body = [
      toolUse('t1', 'Skill', { skill: 'bro-seo' }),
      toolUse('t2', 'mcp__ubersuggest__keyword_overview', {}),
      toolUse('t3', 'Agent', { subagent_type: 'Explore' }),
      toolUse('t4', 'Bash', { command: 'ls' }),
      typed('bro-seo'),
      noise
    ].join('')
    await writeFile(join(dir, 'a.jsonl'), body)
    // A resumed session copies the old skill line into a second file.
    await writeFile(join(dir, 'b.jsonl'), toolUse('t1', 'Skill', { skill: 'bro-seo' }))

    const state = emptyHistory()
    const progress = await importHistory(state, h, Date.now(), 5000)
    assert.equal(progress.done, true)
    assert.deepEqual(countIn(state.stats.skills['bro-seo'], null), { auto: 1, direct: 0 })
    assert.deepEqual(countIn(state.stats.cmds['bro-seo'], null), { auto: 0, direct: 1 })
    assert.equal(state.stats.cmds.fake, undefined)
    assert.deepEqual(countIn(state.stats.mcp['ubersuggest/keyword_overview'], null), { auto: 1, direct: 0 })
    assert.deepEqual(countIn(state.stats.agents.Explore, null), { auto: 1, direct: 0 })
    assert.deepEqual(countIn(state.stats.tools.Bash, null), { auto: 1, direct: 0 })
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('is incremental, waits for a complete last line and honours "from"', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', 'p1')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'a.jsonl')
    await writeFile(file, toolUse('t1', 'Skill', { skill: 'x' }))
    const state = emptyHistory()
    await importHistory(state, h, Date.now(), 5000)
    await importHistory(state, h, Date.now(), 5000)
    assert.deepEqual(countIn(state.stats.skills.x, null), { auto: 1, direct: 0 })

    const partial = toolUse('t2', 'Skill', { skill: 'x' }).trimEnd()
    await appendFile(file, partial)
    await importHistory(state, h, Date.now(), 5000)
    assert.deepEqual(countIn(state.stats.skills.x, null), { auto: 1, direct: 0 })
    await appendFile(file, '\n')
    await importHistory(state, h, Date.now(), 5000)
    assert.deepEqual(countIn(state.stats.skills.x, null), { auto: 2, direct: 0 })

    // After a reset, older lines are ignored.
    const reset = emptyHistory()
    reset.from = Date.now() + 60_000
    await importHistory(reset, h, Date.now(), 5000)
    assert.equal(reset.stats.skills.x, undefined)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('imports Codex rollouts: only real tool calls that read a SKILL.md', async () => {
  const h = await home()
  try {
    const dir = join(h, '.codex', 'sessions', '2026', '11', '09')
    await mkdir(dir, { recursive: true })
    const meta = line({ timestamp: ts(), type: 'session_meta', payload: { skills: '/x/skills/listed/SKILL.md' } })
    const call = line({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["cat","/h/.codex/skills/seo-audit/SKILL.md"]}' } })
    const output = line({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call_output', output: 'skills/echoed/SKILL.md' } })
    await writeFile(join(dir, 'rollout-1.jsonl'), meta + call + output)
    const state = emptyHistory()
    await importHistory(state, h, Date.now(), 5000)
    assert.deepEqual(Object.keys(state.stats.skills), ['seo-audit'])
    assert.deepEqual({ ...state.stats.skills['seo-audit'].by }, { codex: 1 })
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('stops at the time budget and continues on the next call', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', 'p1')
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < 5; i++) await writeFile(join(dir, `f${i}.jsonl`), toolUse(`id${i}`, 'Skill', { skill: `s${i}` }))
    const state = emptyHistory()
    const first = await importHistory(state, h, Date.now(), -1)
    assert.equal(first.done, false)
    let guard = 0
    while (!(await importHistory(state, h, Date.now(), 5000)).done && guard++ < 5) {
      /* keep going */
    }
    assert.equal(Object.keys(state.stats.skills).length, 5)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('projects and sessions: labels from cwd, newest session, import limited to one file or project', async () => {
  const h = await home()
  try {
    const mk = async (slug: string, file: string, id: string, skill: string, cwd: string, ageMs: number) => {
      const dir = join(h, '.claude', 'projects', slug)
      await mkdir(dir, { recursive: true })
      const l = line({ type: 'assistant', timestamp: ts(), cwd, message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } })
      await writeFile(join(dir, file), l)
      const when = new Date(Date.now() - ageMs)
      await utimes(join(dir, file), when, when)
    }
    await mk('-work-shop', 'old.jsonl', 'a1', 'one', '/work/shop', 60_000)
    await mk('-work-shop', 'new.jsonl', 'a2', 'two', '/work/shop', 1_000)
    await mk('-work-blog', 'x.jsonl', 'a3', 'three', '/work/blog', 600_000)

    const files = await listSessionFiles(h, Date.now())
    const all = emptyHistory()
    await importHistory(all, h, Date.now(), 5000)
    assert.equal(all.projects['-work-shop'], 'shop')
    const projects = listProjects(files, all.projects)
    assert.deepEqual(projects.map((p) => p.label), ['shop', 'blog'])
    assert.equal(pickSession(files, '-work-shop')?.name, 'new.jsonl')

    const session = emptyHistory()
    await importHistory(session, h, Date.now(), 5000, (f) => f.path === pickSession(files, '-work-shop')?.path)
    assert.deepEqual(Object.keys(session.stats.skills), ['two'])

    const project = emptyHistory()
    await importHistory(project, h, Date.now(), 5000, (f) => f.dir === '-work-shop')
    assert.deepEqual(Object.keys(project.stats.skills).sort(), ['one', 'two'])
    assert.equal(projectLabel('-a-b-c'), 'a-b-c')
    assert.equal(projectLabel('-a-b-c', 'proj'), 'proj')
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('counts subagent files, and a session includes its subagents', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', '-work-shop')
    await mkdir(join(dir, 'sess1', 'subagents'), { recursive: true })
    await writeFile(join(dir, 'sess1.jsonl'), toolUse('m1', 'Skill', { skill: 'main' }))
    await writeFile(join(dir, 'sess1', 'subagents', 'agent-1.jsonl'), toolUse('s1', 'Skill', { skill: 'sub' }) + toolUse('s2', 'mcp__docs__search', {}))
    await writeFile(join(dir, 'sess2.jsonl'), toolUse('o1', 'Skill', { skill: 'other' }))
    const files = await listSessionFiles(h, Date.now())
    assert.equal(files.length, 3)
    assert.equal(pickSession(files, '-work-shop')?.sub, false)

    const all = emptyHistory()
    await importHistory(all, h, Date.now(), 5000)
    assert.deepEqual(Object.keys(all.stats.skills).sort(), ['main', 'other', 'sub'])
    assert.equal(all.stats.mcp['docs/search'] !== undefined, true)

    const one = emptyHistory()
    await importHistory(one, h, Date.now(), 5000, (f) => f.dir === '-work-shop' && f.session === 'sess1')
    assert.deepEqual(Object.keys(one.stats.skills).sort(), ['main', 'sub'])
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('same file name in two projects: both are imported (offsets are per project)', async () => {
  const h = await home()
  try {
    for (const [slug, skill] of [['-a', 'from-a'], ['-b', 'from-b']] as const) {
      await mkdir(join(h, '.claude', 'projects', slug), { recursive: true })
      await writeFile(join(h, '.claude', 'projects', slug, 'same.jsonl'), toolUse(`id-${slug}`, 'Skill', { skill }))
    }
    const state = emptyHistory()
    await importHistory(state, h, Date.now(), 5000)
    assert.deepEqual(Object.keys(state.stats.skills).sort(), ['from-a', 'from-b'])
    // An offset stored under the old name-only key is taken over once.
    const old = emptyHistory()
    old.offsets['same.jsonl'] = 10_000_000
    await importHistory(old, h, Date.now(), 5000)
    assert.equal(Object.keys(old.stats.skills).length, 0)
    assert.equal('same.jsonl' in old.offsets, false)
    assert.equal(old.offsets['claude:-a/same.jsonl'], 10_000_000)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('Codex: custom_tool_call counts, the duplicate event and the output do not', async () => {
  const h = await home()
  try {
    const dir = join(h, '.codex', 'sessions', '2026', '11', '09')
    await mkdir(dir, { recursive: true })
    const call = line({ timestamp: ts(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'cat /h/.codex/skills/sora/SKILL.md' } })
    const event = line({ timestamp: ts(), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: 'cat /h/.codex/skills/sora/SKILL.md' } } })
    const output = line({ timestamp: ts(), type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'skills/sora/SKILL.md' } })
    await writeFile(join(dir, 'rollout-2.jsonl'), call + event + output)
    const state = emptyHistory()
    await importHistory(state, h, Date.now(), 5000)
    assert.deepEqual(countIn(state.stats.skills.sora, null), { auto: 1, direct: 0 })
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('a huge line without newline is skipped, later lines still count; slices keep exact offsets', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', 'p1')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'big.jsonl')
    const lines: string[] = []
    for (let i = 0; i < 40_000; i++) lines.push(toolUse(`id${i}`, 'Skill', { skill: 'bulk' }))
    // About 8 MB of filler without newline, then a valid line.
    const filler = 'x'.repeat(9 * 1024 * 1024)
    await writeFile(file, lines.join('') + filler + '\n' + toolUse('last', 'Skill', { skill: 'after' }))
    const state = emptyHistory()
    // A tiny budget forces several slices inside one file.
    let guard = 0
    while (!(await importHistory(state, h, Date.now(), 0)).done && guard++ < 50) {
      /* keep going */
    }
    assert.equal(countIn(state.stats.skills.bulk, null).auto, 40_000)
    assert.equal(countIn(state.stats.skills.after, null).auto, 1)
    assert.equal(state.offsets['claude:p1/big.jsonl'], (await readFile(file)).length)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('a project is named after its root folder, not a sub folder the session moved into', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', '-work-Orca-Plugins')
    await mkdir(dir, { recursive: true })
    const at = (cwd: string, id: string) => line({ type: 'assistant', timestamp: ts(), cwd, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] } })
    await writeFile(join(dir, 's.jsonl'), at('/work/Orca Plugins/sub', 'a') + at('/work/Orca Plugins', 'b') + at('/work/Orca Plugins/other', 'c'))
    const state = emptyHistory()
    await importHistory(state, h, Date.now(), 5000)
    assert.equal(state.projects['-work-Orca-Plugins'], 'Orca Plugins')
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('imports attribute calls to the project folder; an old stored format is imported again', async () => {
  const h = await home()
  try {
    for (const [slug, n] of [['-w-shop', 3], ['-w-blog', 1]] as const) {
      const dir = join(h, '.claude', 'projects', slug)
      await mkdir(dir, { recursive: true })
      let body = ''
      for (let i = 0; i < n; i++) body += toolUse(`${slug}-${i}`, 'Skill', { skill: 'shop-sync' })
      body += typed('shop-sync')
      await writeFile(join(dir, 's.jsonl'), body)
    }
    const state = emptyHistory()
    await importHistory(state, h, Date.now(), 5000)
    assert.equal(state.stats.skills['shop-sync'].proj?.[projKey('-w-shop')], 3)
    assert.equal(state.stats.skills['shop-sync'].proj?.[projKey('-w-blog')], 1)
    assert.equal(state.stats.cmds['shop-sync'].proj?.[projKey('-w-shop')], 1)
    assert.equal(state.v, 2)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('an old stored history is dropped but keeps its reset point; hostile data is cleaned', () => {
  const old = parseHistory({ v: 1, from: 1234, offsets: { a: 5 }, stats: {} })
  assert.equal(old.v, 2)
  assert.equal(old.from, 1234)
  assert.deepEqual(Object.keys(old.offsets), [])
  const ok = parseHistory({ v: 2, from: 9, offsets: { a: 5, b: 'x', c: -1 }, seen: ['abcdefghijklmnopqrst', 7], projects: { p: '/full/path/to/shop' }, stats: {} })
  assert.deepEqual({ ...ok.offsets }, { a: 5 })
  assert.deepEqual(ok.seen, ['ijklmnopqrst'])
  assert.equal(ok.projects.p, 'shop')
  assert.equal(parseHistory(null).v, 2)
  assert.equal(parseHistory('x').from, 0)
})

test('offsets of files that left the window are pruned', async () => {
  const h = await home()
  try {
    const dir = join(h, '.claude', 'projects', 'p1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'a.jsonl'), toolUse('x1', 'Skill', { skill: 'x' }))
    const state = emptyHistory()
    state.offsets['claude:p1/gone.jsonl'] = 99
    await importHistory(state, h, Date.now(), 5000)
    assert.equal('claude:p1/gone.jsonl' in state.offsets, false)
    assert.equal('claude:p1/a.jsonl' in state.offsets, true)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})
