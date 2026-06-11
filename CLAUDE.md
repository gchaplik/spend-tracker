# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

CashHeap is a local-first personal finance desktop app built with Electron. All data lives in a local SQLite database (`spend.db`). There is no backend cloud service — the Next.js server runs inside Electron on port 3000.

The React UI is split across `src/SpendTracker.jsx` (root app shell) plus feature files in `src/views/`, `src/components/`, `src/auth/`, and `src/utils/`. Heavy views are lazy-loaded with React.lazy.

---

## Architecture

| Layer | Details |
|---|---|
| UI | React 19, Recharts, all inline styles using design tokens (`T` object) |
| Desktop shell | Electron 32 — `electron/main.mjs` |
| Web framework | Next.js 16 (App Router) on port 3000 |
| API routes | `app/api/` — Next.js route handlers |
| Database | SQLite via better-sqlite3 — `server/db/index.js` |
| DB init | `instrumentation.js` — runs `migrate()` + seed once on server start |
| DAL | `server/dal/` — one file per entity (holdings, etc.) |
| AI | OpenRouter (default) · Gemini · DeepSeek · Ollama |

### Key files

- `src/SpendTracker.jsx` — root app shell, all state, all navigation
- `src/constants/index.js` — NAV_ITEMS, DEFAULT_CATS, DEFAULT_SETTINGS, COLORS, CADENCES
- `src/utils/formatters.js` — fmt, fmtUSD, today, uid, etc.
- `src/utils/dateUtils.js` — buildDates, _df, _label, _sqlDf
- `src/utils/catLearn.js` — merchant→category learning (localStorage, threshold 3)
- `src/api/client.js` — fetchData, patchData
- `server/db/index.js` — migrate(), seedFromJson()
- `app/api/pdf-parse/route.js` — PDF bank statement parser (PDFParse class from pdf-parse)

### Design tokens

All styles reference a `T` object from `src/theme/tokens.jsx`:

```js
const T = {
  bg, surface, overlay, border,
  tx1, tx2, tx3,           // stone-900 / 600 / 400
  accent, accentBg, accentMid,
  green, greenBg, red, redBg, amber, amberBg,
  shadow, shadowMd,
  r: 8, rCard: 12,
};
```

Shared helpers: `CA` (card style), `IS` (input style), `Btn` (button variants), `Fld` (field label).

---

## Jarvis AI

- `TOOL_LIBRARY` — named functions returning `__SQL__:` markers
- `callLLM(msgs, sys, onChunk)` — routes to OpenRouter/Gemini/DeepSeek/Ollama; streams when onChunk provided
- `callSynthesis(question, toolResults, onChunk, history)` — synthesis with last-10-turn context
- `autoWidget` — renders results as metric/bar/pie/table widgets
- Persistent chat: `localStorage["ch_jarvis_msgs"]` (last 50 messages)
- Pinned queries: `settings.pinnedQueries` — auto-run on first open per session

---

## Database

SQLite: `spend.db`. Tables: `transactions`, `bills`, `bill_payments`, `vacations`, `vacation_txns`, `holdings`, `account_history`, `expected_income`, `cat_budgets`, `goals`, `settings`, `accounts`

Migrations: numbered `MIGRATIONS` array in `server/db/index.js`, tracked in `schema_migrations`. New migrations append to the array. Use `PRAGMA table_info` checks since SQLite doesn't support `ADD COLUMN IF NOT EXISTS`.

---

## Known decisions

