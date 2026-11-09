import { assert, test } from 'orca/testing'
import { isTracked, mergeRows } from './merge'
import type { Item } from './inventory'
import { add, dayOf, emptyStats, projKey } from './usage'

const NOW = Date.now()
const DAY = 86_400_000
const item = (kind: Item['kind'], id: string, extra: Partial<Item> = {}): Item => ({ kind, id, label: id, source: 'user', tokens: 10, manual: false, scope: 'global', agents: ['claude'], ...extra })

test('joins usage with the inventory, splits auto and typed, marks unused', () => {
  const st = emptyStats()
  add(st, 'skills', 'used', 'claude', NOW)
  add(st, 'cmds', 'used', 'claude', NOW, 'direct')
  const rows = mergeRows([item('skill', 'used'), item('skill', 'idle')], st)
  const used = rows.find((r) => r.id === 'used')
  assert.equal(used?.auto, 1)
  assert.equal(used?.direct, 1)
  assert.equal(rows.find((r) => r.id === 'idle')?.auto, 0)
})

test('range filter hides old usage', () => {
  const st = emptyStats()
  add(st, 'skills', 'old', 'claude', NOW - 40 * DAY)
  const week = mergeRows([item('skill', 'old')], st, dayOf(NOW - 6 * DAY))
  assert.equal(week[0].auto, 0)
  const quarter = mergeRows([item('skill', 'old')], st, dayOf(NOW - 89 * DAY))
  assert.equal(quarter[0].auto, 1)
})

test('normalizes mcp names and claims each key once', () => {
  const st = emptyStats()
  add(st, 'mcp', 'my_server/tool', 'claude', NOW)
  add(st, 'skills', 'foo', 'claude', NOW)
  const rows = mergeRows(
    [item('mcp', 'my-server'), item('skill', 'foo'), item('skill', 'p:foo', { source: 'plugin:p' })],
    st
  )
  assert.equal(rows.find((r) => r.id === 'my-server')?.auto, 1)
  assert.equal(rows.reduce((n, r) => n + (r.kind === 'skill' ? r.auto : 0), 0), 1)
})

test('lists used-but-not-installed entries, never typed built-ins like /model', () => {
  const st = emptyStats()
  add(st, 'agents', 'Explore', 'claude', NOW)
  add(st, 'cmds', 'model', 'claude', NOW, 'direct')
  const rows = mergeRows([], st)
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}:${r.installed}`), ['agent:Explore:false'])
})

test('rows without usage data are flagged, not treated as unused', () => {
  assert.equal(isTracked({ kind: 'mcp', agents: ['gemini'] }), false)
  assert.equal(isTracked({ kind: 'mcp', agents: ['codex'] }), false)
  assert.equal(isTracked({ kind: 'skill', agents: ['codex'] }), true)
  assert.equal(isTracked({ kind: 'mcp', agents: ['claude', 'codex'] }), true)
  const rows = mergeRows([item('mcp', 'g', { agents: ['gemini'] })], emptyStats())
  assert.equal(rows[0].tracked, false)
})


test('rows list the projects their calls came from, most calls first, as short keys', () => {
  const st = emptyStats()
  for (let i = 0; i < 9; i++) add(st, 'skills', 'shop-sync', 'claude', NOW, 'auto', projKey('shop'))
  add(st, 'skills', 'shop-sync', 'claude', NOW, 'auto', projKey('blog'))
  add(st, 'cmds', 'shop-sync', 'claude', NOW, 'direct', projKey('blog'))
  const [row] = mergeRows([item('skill', 'shop-sync')], st)
  assert.deepEqual(row.usedInKeys, [[projKey('shop'), 9], [projKey('blog'), 2]])
  assert.equal('proj' in row, false)
  assert.equal(mergeRows([item('skill', 'unused')], st)[0].usedInKeys, undefined)
})
