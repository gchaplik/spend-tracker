# Spend Tracker — Product Roadmap

> Last updated: June 2026  
> This document captures everything currently built and a prioritised plan for what a complete personal finance application needs next.

---

## What's Already Built

| Module | Description |
|---|---|
| Dashboard | Monthly spending, income, budget overview, trend chart |
| Transactions | Manual expense & income entry, history, bulk edit |
| Bills | Recurring bills, mark paid, outstanding tracker |
| Categories | Custom categories with monthly budget caps |
| Goals | Savings goals with target amount + date |
| Net Worth | Accounts, assets, liabilities |
| Stocks | Portfolio holdings with live CAD/USD prices |
| Expected Income | Scheduled future income, mark received |
| Vacations | Separate trip budgets, fully rolled into spending totals |
| Receipt Upload | OCR via Gemini — photo/PDF → transaction |
| Folder Sync | Bulk import from local receipt folder |
| Jarvis AI | Global chat FAB with full SQL tool library, voice mode |
| Insights | AI-powered question-and-answer over your data |
| Appearance | Dark mode, 5 colorblind filter modes |
| Auto-Update | Local DMG rebuild + GitHub Releases |
| Terms of Service | First-launch gate, persisted acceptance |

---

## Phase 1 — Core Gaps (High Priority)

These are table-stakes features every financial app has. They close the most obvious holes.

---

### 1.1 Bank & CSV Import

**Why:** Manual entry is the #1 friction point. Users abandon apps that require typing every transaction.

**What to build:**
- CSV importer with column mapping UI (date, amount, merchant, category)
- Support formats from major Canadian banks: TD, RBC, BMO, Scotiabank, CIBC, Tangerine
- Duplicate detection (same date + amount + merchant within ±2 days)
- "Review before import" screen — bulk approve, edit, or skip rows
- Saved column mapping profiles per bank

**Data model:** Add `import_source` and `import_hash` columns to `transactions` to flag and deduplicate imports.

---

### 1.2 Debt Tracker

**Why:** Net worth is incomplete without a dedicated debt management view. Users with loans, credit cards, or a mortgage need payoff planning.

**What to build:**
- Debt register: credit cards, car loans, student loans, mortgage, line of credit
- Fields: balance, interest rate, minimum payment, payment cadence
- Payoff strategies: Avalanche (highest rate first) vs Snowball (lowest balance first)
- Projected payoff date and total interest paid for each strategy
- Debt-to-income ratio shown on dashboard
- Monthly debt payment total rolled into spending totals

**Integration:** Debts appear as liabilities in Net Worth automatically.

---

### 1.3 Cash Flow Forecast

**Why:** The most common question is "will I have enough money next month?" No page answers this today.

**What to build:**
- 90-day forward projection chart
- Inputs: current balance per account + all scheduled bills + expected income
- Accounts for known one-time expenses (vacations, goals with target dates)
- "Danger zone" marker when projected balance dips below a user-set threshold
- Scenario toggle: "what if I add a $X/month expense?"

---

### 1.4 Notifications & Alerts

**Why:** A passive tracker doesn't help users avoid problems. Push alerts turn it into an active tool.

**What to build:**
- Bill due reminders (3 days before, day-of)
- Budget overage alert (when a category hits 80% and 100%)
- Large transaction alert (any expense over a user-set threshold)
- Low balance warning (projected balance below threshold)
- Goal milestone reached (25%, 50%, 75%, 100%)

**Implementation:** Electron `Notification` API for desktop toasts. Store alert preferences in `settings`. Schedule checks via a `setInterval` in main process on app focus.

---

### 1.5 Reports & Export

**Why:** Users need to share data with accountants, partners, or just keep records outside the app.

**What to build:**
- Monthly summary PDF: income, spending by category, net, budget vs actual
- Annual tax year summary PDF
- CSV export: any date range, any category filter
- "Share with accountant" mode — export redacts account numbers, keeps only categories + amounts

