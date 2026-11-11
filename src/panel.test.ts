import { assert, mockHost, mount, test } from 'orca/testing'
import { demoSnapshot } from './demo'
import * as panel from './panel'

// 250 skills: three pages of at most 100 cards.
const base = demoSnapshot({ range: 30, scope: 'all' })
const rows = Array.from({ length: 250 }, (_, i) => ({ ...base.rows[0], id: `skill-${i}`, label: `skill-${i}` }))

test('a long list is paged, and another sort starts again at the first page', async () => {
  const p = await mount(panel, {
    host: mockHost({ requests: { 'usage.get': { ...base, rows } } }),
    persisted: { plugin: { showTiles: false, tab: 'skill' } }
  })
  const next = () => p.findAll({ type: 'Button', text: 'Next' })[0]
  assert.ok(p.find({ text: '1–100 of 250' }))
  assert.equal(p.findAll({ type: 'Card' }).length, 100)

  await p.press(next())
  await p.press(next())
  assert.ok(p.find({ text: '201–250 of 250' }))
  assert.equal(p.findAll({ type: 'Card' }).length, 50)

  await p.select({ label: 'Sort by' }, 'tokens')
  assert.ok(p.find({ text: '1–100 of 250' }))
  assert.deepEqual(p.errors, [])
})
