import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['services/api/src', 'services/api/test', 'apps/web/src', 'cli/src'];
const codeFile = /\.(?:[cm]?[jt]sx?|vue)$/;
const forbidden = [
  {
    label: 'disabled/focused test modifier',
    pattern: /\b(?:describe|it|test)\s*\.\s*(?:skip|only|todo)\b/g,
  },
  {
    label: 'disabled/focused test alias',
    pattern: /\b(?:fdescribe|fit|xdescribe|xit|xtest)\s*\(/g,
  },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else if (codeFile.test(entry.name)) files.push(file);
  }
  return files;
}

const violations = [];
for (const root of roots) {
  for (const file of await walk(root)) {
    const source = await readFile(file, 'utf8');
    const lines = source.split(/\r?\n/);
    for (const { label, pattern } of forbidden) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        violations.push(`${file}:${line}: ${label}: ${lines[line - 1].trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Test policy failed. Commit runnable tests only; skip/only/todo aliases are forbidden.');
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Test policy passed: no skip/only/todo or focused aliases.');
}
