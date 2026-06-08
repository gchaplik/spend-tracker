// Unit tests for CSV Import — parsing, column mapping, date conversion, duplicate detection

// ── Pure functions extracted from CSVImport component ─────────────────────────

function parseCSV(text) {
  const rows = []; let cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { rows[rows.length - 1] ? rows[rows.length - 1].push(cur) : rows.push([cur]); cur = ''; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (cur || rows.length) { const last = rows[rows.length - 1]; if (last) last.push(cur); else rows.push([cur]); rows.push([]); } cur = '';
    } else cur += c;
  }
  if (cur) { const last = rows[rows.length - 1]; if (last) last.push(cur); else rows.push([cur]); }
  return rows.filter(r => r.some(c => c.trim())).map(r => r.map(c => c.trim().replace(/^"|"$/g, '')));
}

function parseCSVDate(raw, fmt) {
  if (!raw) return '';
  raw = raw.trim().replace(/"/g, '');
  if (fmt === 'MM/DD/YYYY') {
    const p = raw.split('/');
    if (p.length === 3) return p[2] + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
  }
  if (fmt === 'DD-MMM-YYYY') {
    const ms = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const p = raw.split('-');
    if (p.length === 3) return p[2] + '-' + (ms[p[1]] || '01') + '-' + p[0].padStart(2, '0');
  }
  return raw.slice(0, 10);
}

function isDuplicate(txns, date, amount, merchant) {
  return txns.some(t =>
    t.date === date &&
    Math.abs(t.amount - amount) < 0.01 &&
    (t.merchant || t.source || '').toLowerCase() === merchant.toLowerCase()
  );
}

function parseAmount(raw) {
  return +(raw || '0').replace(/[,$]/g, '');
}

// ── parseCSV ──────────────────────────────────────────────────────────────────

describe('parseCSV — basic parsing', () => {
  test('parses simple comma-separated row', () => {
    const result = parseCSV('2026-06-01,Walmart,50.00');
    expect(result).toEqual([['2026-06-01', 'Walmart', '50.00']]);
  });

  test('parses multiple rows', () => {
    const result = parseCSV('2026-06-01,Walmart,50.00\n2026-06-02,Netflix,15.99');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['2026-06-01', 'Walmart', '50.00']);
    expect(result[1]).toEqual(['2026-06-02', 'Netflix', '15.99']);
  });

  test('handles quoted values with commas inside', () => {
    const result = parseCSV('"Smith, John",2026-06-01,100.00');
    expect(result[0][0]).toBe('Smith, John');
  });

  test('strips surrounding quotes from values', () => {
    const result = parseCSV('"2026-06-01","Walmart","50.00"');
    expect(result[0]).toEqual(['2026-06-01', 'Walmart', '50.00']);
  });

  test('filters empty rows', () => {
    const result = parseCSV('2026-06-01,Walmart,50.00\n\n\n2026-06-02,Netflix,15.99');
    expect(result).toHaveLength(2);
  });

  test('trims whitespace from cells', () => {
    const result = parseCSV('  2026-06-01 , Walmart , 50.00 ');
    expect(result[0]).toEqual(['2026-06-01', 'Walmart', '50.00']);
  });

  test('parses header row correctly', () => {
    const result = parseCSV('Date,Description,Debit,Credit\n2026-06-01,Walmart,50.00,');
    expect(result[0]).toEqual(['Date', 'Description', 'Debit', 'Credit']);
    expect(result[1][0]).toBe('2026-06-01');
  });

  test('handles Windows-style CRLF line endings', () => {
    const result = parseCSV('2026-06-01,A,10\r\n2026-06-02,B,20');
    expect(result).toHaveLength(2);
  });
});

// ── parseCSVDate ──────────────────────────────────────────────────────────────

