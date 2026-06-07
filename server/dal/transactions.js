import { db } from "../db/index.js";

const rowToObj = (r) => {
  if (!r) return null;
  return { ...r, hasReceipt: r.hasReceipt === 1 };
};

export const getAll = () => db.prepare("SELECT * FROM transactions ORDER BY date DESC").all().map(rowToObj);

export const getByMonth = (month) =>
  db.prepare("SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC").all(month + "%").map(rowToObj);

export const insert = (txn) => {
  db.prepare(`INSERT OR REPLACE INTO transactions
    (id,type,amount,date,category,merchant,note,source,hasReceipt,groupId,cadence)
    VALUES (@id,@type,@amount,@date,@category,@merchant,@note,@source,@hasReceipt,@groupId,@cadence)`)
    .run({
      id: txn.id,
      type: txn.type,
      amount: txn.amount,
      date: txn.date,
      category: txn.category || null,
      merchant: txn.merchant || null,
      note: txn.note || null,
      source: txn.source || null,
      hasReceipt: txn.hasReceipt ? 1 : 0,
      groupId: txn.groupId || null,
      cadence: txn.cadence || null,
    });
};

export const insertMany = (txns) => {
  const stmt = db.prepare(`INSERT OR REPLACE INTO transactions
    (id,type,amount,date,category,merchant,note,source,hasReceipt,groupId,cadence)
    VALUES (@id,@type,@amount,@date,@category,@merchant,@note,@source,@hasReceipt,@groupId,@cadence)`);
  db.transaction(() => {
    for (const txn of txns) {
      stmt.run({
        id: txn.id, type: txn.type, amount: txn.amount, date: txn.date,
        category: txn.category||null, merchant: txn.merchant||null, note: txn.note||null,
        source: txn.source||null, hasReceipt: txn.hasReceipt?1:0, groupId: txn.groupId||null, cadence: txn.cadence||null,
      });
    }
  })();
};

export const update = (id, patch) => {
  const existing = db.prepare("SELECT * FROM transactions WHERE id=?").get(id);
  if (!existing) return;
  const merged = { ...existing, ...patch, hasReceipt: (patch.hasReceipt ?? existing.hasReceipt) ? 1 : 0 };
  db.prepare(`UPDATE transactions SET type=@type,amount=@amount,date=@date,category=@category,
    merchant=@merchant,note=@note,source=@source,hasReceipt=@hasReceipt,groupId=@groupId,cadence=@cadence
    WHERE id=@id`).run(merged);
};

export const remove = (id) => db.prepare("DELETE FROM transactions WHERE id=?").run(id);

export const replaceAll = (txns) => {
  db.transaction(() => {
    db.prepare("DELETE FROM transactions").run();
    const stmt = db.prepare(`INSERT INTO transactions
      (id,type,amount,date,category,merchant,note,source,hasReceipt,groupId,cadence)
      VALUES (@id,@type,@amount,@date,@category,@merchant,@note,@source,@hasReceipt,@groupId,@cadence)`);
    for (const txn of txns) {
      stmt.run({
        id: txn.id, type: txn.type, amount: txn.amount, date: txn.date,
        category: txn.category||null, merchant: txn.merchant||null, note: txn.note||null,
        source: txn.source||null, hasReceipt: txn.hasReceipt?1:0, groupId: txn.groupId||null, cadence: txn.cadence||null,
      });
    }
  })();
};
