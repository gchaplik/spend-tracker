import { NextResponse } from 'next/server';
import { db } from '../../../../server/db/index.js';

export async function PATCH(request) {
  try {
    const { prices } = await request.json();
    if (!prices || typeof prices !== 'object') {
      return NextResponse.json({ error: 'prices object required' }, { status: 400 });
    }
    const stmt = db.prepare('UPDATE holdings SET currentPrice=@price, priceUpdatedAt=@ts WHERE UPPER(ticker)=UPPER(@ticker)');
    const ts = new Date().toISOString();
    db.transaction(() => {
      for (const [ticker, price] of Object.entries(prices)) {
        if (typeof price === 'number') stmt.run({ ticker, price, ts });
      }
    })();
    return NextResponse.json({ ok: true, updated: Object.keys(prices).length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
