# CashHeap — Claude Context

## What this app is

CashHeap is a local-first personal finance desktop app built with Electron. All data lives in a local SQLite database (`spend.db`). There is no backend cloud service — the Express server runs as a child process inside Electron.

The React UI is split across `src/SpendTracker.jsx` (root app shell, ~400 lines) plus 44 feature files in `src/views/`, `src/components/`, `src/auth/`, and `src/utils/`. Heavy views are lazy-loaded with React.lazy.

---

## Architecture

| Layer | Details |
|---|---|
| UI | React 19, Recharts, all inline styles using design tokens (`T` object) |
| Desktop shell | Electron 32 — `electron/main.mjs` |
| Web framework | Next.js 16 (App Router) on port 3000 — replaces Vite + Express |
| API routes | `app/api/` — Next.js route handlers (replaces `server/routes/`) |
| Database | SQLite via better-sqlite3 — `server/db/index.js` |
| DB init | `instrumentation.js` — runs `migrate()` + seed once on server start |
| DAL | `server/dal/` — one file per entity (holdings, etc.) |
| AI | OpenRouter (default) · Gemini · DeepSeek · Ollama |

### Key files

- `src/SpendTracker.jsx` — entire React app
- `src/constants/index.js` — NAV_ITEMS, DEFAULT_CATS, DEFAULT_SETTINGS, COLORS, CADENCES
- `src/utils/formatters.js` — fmt, fmtUSD, today, uid, etc.
- `src/utils/dateUtils.js` — buildDates, _df, _label, _sqlDf
- `src/api/client.js` — fetchData, patchData
- `server/db/index.js` — migrate(), seedFromJson()
- `server/dal/holdings.js` — upsertHolding, replaceAllHoldings, etc.
- `server/routes/data.js` — GET/POST /api/data, PATCH /api/holdings/prices
- `server/routes/sql.js` — POST /api/db/sql (Jarvis query endpoint)

### Design tokens

All styles reference a `T` object defined near the top of `SpendTracker.jsx`:

```js
const T = {
  bg, surface, overlay, border,
  tx1, tx2, tx3,           // stone-900 / 600 / 400
  accent, accentBg, accentMid,  // indigo
  green, greenBg, red, redBg, amber, amberBg,
  shadow, shadowMd,
  r: 8, rCard: 12,
};
```

Shared style helpers: `CA` (card), `IS` (input), `Btn` (button variants), `Fld` (field label).

---

## Jarvis AI

Jarvis is a GlobalChat FAB component. It uses a schema-driven SQL tool library to query the local database and synthesise plain-English answers.

### Key internals

- `TOOL_LIBRARY` — named functions that return `__SQL__: <query>` markers
- `buildSchemaQuery(view, measureKey, opts)` — schema-driven SQL builder using `DEFAULT_SCHEMA`
- `_expUnion(df, cf)` — UNION ALL of `transactions WHERE type='expense'` and `vacation_txns`
- `execTool(name, args)` — runs `__SQL__:` markers against `/api/db/sql`
- `extractFacts(toolResults)` — flattens results into `{key, value}` pairs
- `callSynthesis(question, toolResults)` — LLM synthesis with number validation
- `callLLM(msgs, sys)` — routes to OpenRouter / Gemini / DeepSeek / Ollama
- `autoWidget(id, label, result, preferredType)` — renders tool results as metric/bar/pie/table widgets
- `DOMAIN_PATTERNS` + `classifyQuery` — keyword-based domain routing
- `SelectableWrapper` + `DepthCtx` — in-depth mode: clicking dashboard cards attaches data to queries

### LLM number validation

After synthesis, numbers in the LLM reply are checked against the set of values returned by tools. Any response containing an invented number (not within $0.02 of a known value) is replaced with the raw fact value. This prevents hallucinated totals.

### Error handling

