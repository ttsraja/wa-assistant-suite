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

export function normalizeApiBase(base) {
    if (!base) return '';
    return String(base).replace(/\/$/, '');
}

/**
 * Pure resolver for unit tests. Pass a window-like object and env map.
 * @param {{ windowLike?: object | null, env?: Record<string, string | undefined> }} [opts]
 */
export function resolveApiBase(opts = {}) {
    const windowLike = opts.windowLike;
    const env = opts.env || (typeof process !== 'undefined' ? process.env : {});

    if (windowLike) {
        if (windowLike.__WA_API_BASE__) {
            return normalizeApiBase(windowLike.__WA_API_BASE__);
        }
        const location = windowLike.location || {};
        const { protocol, hostname, port, origin } = location;
        if (protocol === 'http:' || protocol === 'https:') {
            const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
            if (windowLike.__WA_SAME_ORIGIN_API__) {
                return origin;
            }
            if (port === '3001' || port === String(env.NEXT_PUBLIC_ENGINE_PORT || '')) {
                return origin;
            }
            if (isLoopback && port && port !== '3000') {
                return origin;
            }
        }
    }

    if (env?.NEXT_PUBLIC_API_BASE) {
        return normalizeApiBase(env.NEXT_PUBLIC_API_BASE);
    }

    return FALLBACK;
}

export function getApiBase() {
    const windowLike = typeof window !== 'undefined' ? window : null;
    return resolveApiBase({ windowLike, env: typeof process !== 'undefined' ? process.env : {} });
}
