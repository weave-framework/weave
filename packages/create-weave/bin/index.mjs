#!/usr/bin/env node
/**
 * `npm create weave <dir>` (also `pnpm create weave` / `yarn create weave`).
 * Copies template/ into <dir>, renames _gitignore → .gitignore, sets the app's
 * package.json name, and prints next steps. Zero dependencies.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(here, '..', 'template');

const arg = process.argv[2];
const targetDir = resolve(process.cwd(), arg || 'weave-app');
const appName = basename(targetDir);

if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
  console.error(`✖ Target directory "${appName}" already exists and is not empty.`);
  process.exit(1);
}

cpSync(templateDir, targetDir, { recursive: true });

// npm strips a real .gitignore from published tarballs, so it ships as _gitignore.
const gi = join(targetDir, '_gitignore');
if (existsSync(gi)) renameSync(gi, join(targetDir, '.gitignore'));

// Stamp the chosen app name into the generated package.json.
const pkgPath = join(targetDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = appName;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`\n✓ Created a Weave app in ${appName}\n`);
console.log('Next steps:');
console.log(`  cd ${arg || 'weave-app'}`);
console.log('  npm install      # or: pnpm install / yarn');
console.log('  npm run dev      # start the dev server\n');
console.log('Then open the printed URL and edit src/app/app.html — it reloads on save.\n');