Three try/catch boundaries ensure a missing or broken API key degrades gracefully:
1. Around `callSynthesis` — falls back to raw fact string
2. Around the LLM fallback routing path — shows a "check your settings" message
3. Around `callInsightsLLM` — insights panel fails silently

---

## Database

SQLite file: `spend.db` (project root in dev, OS user-data dir in production).

### Tables

`transactions`, `bills`, `bill_payments`, `vacations`, `vacation_txns`, `holdings`, `account_history`, `expected_income`, `cat_budgets`, `goals`, `settings`, `accounts`

### Migrations

`server/db/index.js` exports `migrate()`, which runs a numbered `MIGRATIONS` array against a `schema_migrations` table (version INTEGER PRIMARY KEY). Each migration runs exactly once in order. New migrations go in the array; SQLite doesn't support `ADD COLUMN IF NOT EXISTS`, so use `PRAGMA table_info` checks inside migration functions.

---

## Known issues / decisions

- `paidBillsTotal` was removed from the dashboard spending formula — bill payments are already captured as expense transactions, so including it caused double-counting.
- Portfolio `currentPrice` is persisted to DB on every Stocks tab load via `PATCH /api/holdings/prices`. Jarvis uses `COALESCE(currentPrice, costBasis)` in portfolio SQL so queries work even when prices haven't been fetched yet.
- `_expUnion` must not reference columns that don't exist in `vacation_txns` (e.g. `taxDeductible`, `originalAmountUSD`). Only use columns present in both tables.

---

## Running the app

```bash
npm run dev           # Next.js at localhost:3000
npm run electron:dev  # native Electron window (loads localhost:3000)
npm test              # Vitest unit + integration tests
```

---

## Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

### Phase 1 — Foundation (Jul 2026)

- [x] Split `SpendTracker.jsx` into feature modules — 44 files in `src/views/`, `src/components/`, `src/auth/`, `src/utils/`
- [x] Lazy-load heavy views with React.lazy (cuts initial bundle ~80%)
- [x] Move shared design tokens to `src/theme/tokens.jsx`
- [x] **Migrate from Vite to Next.js** — `app/` directory with API routes replacing Express; `instrumentation.js` handles DB init; Electron loads port 3000.
- [x] Automated SQLite backup on launch (keep last 7 copies)
- [x] Data export / import v2 — JSON backup/restore in Reports with merge-by-ID strategy
- [x] DB schema versioning — numbered `MIGRATIONS` array in `server/db/index.js`, tracked in `schema_migrations` table
- [x] Vitest unit tests for all TOOL_LIBRARY functions (`src/__tests__/utils/toolLibrary.test.js`)
- [x] API integration tests with Supertest (`src/__tests__/server/api.test.js`)
- [x] E2E smoke test with Playwright — `e2e/smoke.spec.js`; run with `npm run test:e2e` (requires `npx playwright install chromium` once)
- [x] Settings keyword search — `show(...keywords)` helper in `src/views/Settings.jsx`
- [x] ⌘K command palette — `src/components/CommandPalette.jsx`; ⌘K/Ctrl+K global shortcut

### Phase 2 — Jarvis 2.0 (Aug 2026)

- [x] Streaming responses from OpenRouter/DeepSeek (eliminates 3s spinner)
- [x] True multi-turn context — keep last 10 turns in synthesis prompt
- [x] Tool retry with clarification when SQL returns 0 rows
- [x] Pinned / favourite queries — auto-run on Dashboard load
- [x] Proactive alerts on app open (budget limits, bills due, spending spikes)
- [x] Persistent insight history — scroll back past session boundary
- [x] Subscription detection tool
- [x] Goal projection tool — project completion dates from savings rate

### Phase 3 — Data In (Sep 2026)

