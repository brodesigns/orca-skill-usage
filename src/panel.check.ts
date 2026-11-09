// `orca plugin check` and `shot --scenario` render the panel once per scenario, each with the worker on a fresh host.
// The demo scenarios show made-up numbers (src/demo.ts), so no real skill or project name ever ends up in a picture.
import { defineCheck } from 'orca/testing'

const demo = { demo: true }
const plugin = (values: Record<string, unknown>) => ({ storage: demo, persisted: { plugin: values } })

export default defineCheck({
  fresh: {},
  // The overview with the summary tiles.
  demo: { storage: demo },
  // Cards of the Skills tab: where an entry exists and where it is used.
  cards: plugin({ showTiles: false, tab: 'skill' }),
  // Only what was not called in the period.
  unused: plugin({ showTiles: false, tab: 'skill', onlyUnused: true, sortBy: 'tokens' }),
  mcp: plugin({ showTiles: false, tab: 'mcp' }),
  // One project chosen: its own entries and the calls that happened there.
  project: plugin({ project: '-demo-shop-site', range: 7 }),
  // The most used tools and the settings.
  other: plugin({ showTiles: false, tab: 'other' }),
  // The same in German.
  de: plugin({ lang: 'de', showTiles: false, tab: 'skill' }),
  'de-overview': plugin({ lang: 'de' })
})
