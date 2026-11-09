// Totals for the tiles, kept apart from the panel so they can be tested.
export type CountRow = { kind: string; auto: number; direct: number }

/**
 * All recorded calls in the period. A plugin row already holds the sum of its own skills and agents,
 * so plugins are left out here; counting them would count those calls twice.
 */
export function totalCalls(rows: CountRow[], toolCalls: number): number {
  return rows.reduce((n, r) => n + (r.kind === 'plugin' ? 0 : r.auto + r.direct), 0) + toolCalls
}