- Bill payments are already captured as expense transactions — don't double-count them in spending totals.
- `_expUnion` unions `transactions` and `vacation_txns` — only reference columns present in both tables.
- `nfmt(v)` is the discrete-mode-aware formatter. Never use `fmt()` directly in views. In `useAlerts`, read `settings.discreteMode` synchronously (not `window.__discreteMode`) since `useMemo` runs before effects.
- Category rules (`settings.catRules`) and learned categories (`ch_cat_learn` localStorage) are both applied in `applyAutoCategory()` in CSVImport during preview.
- Bill auto-matching runs after CSV import via `autoMatchBills()` in SpendTracker.
- Confirming expected income with a cadence auto-generates the next instance in `confirmPayment()`.
- `settings.catRollover` (`{cat: bool}`) — per-category rollover flags; Dashboard computes effective budgets with carryover.
- `settings.merchantNorms` (`[{id, pattern, replacement}]`) — display-layer name normalization applied in History rows.
- `settings.zeroBudget` (`bool`) — zero-based budget mode shown in Categories with unallocated remainder.
- `History` accepts `subscriptions` (for ↻ badge) and `merchantNorms` (for display normalization) props.
- Split transaction: `SplitModal` in History removes original and inserts multiple transactions.
- Duplicate manager in History: O(n²) scan over last 600 singles; dismissedDupes stored in component state.
- RRSP/TFSA tracker in Reports: `RrspTfsaTracker` component backed by `ch_rrsp_tfsa` localStorage.
- Net worth milestones: `prevNetWorthRef` in SpendTracker fires toast + Notification when crossing $10k/$25k/$50k etc.
- Web Notifications fired on app launch (bills ≤3 days, budget ≥80%/100%, weekly digest Sundays) and on saveTxns for large amounts.

---

## Running the app

```bash
npm run dev           # Next.js at localhost:3000
npm run electron:dev  # native Electron window
npm test              # Vitest unit + integration tests
npm run electron:build # production build
```

---

## Roadmap

Status: `[ ]` not started · `[~]` in progress · `[x]` done

### Phase A — Cleanup & Quick Wins

- [x] Delete stale `src/views/* 2.jsx` backup files
- [x] Dashboard: month-over-month spending delta cards (% change vs last month per category)
- [x] Dashboard: spending velocity indicator (on-pace / over-pace / under-pace for the month)
- [x] Quick-add transaction (Cmd+N) — minimal inline form, auto-saves and stays on current view
- [x] History: bulk category reassign — select multiple transactions, set category in one action
- [x] History: inline transaction tags (free-form, searchable, stored in `note` field with `#tag` syntax)

### Phase B — Smart Budgets

- [x] Budget rollover — unused budget carries forward to next month (toggle per category, stored in `settings.catRollover`)
- [x] Budget suggestions — analyse 3-month average spend, suggest budget amounts with one-click apply
- [x] Overspend breakdown — when a category exceeds budget, show the top transactions that drove it
- [x] Zero-based budget mode — allocate every dollar of expected income to categories; show unallocated remainder

### Phase C — Analytics & Reporting

- [x] Year-over-year chart — bar chart comparing monthly spend/income current year vs prior year
- [x] PDF monthly report — print-to-PDF via window.print() — Print/PDF button in Reports
- [x] RRSP / TFSA room tracker — log contributions, compute remaining room, flag over-contributions
- [x] Savings rate tracker — % of income saved each month, rolling 12-month chart
- [x] Net worth milestones — toast when net worth crosses a round number ($10k, $25k, etc.)

### Phase D — Transaction Intelligence

- [x] Split transaction — divide one transaction across multiple categories with individual amounts
- [x] Merchant name normalizer — clean raw bank strings using a rules table in Categories; applied in History display
- [x] Duplicate manager — scan for same-merchant/same-amount/±3-day dupes; dedupe UI in History header
- [x] Subscription badge — transactions matching a known subscription (from SubscriptionManager) show a ↻ recurring icon

### Phase E — Notifications (Electron)

- [x] Native OS toast for bill due in ≤3 days — fires on app launch via Web Notification API
- [x] Budget overage toast — triggers at 80% and 100% of monthly category budget (on launch)
- [x] Large transaction toast — fires when a new transaction exceeds `settings.largeTransactionAlert`
- [x] Weekly digest — Sunday summary notification: top spending category, weekly total
