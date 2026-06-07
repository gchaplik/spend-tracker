import { Router } from "express";
import { db } from "../db/index.js";

const router = Router();

/**
 * POST /api/db/sql
 * Execute a read-only SQL query against the SQLite database.
 * Body: { sql: string, params?: any[] }
 * Returns: { rows: any[], columns: string[] }
 *
 * Security: Only SELECT statements are allowed.
 * The ${TABLE} placeholder in SQL expressions should be resolved by the
 * caller before sending (the LLM replaces ${TABLE} with the actual table name).
 */
router.post("/api/db/sql", (req, res) => {
  const { sql: rawSql, params = [] } = req.body;

  if (!rawSql || typeof rawSql !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'sql' field in body" });
  }

  const trimmed = rawSql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    return res.status(403).json({ error: "Only SELECT statements are permitted" });
  }

  try {
    const stmt = db.prepare(rawSql);
    const rows = stmt.all(...params);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ rows, columns, count: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
