import { NextResponse } from 'next/server';

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';

export async function GET() {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!r.ok) return NextResponse.json({ error: 'Ollama not reachable' }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (err) {
    return NextResponse.json({ error: 'Ollama not running: ' + err.message }, { status: 503 });
  }
}
