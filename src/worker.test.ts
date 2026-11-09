import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const ts = (): string => new Date().toISOString()
const line = (o: unknown): string => `${JSON.stringify(o)}\n`
const skillUse = (id: string, skill: string, cwd: string): string => line({ type: 'assistant', timestamp: ts(), cwd, message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } })

/** A fake home with two projects of the same folder name, a plugin and a skill, then a worker reading it. */
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'skill-usage-w-'))
  process.env.SKILL_USAGE_HOME = home
  await mkdir(join(home, '.claude', 'skills', 'alpha'), { recursive: true })
  await writeFile(join(home, '.claude', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: does alpha things\n---\nbody')
  const plugins = join(home, '.claude', 'plugins')
  await mkdir(join(plugins, 'cache', 'm', 'good', 'skills', 'tool'), { recursive: true })
  await writeFile(join(plugins, 'cache', 'm', 'good', 'skills', 'tool', 'SKILL.md'), '---\nname: tool\ndescription: plugin skill\n---\n')
  await writeFile(join(plugins, 'installed_plugins.json'), JSON.stringify({ plugins: { 'good@m': [{ installPath: join(plugins, 'cache', 'm', 'good') }] } }))
  await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'good@m': true } }))
  await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { '/w/a/app': {}, '/w/b/app': {} } }))
  for (const [slug, cwd] of [['-w-a-app', '/w/a/app'], ['-w-b-app', '/w/b/app']] as const) {
    const dir = join(home, '.claude', 'projects', slug)
    await mkdir(dir, { recursive: true })
    let body = ''
    for (let i = 0; i < 3; i++) body += skillUse(`${slug}-${i}`, 'alpha', cwd)
    body += skillUse(`${slug}-p`, 'good:tool', cwd)
    await writeFile(join(dir, 's.jsonl'), body)
  }
  return home
}

async function settled(worker: Awaited<ReturnType<typeof mountWorker>>, view = { range: 30, scope: 'all' }) {
  // The import runs in the background: ask until it is done.
  for (let i = 0; i < 50; i++) {
    const s = await worker.request('usage.get', view)
    if (s.importing.done) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('import did not finish')
}

test('the snapshot joins inventory and usage, tells same-named projects apart and keeps plumbing out of the rows', async () => {
  const home = await setup()
  try {
    const host = mockHost({ storage: {} })
    const worker = await mountWorker(main, { host })
    const s = await settled(worker)
    const alpha = s.rows.find((r) => r.id === 'alpha')
    assert.equal(alpha?.auto, 6)
    assert.deepEqual((alpha?.usedIn ?? []).map((p) => p.n), [3, 3])
    // Both projects are called "app": the parent folder tells them apart.
    assert.deepEqual(s.projects.map((p) => p.label).sort(), ['a/app', 'b/app'])
    assert.deepEqual((alpha?.usedIn ?? []).map((p) => p.label).sort(), ['a/app', 'b/app'])
    // A plugin row holds the use of its skills.
    assert.equal(s.rows.find((r) => r.id === 'good')?.auto, 2)
    // Nothing internal reaches the panel.
    const leaked = s.rows.flatMap((r) => ['usedInKeys', 'proj', 'where', 'protect', 'rec'].filter((k) => k in r))
    assert.deepEqual(leaked, [])
    assert.equal(JSON.stringify(s).includes(home), false)
    await worker.deactivate()
  } finally {
    delete process.env.SKILL_USAGE_HOME
    await rm(home, { recursive: true, force: true })
  }
})

test('the project view counts only that project; reset clears numbers; bad input is ignored', async () => {
  const home = await setup()
  try {
    const host = mockHost({ storage: {} })
    const worker = await mountWorker(main, { host })
    await settled(worker)
    const one = await settled(worker, { range: 30, scope: '-w-a-app' })
    assert.equal(one.rows.find((r) => r.id === 'alpha')?.auto, 3)
    assert.equal(one.project?.slug, '-w-a-app')
    const reset = await worker.request('usage.reset', { range: 30, scope: 'all' })
    assert.equal(reset.rows.find((r) => r.id === 'alpha')?.auto, 0)
    // The panel is untrusted: odd values fall back to defaults instead of throwing.
    const odd = await worker.request('usage.get', { range: 'x', scope: 42 } as never)
    assert.equal(odd.range, 30)
    const nothing = await worker.request('usage.get', null as never)
    assert.equal(nothing.range, 30)
    await worker.deactivate()
  } finally {
    delete process.env.SKILL_USAGE_HOME
    await rm(home, { recursive: true, force: true })
  }
})

test('demo mode shows made-up numbers only', async () => {
  const home = await setup()
  try {
    const host = mockHost({ storage: { demo: true } })
    const worker = await mountWorker(main, { host })
    const s = await worker.request('usage.get', { range: 30, scope: 'all' })
    const text = JSON.stringify(s)
    assert.equal(text.includes('alpha'), false)
    assert.equal(text.includes(home), false)
    assert.equal(s.rows.some((r) => r.id === 'seo-audit'), true)
    await worker.deactivate()
  } finally {
    delete process.env.SKILL_USAGE_HOME
    await rm(home, { recursive: true, force: true })
  }
})
