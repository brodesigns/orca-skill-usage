import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { emptyHistory, importHistory, listProjects, listSessionFiles, pickSession, projectLabel } from './history'
import { countIn } from './usage'

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
    assert.equal(all.projects['-work-shop'], '/work/shop')
    const projects = listProjects(files, all.projects)
    assert.deepEqual(projects.map((p) => p.label), ['shop', 'blog'])
    assert.equal(pickSession(files, '-work-shop')?.name, 'new.jsonl')

    const session = emptyHistory()
    await importHistory(session, h, Date.now(), 5000, (f) => f.path === pickSession(files, '-work-shop')?.path)
    assert.deepEqual(Object.keys(session.stats.skills), ['two'])

    const project = emptyHistory()
    await importHistory(project, h, Date.now(), 5000, (f) => f.dir === '-work-shop')
    assert.deepEqual(Object.keys(project.stats.skills).sort(), ['one', 'two'])
    assert.equal(projectLabel('-a-b-c'), 'c')
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})
