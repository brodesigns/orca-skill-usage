import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { parseFrontmatter, scanInventory, scanProjectNames } from './inventory'

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-usage-'))
}

async function skill(root: string, name: string, front: string, body = 'body text'): Promise<void> {
  await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, name, 'SKILL.md'), `---\n${front}\n---\n${body}`)
}

test('parses frontmatter incl. manual flag, BOM and yes', () => {
  const fm = parseFrontmatter('---\nname: a\ndisable-model-invocation: true\ndescription: hi there\n---\nbody')
  assert.deepEqual(fm, { name: 'a', description: 'hi there', manual: true })
  const bom = parseFrontmatter('﻿---\nname: a\ndisable-model-invocation: Yes\n---\n')
  assert.equal(bom.name, 'a')
  assert.equal(bom.manual, true)
})

test('scans skills, agents, other agent folders, plugins and projects', async () => {
  const h = await home()
  try {
    await skill(join(h, '.claude', 'skills'), 'alpha', 'name: alpha\ndescription: does alpha things')
    await skill(join(h, '.claude', 'skills'), 'quiet', 'name: quiet\ndisable-model-invocation: true\ndescription: manual only')
    await skill(join(h, '.claude', 'skills', 'synced'), 'nested', 'name: nested\ndescription: one level down')
    await skill(join(h, '.codex', 'skills'), 'codexy', 'name: codexy\ndescription: for codex')
    await skill(join(h, '.codex', 'skills'), 'alpha', 'name: alpha\ndescription: duplicate of the user skill')
    await mkdir(join(h, '.claude', 'agents'), { recursive: true })
    await writeFile(join(h, '.claude', 'agents', 'helper.md'), '---\nname: helper\ndescription: helps\n---\nx')
    await writeFile(join(h, '.claude', 'CLAUDE.md'), 'x'.repeat(400))

    // Plugin: enabled, install path inside plugins; another one escapes via a path outside.
    const plugins = join(h, '.claude', 'plugins')
    await mkdir(join(plugins, 'cache', 'm', 'good'), { recursive: true })
    await skill(join(plugins, 'cache', 'm', 'good', 'skills'), 'tool', 'name: tool\ndescription: plugin skill')
    const outside = join(h, 'outside')
    await skill(join(outside, 'skills'), 'sneaky', 'name: sneaky\ndescription: must not be read')
    await writeFile(join(plugins, 'installed_plugins.json'), JSON.stringify({
      plugins: {
        'good@m': [{ installPath: join(plugins, 'cache', 'm', 'good') }],
        'evil@m': [{ installPath: outside }]
      }
    }))
    await writeFile(join(h, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'good@m': true, 'evil@m': true } }))

    // Project with its own skill, CLAUDE.md and .mcp.json; secrets must never surface.
    const proj = join(h, 'work', 'shop')
    await skill(join(proj, '.claude', 'skills'), 'shopskill', 'name: shopskill\ndescription: shop only')
    await writeFile(join(proj, 'CLAUDE.md'), 'y'.repeat(800))
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { projsrv: { command: 'x', env: { TOKEN: 'SECRET-PROJECT' } } } }))
    await writeFile(join(h, '.claude.json'), JSON.stringify({
      mcpServers: { globalsrv: { command: 'x', env: { API_KEY: 'SECRET-GLOBAL' }, headers: { Authorization: 'SECRET-HEADER' } } },
      projects: { [proj]: {}, relative: {} }
    }))

    // Other AIs: Codex MCP servers and instructions, Gemini MCP servers (names only).
    await mkdir(join(h, '.codex'), { recursive: true })
    await writeFile(join(h, '.codex', 'config.toml'), '[mcp_servers.codexsrv]\ncommand = "x"\n[mcp_servers.codexsrv.env]\nTOKEN = "SECRET-TOML"\n[mcp_servers."quoted"]\ncommand = "y"\n')
    await writeFile(join(h, '.codex', 'AGENTS.md'), 'z'.repeat(40))
    await mkdir(join(h, '.gemini'), { recursive: true })
    await writeFile(join(h, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { geminisrv: { env: { K: 'SECRET-GEMINI' } } } }))

    const items = await scanInventory(h)
    const by = (kind: string, id: string) => items.find((i) => i.kind === kind && i.id === id)

    assert.equal(by('skill', 'quiet')?.tokens, 0)
    assert.equal(by('skill', 'quiet')?.manual, true)
    assert.equal((by('skill', 'alpha')?.tokens ?? 0) > 0, true)
    assert.equal(by('skill', 'nested')?.source, 'user')
    assert.equal(by('skill', 'codexy')?.source, 'codex')
    assert.equal(items.filter((i) => i.kind === 'skill' && i.id === 'alpha').length, 1)
    assert.equal(by('agent', 'helper')?.scope, 'global')
    assert.equal(by('memory', 'CLAUDE.md')?.tokens, 100)
    assert.equal(by('skill', 'good:tool')?.source, 'plugin:good')
    assert.equal(by('skill', 'evil:sneaky'), undefined)
    assert.equal(by('skill', 'shopskill')?.scope, 'project')
    assert.equal(by('memory', 'shop/CLAUDE.md')?.tokens, 200)
    assert.equal(by('mcp', 'projsrv')?.scope, 'project')
    assert.equal(by('mcp', 'globalsrv')?.scope, 'global')
    assert.equal(JSON.stringify(items).includes('SECRET'), false)
    // Which AI an entry is installed for.
    assert.deepEqual(by('skill', 'alpha')?.agents, ['claude', 'codex'])
    assert.deepEqual(by('skill', 'codexy')?.agents, ['codex'])
    assert.deepEqual(by('skill', 'good:tool')?.agents, ['claude'])
    assert.deepEqual(by('mcp', 'codexsrv')?.agents, ['codex'])
    assert.deepEqual(by('mcp', 'quoted')?.agents, ['codex'])
    assert.deepEqual(by('mcp', 'geminisrv')?.agents, ['gemini'])
    assert.deepEqual(by('mcp', 'globalsrv')?.agents, ['claude'])
    assert.equal(by('memory', 'AGENTS.md')?.tokens, 10)
    assert.deepEqual(by('memory', 'AGENTS.md')?.agents, ['codex'])
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('survives a SKILL.md that is a device, a huge file and broken JSON', async () => {
  const h = await home()
  try {
    await mkdir(join(h, '.claude', 'skills', 'zero'), { recursive: true })
    await symlink('/dev/zero', join(h, '.claude', 'skills', 'zero', 'SKILL.md'))
    await skill(join(h, '.claude', 'skills'), 'huge', 'name: huge\ndescription: big', 'z'.repeat(2 * 1024 * 1024))
    await writeFile(join(h, '.claude.json'), '{ not json')
    const items = await scanInventory(h)
    assert.equal(items.find((i) => i.id === 'zero'), undefined)
    assert.equal(items.find((i) => i.id === 'huge') !== undefined, true)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('reads a large ~/.claude.json completely (no cut-off at 256 KiB)', async () => {
  const h = await home()
  try {
    const projects: Record<string, unknown> = {}
    for (let i = 0; i < 4000; i++) projects[`/p/${i}/${'x'.repeat(60)}`] = { history: 'h'.repeat(40) }
    await writeFile(join(h, '.claude.json'), JSON.stringify({ projects, mcpServers: { late: { command: 'x' } } }))
    const items = await scanInventory(h)
    assert.equal(items.some((i) => i.kind === 'mcp' && i.id === 'late'), true)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('a FIFO as SKILL.md or CLAUDE.md does not hang the scan', async () => {
  const h = await home()
  try {
    await mkdir(join(h, '.claude', 'skills', 'pipe'), { recursive: true })
    try {
      execFileSync('mkfifo', [join(h, '.claude', 'skills', 'pipe', 'SKILL.md')])
      execFileSync('mkfifo', [join(h, '.claude', 'CLAUDE.md')])
    } catch {
      return // no mkfifo on this system
    }
    const started = Date.now()
    const items = await scanInventory(h)
    assert.equal(Date.now() - started < 3000, true)
    assert.equal(items.find((i) => i.id === 'pipe'), undefined)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('Codex TOML: real server names only, no sub-tables, fast on hostile input', async () => {
  const h = await home()
  try {
    await mkdir(join(h, '.codex'), { recursive: true })
    await writeFile(join(h, '.codex', 'config.toml'), '[mcp_servers.github]\ncommand = "x"\n[mcp_servers.github.env]\nT = "1"\n[mcp_servers.docs.tools.search]\napproval = "x"\n')
    const items = await scanInventory(h)
    assert.deepEqual(items.filter((i) => i.kind === 'mcp').map((i) => i.id).sort(), ['docs', 'github'])
    await writeFile(join(h, '.codex', 'config.toml'), '[mcp_servers.x'.repeat(30_000))
    const started = Date.now()
    await scanInventory(h)
    assert.equal(Date.now() - started < 2000, true)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('MCP servers of ~/.claude.json: global ones and one entry per project', async () => {
  const h = await home()
  try {
    await writeFile(join(h, '.claude.json'), JSON.stringify({
      mcpServers: { everywhere: {} },
      projects: { '/w/shop': { mcpServers: { crm: { env: { K: 'SECRET' } } } }, '/w/blog': { mcpServers: { crm: {} } } }
    }))
    const items = await scanInventory(h)
    const crm = items.find((i) => i.id === 'crm')
    assert.equal(crm?.scope, 'project')
    assert.equal(crm?.source, 'project:shop')
    assert.deepEqual(crm?.also, ['project:blog'])
    assert.equal(items.find((i) => i.id === 'everywhere')?.scope, 'global')
    assert.equal(JSON.stringify(items).includes('SECRET'), false)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('project names are the name of the folder you work in', async () => {
  const h = await home()
  try {
    await writeFile(join(h, '.claude.json'), JSON.stringify({ projects: { '/w/Kunden/shop-site': {}, '/w/OWN/broBreak': {}, relative: {} } }))
    const names = await scanProjectNames(h)
    assert.equal(names['-w-Kunden-shop-site'], 'shop-site')
    assert.equal(names['-w-OWN-broBreak'], 'broBreak')
    assert.equal(Object.keys(names).length, 2)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('an entry installed for several AIs lists every AI', async () => {
  const h = await home()
  try {
    await skill(join(h, '.claude', 'skills'), 'twin', 'name: twin\ndescription: in both')
    await skill(join(h, '.codex', 'skills'), 'twin', 'name: twin\ndescription: in both')
    const items = await scanInventory(h)
    const twin = items.find((i) => i.id === 'twin')
    assert.deepEqual(twin?.agents, ['claude', 'codex'])
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})