- [x] Persistent CSV column mappings per bank/source
- [x] PDF bank statement parser (common Canadian bank formats)
- [x] Duplicate detection on import (flag same date + amount ± 1 day)
- [x] Merchant → category rules engine ("if merchant contains Sobeys → Groceries")
- [x] LLM-assisted categorisation with user review step
- [x] Category learning from edits (auto-suggest after 3 manual recategorisations)
- [x] Auto-generate future instances from cadence field
- [x] Bill → transaction auto-matching (mark bill paid when transaction matches)

### Phase 4 — Mobile & Sync (Oct 2026)

- [ ] PWA manifest + service worker (offline reads, queued writes)
- [ ] Mobile-responsive layout (bottom nav tab bar on narrow screens)
- [ ] iOS Share Sheet extension (share receipt → CashHeap with OCR pre-filled)
- [ ] Bill due reminders — native Electron OS toast 3 days before due date
- [ ] Budget overage notifications (at 80% and 100% of monthly budget)
- [ ] Weekly spending summary notification (Sunday)
- [ ] iCloud Drive sync — save `spend.db` to Mobile Documents folder
- [ ] Dropbox / custom path sync
- [ ] Conflict resolution UI for offline-then-sync scenarios

### Phase 5 — Sharing & Export (Nov 2026)

- [ ] Shared budget spaces — separate transaction pool, both partners see totals
- [ ] Partner read-only dashboard link (30-day expiry)
- [ ] Split transaction tool — mark as shared with ratio, track who owes whom
- [ ] PDF monthly report (income, spending by category, net, budget vs actual)
- [ ] Tax summary export — transactions by deduction category, CSV for T1 filing
- [ ] Accountant share package — zip of PDF + transactions CSV + receipts folder
- [ ] Shared savings goals — both partners contribute, bar shows each share

### Phase 6 — Advanced Analytics (Dec 2026)

- [ ] What-if scenario builder — reruns projections with adjusted assumptions
- [ ] Debt payoff simulator — avalanche vs snowball with extra payment sliders
- [ ] Mortgage extra payment calculator
- [ ] RRSP room tracker — contribution room from income, remaining room + tax impact
- [ ] TFSA room tracker — cumulative limit by year, over-contribution alert
- [ ] FHSA tracking — annual $8K / lifetime $40K limit, contribution log
- [ ] Annual financial report auto-generated Dec 31
- [ ] 12-month rolling category charts with year-over-year overlay
- [ ] Net worth milestone tracker

---

## Next.js migration notes

### Why

- Vite + Electron works but couples the app to the desktop. Next.js enables a hosted web version of CashHeap alongside the Electron build, which is needed for mobile access and the shared budget features in Phase 4–5.
- Next.js API routes replace the current Express server cleanly. The SQLite DAL layer (`server/dal/`) can be imported directly into Next.js route handlers.
- File-based routing replaces the current single-page view-switcher (`view` state in `SpendTracker.jsx`), which is one of the main reasons the file has grown to 10k lines.

### Plan

1. **Scaffold Next.js app** alongside the current Vite app (keep both runnable during migration)
2. **Move API routes** — `server/routes/*.js` → `app/api/*/route.js`; DAL and DB layers import unchanged
3. **Move views one at a time** — extract each view component from `SpendTracker.jsx` into `app/(views)/[view]/page.tsx`
4. **Electron integration** — use `next build` + `next export` (static) for the Electron shell, or run the Next.js dev server as the Electron renderer in dev mode
5. **Cut over** — remove Vite config and old Express server once all views are migrated

### Risks

- `better-sqlite3` is a native Node module — it cannot run in the browser. API routes must handle all DB access; client components must call the API. This is the same constraint as today (Express server), so the pattern is already established.
- Electron + Next.js requires either static export (`output: 'export'`) or running a local Next.js server as the renderer. Static export loses API routes, so the recommended approach is to keep Next.js running as a local server inside Electron (same as Express today).
- The existing single-file architecture means extraction will surface many implicit dependencies between components. Plan for 4–6 weeks of careful extraction before cutting over.
