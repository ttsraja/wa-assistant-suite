/**
 * Resolve core-engine HTTP/Socket.IO base URL.
 *
 * Priority:
 * 1. window.__WA_API_BASE__ (Electron preload)
 * 2. Same-origin when UI is served by the engine (port 3001 or empty)
 * 3. NEXT_PUBLIC_API_BASE (build-time)
 * 4. http://127.0.0.1:3001 (local dev default)
 */
const FALLBACK = 'http://127.0.0.1:3001';

function normalize(base) {
    if (!base) return '';
    return String(base).replace(/\/$/, '');
}

export function getApiBase() {
    if (typeof window !== 'undefined') {
        if (window.__WA_API_BASE__) {
            return normalize(window.__WA_API_BASE__);
        }
const { protocol, hostname, port, origin } = window.location;
        if (protocol === 'http:' || protocol === 'https:') {
            // UI hosted by core-engine / Electron (any port except Next dev :3000)
            const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
            if (window.__WA_SAME_ORIGIN_API__) {
                return origin;
            }
            if (port === '3001' || port === String(process.env.NEXT_PUBLIC_ENGINE_PORT || '')) {
                return origin;
            }
            if (isLoopback && port && port !== '3000') {
                return origin;
            }
        }
    }

    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_BASE) {
        return normalize(process.env.NEXT_PUBLIC_API_BASE);
    }

    return FALLBACK;
}
