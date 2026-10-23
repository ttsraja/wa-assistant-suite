/**
 * WhatsApp connection UI rules.
 * Only READY means linked — never AUTHENTICATED alone (C1/K3).
 */

export function isWhatsAppConnected(connectionStatus) {
    return connectionStatus === 'READY';
}

export function isWhatsAppLoading(connectionStatus) {
    return connectionStatus === 'LOADING' || connectionStatus === 'AUTHENTICATED';
}

export function needsWhatsAppScan(connectionStatus, qrCode) {
    return (
        connectionStatus === 'SCAN_QR' ||
        (!!qrCode &&
            connectionStatus !== 'READY' &&
            connectionStatus !== 'AUTHENTICATED' &&
            connectionStatus !== 'LOADING')
    );
}
