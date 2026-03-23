import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const nodeExec = process.execPath;
const command = process.argv[2];
const extraArgs = process.argv.slice(3);

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function spawnProcess(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: projectDir,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function ensureDependencies() {
  if (existsSync(path.join(projectDir, 'node_modules'))) {
    return;
  }

  console.log('Installing dependencies...');
  const code = await spawnProcess(npmCommand(), ['install']);
  if (code !== 0) {
    process.exit(code);
  }
}

function withDefaultServerArgs(args, defaultPort) {
  const nextArgs = [...args];
  const hasHost = nextArgs.includes('--host');
  const hasPort = nextArgs.includes('--port');

  if (!hasHost) {
    nextArgs.push('--host', process.env.HOST || '0.0.0.0');
  }

  if (!hasPort) {
    nextArgs.push('--port', process.env.PORT || defaultPort);
  }

  return nextArgs;
}

async function runNodeScript(scriptPath, args = []) {
  const code = await spawnProcess(nodeExec, [path.join(projectDir, scriptPath), ...args]);
  process.exit(code);
}

async function main() {
  await ensureDependencies();

  switch (command) {
    case 'dev':
      await runNodeScript('node_modules/vite/bin/vite.js', withDefaultServerArgs(extraArgs, '3000'));
      break;
    case 'build': {
      const tscCode = await spawnProcess(nodeExec, [path.join(projectDir, 'node_modules/typescript/lib/tsc.js'), '-b']);
      if (tscCode !== 0) {
        process.exit(tscCode);
      }
      await runNodeScript('node_modules/vite/bin/vite.js', ['build', ...extraArgs]);
      break;
    }
    case 'lint':
      await runNodeScript('node_modules/eslint/bin/eslint.js', ['.', ...extraArgs]);
      break;
    case 'preview':
      await runNodeScript('node_modules/vite/bin/vite.js', ['preview', ...withDefaultServerArgs(extraArgs, '4173')]);
      break;
    default:
      console.error('Usage: node scripts/run.mjs <dev|build|lint|preview> [args...]');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
