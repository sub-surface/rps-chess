// Production releases must identify committed source, never an ambiguous dirty tree.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'public', 'scripts', 'package.json', 'package-lock.json', 'wrangler.jsonc'],
  { cwd: root, encoding: 'utf8' },
);
const changes = output
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((line) => !line.endsWith(' public/version.json'));

if (changes.length) {
  console.error('Refusing to deploy uncommitted application changes:');
  console.error(changes.join('\n'));
  console.error('Commit the release first so version.json can identify the exact deployed source.');
  process.exit(1);
}