---

## Phase 2 — Financial Depth (Medium Priority)

These features move the app from "expense tracker" to "financial planner."

---

### 2.1 Subscription Manager

**Why:** Subscriptions are the silent budget killer. Users typically underestimate their total by 40%.

**What to build:**
- Dedicated subscription registry (separate from bills)
- Fields: name, amount, cadence, trial end date, cancellation URL
- Auto-detect subscriptions from transaction history using merchant name + recurring pattern
- Monthly/annual total displayed prominently
- "Subscriptions I forgot about" surface — subscriptions with no matching transaction in 60+ days

---

### 2.2 Tax Tracker

**Why:** Canadian users have RRSP contribution room, medical expense deductions, home office deductions. There is no dedicated tax view.

**What to build:**
- Tax year view (Jan–Dec or custom fiscal year)
- Tag transactions as tax-deductible (with CRA category: medical, charitable, business, home office)
- RRSP contribution tracker: room remaining, YTD contributions, deadline countdown
- Tax estimate summary: total deductible spending by category
- Export CRA-ready summary PDF

---

### 2.3 Retirement & RRSP / TFSA Planner

**Why:** Long-term savings goals need compound growth projections, not just "save $X by date Y."

**What to build:**
- RRSP and TFSA accounts in Net Worth with contribution room tracking
- Compound growth projector: "if you contribute $X/month at Y% return, you'll have $Z at age 65"
- Gap analysis: current trajectory vs retirement target
- Contribution room calculator (based on income entry)

---

### 2.4 Recurring Transaction Intelligence

**Why:** Most expenses are predictable. The app should recognise patterns and reduce manual work.

**What to build:**
- Auto-detect recurring expenses from history (same merchant, similar amount, regular interval)
- Suggest converting detected recurring items to bills
- Predict next occurrence and amount for irregular-but-patterned spending (e.g. quarterly vet visits)
- "Unusual spending" flag: a category is 30%+ over its 3-month average this month

---

### 2.5 Multi-Currency Support

**Why:** The stocks page already handles CAD/USD. Travel, freelance income, and cross-border purchases introduce other currencies throughout the app.

**What to build:**
- Currency field on any transaction (default: CAD)
- Live exchange rate fetch (or manual rate entry)
- All reporting in home currency with original currency shown as tooltip
- Per-vacation currency setting
- Historical rate storage so old transactions don't reprice

---

### 2.6 Shared / Household Expenses

**Why:** Couples and roommates split costs. Today there's no way to track who owes what.

**What to build:**
- Mark any transaction as "shared" with a split ratio (50/50, custom %)
- "You are owed" / "You owe" running total per person
- Settle up button — logs a transfer transaction
- Optional: export split summary for the other person

---

## Phase 3 — Intelligence & UX (Lower Priority, High Delight)

These make the app feel premium and differentiated.

---

### 3.1 Financial Health Score

A single 0–100 score on the dashboard computed from:
- Savings rate (target: 20%+)
- Emergency fund coverage (target: 3–6 months expenses)
- Debt-to-income ratio (target: <36%)
- Budget adherence (% of categories under budget)
- Net worth trend (positive month-over-month)

Each sub-score shows a coloured ring with a one-line explanation and a specific action to improve it.

---

### 3.2 Spending Anomaly Detection

Use the local AI (Ollama/Gemini) to flag:
- "Your Dining spending is 2.4× higher than your 6-month average this month"
- "You have 3 transactions at the same merchant on the same day — possible duplicate?"
- "Your grocery spending dropped to zero in July — did you switch stores?"

Surface these as dismissable cards on the dashboard.

---

### 3.3 Financial Calendar

A full monthly calendar view showing:
- Bill due dates (colour-coded: paid=green, due=amber, overdue=red)
- Expected income dates
- Goal contribution dates
- Vacation start/end dates
- Click any day to see all transactions that day

---

### 3.4 Wishlist / Planned Purchases

