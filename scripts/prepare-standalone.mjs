// Copies the static assets that Next.js standalone output intentionally omits.
// Must run after `next build` and before `electron-builder`.
import { cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.error('[prepare-standalone] .next/standalone not found — run next build first');
  process.exit(1);
}

cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
console.log('[prepare-standalone] copied .next/static → .next/standalone/.next/static');

if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true });
  console.log('[prepare-standalone] copied public/ → .next/standalone/public/');
}