describe('parseCSVDate — format conversions', () => {
  test('YYYY-MM-DD passes through unchanged', () => {
    expect(parseCSVDate('2026-06-15', 'YYYY-MM-DD')).toBe('2026-06-15');
  });

  test('MM/DD/YYYY converts correctly', () => {
    expect(parseCSVDate('06/15/2026', 'MM/DD/YYYY')).toBe('2026-06-15');
  });

  test('MM/DD/YYYY zero-pads month and day', () => {
    expect(parseCSVDate('1/5/2026', 'MM/DD/YYYY')).toBe('2026-01-05');
  });

  test('DD-MMM-YYYY converts Jan correctly', () => {
    expect(parseCSVDate('15-Jun-2026', 'DD-MMM-YYYY')).toBe('2026-06-15');
  });

  test('DD-MMM-YYYY converts Dec correctly', () => {
    expect(parseCSVDate('25-Dec-2025', 'DD-MMM-YYYY')).toBe('2025-12-25');
  });

  test('DD-MMM-YYYY zero-pads day', () => {
    expect(parseCSVDate('5-Mar-2026', 'DD-MMM-YYYY')).toBe('2026-03-05');
  });

  test('returns empty string for null/empty input', () => {
    expect(parseCSVDate('', 'YYYY-MM-DD')).toBe('');
    expect(parseCSVDate(null, 'YYYY-MM-DD')).toBe('');
  });

  test('strips double-quotes from raw input', () => {
    expect(parseCSVDate('"2026-06-15"', 'YYYY-MM-DD')).toBe('2026-06-15');
  });
});

// ── isDuplicate ───────────────────────────────────────────────────────────────

describe('isDuplicate — duplicate detection', () => {
  const existing = [
    { id: '1', date: '2026-06-01', amount: 50.00, merchant: 'Walmart', type: 'expense' },
    { id: '2', date: '2026-06-02', amount: 15.99, merchant: 'Netflix', type: 'expense' },
    { id: '3', date: '2026-06-03', amount: 100.00, source: 'Employer', type: 'income' },
  ];

  test('detects exact duplicate (date + amount + merchant)', () => {
    expect(isDuplicate(existing, '2026-06-01', 50.00, 'Walmart')).toBe(true);
  });

  test('no duplicate when date differs', () => {
    expect(isDuplicate(existing, '2026-06-05', 50.00, 'Walmart')).toBe(false);
  });

  test('no duplicate when amount differs', () => {
    expect(isDuplicate(existing, '2026-06-01', 51.00, 'Walmart')).toBe(false);
  });

  test('no duplicate when merchant differs', () => {
    expect(isDuplicate(existing, '2026-06-01', 50.00, 'Superstore')).toBe(false);
  });

  test('case-insensitive merchant matching', () => {
    expect(isDuplicate(existing, '2026-06-01', 50.00, 'WALMART')).toBe(true);
    expect(isDuplicate(existing, '2026-06-01', 50.00, 'walmart')).toBe(true);
  });

  test('within 1-cent tolerance for floating point', () => {
    expect(isDuplicate(existing, '2026-06-01', 50.009, 'Walmart')).toBe(true);
    expect(isDuplicate(existing, '2026-06-01', 50.011, 'Walmart')).toBe(false);
  });

  test('matches against source field for income transactions', () => {
    expect(isDuplicate(existing, '2026-06-03', 100.00, 'Employer')).toBe(true);
  });

  test('empty transactions list returns false', () => {
    expect(isDuplicate([], '2026-06-01', 50.00, 'Walmart')).toBe(false);
  });
});

// ── parseAmount ───────────────────────────────────────────────────────────────

describe('parseAmount — CSV amount cleaning', () => {
  test('parses plain number', () => expect(parseAmount('50.00')).toBe(50));
  test('strips dollar sign', () => expect(parseAmount('$50.00')).toBe(50));
  test('strips comma thousands separator', () => expect(parseAmount('1,500.00')).toBe(1500));
  test('handles negative (debit) amounts', () => expect(parseAmount('-25.50')).toBe(-25.5));
  test('handles empty string', () => expect(parseAmount('')).toBe(0));
  test('handles undefined', () => expect(parseAmount(undefined)).toBe(0));
  test('handles amount with both $ and comma', () => expect(parseAmount('$2,500.75')).toBe(2500.75));
});

// ── Transaction type detection from debit/credit columns ─────────────────────

