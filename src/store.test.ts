import { assert, test } from 'orca/testing'
import { loadJson, saveJson, split } from './store'

/** A storage that refuses values over 256 KiB, like Orca's. */
function fake() {
  const data = new Map<string, unknown>()
  return {
    data,
    storage: {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: unknown) => {
        if (Buffer.byteLength(JSON.stringify(v)) > 262_144) throw new Error('value exceeds 262144 bytes')
        data.set(k, v)
      },
      delete: async (k: string) => void data.delete(k),
      keys: async () => [...data.keys()],
      onDidChange: () => ({ dispose() {} })
    }
  }
}

test('stores values far over the limit in chunks and reads them back', async () => {
  const f = fake()
  const value = { rows: Array.from({ length: 40_000 }, (_, i) => ({ id: `item-${i}`, text: 'äöü😀'.repeat(3) })) }
  assert.equal(JSON.stringify(value).length > 1_000_000, true)
  await saveJson(f.storage as never, 'k', value)
  assert.deepEqual(await loadJson(f.storage as never, 'k'), value)
})

test('a shorter value removes the old chunks; broken or missing data reads as null', async () => {
  const f = fake()
  await saveJson(f.storage as never, 'k', { big: 'x'.repeat(300_000) })
  const many = [...f.data.keys()].length
  await saveJson(f.storage as never, 'k', { small: 1 })
  assert.equal([...f.data.keys()].length < many, true)
  assert.deepEqual(await loadJson(f.storage as never, 'k'), { small: 1 })
  const p = f.data.get('k.p') as { gen: number }
  f.data.set(`k.${p.gen}.0`, '{"broken')
  assert.equal(await loadJson(f.storage as never, 'k'), null)
  assert.equal(await loadJson(f.storage as never, 'missing'), null)
})

test('never cuts a surrogate pair', () => {
  const text = '😀'.repeat(70_000)
  const parts = split(text)
  assert.equal(parts.join(''), text)
  assert.equal(parts.every((p) => !/[\ud800-\udbff]$/.test(p)), true)
})

test('a crash between the chunks and the pointer leaves the old value whole', async () => {
  const f = fake()
  await saveJson(f.storage as never, 'k', { v: 1, pad: 'x'.repeat(130_000) })
  // The next save dies after writing a new chunk: the pointer was not moved yet.
  const p = f.data.get('k.p') as { gen: number }
  f.data.set(`k.${p.gen + 1}.0`, '{"v":2,"half')
  assert.deepEqual((await loadJson(f.storage as never, 'k') as { v: number }).v, 1)
})

test('reads and migrates the older single-count format', async () => {
  const f = fake()
  f.data.set('k.0', '{"old":')
  f.data.set('k.1', 'true}')
  f.data.set('k.n', 2)
  assert.deepEqual(await loadJson(f.storage as never, 'k'), { old: true })
  await saveJson(f.storage as never, 'k', { fresh: 1 })
  assert.equal(f.data.has('k.n'), false)
  assert.equal(f.data.has('k.0'), false)
  assert.deepEqual(await loadJson(f.storage as never, 'k'), { fresh: 1 })
})

test('a hostile pointer is ignored', async () => {
  const f = fake()
  f.data.set('k.p', { gen: 1, n: 999_999 })
  assert.equal(await loadJson(f.storage as never, 'k'), null)
  f.data.set('k.p', 'nope')
  assert.equal(await loadJson(f.storage as never, 'k'), null)
})
