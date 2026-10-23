/**
 * Dev launcher — always uses stock Electron from node_modules (stable GPU/ICU).
 * Menu bar shows "Electron" in dev; packaged builds use "WA Assistant Suite".
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function electronPath() {
  return require('electron');
}

function main() {
  const bin = electronPath();
  console.log('[run-dev] Electron:', bin);
  console.log('[run-dev] App dir:', __dirname);

  // Standard pattern: electron .  (cwd = package with main.mjs)
  const child = spawn(bin, ['.', ...process.argv.slice(2)], {
    cwd: __dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS:
        process.env.ELECTRON_DISABLE_SECURITY_WARNINGS || 'true',
    },
  });

  const forward = (sig) => {
    try {
      if (child && !child.killed) child.kill(sig);
    } catch {
      /* ignore */
    }
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  child.on('error', (err) => {
    console.error('[run-dev] Failed to start Electron:', err.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.exit(0);
    process.exit(code ?? 0);
  });
}

main();
