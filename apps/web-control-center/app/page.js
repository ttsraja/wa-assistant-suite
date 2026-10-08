"use client";
import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";

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
    const [logOffset, setLogOffset] = useState(0);
    const logScrollRef = useRef(null);
    const socketConnected = useRef(false);

    // Initial fetch and socket subscription
    useEffect(() => {
        let isMounted = true;

        // Fetch logs with pagination (start fresh)
        const fetchLogs = async () => {
            try {
                const res = await fetch("http://localhost:3001/api/logs?limit=100&offset=" + logOffset);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const pastLogs = await res.json();
                const formatted = (pastLogs || []).flatMap((l) => [
                    {
                        id: l.id + "-res",
                        from: "AI Assistant",
                        message: l.response,
                        isBot: true,
                        toolsUsed: l.toolsUsed ? JSON.parse(l.toolsUsed) : [],
                        timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    },
                    {
                        id: l.id + "-msg",
                        from: l.senderName || "Contact",
                        message: l.message,
                        isBot: false,
                        timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    },
                ]);
                if (isMounted) setLogs(formatted);
            } catch (e) {
                console.error("Error fetching logs:", e);
                if (isMounted) {
                    // Fetch from database fallback
                    fetch("http://localhost:3001/api/logs")
                        .then((res) => res.json())
                        .then((pastLogs) => setLogs(formattedFromDB(pastLogs || [])))
                        .catch(() => {});
                }
            }
        };

        const formattedFromDB = (pastLogs) => {
            return (pastLogs || []).flatMap((l) => [
                {
                    id: l.id + "-res",
                    from: "AI Assistant",
                    message: l.response,
                    isBot: true,
                    toolsUsed: l.toolsUsed ? JSON.parse(l.toolsUsed) : [],
                    timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
                {
                    id: l.id + "-msg",
                    from: l.senderName || "Contact",
                    message: l.message,
                    isBot: false,
                    timestamp: new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
            ]);
        };

        fetchLogs();

        // 3. Setup Socket.io with reconnection handling
        const socket = io("http://localhost:3001", {
            reconnectionAttempts: Infinity,
            timeout: 10000,
            reconnectInterval: 5000,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
            console.log("Socket connected");
            setEngineOnline(true);
            socketConnected.current = true;

            // Re-fetch logs when socket reconnected to get any missed messages
            fetchLogs();
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
            // Only process and display logs if the component is mounted
            if (!isMounted || !socketConnected.current) return;

            setLogs((prev) => [
                {
                    id: log.id || Date.now() + Math.random(),
                    from: log.from,
                    message: log.message,
                    isBot: !!log.isBot,
                    paused: !!log.paused,
                    toolsUsed: log.toolsUsed || [],
                    timestamp: log.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
                ...prev.slice(0, 29), // Keep max 30 messages
            ]);
        });

        // Cleanup function
        return () => {
            isMounted = false; // Mark component as unmounted
            socket.off("live_log"); // Clean up the specific listener
            socket.disconnect(); // Disconnect the socket
        };
    }, []);

    const updateState = async (updates) => {
        setIsSaving(true);
        try {
            const res = await fetch("http://localhost:3001/api/state", {
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
        if (!confirm("Are you sure you want to disconnect WhatsApp and regenerate QR code?")) return;
        try {
            await fetch("http://localhost:3001/api/logout", { method: "POST" });
        } catch (e) {
            console.error(e);
        }
    };

    const isConnected = state.connectionStatus === "READY" || !!state.user;
    const isLoading = state.connectionStatus === "LOADING";
    const needsScan = (state.connectionStatus === "SCAN_QR" || !!state.qrCode) && !isConnected;

    return (
        <div className="app-container">
            {/* Header */}
            <header className="dashboard-header">
                <div className="brand-wrapper">
                    <div className="brand-logo-glow">💬</div>
                    <div>
                        <h1 className="brand-title">WhatsApp AI Assistant Suite</h1>
                        <p className="brand-subtitle">Executive Autonomous Agent • Ollama + Google Workspace</p>
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span className={`badge ${engineOnline ? "badge-emerald" : "badge-rose"}`}>
                        <span className={`status-indicator-dot ${engineOnline ? "ready" : "disconnected"}`} style={{ width: 8, height: 8 }} />
                        {engineOnline ? "Engine Online :3001" : "Engine Disconnected"}
                    </span>
                    <a href="/settings"
                        style={{ padding: "5px 14px", borderRadius: 8, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", fontSize: 12, textDecoration: "none", fontWeight: 600 }}>
                        ⚙️ Settings
                    </a>
                </div>
            </header>

            {/* WhatsApp Connection Banner */}
            <div className={`status-banner ${isConnected ? "ready" : isLoading ? "loading" : needsScan ? "scan_qr" : "disconnected"}`}>
                <div className="status-left">
                    <div className={`status-indicator-dot ${isConnected ? "ready" : isLoading ? "loading" : needsScan ? "scan_qr" : "disconnected"}`} />
                    <div>
                        <div className="status-heading">
                            {isConnected && `Connected as ${state.user || "WhatsApp User"}`}
                            {isLoading && `Syncing with WhatsApp (${state.loadingProgress || 99}%)`}
                            {needsScan && "Action Required: Link WhatsApp Account"}
                            {!isConnected && !isLoading && !needsScan && "WhatsApp Engine Initializing..."}
                        </div>
                        <div className="status-meta">
                            {isConnected && (
                                <span>
                                    📱 {state.phoneNumber ? `+${state.phoneNumber}` : "Linked"} • Device: {state.platform || "Mobile"} • Auto-reply active
                                </span>
                            )}
                            {isLoading && "Finalizing handshake with WhatsApp Web. Ready in a few seconds..."}
                            {needsScan && "Open WhatsApp on your phone > Linked Devices > Link a Device > Scan QR"}
                            {!isConnected && !isLoading && !needsScan && "Starting headless Chromium instance..."}
                        </div>
                    </div>
                </div>

                <div>
                    {isConnected && (
                        <button onClick={handleLogout} className="btn-secondary" title="Disconnect and scan a different number">
                            Unlink / Re-pair
                        </button>
                    )}
                </div>
            </div>

            {/* QR Code Modal/Card if scanning needed */}
            {needsScan && state.qrCode && (
                <div className="qr-container">
                    <span className="badge badge-amber" style={{ marginBottom: "12px" }}>
                        Pairing Code Ready
                    </span>
                    <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px" }}>Scan QR Code with WhatsApp</h2>
                    <p style={{ color: "var(--text-muted)", fontSize: "14px", maxWidth: "420px" }}>
                        Open WhatsApp on your phone, navigate to <strong>Settings &gt; Linked Devices &gt; Link a Device</strong>, and scan the code below.
                    </p>
                    <div className="qr-frame">
                        <img src={state.qrCode} alt="WhatsApp QR Code" className="qr-image" />
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-faint)" }}>
                        This QR code automatically refreshes periodically. Keep this page open.
                    </p>
                </div>
            )}

            {/* Main Controls & Live Feed Grid */}
            <div className="dashboard-grid">
                {/* Master Controls Card */}
                <div className="glass-card">
                    <h2 className="section-title">
                        <span>⚙️</span> Master Agent Controls
                    </h2>

                    {/* Agent Status Toggle */}
                    <div className="form-group">
                        <label className="form-label">Autonomous Reply Mode</label>
                        <select
                            value={state.status}
                            onChange={(e) => updateState({ status: e.target.value })}
                            className="custom-select"
                        >
                            <option value="ON">🟢 Active (Autonomous AI Replying Enabled)</option>
                            <option value="OFF">⏸️ Paused (Monitoring Feed Only - No Auto-Replies)</option>
                        </select>
                        <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-faint)" }}>
                            {state.status === "ON"
                                ? "Incoming WhatsApp messages will be analyzed by Ollama and auto-replied with tool access."
                                : "Incoming messages are displayed in the Live Feed below, but the AI will NOT send any replies."}
                        </div>
                    </div>

                    {/* Context Injection */}
                    <div className="form-group">
                        <label className="form-label">
                            Dynamic Prompt Context (Injected into Gemma LLM):
                        </label>
                        <textarea
                            value={contextInput}
                            onChange={(e) => setContextInput(e.target.value)}
                            className="custom-input"
                            rows={3}
                            placeholder="e.g. In a board meeting until 5 PM. For urgent requests, take a message and record it to Google Tasks."
                            style={{ resize: "vertical" }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
                            <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                    type="button"
                                    onClick={() => setContextInput("Busy at work. Free after 6 PM.")}
                                    className="btn-secondary"
                                    style={{ fontSize: "11px", padding: "4px 8px" }}
                                >
                                    Preset: Busy
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setContextInput("Traveling with limited connectivity. Urgent inquiries only.")}
                                    className="btn-secondary"
                                    style={{ fontSize: "11px", padding: "4px 8px" }}
                                >
                                    Preset: Travel
                                </button>
                            </div>
                            <button
                                onClick={handleSaveContext}
                                disabled={isSaving}
                                className="btn-primary"
                            >
                                {isSaving ? "Saving..." : "Update Context"}
                            </button>
                        </div>
                    </div>

                    {/* System Integrations Overview */}
                    <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border-subtle)" }}>
                        <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)", marginBottom: "12px" }}>
                            Integrated Services
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                                <span>📅 Google Calendar (Busy/Free Slots)</span>
                                <span className="badge badge-emerald">Ready</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                                <span>📌 Google Tasks (Note Recording)</span>
                                <span className="badge badge-emerald">Ready</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                                <span>🧠 Ollama Local LLM (gemma4)</span>
                                <span className="badge badge-indigo">Connected :11434</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                                <span>🗄️ SQLite Database (Audit Logs)</span>
                                <span className="badge badge-emerald">Prisma Synced</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live Message Feed Card */}
                <div className="glass-card feed-container">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <h2 className="section-title" style={{ margin: 0 }}>
                            <span>📡</span> Live Conversation Feed
                        </h2>
                        <span className="badge badge-indigo" style={{ fontSize: "11px" }}>
                            {logs.length} messages
                        </span>
                    </div>

                    <div
                        className="feed-scroll"
                        ref={logScrollRef}
                        onScroll={(e) => {
                            // Auto-scroll to bottom when socket is connected and user is at bottom
                            if (socketConnected.current && logScrollRef.current) {
                                const { scrollTop, scrollHeight, clientHeight } = logScrollRef.current;
                                const isNearBottom = scrollHeight - scrollTop <= clientHeight + 100;
                                if (isNearBottom && logs.length > 29) {
                                    logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
                                }
                            }
                        }}
                    >
                        {logs.map((log) => (
                            <div
                                key={log.id}
                                className={`log-entry ${log.isBot ? "bot-reply" : "user-msg"}`}
                                style={{ animation: "fadeIn 0.2s ease-out" }}
                            >
                                <div className="log-header">
                                    <span className={`log-sender ${log.isBot ? "bot" : "user"}`}>
                                        {log.isBot ? "🤖 AI Assistant" : `👤 ${log.from}`}
                                        {log.paused && (
                                            <span className="badge badge-amber" style={{ fontSize: "10px", padding: "1px 6px" }}>
                                                Agent Paused
                                            </span>
                                        )}
                                    </span>
                                    <span className="log-time">{log.timestamp}</span>
                                </div>
                                <div className="log-content">{log.message}</div>
                                {log.toolsUsed && log.toolsUsed.length > 0 && (
                                    <div className="log-tools">
                                        {log.toolsUsed.map((tool, idx) => (
                                            <span key={idx} className="tool-tag">
                                                ⚡ {tool}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {logs.length === 0 && (
                            <div className="empty-state">
                                <div style={{ fontSize: "32px", opacity: 0.4 }}>💬</div>
                                <div style={{ fontWeight: 600 }}>No Messages Yet</div>
                                <div style={{ fontSize: "12px", maxWidth: "260px" }}>
                                    When someone sends a WhatsApp message to your linked number, it will stream live here.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}