import { db } from "../db/index.js";

export const getAll = () => db.prepare("SELECT * FROM holdings").all();
export const getHistory = () => db.prepare("SELECT * FROM account_history ORDER BY date ASC").all();
export const getAccounts = () => db.prepare("SELECT * FROM accounts").all();

export const upsertHolding = (h) => {
  db.prepare(`INSERT OR REPLACE INTO holdings (id,ticker,shares,costBasis,name)
    VALUES (@id,@ticker,@shares,@costBasis,@name)`).run({
    id:h.id, ticker:h.ticker, shares:h.shares, costBasis:h.costBasis||null, name:h.name||null,
  });
};

export const removeHolding = (id) => db.prepare("DELETE FROM holdings WHERE id=?").run(id);

export const addHistory = (h) => {
  db.prepare(`INSERT OR REPLACE INTO account_history (id,date,balance,note,accountId)
    VALUES (@id,@date,@balance,@note,@accountId)`).run({
    id:h.id, date:h.date, balance:h.balance, note:h.note||null, accountId:h.accountId||null,
  });
};

export const upsertAccount = (a) => {
  db.prepare(`INSERT OR REPLACE INTO accounts (id,name,type,balance) VALUES (@id,@name,@type,@balance)`)
    .run({ id:a.id, name:a.name, type:a.type, balance:a.balance||0 });
};

export const removeAccount = (id) => {
  db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  db.prepare("DELETE FROM account_history WHERE accountId=?").run(id);
};

export const replaceAllHoldings = (holdings) => {
  db.transaction(() => {
    db.prepare("DELETE FROM holdings").run();
    const stmt = db.prepare(`INSERT INTO holdings (id,ticker,shares,costBasis,name) VALUES (@id,@ticker,@shares,@costBasis,@name)`);
    for (const h of holdings) stmt.run({ id:h.id, ticker:h.ticker, shares:h.shares, costBasis:h.costBasis||null, name:h.name||null });
  })();
};

export const replaceAllAccounts = (accounts) => {
  db.transaction(() => {
    db.prepare("DELETE FROM accounts").run();
    const stmt = db.prepare(`INSERT INTO accounts (id,name,type,balance) VALUES (@id,@name,@type,@balance)`);
    for (const a of accounts) stmt.run({ id:a.id, name:a.name, type:a.type, balance:a.balance||0 });
  })();
};

export const replaceAllHistory = (history) => {
  db.transaction(() => {
    db.prepare("DELETE FROM account_history").run();
    const stmt = db.prepare(`INSERT INTO account_history (id,date,balance,note,accountId) VALUES (@id,@date,@balance,@note,@accountId)`);
    for (const h of history) stmt.run({ id:h.id, date:h.date, balance:h.balance, note:h.note||null, accountId:h.accountId||null });
  })();
};