A place to park "I want to buy this" items with:
- Name, estimated cost, priority (nice-to-have / need / essential)
- "Afford by" date based on current savings rate
- Promotes to a Goal with one click
- Jarvis can answer "when can I afford a new MacBook given my current savings?"

---

### 3.5 Mortgage Calculator & Amortization

For homeowners:
- Inputs: purchase price, down payment, interest rate, amortization period, payment frequency
- Full amortization table (month-by-month principal vs interest breakdown)
- Extra payment simulator: "if I pay $200 extra/month, I pay off 3.5 years early and save $22k"
- Remaining balance feeds directly into Net Worth liabilities

---

### 3.6 Bill Negotiation Tracker

- Log negotiation attempts on recurring bills (internet, phone, insurance)
- Track outcome: saved $X/month starting from date
- Running total: "you've negotiated $1,340/year in savings"

---

## Phase 4 — Platform Expansion

---

### 4.1 Windows & Linux Builds

The Electron architecture already supports this. What's needed:
- CI pipeline (GitHub Actions) building `.exe` (Windows portable) and `.AppImage` (Linux) on every release tag
- Test matrix covering all three platforms
- Platform-specific install paths in `electron/main.mjs`

### 4.2 iOS / Android Companion

A React Native app that connects to the desktop app over local network (same Wi-Fi) or via a sync endpoint:

**Read (dashboard view):**
- Dashboard summary: monthly spending, income, budget ring
- Recent transactions list
- Upcoming bills and goals progress
- Net worth snapshot

**Write (receipt capture):**
- Take a photo or pick from camera roll → send to desktop for Gemini OCR processing
- Review extracted transaction (merchant, amount, date, category) on mobile before confirming
- Confirmed transaction syncs back to the desktop SQLite database immediately
- Queues receipts locally when desktop is offline; syncs when connection is restored

**Notifications:**
- Push notifications for bill due reminders and budget overage alerts (forwarded from desktop)

### 4.3 iCloud / Local Network Sync

- Export/import database file to iCloud Drive for backup
- Optional: local-network sync between two devices (no cloud server)

---

## Prioritised Backlog Summary

| # | Feature | Phase | Effort | Impact |
|---|---|---|---|---|
| 1 | CSV / Bank Import | 1 | Medium | 🔥 Critical |
| 2 | Cash Flow Forecast | 1 | Medium | 🔥 Critical |
| 3 | Debt Tracker | 1 | Medium | High |
| 4 | Notifications & Alerts | 1 | Low | High |
| 5 | Reports & PDF Export | 1 | Medium | High |
| 6 | Subscription Manager | 2 | Low | High |
| 7 | Recurring Intelligence | 2 | Medium | High |
| 8 | Tax Tracker | 2 | Medium | Medium |
| 9 | Financial Health Score | 3 | Low | High |
| 10 | Financial Calendar | 3 | Medium | Medium |
| 11 | Multi-Currency | 2 | High | Medium |
| 12 | Shared Expenses | 2 | Medium | Medium |
| 13 | RRSP / Retirement Planner | 2 | High | Medium |
| 14 | Spending Anomaly Detection | 3 | Low | High |
| 15 | Wishlist / Planned Purchases | 3 | Low | Medium |
| 16 | Mortgage Calculator | 3 | Medium | Medium |
| 17 | Windows / Linux Builds | 4 | Low | Medium |
| 18 | Mobile Companion App (read + receipt capture) | 4 | High | Medium |

---

## Design Principles for New Features

1. **Local-first.** All data stays on-device. No account required, no subscription. New features follow the same SQLite + Express pattern.
2. **AI-native.** Every new data type gets a Jarvis tool so users can ask natural-language questions about it from day one.
3. **Zero mandatory setup.** Features work with defaults. The app should be useful in the first 5 minutes without filling in every field.
4. **One source of truth.** All financial data flows into the dashboard and Net Worth. No siloed module that doesn't talk to the rest.
