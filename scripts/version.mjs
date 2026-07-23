// Writes public/version.json with the current git commit, shown in the site footer.
// Run before deploy so the footer reflects exactly what's live.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let full = 'dev', short = 'dev';
try {
  full = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  short = full.slice(0, 7);
} catch { }

const out = { full, short, url: `https://github.com/sub-surface/rps-chess/commit/${full}` };
writeFileSync(join(root, 'public', 'version.json'), JSON.stringify(out));
console.log('version.json →', short);