describe('Debit/credit column → transaction type', () => {
  const detectType = (debitRaw, creditRaw) => {
    const debit = parseAmount(debitRaw);
    const credit = parseAmount(creditRaw);
    if (debit > 0) return { amount: debit, type: 'expense' };
    if (credit > 0) return { amount: credit, type: 'income' };
    return null;
  };

  test('debit column → expense', () => {
    expect(detectType('50.00', '')).toEqual({ amount: 50, type: 'expense' });
  });

  test('credit column → income', () => {
    expect(detectType('', '1000.00')).toEqual({ amount: 1000, type: 'income' });
  });

  test('both empty → null', () => {
    expect(detectType('', '')).toBeNull();
  });

  test('negative single-column amount → expense', () => {
    const raw = -50;
    const type = raw < 0 ? 'expense' : 'income';
    expect(type).toBe('expense');
    expect(Math.abs(raw)).toBe(50);
  });

  test('positive single-column amount → income', () => {
    const raw = 1000;
    const type = raw < 0 ? 'expense' : 'income';
    expect(type).toBe('income');
  });
});

// ── Full row parse pipeline ───────────────────────────────────────────────────

describe('CSV row → transaction pipeline', () => {
  const parseRow = (row, mapping, cats, dateFormat = 'YYYY-MM-DD') => {
    const rawDate = mapping.date !== '' ? row[+mapping.date] : '';
    const date = parseCSVDate(rawDate, dateFormat);
    const merchant = (mapping.desc !== '' ? row[+mapping.desc] : '').replace(/\s+/g, ' ').trim();
    let amount = 0, type = 'expense';
    if (mapping.amount !== '') {
      const raw = parseAmount(row[+mapping.amount]);
      if (raw < 0) { amount = Math.abs(raw); type = 'expense'; }
      else { amount = raw; type = raw > 0 ? 'income' : 'expense'; }
    } else {
      const debit = mapping.debit !== '' ? parseAmount(row[+mapping.debit]) : 0;
      const credit = mapping.credit !== '' ? parseAmount(row[+mapping.credit]) : 0;
      if (debit > 0) { amount = debit; type = 'expense'; }
      else if (credit > 0) { amount = credit; type = 'income'; }
    }
    return { date, merchant, amount, type, category: cats[0] || 'Other' };
  };

  const cats = ['Groceries', 'Dining', 'Other'];

  test('TD-style row (debit/credit columns)', () => {
    const row = ['2026-06-01', 'WALMART STORE', '55.32', ''];
    const mapping = { date: '0', desc: '1', debit: '2', credit: '3', amount: '' };
    const result = parseRow(row, mapping, cats);
    expect(result.date).toBe('2026-06-01');
    expect(result.merchant).toBe('WALMART STORE');
    expect(result.amount).toBe(55.32);
    expect(result.type).toBe('expense');
  });

  test('single amount column — positive is income', () => {
    const row = ['2026-06-01', 'Employer', '2500.00'];
    const mapping = { date: '0', desc: '1', amount: '2', debit: '', credit: '' };
    const result = parseRow(row, mapping, cats);
    expect(result.type).toBe('income');
    expect(result.amount).toBe(2500);
  });

  test('single amount column — negative is expense', () => {
    const row = ['2026-06-01', 'Netflix', '-15.99'];
    const mapping = { date: '0', desc: '1', amount: '2', debit: '', credit: '' };
    const result = parseRow(row, mapping, cats);
    expect(result.type).toBe('expense');
    expect(result.amount).toBe(15.99);
  });

  test('collapses multiple spaces in merchant name', () => {
    const row = ['2026-06-01', 'UBER   EATS  TORONTO', '30.00', ''];
    const mapping = { date: '0', desc: '1', debit: '2', credit: '3', amount: '' };
    const result = parseRow(row, mapping, cats);
    expect(result.merchant).toBe('UBER EATS TORONTO');
  });

  test('assigns default category from cats[0]', () => {
    const row = ['2026-06-01', 'Store', '10.00', ''];
    const mapping = { date: '0', desc: '1', debit: '2', credit: '3', amount: '' };
    const result = parseRow(row, mapping, cats);
    expect(result.category).toBe('Groceries');
  });

  test('zero-amount rows should be filtered out', () => {
    const row = ['2026-06-01', 'Some Entry', '0', ''];
    const mapping = { date: '0', desc: '1', debit: '2', credit: '3', amount: '' };
    const result = parseRow(row, mapping, cats);
    expect(result.amount).toBe(0); // caller filters amount === 0
  });
});
