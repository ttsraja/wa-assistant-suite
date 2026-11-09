#!/usr/bin/env node
/**
 * Repair a broken Electron install (missing path.txt, trailing newline, incomplete dist).
 * Usage: npm run electron:repair
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '33.4.11';

function log(...a) {
  console.log('[electron:repair]', ...a);
}

function fail(msg) {
  console.error('[electron:repair]', msg);
  process.exit(1);
}

function platformZip() {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  if (platform === 'darwin') return `electron-v${version}-darwin-${arch}.zip`;
  if (platform === 'win32') return `electron-v${version}-win32-${arch}.zip`;
  if (platform === 'linux') return `electron-v${version}-linux-${arch}.zip`;
  fail(`Unsupported platform: ${platform}`);
}

function platformPathTxt() {
  if (process.platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron';
  if (process.platform === 'win32') return 'electron.exe';
  return 'electron';
}

function electronPkgDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return path.join(root, 'node_modules', 'electron');
  }
}

function isHealthy(pkg) {
  const pathTxt = path.join(pkg, 'path.txt');
  if (!fs.existsSync(pathTxt)) return false;
  const rel = fs.readFileSync(pathTxt, 'utf8').trim();
  if (!rel) return false;
  const bin = path.join(pkg, 'dist', rel);
  if (!fs.existsSync(bin)) return false;
  // macOS Frameworks should exist for a full install
  if (process.platform === 'darwin') {
    const fw = path.join(pkg, 'dist', 'Electron.app', 'Contents', 'Frameworks');
    if (!fs.existsSync(fw)) return false;
  }
  return true;
}

function repairPathTxt(pkg) {
  const pathTxt = path.join(pkg, 'path.txt');
  const expected = platformPathTxt();
  if (fs.existsSync(pathTxt)) {
    const raw = fs.readFileSync(pathTxt, 'utf8');
    if (raw !== raw.trim() || raw.trim() !== expected) {
      fs.writeFileSync(pathTxt, expected, 'utf8');
      log('Wrote clean path.txt');
    }
  } else {
    fs.writeFileSync(pathTxt, expected, 'utf8');
    log('Created path.txt');
  }
}

function downloadAndExtract(pkg) {
  const zipName = platformZip();
  const url = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`;
  const zipPath = path.join(os.tmpdir(), zipName);
  const dist = path.join(pkg, 'dist');

  log('Downloading', url);
  const curl = spawnSync('curl', ['-L', '--fail', '-o', zipPath, url], { stdio: 'inherit' });
  if (curl.status !== 0) fail('curl download failed');

  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  log('Extracting to', dist);
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${dist}' -Force`],
      { stdio: 'inherit' }
    );
    if (ps.status !== 0) fail('unzip failed');
  } else {
    const uz = spawnSync('unzip', ['-q', '-o', zipPath, '-d', dist], { stdio: 'inherit' });
    if (uz.status !== 0) fail('unzip failed');
  }

  fs.writeFileSync(path.join(pkg, 'path.txt'), platformPathTxt(), 'utf8');
  log('path.txt + dist ready');
}

function main() {
  const pkg = electronPkgDir();
  if (!fs.existsSync(pkg)) {
    log('electron package missing — npm install electron@' + version);
    const r = spawnSync(
      'npm',
      ['install', `electron@${version}`, '--save-dev', '--workspace=apps/desktop', '--foreground-scripts'],
      { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
    );
    if (r.status !== 0) fail('npm install electron failed');
  }

  repairPathTxt(pkg);

  if (isHealthy(pkg)) {
    log('Electron looks healthy at', path.join(pkg, 'dist'));
    try {
      const bin = String(require('electron')).trim();
      log('require("electron") =>', bin);
    } catch (e) {
      log('require still failing, force re-download:', e.message);
      downloadAndExtract(pkg);
    }
  } else {
    log('Incomplete Electron install — downloading official binary…');
    downloadAndExtract(pkg);
  }

  if (!isHealthy(pkg)) fail('Electron still unhealthy after repair');

  // Smoke spawn --version
  const bin = path.join(pkg, 'dist', fs.readFileSync(path.join(pkg, 'path.txt'), 'utf8').trim());
  const ver = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (ver.error || ver.status !== 0) {
    fail(`spawn --version failed: ${ver.error || ver.stderr}`);
  }
  log('OK', ver.stdout.trim());
}

main();
