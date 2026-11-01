"use client";
import { useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";

function shortPath(p) {
    if (!p) return "—";
    if (p.length <= 48) return p;
    return "…" + p.slice(-46);
}

export function VersionPill({ system }) {
    if (!system?.version) {
        return <span className="version-pill muted">v—</span>;
    }
    return (
        <span className="version-pill" title={`${system.name || "App"} · ${system.channel || "stable"}`}>
            <span className="version-pill-dot" />
            v{system.version}
            <span className="version-pill-channel">{system.channel || "stable"}</span>
        </span>
    );
}

export function useSystemInfo() {
    const [system, setSystem] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        const load = () => {
            fetch(`${getApiBase()}/api/system`)
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                .then((data) => {
                    if (alive) {
                        setSystem(data);
                        setError(null);
                    }
                })
                .catch((e) => {
                    if (alive) setError(e.message || "Unavailable");
                });
        };
        load();
        const t = setInterval(load, 60000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, []);

    return { system, error, reload: () => fetch(`${getApiBase()}/api/system`).then((r) => r.json()).then(setSystem) };
}

export function AppFooter() {
    const { system } = useSystemInfo();

    return (
        <footer className="app-footer">
            <div className="app-footer-left">
                <span className="app-footer-brand">{system?.name || "WA Assistant Suite"}</span>
                <VersionPill system={system} />
                <span className="app-footer-sep">·</span>
                <span className="app-footer-meta">
                    Schema {system?.schemaVersion ?? "—"} · {system?.platform || "—"}/{system?.arch || "—"}
                </span>
            </div>
            <div className="app-footer-right">
                <span className="app-footer-meta" title={system?.dataDir || ""}>
                    Data {shortPath(system?.dataDir)}
                </span>
                <span className="app-footer-sep">·</span>
                <span className="app-footer-meta durability" title={system?.durability?.note || ""}>
                    Upgrade-safe storage
                </span>
            </div>
        </footer>
    );
}

export function SystemPanel() {
    const { system, error } = useSystemInfo();

    if (error && !system) {
        return (
            <div className="glass-card">
                <p className="form-hint" style={{ color: "var(--rose-text)" }}>
                    System metadata unavailable: {error}
                </p>
            </div>
        );
    }

    if (!system) {
        return (
            <div className="glass-card">
                <p className="form-hint">Loading system information…</p>
            </div>
        );
    }

    const history = Array.isArray(system.upgradeHistory) ? [...system.upgradeHistory].reverse() : [];

    return (
        <div className="settings-grid system-grid">
            <div className="glass-card">
                <h2 className="section-title">
                    <span className="section-icon">◆</span>
                    Product identity
                </h2>
                <div className="system-kv">
                    <div><span className="kv-label">Product</span><span className="kv-value">{system.name}</span></div>
                    <div><span className="kv-label">Version</span><span className="kv-value mono">v{system.version}</span></div>
                    <div><span className="kv-label">Channel</span><span className="kv-value"><span className="badge badge-indigo">{system.channel}</span></span></div>
                    <div><span className="kv-label">Product ID</span><span className="kv-value mono">{system.productId}</span></div>
                    <div><span className="kv-label">Schema</span><span className="kv-value mono">{system.schemaVersion}</span></div>
                    <div><span className="kv-label">Runtime</span><span className="kv-value mono">{system.platform}/{system.arch} · {system.node}</span></div>
                </div>
            </div>

            <div className="glass-card">
                <h2 className="section-title">
                    <span className="section-icon">▣</span>
                    Durable data (survives upgrades)
                </h2>
                <p className="form-hint" style={{ marginBottom: 14 }}>
                    {system.durability?.note ||
                        "Installing a new app version replaces binaries only. Your database, WhatsApp session, and OAuth tokens remain in the data directory."}
                </p>
                <ul className="durability-list">
                    <li className={system.durability?.preservesDatabase ? "ok" : ""}>SQLite database & conversation logs</li>
                    <li className={system.durability?.preservesPoliciesAndLogs ? "ok" : ""}>LLM / calendar settings & contact policies</li>
                    <li className={system.durability?.preservesWhatsAppSession ? "ok" : ""}>WhatsApp Web session (no re-scan on upgrade)</li>
                    <li className={system.durability?.preservesOAuthTokens ? "ok" : ""}>Google OAuth credentials & tokens</li>
                </ul>
                <div className="system-kv" style={{ marginTop: 16 }}>
                    <div><span className="kv-label">Data directory</span><span className="kv-value mono break">{system.dataDir}</span></div>
                    <div><span className="kv-label">Database file</span><span className="kv-value mono break">{system.databaseFile}</span></div>
                    <div><span className="kv-label">WhatsApp session</span><span className="kv-value mono break">{system.authDataPath}</span></div>
                </div>
            </div>

            <div className="glass-card">
                <h2 className="section-title">
                    <span className="section-icon">↻</span>
                    Updates & lifecycle
                </h2>
                <div className="system-kv">
                    <div>
                        <span className="kv-label">First installed</span>
                        <span className="kv-value mono">{system.firstInstalledAt ? new Date(system.firstInstalledAt).toLocaleString() : "—"}</span>
                    </div>
                    <div>
                        <span className="kv-label">Last started</span>
                        <span className="kv-value mono">{system.lastStartedAt ? new Date(system.lastStartedAt).toLocaleString() : "—"}</span>
                    </div>
                    <div>
                        <span className="kv-label">Last upgraded</span>
                        <span className="kv-value mono">{system.lastUpgradedAt ? new Date(system.lastUpgradedAt).toLocaleString() : "Never (fresh install)"}</span>
                    </div>
                    <div>
                        <span className="kv-label">Previous version</span>
                        <span className="kv-value mono">{system.previousAppVersion ? `v${system.previousAppVersion}` : "—"}</span>
                    </div>
                    <div>
                        <span className="kv-label">Update feed</span>
                        <span className="kv-value">
                            {system.update?.supported ? (
                                <span className="badge badge-emerald">Configured</span>
                            ) : (
                                <span className="badge badge-amber">Manual / offline</span>
                            )}
                        </span>
                    </div>
                </div>
                {!system.update?.supported && (
                    <p className="form-hint" style={{ marginTop: 12 }}>
                        To enable in-app update checks, set <code className="mono">WA_UPDATE_FEED_URL</code> for your release channel.
                        Until then, replace the app binary/DMG; user data is kept automatically.
                    </p>
                )}
                {history.length > 0 && (
                    <div className="upgrade-history">
                        <div className="overview-label" style={{ marginBottom: 8 }}>Upgrade history</div>
                        <table className="pro-table">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>To</th>
                                    <th>When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((h, i) => (
                                    <tr key={i}>
                                        <td className="mono">v{h.from}</td>
                                        <td className="mono">v{h.to}</td>
                                        <td className="mono">{h.at ? new Date(h.at).toLocaleString() : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
