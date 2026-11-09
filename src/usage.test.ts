import { assert, test } from 'orca/testing'
import { add, classify, countIn, dayOf, emptyStats, mergeStats, parseStats, prune } from './usage'
import { agentName, agentNames, note, source, t } from './i18n'

const NOW = Date.parse('2026-11-09T12:00:00Z')
const DAY = 86_400_000

test('classifies calls', () => {
  assert.deepEqual(classify('Skill', { skill: '/commit' }), { bucket: 'skills', id: 'commit' })
  assert.deepEqual(classify('mcp__secondbrain-write__notiz_schreiben', {}), { bucket: 'mcp', id: 'secondbrain-write/notiz_schreiben', server: 'secondbrain-write' })
  assert.deepEqual(classify('Agent', { subagent_type: 'Explore' }), { bucket: 'agents', id: 'Explore' })
  assert.deepEqual(classify('Bash', {}), { bucket: 'tools', id: 'Bash' })
  assert.equal(classify('Skill', 'x'), null)
  assert.equal(classify(42 as unknown as string, {}), null)
})

test('other agents load a skill by reading SKILL.md', () => {
  const cmd = { command: ['bash', '-lc', 'cat /Users/me/.codex/skills/seo-audit/SKILL.md'] }
  assert.deepEqual(classify('shell', cmd, 'codex'), { bucket: 'skills', id: 'seo-audit' })
  // Claude Code has the Skill tool: a Bash read is just a Bash call.
  assert.deepEqual(classify('Bash', cmd, 'claude'), { bucket: 'tools', id: 'Bash' })
})

test('counts per day and mode, filters by range', () => {
  const s = emptyStats()
  add(s, 'skills', 'x', 'claude', NOW)
  add(s, 'skills', 'x', 'claude', NOW - 10 * DAY)
  add(s, 'skills', 'x', 'claude', NOW - 1 * DAY, 'direct')
  assert.deepEqual(countIn(s.skills.x, null), { auto: 2, direct: 1 })
  assert.deepEqual(countIn(s.skills.x, dayOf(NOW - 7 * DAY)), { auto: 1, direct: 1 })
  assert.equal(s.skills.x.last, NOW)
})

test('prunes old days and merges two stats', () => {
  const a = emptyStats()
  add(a, 'tools', 'Bash', 'claude', NOW - 200 * DAY)
  add(a, 'tools', 'Read', 'claude', NOW)
  prune(a, NOW)
  assert.equal(a.tools.Bash, undefined)
  const b = emptyStats()
  add(b, 'tools', 'Read', 'codex', NOW)
  const m = mergeStats(a, b)
  assert.deepEqual(countIn(m.tools.Read, null), { auto: 2, direct: 0 })
  assert.deepEqual({ ...m.tools.Read.by }, { claude: 1, codex: 1 })
})

test('hardening: odd names, bad stored data, agent cap', () => {
  const s = emptyStats()
  add(s, 'tools', 'Bash', '__proto__', NOW)
  assert.equal(s.tools.Bash.by['__proto__'], 1)
  for (let i = 0; i < 30; i++) add(s, 'tools', 'Bash', `a${i}`, NOW)
  assert.equal(Object.keys(s.tools.Bash.by).length <= 20, true)
  const parsed = parseStats({
    skills: {
      x: { last: 1, by: { claude: 'oops', codex: 3 }, days: { '2026-11-01': [1, 'bad'], 'nonsense': [1, 1] } },
      y: 'broken'
    }
  })
  assert.deepEqual({ ...parsed.skills.x.by }, { codex: 3 })
  assert.deepEqual(Object.keys(parsed.skills.x.days), ['2026-11-01'])
  assert.deepEqual(parsed.skills.x.days['2026-11-01'], [1, 0])
  assert.equal(parsed.skills.y, undefined)
})

test('evicts the rarest entries beyond the bucket limit', () => {
  const s = emptyStats()
  for (let i = 0; i < 700; i++) add(s, 'skills', `s${i}`, 'claude', NOW)
  add(s, 'skills', 's0', 'claude', NOW)
  assert.equal(Object.keys(s.skills).length <= 650, true)
})

test('translates codes in both languages', () => {
  assert.equal(source('de', 'projects:3'), '3 Projekt(e)')
  assert.equal(source('en', 'projects:3'), '3 project(s)')
  assert.equal(source('en', 'plugin:user'), 'plugin user')
  assert.equal(source('en', 'project:shop'), 'project shop')
  assert.equal(source('en', 'marketplace:a:b'), 'a:b')
  assert.equal(source('en', 'codex'), 'codex')
  assert.equal(note('en', 'tools:2:a, b'), '2 tool(s) used: a, b')
  assert.equal(note('de', 'content:12'), 'Inhalt beim Aufruf: ca. 12 Token')
  assert.equal(t('en', 'unused'), 'unused')
})

test('names the AI behind an entry', () => {
  assert.equal(agentName('claude'), 'Claude')
  assert.equal(agentName('claude-code'), 'Claude')
  assert.equal(agentName('codex'), 'Codex (ChatGPT)')
  assert.equal(agentName('agents'), 'Shared (.agents)')
  assert.equal(agentName('my-agent'), 'my-agent')
  assert.deepEqual(agentNames(['codex', 'claude-code', 'claude']), ['Claude', 'Codex (ChatGPT)'])
})
