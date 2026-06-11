import { NextResponse } from 'next/server';
import { getFullData, mergeData } from '../../../server/services/dataService.js';

export async function GET() {
  try {
    return NextResponse.json(getFullData());
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    mergeData(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
