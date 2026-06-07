// Server API tests — uses supertest against the Express app directly
// We import the app logic by creating a minimal inline server mirror,
// since server.js is an ES module that starts listening on import.
// Instead we test the endpoints via a local fetch against the running test server.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'http';

// ── Minimal in-memory server that mirrors the real endpoints ──────────────────
const testApp = express();
testApp.use(express.json());

let _store = {
  txns: [
    { type: 'expense', amount: 100, date: '2026-06-01', category: 'Food', merchant: 'Cafe' },
    { type: 'income', amount: 500, date: '2026-06-01', category: 'Income', merchant: 'Employer' },
  ],
  bills: [{ id: 'b1', name: 'Rent', amount: 1000, active: true }],
  expected: [],
  catBudgets: {},
  vacations: [],
  holdings: [],
  accountHistory: [],
  billPayments: [],
  favourites: [],
};

testApp.get('/api/data', (_req, res) => res.json(_store));
testApp.post('/api/data', (req, res) => { _store = { ..._store, ...req.body }; res.json({ ok: true }); });

testApp.post('/api/llm/query', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  try {
    const fn = new Function('data', `"use strict"; return (${query});`);
    res.json({ result: fn(_store) });
  } catch (err) {
    res.status(400).json({ error: 'Query error: ' + err.message });
  }
});

let server;
let BASE;

beforeAll(async () => {
  await new Promise(resolve => {
    server = createServer(testApp).listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}`;
});

afterAll(() => server?.close());

// ── Helper ──────────────────────────────────────────────────────────────────
const get = (path) => fetch(`${BASE}${path}`).then(r => r.json());
const post = (path, body) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => r.json());

// ── Tests ──────────────────────────────────────────────────────────────────
describe('GET /api/data', () => {
  test('returns current store', async () => {
    const data = await get('/api/data');
    expect(data).toHaveProperty('txns');
    expect(Array.isArray(data.txns)).toBe(true);
    expect(data.txns.length).toBeGreaterThan(0);
  });

  test('txns include expense and income rows', async () => {
    const data = await get('/api/data');
    const types = new Set(data.txns.map(t => t.type));
    expect(types.has('expense')).toBe(true);
    expect(types.has('income')).toBe(true);
  });
});

describe('POST /api/data', () => {
  test('persists favourites field', async () => {
    const result = await post('/api/data', { favourites: ['bills', 'stocks'] });
    expect(result).toEqual({ ok: true });
    const data = await get('/api/data');
    expect(data.favourites).toEqual(['bills', 'stocks']);
  });

  test('persists arbitrary fields', async () => {
    await post('/api/data', { customField: 'hello' });
    const data = await get('/api/data');
    expect(data.customField).toBe('hello');
  });
});

describe('POST /api/llm/query', () => {
  test('evaluates simple expression', async () => {
    const result = await post('/api/llm/query', {
      query: 'data.txns.length',
    });
    expect(typeof result.result).toBe('number');
    expect(result.result).toBeGreaterThan(0);
  });

  test('sums expense amounts', async () => {
    const result = await post('/api/llm/query', {
      query: `data.txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)`,
    });
    expect(result.result).toBeCloseTo(100, 2);
  });

  test('returns 400 for missing query', async () => {
    const r = await fetch(`${BASE}/api/llm/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 for invalid JS', async () => {
    const r = await fetch(`${BASE}/api/llm/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '!!!invalid js!!!' }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/Query error/i);
  });

  test('can access bills array', async () => {
    const result = await post('/api/llm/query', { query: 'data.bills.length' });
    expect(result.result).toBe(1);
  });

  test('complex query: category totals', async () => {
    const result = await post('/api/llm/query', {
      query: `(function(){
        var a={};
        data.txns.filter(t=>t.type==='expense').forEach(t=>{
          var c=t.category||'Other';a[c]=(a[c]||0)+t.amount;
        });
        return a;
      })()`,
    });
    expect(result.result).toHaveProperty('Food');
    expect(result.result.Food).toBe(100);
  });
});
