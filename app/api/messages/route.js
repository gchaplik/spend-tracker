import { NextResponse } from 'next/server';
import { getSetting } from '../../../server/dal/settings.js';

const getGeminiKey = () => getSetting('geminiApiKey') || process.env.GEMINI_API_KEY || null;

export async function POST(request) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: { message: 'Gemini API key not set — add it in Settings or set GEMINI_API_KEY in .env' } },
      { status: 500 }
    );
  }
  try {
    const body = await request.json();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    return NextResponse.json(await response.json());
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
