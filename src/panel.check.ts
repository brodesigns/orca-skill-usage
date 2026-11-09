// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host.
import { defineCheck } from 'orca/testing'

const now = Date.now()
const iso = (daysAgo: number): string => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10)
const entry = (days: Record<string, [number, number]>, by: Record<string, number>) => ({ last: now - 86_400_000, by, days })

export default defineCheck({
  fresh: {},
  used: {
    storage: {
      hist: {
        offsets: {},
        seen: [],
        from: 0,
        stats: {
          skills: { commit: entry({ [iso(1)]: [9, 3], [iso(5)]: [4, 0] }, { claude: 16 }), deploy: entry({ [iso(3)]: [2, 1] }, { claude: 2, codex: 1 }) },
          mcp: { 'docs-server/search': entry({ [iso(2)]: [7, 0] }, { claude: 7 }) },
          agents: { Explore: entry({ [iso(2)]: [5, 0] }, { claude: 5 }) },
          tools: { Bash: entry({ [iso(1)]: [120, 0] }, { claude: 120 }), Read: entry({ [iso(1)]: [80, 0] }, { claude: 80 }) },
          cmds: { commit: entry({ [iso(1)]: [0, 3] }, { claude: 3 }) }
        }
      }
    }
  }
})
