/**
 * Dev launcher — always uses stock Electron from node_modules (stable GPU/ICU).
 * Menu bar shows "Electron" in dev; packaged builds use "WA Assistant Suite".
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Resolve the Electron binary path and repair a common broken install:
 * path.txt sometimes contains a trailing newline → spawn ENOENT.
 */
function electronPath() {
  let bin;
  try {
    bin = String(require('electron') || '').trim();
  } catch (e) {
    throw new Error(
      `Electron module failed to load (${e.message}). Run: rm -rf node_modules/electron && npm install electron@33.4.11 --workspace=apps/desktop && node node_modules/electron/install.js`
    );
  }

  // Repair path.txt if it has trailing whitespace/newlines (causes spawn ENOENT)
  try {
    const electronPkg = path.dirname(require.resolve('electron/package.json'));
    const pathTxt = path.join(electronPkg, 'path.txt');
    if (fs.existsSync(pathTxt)) {
      const raw = fs.readFileSync(pathTxt, 'utf8');
      const trimmed = raw.trim();
      if (raw !== trimmed) {
        fs.writeFileSync(pathTxt, trimmed, 'utf8');
        bin = path.join(electronPkg, 'dist', trimmed);
        console.warn('[run-dev] Repaired electron path.txt (removed trailing whitespace)');
      }
    }
    // Re-resolve after repair
    if (!bin || !fs.existsSync(bin)) {
      delete require.cache[require.resolve('electron')];
      bin = String(require('electron') || '').trim();
    }
  } catch {
    /* best-effort repair */
  }

  if (!bin || !fs.existsSync(bin)) {
    throw new Error(
      `Electron binary missing at "${bin || '(empty)'}". ` +
        'Fix: rm -rf node_modules/electron && npm install electron@33.4.11 --foreground-scripts --workspace=apps/desktop'
    );
  }
  return bin;
}

function main() {
  let bin;
  try {
    bin = electronPath();
  } catch (e) {
    console.error('[run-dev]', e.message);
    process.exit(1);
  }

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
    console.error(
      '[run-dev] Hint: reinstall Electron with a complete binary download, then retry dev:desktop:fast.'
    );
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.exit(0);
    process.exit(code ?? 0);
  });
}

main();
