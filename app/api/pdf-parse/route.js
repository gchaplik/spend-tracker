import { NextResponse } from 'next/server';
import pdfParse from 'pdf-parse';

// Bank-specific regex patterns for Canadian banks.
// Each pattern extracts: date, description, debit amount, credit amount.
const BANK_PATTERNS = {
  td: {
    name: 'TD Bank',
    // TD format: "MM DD    DESCRIPTION    DEBIT    CREDIT    BALANCE"
    row: /(\d{2}\/\d{2})\s+([\w\s&'.,-]+?)\s{2,}([\d,]+\.\d{2})?\s{2,}([\d,]+\.\d{2})?\s{2,}[\d,]+\.\d{2}/g,
    dateFormat: 'MM/DD',
  },
  rbc: {
    name: 'RBC',
    // RBC format: "MM-DD-YYYY    DESCRIPTION    AMOUNT"
    row: /(\d{2}-\d{2}-\d{4})\s+([\w\s&'.,-]+?)\s{2,}(-?[\d,]+\.\d{2})/g,
    dateFormat: 'MM-DD-YYYY',
  },
  bmo: {
    name: 'BMO',
    // BMO format: "MMM DD, YYYY    DESCRIPTION    DEBIT    CREDIT"
    row: /([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})\s+([\w\s&'.,-]+?)\s{2,}([\d,]+\.\d{2})?\s{2,}([\d,]+\.\d{2})?/g,
    dateFormat: 'MMM DD, YYYY',
  },
  scotiabank: {
    name: 'Scotiabank',
    // Scotia format: "DD MMM YYYY    DESCRIPTION    AMOUNT"
    row: /(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})\s+([\w\s&'.,-]+?)\s{2,}(-?[\d,]+\.\d{2})/g,
    dateFormat: 'DD MMM YYYY',
  },
  cibc: {
    name: 'CIBC',
    // CIBC format: "MM/DD/YYYY    DESCRIPTION    DEBIT    CREDIT"
    row: /(\d{2}\/\d{2}\/\d{4})\s+([\w\s&'.,-]+?)\s{2,}([\d,]+\.\d{2})?\s{2,}([\d,]+\.\d{2})?/g,
    dateFormat: 'MM/DD/YYYY',
  },
};

function parseDate(raw, fmt) {
  raw = raw.trim();
  const months = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
  const now = new Date();
  if (fmt === 'MM/DD') {
    const [m, d] = raw.split('/');
    return `${now.getFullYear()}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (fmt === 'MM-DD-YYYY') {
    const [m, d, y] = raw.split('-');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (fmt === 'MMM DD, YYYY') {
    const p = raw.replace(',', '').split(/\s+/);
    return `${p[2]}-${String(months[p[0]]||1).padStart(2,'0')}-${p[1].padStart(2,'0')}`;
  }
  if (fmt === 'DD MMM YYYY') {
    const p = raw.split(/\s+/);
    return `${p[2]}-${String(months[p[1]]||1).padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  }
  if (fmt === 'MM/DD/YYYY') {
    const [m, d, y] = raw.split('/');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return raw.slice(0, 10);
}

function parseAmt(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/,/g, '')) || 0;
}

function detectBank(text) {
  const lower = text.toLowerCase();
  if (lower.includes('td bank') || lower.includes('toronto-dominion')) return 'td';
  if (lower.includes('royal bank') || lower.includes(' rbc ')) return 'rbc';
  if (lower.includes('bank of montreal') || lower.includes(' bmo ')) return 'bmo';
  if (lower.includes('scotiabank') || lower.includes('nova scotia')) return 'scotiabank';
  if (lower.includes('cibc') || lower.includes('canadian imperial')) return 'cibc';
  return null;
}

function extractTransactions(text, bankKey) {
  const pattern = BANK_PATTERNS[bankKey];
  if (!pattern) return [];

  const transactions = [];
  let match;
  const re = new RegExp(pattern.row.source, 'g');

  while ((match = re.exec(text)) !== null) {
    const [, rawDate, desc, col3, col4] = match;
    const date = parseDate(rawDate, pattern.dateFormat);
    const merchant = desc.replace(/\s{2,}/g, ' ').trim();
    if (!merchant || merchant.length < 2) continue;

    let amount = 0, type = 'expense';
    if (col3 && col4) {
      // debit/credit columns
      const debit = parseAmt(col3);
      const credit = parseAmt(col4);
      if (debit > 0) { amount = debit; type = 'expense'; }
      else if (credit > 0) { amount = credit; type = 'income'; }
    } else {
      const val = parseAmt(col3 || col4);
      if (val < 0) { amount = Math.abs(val); type = 'expense'; }
      else if (val > 0) { amount = val; type = 'income'; }
    }

    if (amount > 0 && date && date.length === 10) {
      transactions.push({ date, merchant, amount, type });
    }
  }
  return transactions;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const preferredBank = formData.get('bank') || null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buffer, { max: 0 });
    const text = parsed.text;

    const bankKey = preferredBank && BANK_PATTERNS[preferredBank] ? preferredBank : detectBank(text);
    if (!bankKey) {
      return NextResponse.json({
        error: 'Could not detect bank format. Try selecting a bank manually.',
        rawText: text.slice(0, 500),
      }, { status: 422 });
    }

    const transactions = extractTransactions(text, bankKey);
    return NextResponse.json({ bank: BANK_PATTERNS[bankKey].name, bankKey, transactions, pageCount: parsed.numpages });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
