// Orca's plugin storage refuses values over 256 KiB. Larger JSON is split into chunks of plain strings.
// Every save writes a new generation of chunks and moves the pointer last, so a crash in between leaves the old value whole.
import type { OrcaWorkerApi } from 'orca/worker'

type Storage = OrcaWorkerApi['storage']

/** Characters per chunk: even at 4 bytes each this stays below the limit. */
const CHUNK = 60_000
const MAX_CHUNKS = 1000

/** Splits without cutting a surrogate pair in half. */
export function split(text: string): string[] {
  const parts: string[] = []
  let at = 0
  while (at < text.length) {
    let end = Math.min(at + CHUNK, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    parts.push(text.slice(at, end))
    at = end
  }
  return parts
}

type Pointer = { gen: number; n: number }

function asPointer(v: unknown): Pointer | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as Record<string, unknown>
  return Number.isInteger(p.gen) && Number.isInteger(p.n) && (p.n as number) >= 0 && (p.n as number) <= MAX_CHUNKS ? { gen: p.gen as number, n: p.n as number } : null
}

/** Writes a new generation of chunks, then the pointer, then removes the old generation (and the older single-count format). */
export async function saveJson(storage: Storage, key: string, value: unknown): Promise<void> {
  const parts = split(JSON.stringify(value))
  const before = asPointer(await storage.get(`${key}.p`))
  const gen = (before?.gen ?? 0) + 1
  for (let i = 0; i < parts.length; i++) await storage.set(`${key}.${gen}.${i}`, parts[i])
  await storage.set(`${key}.p`, { gen, n: parts.length })
  if (before !== null) for (let i = 0; i < before.n; i++) await storage.delete(`${key}.${before.gen}.${i}`)
  // The format of earlier versions: `key.n` and `key.<i>`.
  const legacy = await storage.get(`${key}.n`)
  if (typeof legacy === 'number' && Number.isInteger(legacy) && legacy >= 0 && legacy <= MAX_CHUNKS) {
    for (let i = 0; i < legacy; i++) await storage.delete(`${key}.${i}`)
    await storage.delete(`${key}.n`)
  }
}

async function readChunks(storage: Storage, name: (i: number) => string, n: number): Promise<unknown> {
  let text = ''
  for (let i = 0; i < n; i++) {
    const part = await storage.get(name(i))
    if (typeof part !== 'string') return null
    text += part
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Reads a value saved by `saveJson`; null when absent, incomplete or broken. */
export async function loadJson(storage: Storage, key: string): Promise<unknown> {
  const p = asPointer(await storage.get(`${key}.p`))
  if (p !== null) return readChunks(storage, (i) => `${key}.${p.gen}.${i}`, p.n)
  const legacy = await storage.get(`${key}.n`)
  if (typeof legacy === 'number' && Number.isInteger(legacy) && legacy >= 0 && legacy <= MAX_CHUNKS) return readChunks(storage, (i) => `${key}.${i}`, legacy)
  return null
}
