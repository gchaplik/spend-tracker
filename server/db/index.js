import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SPEND_DB_PATH || join(__dirname, "..", "..", "spend.db");

// Lazy singleton — defers opening the file until the first property access.
// This prevents better-sqlite3 (not thread-safe) from crashing Next.js build
// workers that import this module during static analysis.
let _db = null;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
  }
  return _db;
}

export const db = new Proxy({}, {
  get(_t, prop) { return getDb()[prop]; },
  set(_t, prop, val) { getDb()[prop] = val; return true; },
});

// ── Schema migrations ─────────────────────────────────────────────────────────
// Each entry runs once in order. Existing DBs that predate this system start at
// version 0 and get every migration applied on first launch.
// Rules: migrations must be safe to apply to both new and existing DBs.
//   - Use CREATE TABLE IF NOT EXISTS for table creation.
//   - Use PRAGMA table_info checks before ALTER TABLE ADD COLUMN.

const MIGRATIONS = [
  // v1 — baseline tables
  function v1_baseline() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT,
        amount REAL,
        date TEXT,
        category TEXT,
        merchant TEXT,
        note TEXT,
        receiptB64 TEXT,
        receiptMime TEXT,
        receiptFP TEXT,
        tags TEXT,
        source TEXT,
        hasReceipt INTEGER,
        groupId TEXT,
        cadence TEXT
      );
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY,
        name TEXT,
        amount REAL,
        dueDay INTEGER,
        category TEXT,
        cadence TEXT,
        active INTEGER DEFAULT 1,
        notes TEXT,
        lastPaid TEXT
      );
      CREATE TABLE IF NOT EXISTS bill_payments (
        id TEXT PRIMARY KEY,
        billId TEXT,
        month TEXT,
        amount REAL,
        date TEXT,
        note TEXT,
        paidDate TEXT
      );
      CREATE TABLE IF NOT EXISTS vacations (
        id TEXT PRIMARY KEY,
        name TEXT,
        startDate TEXT,
        endDate TEXT,
        budget REAL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS vacation_txns (
        id TEXT PRIMARY KEY,
        vacationId TEXT,
        amount REAL,
        date TEXT,
        category TEXT,
        merchant TEXT,
        note TEXT
      );
      CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        ticker TEXT,
        shares REAL,
        avgCost REAL,
        name TEXT,
        costBasis REAL,
        currentPrice REAL,
        priceUpdatedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS account_history (
        id TEXT PRIMARY KEY,
        date TEXT,
        balance REAL,
        note TEXT,
        accountId TEXT
      );
      CREATE TABLE IF NOT EXISTS expected_income (
        id TEXT PRIMARY KEY,
        source TEXT,
        amount REAL,
        expectedDate TEXT,
        cadence TEXT,
        confirmed INTEGER DEFAULT 0,
        note TEXT,
        groupId TEXT,
        confirmedDate TEXT,
        confirmedTxnId TEXT
      );
      CREATE TABLE IF NOT EXISTS cat_budgets (
        category TEXT PRIMARY KEY,
        budget REAL
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT,
        targetAmount REAL,
        currentAmount REAL,
        monthlyTarget REAL,
        deadline TEXT,
        color TEXT,
        createdAt TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        balance REAL
      );
    `);
  },

  // v2 — holdings price columns (were added ad-hoc pre-migrations)
  function v2_holdings_price_columns() {
    const cols = db.prepare("PRAGMA table_info(holdings)").all().map(r => r.name);
    if (!cols.includes("currentPrice"))
      db.exec("ALTER TABLE holdings ADD COLUMN currentPrice REAL");
    if (!cols.includes("priceUpdatedAt"))
      db.exec("ALTER TABLE holdings ADD COLUMN priceUpdatedAt TEXT");
  },

  // v3 — bill_payments.txnId links a payment to the expense transaction it created
  function v3_bill_payment_txnId() {
    const cols = db.prepare("PRAGMA table_info(bill_payments)").all().map(r => r.name);
    if (!cols.includes("txnId"))
      db.exec("ALTER TABLE bill_payments ADD COLUMN txnId TEXT");
  },
];

function ensureMigrationsTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function appliedVersions() {
  return new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map(r => r.version)
  );
}

export function migrate() {
  ensureMigrationsTable();
  const applied = appliedVersions();
  const mark = db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)");

  for (let v = 1; v <= MIGRATIONS.length; v++) {
    if (applied.has(v)) continue;
    db.transaction(() => {
      MIGRATIONS[v - 1]();
      mark.run(v);
    })();
  }
}

export function seedFromJson(dataJson) {
  const count = db.prepare("SELECT COUNT(*) as c FROM transactions").get().c;
  if (count > 0) return;

  const insertTxn = db.prepare(`INSERT OR IGNORE INTO transactions
    (id,type,amount,date,category,merchant,note,source,hasReceipt,groupId,cadence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertBill = db.prepare(`INSERT OR IGNORE INTO bills
    (id,name,amount,dueDay,category,active,notes)
    VALUES (?,?,?,?,?,?,?)`);
  const insertBillPayment = db.prepare(`INSERT OR IGNORE INTO bill_payments
    (id,billId,month,amount,paidDate,txnId)
    VALUES (?,?,?,?,?,?)`);
  const insertVacation = db.prepare(`INSERT OR IGNORE INTO vacations
    (id,name,startDate,endDate,budget)
    VALUES (?,?,?,?,?)`);
  const insertVacationTxn = db.prepare(`INSERT OR IGNORE INTO vacation_txns
    (id,vacationId,amount,date,merchant,note)
    VALUES (?,?,?,?,?,?)`);
  const insertHolding = db.prepare(`INSERT OR IGNORE INTO holdings
    (id,ticker,shares,costBasis)
    VALUES (?,?,?,?)`);
  const insertAccountHistory = db.prepare(`INSERT OR IGNORE INTO account_history
    (id,date,balance,accountId)
    VALUES (?,?,?,?)`);
  const insertExpected = db.prepare(`INSERT OR IGNORE INTO expected_income
    (id,source,amount,expectedDate,cadence,confirmed,note,groupId,confirmedDate,confirmedTxnId)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insertCatBudget = db.prepare(`INSERT OR REPLACE INTO cat_budgets (category,budget) VALUES (?,?)`);
  const insertGoal = db.prepare(`INSERT OR IGNORE INTO goals
    (id,name,emoji,targetAmount,currentAmount,monthlyTarget,deadline,color,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insertSetting = db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`);
  const insertAccount = db.prepare(`INSERT OR IGNORE INTO accounts (id,name,type,balance) VALUES (?,?,?,?)`);

  db.transaction(() => {
    for (const t of dataJson.txns || []) {
      insertTxn.run(t.id,t.type,t.amount,t.date,t.category||null,t.merchant||null,t.note||null,t.source||null,t.hasReceipt?1:0,t.groupId||null,t.cadence||null);
    }
    for (const b of dataJson.bills || []) {
      insertBill.run(b.id,b.name,b.amount,b.dueDay||15,b.category||null,b.active!==false?1:0,b.note||null);
    }
    for (const p of dataJson.billPayments || []) {
      insertBillPayment.run(p.id,p.billId,p.month,p.amount,p.paidDate||null,p.txnId||null);
    }
    for (const v of dataJson.vacations || []) {
      insertVacation.run(v.id,v.name,v.startDate,v.endDate,v.budget||0);
    }
    for (const t of dataJson.vacationTxns || []) {
      insertVacationTxn.run(t.id,t.vacationId,t.amount,t.date,t.merchant||null,t.note||null);
    }
    for (const h of dataJson.holdings || []) {
      insertHolding.run(h.id,h.ticker,h.shares,h.costBasis||null);
    }
    for (const h of dataJson.accountHistory || []) {
      insertAccountHistory.run(h.id,h.date,h.balance,h.accountId||null);
    }
    for (const e of dataJson.expected || []) {
      insertExpected.run(e.id,e.source,e.amount,e.expectedDate,e.cadence||null,e.confirmed?1:0,e.note||null,e.groupId||null,e.confirmedDate||null,e.confirmedTxnId||null);
    }
    for (const [cat, budget] of Object.entries(dataJson.catBudgets || {})) {
      insertCatBudget.run(cat, budget);
    }
    for (const g of dataJson.goals || []) {
      insertGoal.run(g.id,g.name,g.emoji||"🎯",g.targetAmount||0,g.currentAmount||0,g.monthlyTarget||0,g.deadline||null,g.color||"#0284C7",g.createdAt||null);
    }
    for (const a of dataJson.accounts || []) {
      insertAccount.run(a.id,a.name,a.type,a.balance||0);
    }
    if (dataJson.cats) insertSetting.run("cats", JSON.stringify(dataJson.cats));
    if (dataJson.settings) insertSetting.run("settings", JSON.stringify(dataJson.settings));
    if (dataJson.schema) insertSetting.run("schema", JSON.stringify(dataJson.schema));
    if (dataJson.favourites) insertSetting.run("favourites", JSON.stringify(dataJson.favourites));
    if (dataJson.receiptFPs) insertSetting.run("receiptFPs", JSON.stringify(dataJson.receiptFPs));
    if (dataJson.insightMessages) insertSetting.run("insightMessages", JSON.stringify(dataJson.insightMessages));
    if (dataJson.insightWidgets) insertSetting.run("insightWidgets", JSON.stringify(dataJson.insightWidgets));
  })();
}
