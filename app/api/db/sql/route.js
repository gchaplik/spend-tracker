import { NextResponse } from 'next/server';
import { db } from '../../../../server/db/index.js';

// Only SELECT and WITH (CTEs) are permitted — no writes.
export async function POST(request) {
  try {
    const { sql: rawSql, params = [] } = await request.json();

    if (!rawSql || typeof rawSql !== 'string') {
      return NextResponse.json({ error: "Missing or invalid 'sql' field in body" }, { status: 400 });
    }

    const trimmed = rawSql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
      return NextResponse.json({ error: 'Only SELECT statements are permitted' }, { status: 403 });
    }

    const stmt = db.prepare(rawSql);
    const rows = stmt.all(...params);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return NextResponse.json({ rows, columns, count: rows.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
