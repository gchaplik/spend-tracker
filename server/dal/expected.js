import { db } from "../db/index.js";

const rowToObj = (r) => ({ ...r, confirmed: r.confirmed === 1 });

export const getAll = () =>
  db.prepare("SELECT * FROM expected_income ORDER BY expectedDate ASC").all().map(rowToObj);

export const insert = (e) => {
  db.prepare(`INSERT OR REPLACE INTO expected_income
    (id,source,amount,expectedDate,cadence,confirmed,note,groupId,confirmedDate,confirmedTxnId)
    VALUES (@id,@source,@amount,@expectedDate,@cadence,@confirmed,@note,@groupId,@confirmedDate,@confirmedTxnId)`)
    .run({
      id:e.id, source:e.source, amount:e.amount, expectedDate:e.expectedDate,
      cadence:e.cadence||null, confirmed:e.confirmed?1:0, note:e.note||null,
      groupId:e.groupId||null, confirmedDate:e.confirmedDate||null, confirmedTxnId:e.confirmedTxnId||null,
    });
};

export const update = (id, patch) => {
  const existing = db.prepare("SELECT * FROM expected_income WHERE id=?").get(id);
  if (!existing) return;
  const merged = { ...existing, ...patch, confirmed: (patch.confirmed ?? existing.confirmed) ? 1 : 0 };
  db.prepare(`UPDATE expected_income SET source=@source,amount=@amount,expectedDate=@expectedDate,
    cadence=@cadence,confirmed=@confirmed,note=@note,groupId=@groupId,confirmedDate=@confirmedDate,confirmedTxnId=@confirmedTxnId
    WHERE id=@id`).run(merged);
};

export const remove = (id) => db.prepare("DELETE FROM expected_income WHERE id=?").run(id);

export const replaceAll = (items) => {
  db.transaction(() => {
    db.prepare("DELETE FROM expected_income").run();
    const stmt = db.prepare(`INSERT INTO expected_income
      (id,source,amount,expectedDate,cadence,confirmed,note,groupId,confirmedDate,confirmedTxnId)
      VALUES (@id,@source,@amount,@expectedDate,@cadence,@confirmed,@note,@groupId,@confirmedDate,@confirmedTxnId)`);
    for (const e of items) {
      stmt.run({
        id:e.id, source:e.source, amount:e.amount, expectedDate:e.expectedDate,
        cadence:e.cadence||null, confirmed:e.confirmed?1:0, note:e.note||null,
        groupId:e.groupId||null, confirmedDate:e.confirmedDate||null, confirmedTxnId:e.confirmedTxnId||null,
      });
    }
  })();
};
