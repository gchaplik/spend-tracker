import { NextResponse } from 'next/server';
import { fetchQuotes } from '../../../server/services/stockService.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols');
  if (!symbols) return NextResponse.json({ quotes: [] });
  try {
    const quotes = await fetchQuotes(symbols);
    return NextResponse.json({ quotes });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
