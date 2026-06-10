# CashHeap

A local-first personal finance app for macOS, Windows, and Linux. 
---

## Features

### Core Finance

| Module | Description |
|---|---|
| **Dashboard** | Monthly spending, income, budget overview, and trend charts at a glance |
| **Transactions** | Manual expense & income entry, full history, bulk editing |
| **Bills** | Track recurring bills, mark them paid, see what's outstanding |
| **Categories** | Custom categories with monthly budget caps and progress alerts |
| **Goals** | Savings goals with target amounts and dates |
| **Net Worth** | Accounts, assets, and liabilities in one view |
| **Stocks** | Portfolio holdings with live CAD/USD prices, persisted to DB |
| **Expected Income** | Schedule future payments and mark them received |
| **Vacations** | Separate trip budgets that roll into your overall spending totals |
| **Cash Flow** | 90-day balance forecast based on bills, income, and spending patterns |
| **Debt Tracker** | Loans, credit cards, and mortgages with payoff strategies |
| **Subscriptions** | Detect recurring charges and see your total monthly cost |
| **Tax Tracker** | Tag deductible transactions, track RRSP contributions |
| **Retirement Planner** | RRSP/TFSA projections with compound growth |
| **Mortgage Calculator** | Amortization with extra payment simulator |
| **Household** | Split expenses across members, track who owes whom |
| **Calendar** | Monthly view of bills, income, goals, and vacations |
| **Wishlist** | Track planned purchases and see when you can afford them |

### AI — Jarvis

Jarvis is a financial assistant built into every screen via a floating chat panel. It queries your actual data through a SQL tool library and synthesises plain-English answers.

| Capability | Description |
|---|---|
| **Natural language queries** | "What did I spend on dining last month?" "What's my savings rate?" |
| **In-depth mode** | Click any dashboard card to attach its data to a Jarvis query |
| **AI Insights** | Proactive analysis and charts auto-generated over your transaction history |
| **Receipt OCR** | Photograph or upload a receipt — Gemini extracts it into a transaction |
| **Folder sync** | Point the app at a folder of receipts and bulk-import them |

Jarvis runs against your local SQLite database. Nothing is sent to any external service unless you configure a cloud AI key.

### Import / Export

- **CSV Import** — Import transactions from any bank export with column mapping and duplicate detection
- **Reports** — Export monthly summaries, annual tax reports, and filtered CSVs

### Security

- **PIN lock** — PBKDF2-hashed 6-digit PIN protects the app at launch and after idle
- **Biometrics** — Touch ID (macOS) and Windows Hello / FIDO2 (Windows) for one-touch unlock
- **Two-Factor Auth** — TOTP authenticator app support
- **Auto-lock** — Configurable idle timeout

### Appearance

- Dark mode — inverts colours across the entire UI
- Colour blind modes — Deuteranopia, Protanopia, Tritanopia, Greyscale

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19, Recharts, inline styles |
| Desktop shell | Electron 32 |
| Server | Express (child process in dev, embedded in prod) |
| Database | SQLite via better-sqlite3 |
| AI | OpenRouter · Google Gemini · DeepSeek · Ollama (local) |
| Build | Vite 5, electron-builder |
| Tests | Vitest, Testing Library, Supertest |

---

## Getting Started

### 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| npm | 9+ | Comes with Node |
| Git | any | To clone the repo |
| Xcode CLT (macOS) | any | Required to compile `better-sqlite3` native module |

On macOS, install Xcode Command Line Tools if prompted:
```bash
xcode-select --install
```

### 2. Clone and install

```bash
git clone https://github.com/gchaplik/cashheap.git
cd cashheap
npm install
```

`npm install` runs `postinstall` automatically, which rebuilds `better-sqlite3` for your platform and architecture. If you see a native module error later, run `npm rebuild better-sqlite3` manually.

### 3. Start the app

**As a browser app** (fastest for development):
```bash
npm run dev
```
Opens Vite at `http://localhost:5173` with HMR. The Express API starts alongside it at `http://localhost:3001`.

**As the Electron desktop app**:
```bash
npm run electron:dev
```
Launches the native app window. Use this to test biometrics, notifications, and OS-level integrations.

### 4. First launch

On first launch the app will:

1. **Create the database** — `spend.db` is created in the project root (dev) or your OS user-data directory (production build). It is seeded with demo data from `data.json` so the app isn't empty.
2. **Show the setup wizard** — walks you through creating a PIN, enabling biometrics (optional), and picking an AI provider.
3. **Show the tutorial** — a step-by-step walkthrough of the main views. Skip it with the × button and reopen it anytime from **Settings → Tutorial**.

### 5. Add your data

There are three ways to get your transactions in:

**Manual entry** — Click the **+** button (bottom right on any view) to add a transaction. Fill in amount, date, merchant, and category. Takes about 10 seconds per transaction.

