/**
 * Preload runs in an isolated context before page scripts.
 * Exposes engine base URL for the control center (also same-origin when UI is engine-hosted).
 */
const { contextBridge } = require('electron');

const apiBase = process.env.WA_API_BASE || 'http://127.0.0.1:3001';

try {
  contextBridge.exposeInMainWorld('__WA_API_BASE__', apiBase);
  contextBridge.exposeInMainWorld('__WA_SAME_ORIGIN_API__', true);
  contextBridge.exposeInMainWorld('waDesktop', {
    apiBase,
    platform: process.platform,
  });
} catch (e) {
  // contextIsolation may be off in some debug setups
  // eslint-disable-next-line no-undef
  globalThis.__WA_API_BASE__ = apiBase;
}
