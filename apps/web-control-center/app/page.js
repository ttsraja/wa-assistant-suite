"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import io from "socket.io-client";
import ThemeToggle from "./components/ThemeToggle";
import {
    IconMessage, IconSettings, IconServer, IconPhone, IconActivity,
    IconBrain, IconCalendar, IconUsers, IconInbox, IconBot, IconUser,
    IconZap, IconDatabase, IconCheckSquare, IconCpu, IconShield
} from "./components/icons";

import { getApiBase } from "./lib/apiBase";
import { AppFooter } from "./components/AppChrome";
import AppShell from "./components/AppShell";


const LLM_LABELS = {
    ollama: "Ollama (Local)",
    gemini: "Google Gemini",
    claude: "Anthropic Claude",
    openai: "OpenAI",
    grok: "xAI Grok",
};

const CAL_LABELS = {
    google: "Google",
    macos: "macOS",
    windows: "Windows / Outlook",
};

export default function Dashboard() {
    const [state, setState] = useState({
        status: "ON",
        customContext: "",
        qrCode: null,
        connectionStatus: "INITIALIZING",
        loadingProgress: null,
        user: null,
        phoneNumber: null,
        platform: null,
    });
    const [logs, setLogs] = useState([]);
    const [contextInput, setContextInput] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [engineOnline, setEngineOnline] = useState(true);
    const socketRef = useRef(null);
    const [logOffset] = useState(0);
    const logScrollRef = useRef(null);
    const socketConnected = useRef(false);

    // Live config overview (read-only display of current settings)
    const [llmConfig, setLlmConfig] = useState(null);
    const [calendarConfig, setCalendarConfig] = useState(null);
    const [policyCount, setPolicyCount] = useState(0);
    const [policies, setPolicies] = useState([]);
    const [pendingApprovals, setPendingApprovals] = useState(0);

    const fetchOverview = useCallback(async () => {
        try {
            const [llm, cal, policyList, approvals] = await Promise.all([
                fetch(`${getApiBase()}/api/llm-config`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
                fetch(`${getApiBase()}/api/calendar-config`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
                fetch(`${getApiBase()}/api/contact-policies`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
                fetch(`${getApiBase()}/api/approvals?status=pending`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
            ]);
            if (llm) setLlmConfig(llm);
            if (cal) setCalendarConfig(cal);
            const list = Array.isArray(policyList) ? policyList : [];
            setPolicies(list);
            setPolicyCount(list.length);
            setPendingApprovals(Array.isArray(approvals) ? approvals.length : 0);
        } catch {
            /* non-fatal overview */
        }
    }, []);

    /** Resolve contact policy for a feed entry (by WhatsApp id or display name). */
    const findPolicyForLog = useCallback((log) => {
        if (!log || !policies.length) return null;
        const contactId = (log.contactId || "").toLowerCase();
        if (contactId) {
            const byId = policies.find((p) => (p.contactId || "").toLowerCase() === contactId);
            if (byId) return byId;
        }
        // Bot replies still carry contactId; skip name match on assistant labels
        if (log.isBot) return null;
        const name = (log.from || "").trim().toLowerCase();
        if (!name) return null;
        return policies.find((p) => {
            const display = (p.displayName || "").trim().toLowerCase();
            if (!display) return false;
            return display === name || display.startsWith(name) || name.startsWith(display.split(" ")[0]);
        }) || null;
    }, [policies]);

    // Initial fetch and socket subscription
    useEffect(() => {
        let isMounted = true;

        const formattedFromDB = (pastLogs) => {
            return (pastLogs || []).flatMap((l) => [
                {
                    id: l.id + "-res",
                    from: "AI Assistant",
                    contactId: l.chatId || null,
                    message: l.response,
                    isBot: true,
                    toolsUsed: l.toolsUsed ? JSON.parse(l.toolsUsed) : [],
                    timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
                {
                    id: l.id + "-msg",
                    from: l.senderName || "Contact",
                    contactId: l.chatId || null,
                    message: l.message,
                    isBot: false,
                    timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
            ]);
        };

        const fetchLogs = async () => {
            try {
                const res = await fetch(`${getApiBase()}/api/logs?limit=100&offset=` + logOffset);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const pastLogs = await res.json();
                const formatted = (pastLogs || []).flatMap((l) => [
                    {
                        id: l.id + "-res",
                        from: "AI Assistant",
                        contactId: l.chatId || null,
                        message: l.response,
                        isBot: true,
                        toolsUsed: l.toolsUsed ? JSON.parse(l.toolsUsed) : [],
                        timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    },
                    {
                        id: l.id + "-msg",
                        from: l.senderName || "Contact",
                        contactId: l.chatId || null,
                        message: l.message,
                        isBot: false,
                        timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    },
                ]);
                if (isMounted) setLogs(formatted);
            } catch (e) {
                console.error("Error fetching logs:", e);
                if (isMounted) {
                    fetch(`${getApiBase()}/api/logs`)
                        .then((res) => res.json())
                        .then((pastLogs) => setLogs(formattedFromDB(pastLogs || [])))
                        .catch(() => {});
                }
            }
        };

        const fetchState = async () => {
            try {
                const res = await fetch(`${getApiBase()}/api/state`);
                if (!res.ok) return;
                const data = await res.json();
                if (isMounted) {
                    setState((prev) => ({ ...prev, ...data }));
                    if (data.customContext !== undefined) setContextInput(data.customContext);
                    setEngineOnline(true);
                }
            } catch {
                if (isMounted) setEngineOnline(false);
            }
        };

        fetchLogs();
        fetchOverview();
        fetchState();
        const statePoll = setInterval(fetchState, 2500);

        const socket = io(getApiBase(), {
            reconnectionAttempts: Infinity,
            timeout: 10000,
            reconnectInterval: 5000,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
            console.log("Socket connected");
            setEngineOnline(true);
            socketConnected.current = true;
            fetchLogs();
            fetchOverview();
        });

        socket.on("disconnect", (reason) => {
            console.log("Socket disconnected:", reason);
            setEngineOnline(false);
            socketConnected.current = false;
        });

        socket.on("connect_error", (err) => {
            console.error("Socket connection error:", err.message);
            setEngineOnline(false);
        });

        socket.on("state", (newState) => {
            setState(newState);
            if (newState.customContext !== undefined) {
                setContextInput(newState.customContext);
            }
        });

        socket.on("live_log", (log) => {
            if (!isMounted || !socketConnected.current) return;
            setLogs((prev) => [
                {
                    id: log.id || Date.now() + Math.random(),
                    from: log.from,
                    contactId: log.contactId || null,
                    message: log.message,
                    isBot: !!log.isBot,
                    paused: !!log.paused,
                    toolsUsed: log.toolsUsed || [],
                    timestamp: log.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                },
                ...prev.slice(0, 29),
            ]);
        });

        socket.on("approval_request", () => {
            if (isMounted) fetchOverview();
        });

        const overviewTimer = setInterval(() => {
            if (isMounted) fetchOverview();
        }, 15000);

        return () => {
            isMounted = false;
            clearInterval(overviewTimer);
            clearInterval(statePoll);
            socket.off("live_log");
            socket.off("approval_request");
            socket.disconnect();
        };
    }, [fetchOverview, logOffset]);

    const updateState = async (updates) => {
        setIsSaving(true);
        try {
            const res = await fetch(`${getApiBase()}/api/state`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });
            const data = await res.json();
            setState(data);
        } catch (e) {
            console.error("Error updating state", e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveContext = () => {
        updateState({ customContext: contextInput });
    };

    const handleLogout = async () => {
        if (!confirm("Unlink this WhatsApp session and show a new QR code? You will need to scan again from your phone.")) return;
        // Optimistic UI — clear any stale "connected" identity immediately
        setState((prev) => ({
            ...prev,
            connectionStatus: "INITIALIZING",
            qrCode: null,
            user: null,
            phoneNumber: null,
            platform: null,
            loadingProgress: null,
            error: null,
            waClientState: null,
        }));
        try {
            await fetch(`${getApiBase()}/api/logout`, { method: "POST" });
        } catch (e) {
            console.error(e);
            setState((prev) => ({
                ...prev,
                connectionStatus: "ERROR",
                error: e.message || "Failed to start re-pair",
            }));
        }
    };

    const status = state.connectionStatus || "INITIALIZING";
    // Only READY means fully linked — never treat leftover user + AUTHENTICATED as connected
    const isConnected = status === "READY";
    const isLoading = status === "LOADING" || status === "AUTHENTICATED";
    const needsScan = status === "SCAN_QR" || (!!state.qrCode && status !== "READY" && status !== "AUTHENTICATED" && status !== "LOADING");
    const isError = status === "ERROR" || status === "AUTH_FAILURE" || status === "DISCONNECTED";
    const isInitializing = !isConnected && !isLoading && !needsScan && !isError;

    const statusTone = isConnected ? "ready" : isLoading ? "loading" : needsScan ? "scan_qr" : isError ? "disconnected" : "loading";
    const statusHeading = isConnected
        ? `Connected as ${state.user || "WhatsApp User"}`
        : isLoading
            ? (status === "AUTHENTICATED"
                ? "Authenticated — finishing WhatsApp setup…"
                : `Syncing with WhatsApp (${state.loadingProgress ?? "…"}%)`)
            : needsScan
                ? "Action required: Link WhatsApp"
                : isError
                    ? (status === "AUTH_FAILURE" ? "Authentication failed" : status === "DISCONNECTED" ? "WhatsApp disconnected" : "Connection error")
                    : "WhatsApp engine starting…";
    const statusMeta = isConnected
        ? null
        : isLoading
            ? (state.waClientState ? `Client state: ${state.waClientState}` : "Keep this window open while WhatsApp Web finishes loading.")
            : needsScan
                ? "Phone → Linked devices → Link a device → scan the QR code"
                : isError
                    ? (state.error || "Check engine logs, Chrome installation, or try Unlink / Restart.")
                    : "Launching Chromium session for WhatsApp Web…";

    const llmProviderLabel = LLM_LABELS[llmConfig?.provider] || llmConfig?.provider || "Not loaded";
    const llmModel = llmConfig?.modelName || "—";
    const calProvider = CAL_LABELS[calendarConfig?.calendarProvider] || calendarConfig?.calendarProvider || "—";
    const tasksProvider = CAL_LABELS[calendarConfig?.tasksProvider] || calendarConfig?.tasksProvider || "—";
    const googleAuth = calendarConfig?.authStatus?.google || "—";

    return (
        <AppShell
            active="dashboard"
            title="Dashboard"
            subtitle="Live connection · policies · conversation feed"
            engineOnline={engineOnline}
            topRight={<ThemeToggle />}
        >
            <div className="mac-page-body">

            <div className={`status-banner ${statusTone}`}>
                <div className="status-left">
                    <div className={`status-indicator-dot ${statusTone}`} />
                    <div>
                        <div className="status-heading">{statusHeading}</div>
                        <div className="status-meta">
                            {isConnected ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <IconPhone width={14} height={14} />
                                    {state.phoneNumber ? `+${state.phoneNumber}` : "Linked"} · Device: {state.platform || "Mobile"} · Auto-reply {state.status === "ON" ? "active" : "paused"}
                                </span>
                            ) : statusMeta}
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(isConnected || status === "AUTHENTICATED" || status === "LOADING" || needsScan) && (
                        <button onClick={handleLogout} className="btn-secondary" title="Clear session and show a new QR code">
                            {needsScan ? "Refresh QR" : "Unlink / Re-pair"}
                        </button>
                    )}
                </div>
            </div>

            {/* Configuration overview — reflects live Settings */}
            <div className="overview-grid">
                <a href="/settings?tab=llm" className="glass-card overview-card">
                    <div className="overview-card-top">
                        <div className="overview-icon indigo"><IconBrain width={18} height={18} /></div>
                        <span className="badge badge-indigo">{llmConfig?.provider || "…"}</span>
                    </div>
                    <div>
                        <div className="overview-label">LLM Model</div>
                        <div className="overview-value">{llmProviderLabel}</div>
                        <div className="overview-meta mono">{llmModel}</div>
                    </div>
                </a>

                <a href="/settings?tab=calendar" className="glass-card overview-card">
                    <div className="overview-card-top">
                        <div className="overview-icon emerald"><IconCalendar width={18} height={18} /></div>
                        <span className={`badge ${googleAuth === "Authenticated" ? "badge-emerald" : "badge-amber"}`}>
                            {googleAuth === "Authenticated" ? "Auth OK" : googleAuth}
                        </span>
                    </div>
                    <div>
                        <div className="overview-label">Calendar & Tasks</div>
                        <div className="overview-value">Cal: {calProvider}</div>
                        <div className="overview-meta">Tasks: {tasksProvider}</div>
                    </div>
                </a>

                <a href="/settings?tab=contacts" className="glass-card overview-card">
                    <div className="overview-card-top">
                        <div className="overview-icon amber"><IconUsers width={18} height={18} /></div>
                        <span className="badge badge-amber">{policyCount}</span>
                    </div>
                    <div>
                        <div className="overview-label">Contact Policies</div>
                        <div className="overview-value">{policyCount === 0 ? "None configured" : `${policyCount} active`}</div>
                        <div className="overview-meta">Tone · info level · approval rules</div>
                    </div>
                </a>

                <a href="/settings?tab=approvals" className="glass-card overview-card">
                    <div className="overview-card-top">
                        <div className="overview-icon rose"><IconInbox width={18} height={18} /></div>
                        <span className={`badge ${pendingApprovals > 0 ? "badge-rose" : "badge-emerald"}`}>
                            {pendingApprovals} pending
                        </span>
                    </div>
                    <div>
                        <div className="overview-label">Approval Queue</div>
                        <div className="overview-value">{pendingApprovals === 0 ? "Clear" : "Needs review"}</div>
                        <div className="overview-meta">Human-in-the-loop outbound replies</div>
                    </div>
                </a>
            </div>

            {needsScan && state.qrCode && (
                <div className="qr-container">
                    <span className="badge badge-amber" style={{ marginBottom: 12 }}>Pairing Code Ready</span>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Scan QR Code with WhatsApp</h2>
                    <p style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 420 }}>
                        Open WhatsApp on your phone, navigate to <strong>Settings &gt; Linked Devices &gt; Link a Device</strong>, and scan the code below.
                    </p>
                    <div className="qr-frame">
                        <img src={state.qrCode} alt="WhatsApp QR Code" className="qr-image" />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-faint)" }}>
                        This QR code automatically refreshes periodically. Keep this page open.
                    </p>
                </div>
            )}

            <div className="dashboard-grid">
                <div className="glass-card">
                    <h2 className="section-title">
                        <span className="section-icon"><IconActivity width={16} height={16} /></span>
                        Master Agent Controls
                    </h2>

                    <div className="form-group">
                        <label className="form-label">Autonomous Reply Mode</label>
                        <select
                            value={state.status}
                            onChange={(e) => updateState({ status: e.target.value })}
                            className="custom-select"
                        >
                            <option value="ON">Active — Autonomous AI replying enabled</option>
                            <option value="OFF">Paused — Monitoring feed only (no auto-replies)</option>
                        </select>
                        <div className="form-hint">
                            {state.status === "ON"
                                ? "Incoming WhatsApp messages are analyzed by the configured LLM and auto-replied with tool access."
                                : "Incoming messages appear in the Live Feed, but the AI will not send replies."}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Dynamic Prompt Context</label>
                        <textarea
                            value={contextInput}
                            onChange={(e) => setContextInput(e.target.value)}
                            className="custom-textarea"
                            rows={3}
                            placeholder="e.g. In a board meeting until 5 PM. For urgent requests, take a message and record it to tasks."
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button type="button" onClick={() => setContextInput("Busy at work. Free after 6 PM.")} className="btn-secondary" style={{ fontSize: 11, padding: "4px 8px" }}>
                                    Preset: Busy
                                </button>
                                <button type="button" onClick={() => setContextInput("Traveling with limited connectivity. Urgent inquiries only.")} className="btn-secondary" style={{ fontSize: 11, padding: "4px 8px" }}>
                                    Preset: Travel
                                </button>
                            </div>
                            <button onClick={handleSaveContext} disabled={isSaving} className="btn-primary">
                                {isSaving ? "Saving..." : "Update Context"}
                            </button>
                        </div>
                    </div>

                    <div className="divider">
                        <div className="overview-label" style={{ marginBottom: 12 }}>Integrated Services</div>
                        <div className="service-list">
                            <div className="service-row">
                                <span className="service-row-left"><IconBrain width={15} height={15} /><span>LLM · {llmProviderLabel}</span></span>
                                <span className="badge badge-indigo mono" style={{ fontSize: 11 }}>{llmModel}</span>
                            </div>
                            <div className="service-row">
                                <span className="service-row-left"><IconCalendar width={15} height={15} /><span>Calendar · {calProvider}</span></span>
                                <span className={`badge ${googleAuth === "Authenticated" || calProvider !== "Google" ? "badge-emerald" : "badge-amber"}`}>
                                    {calendarConfig ? (calProvider === "Google" ? googleAuth : "Selected") : "…"}
                                </span>
                            </div>
                            <div className="service-row">
                                <span className="service-row-left"><IconCheckSquare width={15} height={15} /><span>Tasks · {tasksProvider}</span></span>
                                <span className="badge badge-emerald">Configured</span>
                            </div>
                            <div className="service-row">
                                <span className="service-row-left"><IconUsers width={15} height={15} /><span>Contact policies</span></span>
                                <span className="badge badge-amber">{policyCount}</span>
                            </div>
                            <div className="service-row">
                                <span className="service-row-left"><IconInbox width={15} height={15} /><span>Pending approvals</span></span>
                                <span className={`badge ${pendingApprovals > 0 ? "badge-rose" : "badge-emerald"}`}>{pendingApprovals}</span>
                            </div>
                            <div className="service-row">
                                <span className="service-row-left"><IconDatabase width={15} height={15} /><span>SQLite audit logs</span></span>
                                <span className="badge badge-emerald">Prisma</span>
                            </div>
                            {llmConfig?.provider === "ollama" && (
                                <div className="service-row">
                                    <span className="service-row-left"><IconCpu width={15} height={15} /><span>Ollama host</span></span>
                                    <span className="badge badge-indigo">:11434</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="glass-card feed-container">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 }}>
                        <h2 className="section-title" style={{ margin: 0 }}>
                            <span className="section-icon"><IconActivity width={16} height={16} /></span>
                            Live Conversation Feed
                        </h2>
                        <span className="badge badge-indigo" style={{ fontSize: 11 }}>{logs.length} messages</span>
                    </div>

                    <div
                        className="feed-scroll"
                        ref={logScrollRef}
                        onScroll={() => {
                            if (socketConnected.current && logScrollRef.current) {
                                const { scrollTop, scrollHeight, clientHeight } = logScrollRef.current;
                                const isNearBottom = scrollHeight - scrollTop <= clientHeight + 100;
                                if (isNearBottom && logs.length > 29) {
                                    logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
                                }
                            }
                        }}
                    >
                        {logs.map((log) => {
                            const matchedPolicy = findPolicyForLog(log);
                            const policyTone = matchedPolicy?.tone && matchedPolicy.tone !== "auto"
                                ? matchedPolicy.tone
                                : null;
                            const chipClass = matchedPolicy?.requiresApproval
                                ? "policy-chip approval"
                                : matchedPolicy?.restrictedTopics
                                    ? "policy-chip restricted"
                                    : "policy-chip";
                            const chipLabel = matchedPolicy?.requiresApproval
                                ? "Approval"
                                : policyTone
                                    ? `Policy · ${policyTone}`
                                    : "Policy";
                            const chipTitle = matchedPolicy
                                ? [
                                    matchedPolicy.displayName || "Contact policy",
                                    matchedPolicy.tone ? `Tone: ${matchedPolicy.tone}` : null,
                                    matchedPolicy.infoLevel ? `Info: ${matchedPolicy.infoLevel}` : null,
                                    matchedPolicy.requiresApproval ? "Requires approval" : null,
                                    matchedPolicy.restrictedTopics ? "Has restricted topics" : null,
                                ].filter(Boolean).join(" · ")
                                : "";

                            return (
                            <div key={log.id} className={`log-entry ${log.isBot ? "bot-reply" : "user-msg"}`}>
                                <div className="log-header">
                                    <span className={`log-sender ${log.isBot ? "bot" : "user"}`}>
                                        {log.isBot ? <IconBot width={14} height={14} /> : <IconUser width={14} height={14} />}
                                        {log.isBot ? "AI Assistant" : log.from}
                                        {matchedPolicy && (
                                            <span className={chipClass} title={chipTitle}>
                                                <IconShield width={11} height={11} />
                                                {chipLabel}
                                            </span>
                                        )}
                                        {log.paused && (
                                            <span className="badge badge-amber" style={{ fontSize: 10, padding: "1px 6px" }}>Agent Paused</span>
                                        )}
                                    </span>
                                    <span className="log-time">{log.timestamp}</span>
                                </div>
                                <div className="log-content">{log.message}</div>
                                {log.toolsUsed && log.toolsUsed.length > 0 && (
                                    <div className="log-tools">
                                        {log.toolsUsed.map((tool, idx) => (
                                            <span key={idx} className="tool-tag">
                                                <IconZap width={11} height={11} /> {tool}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            );
                        })}

                        {logs.length === 0 && (
                            <div className="empty-state">
                                <div className="empty-state-icon"><IconMessage width={22} height={22} /></div>
                                <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>No Messages Yet</div>
                                <div style={{ fontSize: 12, maxWidth: 260 }}>
                                    When someone sends a WhatsApp message to your linked number, it will stream live here.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </div>
            <AppFooter />
        </AppShell>
    );
}
