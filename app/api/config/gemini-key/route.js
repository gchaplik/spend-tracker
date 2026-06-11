import { NextResponse } from 'next/server';
import { getSetting, setSetting } from '../../../../server/dal/settings.js';

export async function GET() {
  const stored = getSetting('geminiApiKey');
  const envKey = process.env.GEMINI_API_KEY;
  return NextResponse.json({ set: !!(stored || envKey), source: stored ? 'db' : envKey ? 'env' : 'none' });
}

export async function POST(request) {
  const { key } = await request.json();
  if (!key || typeof key !== 'string' || key.trim().length < 10) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }
  setSetting('geminiApiKey', key.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  setSetting('geminiApiKey', null);
  return NextResponse.json({ ok: true });
}
