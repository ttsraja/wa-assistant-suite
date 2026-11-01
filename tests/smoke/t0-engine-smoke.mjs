#!/usr/bin/env node
/**
 * T0 smoke — engine boots on temp dataDir, GET /api/state + /api/system.
 * No WhatsApp init. Exit 0 on success.
 */
import { startTestEngine, removeTempDataDir, REPO_ROOT } from '../helpers/engineHarness.js';
import { existsSync } from 'fs';
import path from 'path';

async function main() {
    const errors = [];
    let engine;

    // Optional: static export presence (warn only for pure smoke)
    const outIndex = path.join(REPO_ROOT, 'apps/web-control-center/out/index.html');
    if (!existsSync(outIndex)) {
        console.warn('⚠️  apps/web-control-center/out missing — run npm run build:ui for desktop/UI smoke');
    }

    try {
        engine = await startTestEngine({ initWhatsApp: false });
        console.log(`✅ Engine up at ${engine.baseUrl} dataDir=${engine.dataDir}`);

        const stateRes = await fetch(`${engine.baseUrl}/api/state`);
        if (!stateRes.ok) errors.push(`/api/state HTTP ${stateRes.status}`);
        const state = await stateRes.json();
        if (!state || typeof state.connectionStatus !== 'string') {
            errors.push('/api/state missing connectionStatus');
        } else {
            console.log(`✅ /api/state connectionStatus=${state.connectionStatus}`);
        }

        const sysRes = await fetch(`${engine.baseUrl}/api/system`);
        if (!sysRes.ok) errors.push(`/api/system HTTP ${sysRes.status}`);
        const sys = await sysRes.json();
        if (!sys?.version || !sys?.dataDir) {
            errors.push('/api/system missing version/dataDir');
        } else {
            console.log(`✅ /api/system v${sys.version} dataDir=${sys.dataDir}`);
        }

        if (sys?.dataDir !== engine.dataDir) {
            errors.push(`dataDir mismatch: system=${sys.dataDir} engine=${engine.dataDir}`);
        }
        if (String(sys?.databaseFile || '').includes('Application Support') === false) {
            // temp dir is fine — just ensure not accidentally package default when custom dir set
            if (!String(sys?.databaseFile || '').startsWith(engine.dataDir)) {
                errors.push(`databaseFile not under temp dataDir: ${sys.databaseFile}`);
            }
        }
    } catch (e) {
        errors.push(e.stack || e.message || String(e));
    } finally {
        if (engine) {
            try {
                await engine.stop();
                console.log('✅ Engine stopped');
            } catch (e) {
                errors.push(`stopEngine: ${e.message}`);
            }
            removeTempDataDir(engine.dataDir);
        }
    }

    if (errors.length) {
        console.error('❌ T0 smoke failed:');
        for (const e of errors) console.error(' -', e);
        process.exit(1);
    }
    console.log('✅ T0 smoke passed');
}

main();
