import { NextResponse } from 'next/server';
import { fetchHistory } from '../../../../server/services/stockService.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const range = searchParams.get('range') || '1mo';
  const interval = searchParams.get('interval') || '1d';
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  try {
    const points = await fetchHistory(symbol, range, interval);
    return NextResponse.json({ symbol, points });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
