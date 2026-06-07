// Inline copy of parseToolCall from SpendTracker.jsx
const KNOWN_TOOLS = ['expenses','income','net','categories','largest_expenses','bills','portfolio','txns_by_category'];

const parseToolCall = (text) => {
  // Format 1: <tool>...</tool>
  const xmlM = text.match(/<tool>([\s\S]*?)<\/tool>/);
  if (xmlM) { try { const d = JSON.parse(xmlM[1]); if (d?.name) return d; } catch {} }
  // Format 2: code blocks
  const blockMs = [...text.matchAll(/```[a-z]*\s*(\{[\s\S]*?\})\s*```/g)];
  for (const bm of blockMs) {
    try {
      const d = JSON.parse(bm[1]);
      if (d?.name) return { name: d.name, args: d.args || d.arguments || d.parameters || {} };
      if (d?.tool?.name) return { name: d.tool.name, args: d.tool.args || d.tool.arguments || d.tool.parameters || {} };
    } catch {}
  }
  // Format 3: raw JSON with "name" key
  const allJson = [...text.matchAll(/(\{[^{}]*"name"\s*:[^{}]*\})/g)];
  for (const jm of allJson) {
    try { const d = JSON.parse(jm[1]); if (d?.name && KNOWN_TOOLS.includes(d.name)) return { name: d.name, args: d.args || d.arguments || {} }; } catch {}
  }
  // Format 4: phi3 nested
  const nestedM = text.match(/"tool"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (nestedM) { const name = nestedM[1]; if (KNOWN_TOOLS.includes(name)) return { name, args: {} }; }
  return null;
};

describe('parseToolCall', () => {
  describe('Format 1 — XML <tool> tags', () => {
    test('parses basic tool call', () => {
      const r = parseToolCall('<tool>{"name":"expenses","args":{"month":"2026-06"}}</tool>');
      expect(r).toEqual({ name: 'expenses', args: { month: '2026-06' } });
    });

    test('parses tool with no args', () => {
      const r = parseToolCall('<tool>{"name":"categories"}</tool>');
      expect(r?.name).toBe('categories');
    });

    test('ignores surrounding prose', () => {
      const r = parseToolCall('Let me check that. <tool>{"name":"income","args":{}}</tool> Here you go.');
      expect(r?.name).toBe('income');
    });

    test('returns null for malformed JSON', () => {
      expect(parseToolCall('<tool>{bad json}</tool>')).toBeNull();
    });
  });

  describe('Format 2 — markdown code blocks', () => {
    test('parses ```json block', () => {
      const r = parseToolCall('```json\n{"name":"bills","args":{}}\n```');
      expect(r?.name).toBe('bills');
    });

    test('parses ```plaintext block', () => {
      const r = parseToolCall('```plaintext\n{"name":"portfolio","args":{"type":"total"}}\n```');
      expect(r?.name).toBe('portfolio');
    });

    test('parses phi3 nested tool in code block', () => {
      const r = parseToolCall('```plaintext\n{"tool":{"name":"expenses","args":{"month":"2026-06"}}}\n```');
      expect(r?.name).toBe('expenses');
    });
  });

  describe('Format 3 — raw inline JSON', () => {
    test('parses known tool name from prose', () => {
      const r = parseToolCall('I will call {"name":"categories"} now.');
      expect(r?.name).toBe('categories');
    });

    test('ignores unknown tool names', () => {
      expect(parseToolCall('{"name":"unknown_tool"}')).toBeNull();
    });
  });

  describe('Format 4 — phi3 nested object', () => {
    test('parses nested tool object', () => {
      const r = parseToolCall('{ "tool": { "name": "largest_expenses" } }');
      expect(r?.name).toBe('largest_expenses');
    });

    test('ignores unknown tool name in nested format', () => {
      expect(parseToolCall('{ "tool": { "name": "fake_tool" } }')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    test('empty string returns null', () => {
      expect(parseToolCall('')).toBeNull();
    });

    test('plain prose returns null', () => {
      expect(parseToolCall('Your total spending this month is $407.29.')).toBeNull();
    });

    test('incomplete XML returns null', () => {
      expect(parseToolCall('<tool>{"name":"expenses"')).toBeNull();
    });
  });
});
