import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');

for (const target of ['dist', '.vite']) {
  rmSync(path.join(projectDir, target), { force: true, recursive: true });
}
