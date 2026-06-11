import { NextResponse } from 'next/server';
import { execQuery } from '../../../../server/services/llmService.js';

export async function POST(request) {
  try {
    const { query } = await request.json();
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });
    return NextResponse.json({ result: execQuery(query) });
  } catch (err) {
    return NextResponse.json({ error: 'Query error: ' + err.message }, { status: 400 });
  }
}
