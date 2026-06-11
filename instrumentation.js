// Runs once when the Next.js server starts (Node.js runtime only).
// Initialises the database schema and seeds demo data if the DB is empty.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { migrate, seedFromJson } = await import('./server/db/index.js');
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  migrate();

  const dataFile = process.env.SEED_DATA_PATH || join(process.cwd(), 'data.json');
  if (existsSync(dataFile)) {
    try {
      seedFromJson(JSON.parse(readFileSync(dataFile, 'utf8')));
    } catch (e) {
      console.warn('[CashHeap] Could not seed from data.json:', e.message);
    }
  }
}
