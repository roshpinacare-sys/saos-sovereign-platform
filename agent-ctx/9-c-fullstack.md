# Task 9-c — one-net brain builder (full-stack agent)

Date: 2026-09-30 · Platform: SAOS v97.0.0 (biblioteque "ביקורת-התצוגה")

## What was built (ONLY these 5 files touched)
1. `prisma/schema.prisma` — appended `AgentHeartbeat {id, source, vitality @default("live"), payload, at, @@index([source, at])}`; `bun run db:push` OK (27 models now).
2. `src/lib/saos/one-net.ts` — the coordination brain: Promise.allSettled composition of agentCensus / keeperStatus / probeAgentsNet / latestOrganismVerify(owner, topRepo) / superviseOnce / realWorkStats / MESH_CONTRACT_COUNT / SAOS_VERSION / 3 journal tails (64KB tail-read, 5s budget) / AgentHeartbeat latest-per-source + staleness (live ≤120s, stale, none). 15s cache + inflight dedupe. Exports `OneNetSnapshot` + `getOneNetSnapshot()`. Never throws, never fabricates.
3. `src/app/api/saos/one-net/route.ts` — GET only, runtime nodejs, never throws.
4. `src/app/api/saos/one-net/beat/route.ts` — THE sink: requireAuth bearer → whitelist {keeper|gate-herald|swarm|evm-mesh|web|anvil} → vitality live|stale → payload ≤4096 chars → create + prune to 30/source (single deleteMany at < cutoff) → {ok:true,at}. OpLog "one-net.beat" on rejections only.
5. `src/components/saos/views/one-net.tsx` — hero view "רשת-אחת — היחידה המתואמת", `export function OneNetView()`, useLive 15s, established keeper.tsx conventions, honest empty states everywhere.

## Verification evidence
- GET /api/saos/one-net → 200; warm 5.7ms / cold 0.84s (budgets 300ms/3s); ok:true, 7/7 services live, census 37/37, organismVerify Domain 52/53, repos 16/8/16, contracts 10, supervision 4/4, issuesOpen 3, deliverables 87, beats 19, errors []
- POST beat correct key → 200 {ok:true, at}; wrong key → 401; source "hacker" → 400; payload 5011 chars → 400
- Prune measured: 37 rows for web → 30 after next beat; synthetic test rows deleted afterwards (ledger holds only real beats)
- OpLog rejections recorded (401 bearer:78657072, whitelist, oversize)
- 9-e mini-service wiring ALREADY LIVE: keeper/gate-herald/swarm/evm-mesh beats arrive on cadence
- `bun run lint` 0 errors · `bunx tsc --noEmit` clean · dev.log clean (all 200s)

## Wiring snippet for the orchestrator (shell.tsx + page.tsx — I did NOT touch them)
- ViewId union: add `"one-net"` after `"agentchat"`.
- VIEWS insert after agentchat entry (RadioTower already imported in shell.tsx):

```tsx
  {
    id: "one-net",
    label: "רשת-אחת — היחידה המתואמת",
    short: "רשת-אחת",
    desc: "הוראת הבעלים 'יחידה אחת, רשת אחת, הכל מתואם' — תמונת-מצב אחת מורכבת מכל המצרפים החיים: שבעת השירותים עם דופק ויומן-זנב · מצבת-הסוכנים · 16 הריפואים · עשרת החוזים · העבודה האמיתית · פנקס-הדופק (חי ≤120ש') — נגזר וכנה, בלי ירוק-מזויף",
    icon: <RadioTower size={16} />,
    group: "תפעול"
  },
```

- page.tsx TITLES: `"one-net": "רשת-אחת — היחידה המתואמת",` (Record is exhaustive — required).
- page.tsx import: `import { OneNetView } from "@/components/saos/views/one-net";`
- page.tsx render: `{view === "one-net" && <OneNetView />}` after the agentchat block.

## Notes for the next agent
- Beat contract (shared with 9-e): POST /api/saos/one-net/beat · Authorization: Bearer <plaintext admin key> · {"source":"keeper","vitality":"live","payload":{...≤4KB}} → 200 {ok:true,at:"ISO"} | 400 invalid | 401 auth. Sources: keeper|gate-herald|swarm|evm-mesh|web|anvil. Supervisor never beats (measured in-process).
- web/anvil had not beaten at build time (staleness "none" — honest); their services still derive live from keeper/TCP.
- View shows type import from "@/lib/saos/one-net" (`import type`) — erased at build; do NOT import runtime values from it in client code.
