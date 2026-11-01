/**
 * Selected-provider auth status helpers for dashboard / settings.
 * Keep pure so unit tests lock the desktop badge regression (K1/H1/H2).
 */

export function providerReady(authStatus, key) {
    const s = authStatus?.[key];
    if (key === 'google') return s === 'Authenticated';
    return s === 'Available' || s === 'Authenticated';
}

export function calendarBadgeLabel(authStatus = {}, calProviderKey = 'google', tasksProviderKey = 'google') {
    const calReady = providerReady(authStatus, calProviderKey);
    const tasksReady = providerReady(authStatus, tasksProviderKey);

    if (calProviderKey === tasksProviderKey) {
        const s = authStatus[calProviderKey];
        if (calProviderKey === 'google') return s === 'Authenticated' ? 'Auth OK' : (s || 'Not configured');
        if (s === 'Available') return 'Ready';
        if (s === 'Unavailable') return 'Unavailable';
        return s || '—';
    }

    const fmt = (key, ready) => {
        if (key === 'google') return ready ? 'G:OK' : 'G:off';
        if (key === 'macos') return ready ? 'Mac:OK' : 'Mac:n/a';
        if (key === 'windows') return ready ? 'Win:OK' : 'Win:n/a';
        return ready ? 'OK' : 'off';
    };
    return `${fmt(calProviderKey, calReady)} · ${fmt(tasksProviderKey, tasksReady)}`;
}

export function calendarBadgeOk(authStatus = {}, calProviderKey = 'google', tasksProviderKey = 'google') {
    return providerReady(authStatus, calProviderKey) && providerReady(authStatus, tasksProviderKey);
}
