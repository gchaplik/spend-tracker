// Runs between `next build` and `electron-builder`.
// 1. Replaces Turbopack native-module symlinks in .next/node_modules/ with
//    redirect shims that load from app.asar.unpacked/ in production.
// 2. Creates a `next` symlink so server chunks can require('next/dist/...')
//    from outside the asar (they live in .next/ which is an extraResource).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.next', 'node_modules');
if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }

// ── Step 1: shim native-module symlinks ──────────────────────────────────────
for (const entry of fs.readdirSync(dir)) {
  if (entry === 'next') continue; // handled in step 2

  const p = path.join(dir, entry);
  const stat = fs.lstatSync(p);

  let pkgName;
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(p);
    pkgName = path.basename(target.replace(/\\/g, '/'));
    fs.unlinkSync(p); // remove symlink before mkdirSync
  } else if (stat.isDirectory()) {
    const idx = path.join(p, 'index.js');
    if (fs.existsSync(idx) && fs.readFileSync(idx, 'utf8').includes('app.asar.unpacked')) {
      console.log(`Already shimmed: ${entry}`);
      continue;
    }
    continue;
  } else {
    continue;
  }

  console.log(`Shimming: ${entry} -> ${pkgName}`);
  fs.mkdirSync(p);
  fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: pkgName, version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(p, 'index.js'), `\
'use strict';
const path = require('path');
const fs = require('fs');
const prod = path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'node_modules', '${pkgName}');
const dev  = path.join(__dirname, '..', '..', '..', 'node_modules', '${pkgName}');
module.exports = require(fs.existsSync(prod) ? prod : dev);
`);
}

// ── Step 2: symlink `next` so that .next/server/chunks can require('next/...') ─
// The .next/ directory is an extraResource (outside the asar) but the chunks
// use require('next/dist/compiled/...') etc. at runtime. Pointing next at
// app.asar.unpacked/node_modules/next (which has all files physically on disk)
// makes every sub-path resolve correctly inside the packaged Electron app.
const nextLink = path.join(dir, 'next');
// Relative path: from .next/node_modules/ go up 2 levels to Contents/Resources/
// (.next/node_modules/ -> .next/ -> Contents/Resources/)
// Note: shims use 3 levels because __dirname is one level deeper (.next/node_modules/<pkg>/)
const nextTarget = path.join('..', '..', 'app.asar.unpacked', 'node_modules', 'next');

let existing = null;
try { existing = fs.lstatSync(nextLink); } catch {}
if (existing) {
  if (existing.isSymbolicLink()) {
    const cur = fs.readlinkSync(nextLink);
    if (cur === nextTarget) {
      console.log('next symlink already correct');
    } else {
      fs.unlinkSync(nextLink);
      fs.symlinkSync(nextTarget, nextLink, 'dir');
      console.log(`Updated next symlink -> ${nextTarget}`);
    }
  } else {
    console.log('next entry is a real directory — skipping');
  }
} else {
  fs.symlinkSync(nextTarget, nextLink, 'dir');
  console.log(`Created next symlink -> ${nextTarget}`);
}

console.log('Done.');
