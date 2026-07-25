// Check every JavaScript module that contributes to the app, release tooling, or tests.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const visit = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(relative(root, full));
  }
};

for (const directory of ['public', 'src', 'scripts', 'test', 'e2e']) {
  const path = join(root, directory);
  if (existsSync(path)) visit(path);
}
for (const config of ['vitest.config.js', 'playwright.config.js']) {
  if (existsSync(join(root, config))) files.push(config);
}

for (const file of files.sort()) {
  execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
}
console.log(`Syntax checked ${files.length} modules.`);
