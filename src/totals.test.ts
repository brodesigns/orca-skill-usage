import { assert, test } from 'orca/testing'
import { totalCalls } from './totals'

test('plugin rows are not counted twice', () => {
  const rows = [
    { kind: 'skill', auto: 3, direct: 1 },
    { kind: 'skill', auto: 2, direct: 0 },
    // The plugin row holds the sum of its skills: 3 + 1 + 2 = 6.
    { kind: 'plugin', auto: 5, direct: 1 },
    { kind: 'mcp', auto: 4, direct: 0 }
  ]
  assert.equal(totalCalls(rows, 10), 3 + 1 + 2 + 4 + 10)
  assert.equal(totalCalls([], 0), 0)
})
