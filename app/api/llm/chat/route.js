import { NextResponse } from 'next/server';

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';

export async function POST(request) {
  try {
    const body = await request.json();

    if (body.stream) {
      const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return NextResponse.json({ error: 'Ollama error ' + r.status }, { status: r.status });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const chunk = JSON.parse(line);
                  const token = chunk.message?.content ?? '';
                  if (token) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: token })}\n\n`));
                  }
                  if (chunk.done) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                    return;
                  }
                } catch {}
              }
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }),
    });
    if (!r.ok) return NextResponse.json({ error: 'Ollama error ' + r.status }, { status: r.status });
    return NextResponse.json(await r.json());
  } catch (err) {
    return NextResponse.json({ error: 'Ollama not running: ' + err.message }, { status: 503 });
  }
}