**CSV import** — Go to **Settings → Import CSV**. Upload a `.csv` export from your bank, map the columns (date, amount, merchant), and review before importing. Column mappings are saved per file source so you only do this once per bank.

**Receipt scan** — Click the camera icon inside the **+** flow. Take or upload a photo of a receipt. Gemini OCR extracts the merchant, amount, date, and line items. Requires a Gemini API key (see AI Setup below).

### 6. Configure AI (optional but recommended)

Jarvis works out of the box as soon as you add an API key. The quickest path:

1. Get a free OpenRouter key at [openrouter.ai](https://openrouter.ai)
2. Open **Settings → AI → OpenRouter**, paste the key
3. Ask Jarvis anything: *"What did I spend on groceries last month?"*

Full provider options are covered in the [AI Setup](#ai-setup) section below.

### 7. Set a PIN (security)

CashHeap locks automatically after a configurable idle period. To set up:

1. Open **Settings → Security**
2. Set a 6-digit PIN
3. Optionally enable Touch ID (macOS) or Windows Hello for one-touch unlock

The PIN is hashed with PBKDF2 — it is never stored in plain text.

---

## Building

```bash
npm run electron:build           # current platform
npm run electron:build:mac       # macOS .dmg (arm64 + x64)
npm run electron:build:win       # Windows portable .exe
npm run electron:build:linux     # Linux .AppImage + .deb
npm run electron:build:all       # all platforms
```

Built artifacts are placed in `release/`.

### Run tests

```bash
npm test
```

---

## AI Setup

Jarvis works with any of the following providers. Default is OpenRouter — no local GPU required.

### OpenRouter (default — recommended)

OpenRouter gives you access to dozens of frontier models from a single API key, billed per-token with no monthly fee.

1. Create a free account at [openrouter.ai](https://openrouter.ai) and generate an API key
2. Open **Settings → AI → OpenRouter**, paste your key, and optionally set the model
3. Default model: `moonshotai/kimi-k2` — fast, accurate on financial reasoning, low cost

Other good choices: `anthropic/claude-haiku-4-5`, `openai/gpt-4o-mini`

### Google Gemini (cloud — also powers OCR)

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Open **Settings → AI → Gemini API Key** and paste it in

Gemini is required for receipt OCR (photo → transaction extraction). Jarvis chat and Insights can use either provider.

### DeepSeek (cloud)

1. Get a key at [platform.deepseek.com](https://platform.deepseek.com)
2. Open **Settings → AI → DeepSeek** and paste your key

### Ollama (fully local — no data leaves your machine)

1. Install Ollama: `curl -fsSL https://ollama.ai/install.sh | sh`
2. Pull a model: `ollama pull phi3:mini`
3. Start the server: `ollama serve`
4. Open **Settings → AI → Local AI (Ollama)** and set the server URL + model name

Recommended models for Jarvis: `phi3:mini`, `llama3.2:3b`, `mistral:7b`

---

## Project Structure

```
├── electron/           Electron main process, preload, IPC handlers
├── server/
│   ├── dal/            Data access layer (SQLite queries)
│   ├── db/             Schema, migrations, seed
│   ├── routes/         Express route handlers
│   └── services/       Business logic (data merge, stocks)
├── src/
│   └── SpendTracker.jsx   React UI (~10k lines, single-file)
├── public/             Static assets
└── scripts/            Local update helper
```

---

## Data & Privacy

- All data is stored in a local SQLite database (`spend.db`) in your OS user-data directory
- Nothing is sent to any server unless you configure a cloud AI key
- With Ollama, the app runs completely offline
- Biometric credentials never leave the device — handled by Touch ID / Windows Hello OS APIs
- Receipt images are stored in the local `Receipts/` folder and never uploaded

---

## Roadmap

> Jun 2026 – Dec 2026 · Effort: **S** < 1 week · **M** 1–2 weeks · **L** 2–4 weeks

### Phase 1 — Foundation (Jul 2026)

The single-file architecture and missing test coverage need to be addressed before building further.

| Item | Effort | Notes |
|---|---|---|
| Split `SpendTracker.jsx` into feature modules | L | Target: no file > 500 lines; extract views + hooks |
| Lazy-load heavy views with React.lazy | M | Cuts initial bundle from ~2MB to ~400KB |
| Shared design token file (`src/theme.js`) | S | Stop re-deriving `T{}` tokens inside every render |
| Automated SQLite backup on launch | S | Keep last 7 copies in app-data directory |
| Data export / import v2 | M | JSON or CSV zip; merge strategy skips duplicate IDs |
| DB schema versioning (migrations table) | M | Replace ad-hoc PRAGMA checks with numbered SQL files |
| Vitest unit tests for TOOL_LIBRARY | M | Assert each tool returns valid SQL against a seed DB |
| API integration tests (Supertest) | M | Cover `/api/db/sql`, `/api/holdings/prices`, `/api/data` |
| E2E smoke test (Playwright) | L | Add transaction → confirm in history |
| Settings keyword search | S | App is complex enough that users can't find things |
| ⌘K command palette | M | Jump to any view, open Jarvis, add transaction |

### Phase 2 — Jarvis 2.0 (Aug 2026)

Jarvis answers individual questions but loses context between turns and can't push insights proactively.

| Item | Effort | Notes |
|---|---|---|
| Streaming responses | M | Show tokens as they arrive; eliminates 3s spinner |
| True multi-turn context | M | Keep last 10 turns in synthesis prompt |
| Tool retry with clarification | M | Re-ask LLM when SQL returns 0 rows |
| Pinned / favourite queries | M | Star queries; pinned ones auto-run on Dashboard load |
| Proactive alerts on open | L | Budget limits, bills due in 3 days, spending spikes |
| Persistent insight history | S | Scroll back past session boundary |
| Subscription detection tool | M | Surface recurring charges in Subscriptions view |
| Goal projection tool | S | Project completion dates from current savings rate |

### Phase 3 — Data In (Sep 2026)

Manual entry is the biggest friction point. Build smart import pipelines.

| Item | Effort | Notes |
|---|---|---|
| Persistent CSV column mappings | M | Remember bank-specific mappings; never re-map twice |
| PDF bank statement parser | L | Common Canadian bank formats via pdf-parse + regex |
| Duplicate detection on import | M | Flag same date + amount ± 1 day before committing |
| Merchant → category rules engine | M | "if merchant contains Sobeys → Groceries" |
| LLM-assisted categorisation | M | Batch-classify uncategorised imports; user reviews |
| Category learning from edits | S | Auto-suggest category after user recategorises 3× |
| Auto-generate from cadence field | M | Future instances visible in Calendar view |
| Bill → transaction auto-match | L | Link matching transaction, mark bill paid |

### Phase 4 — Mobile & Sync (Oct 2026)

The app is Electron-only. A PWA shell and sync unlock mobile capture and multi-device use.

| Item | Effort | Notes |
|---|---|---|
| PWA manifest + service worker | L | Add to home screen; offline reads, queued writes |
| Mobile-responsive layout | L | Bottom nav tab bar; touch-optimised add-transaction |
| iOS Share Sheet extension | L | Share a receipt → CashHeap with OCR pre-filled |
| Bill due reminders (Electron) | S | Native OS toast 3 days before each bill's due date |
| Budget overage notifications | S | At 80% and 100% of monthly budget |
| Weekly spending summary notification | M | Sunday: spending this week + budget used |
| iCloud Drive sync (Mac) | M | Save `spend.db` to Mobile Documents folder |
| Dropbox / custom path sync | S | Any folder: Dropbox, OneDrive, NAS |
| Conflict resolution UI | L | Diff + per-record winner selection when both wrote offline |

### Phase 5 — Sharing & Export (Nov 2026)

Household is a stub. Build real shared budgets, exportable reports, and tax-ready summaries.

| Item | Effort | Notes |
|---|---|---|
| Shared budget spaces | L | Separate transaction pool; both partners see totals |
| Partner read-only dashboard link | M | 30-day expiry; no account needed |
| Split transaction tool | M | Mark as shared with ratio; track who owes whom |
| PDF monthly report | M | Income, spending by category, net, budget vs actual |
| Tax summary export | M | Transactions by deduction category; CSV for T1 filing |
| Accountant share package | S | Zip: PDF + transactions CSV + receipts folder |
| Shared savings goals | M | Both partners contribute; bar shows each person's share |

### Phase 6 — Advanced Analytics (Dec 2026)

Retirement and Cash Flow exist but are static. Add scenario modelling and Canadian tax account tracking.

| Item | Effort | Notes |
|---|---|---|
| What-if scenario builder | L | Reruns projections with user-adjusted assumptions |
| Debt payoff simulator | M | Avalanche vs snowball with extra payment sliders |
| Mortgage extra payment calculator | S | Total interest saved + payoff date for any overpayment |
| RRSP room tracker | M | Contribution room from income; remaining room + tax impact |
| TFSA room tracker | M | Cumulative limit by year + withdrawals; over-contribution alert |
| FHSA tracking | M | Annual $8K / lifetime $40K limit; contribution + withdrawal log |
| Annual financial report | M | Auto-generated Dec 31: best/worst month, net worth change |
| 12-month rolling category charts | M | Year-over-year overlay per category |
| Net worth milestone tracker | S | Mark $50K, $100K... milestones; date achieved on chart |

---

## Design Principles

1. **Local-first.** All data stays on-device. No account required, no subscription. Every new feature follows the same SQLite + Express pattern.
2. **AI-native.** Every new data type gets a Jarvis tool so users can ask natural-language questions about it from day one.
3. **Zero mandatory setup.** Features work with defaults. The app should be useful in the first 5 minutes without filling in every field.
4. **One source of truth.** All financial data flows into the dashboard and Net Worth. No siloed module that doesn't connect to the rest.

---

## License

MIT
