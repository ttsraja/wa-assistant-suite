"use client";
import { useEffect, useState, useCallback } from "react";

const API = "http://localhost:3001";

// ── PROVIDERS ──────────────────────────────────────────────────────────────────
const LLM_PROVIDERS = [
    { value: "ollama", label: "🖥️ Ollama (Local LLM)", needsKey: false, modelPlaceholder: "e.g. gemma4:latest, qwen3:4b, llama3.2" },
    { value: "gemini", label: "✨ Google Gemini", needsKey: true, modelPlaceholder: "e.g. gemini-1.5-flash, gemini-1.5-pro" },
    { value: "claude", label: "🧠 Anthropic Claude", needsKey: true, modelPlaceholder: "e.g. claude-3-5-haiku-20241022, claude-opus-4-5" },
    { value: "openai", label: "🤖 OpenAI GPT", needsKey: true, modelPlaceholder: "e.g. gpt-4o-mini, gpt-4o" },
    { value: "grok", label: "⚡ xAI Grok", needsKey: true, modelPlaceholder: "e.g. grok-beta, grok-2-mini" },
];

const CALENDAR_PROVIDERS = [
    { value: "google", label: "📅 Google Calendar" },
    { value: "macos", label: "🍎 macOS Calendar + Reminders (AppleScript)" },
    { value: "windows", label: "🪟 Windows Outlook (PowerShell/COM)" },
];

const TONE_OPTIONS = [
    { value: "auto", label: "🤖 Auto (Mirror sender's style)" },
    { value: "formal", label: "🎩 Formal & Professional" },
    { value: "casual", label: "😊 Casual & Friendly" },
    { value: "tamil", label: "🌿 Tamil (தமிழ்)" },
    { value: "tanglish", label: "🔀 Tanglish (Tamil + English)" },
];

const INFO_LEVELS = [
    { value: "full", label: "🔓 Full — Share all available info" },
    { value: "limited", label: "🔒 Limited — General availability only, no details" },
    { value: "minimal", label: "🚫 Minimal — Unavailable, reply later" },
];

// ── HELPERS ────────────────────────────────────────────────────────────────────
function Badge({ children, color = "indigo" }) {
    const colors = {
        indigo: { bg: "rgba(99,102,241,0.15)", border: "rgba(99,102,241,0.3)", text: "#a5b4fc" },
        emerald: { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.3)", text: "#6ee7b7" },
        amber: { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.3)", text: "#fcd34d" },
        rose: { bg: "rgba(244,63,94,0.15)", border: "rgba(244,63,94,0.3)", text: "#fda4af" },
    };
    const c = colors[color] || colors.indigo;
    return (
        <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
            {children}
        </span>
    );
}

function SectionTitle({ icon, children }) {
    return (
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 20px" }}>
            <span style={{ fontSize: 18 }}>{icon}</span> {children}
        </h2>
    );
}

function FormLabel({ children }) {
    return <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>{children}</label>;
}

function Input({ ...props }) {
    return (
        <input
            {...props}
            style={{
                width: "100%", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8,
                color: "#e2e8f0", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box",
                ...(props.style || {})
            }}
        />
    );
}

function Select({ children, ...props }) {
    return (
        <select
            {...props}
            style={{
                width: "100%", background: "rgba(15,23,42,0.8)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8,
                color: "#e2e8f0", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box",
                ...(props.style || {})
            }}
        >
            {children}
        </select>
    );
}

function SaveButton({ onClick, saving, label = "Save Changes" }) {
    return (
        <button
            onClick={onClick}
            disabled={saving}
            style={{
                padding: "9px 20px", borderRadius: 8, border: "none", cursor: saving ? "not-allowed" : "pointer",
                background: saving ? "rgba(99,102,241,0.4)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color: "#fff", fontWeight: 600, fontSize: 13, transition: "opacity .2s"
            }}
        >
            {saving ? "Saving..." : label}
        </button>
    );
}

// ── TABS ───────────────────────────────────────────────────────────────────────
const TABS = [
    { id: "llm", label: "🧠 LLM Provider" },
    { id: "calendar", label: "📅 Calendar & Tasks" },
    { id: "contacts", label: "👥 Contact Policies" },
    { id: "approvals", label: "✅ Approval Queue" },
];

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("llm");

    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)", padding: "24px 20px", fontFamily: "'Inter',sans-serif" }}>
            {/* Header */}
            <div style={{ maxWidth: 900, margin: "0 auto 28px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 0 20px rgba(99,102,241,0.5)" }}>⚙️</div>
                        <div>
                            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e2e8f0" }}>Agent Settings</h1>
                            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>LLM · Calendar · Contact Policies · Approvals</p>
                        </div>
                    </div>
                    <a href="/" style={{ padding: "8px 16px", background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, color: "#a5b4fc", fontSize: 13, textDecoration: "none", fontWeight: 600 }}>
                        ← Dashboard
                    </a>
                </div>
            </div>

            {/* Tab Bar */}
            <div style={{ maxWidth: 900, margin: "0 auto 20px", display: "flex", gap: 4, background: "rgba(15,23,42,0.5)", padding: 4, borderRadius: 10, border: "1px solid rgba(99,102,241,0.15)" }}>
                {TABS.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1, padding: "9px 4px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all .2s",
                            background: activeTab === tab.id ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "transparent",
                            color: activeTab === tab.id ? "#fff" : "#64748b",
                            boxShadow: activeTab === tab.id ? "0 4px 12px rgba(99,102,241,0.4)" : "none"
                        }}
                    >{tab.label}</button>
                ))}
            </div>

            {/* Tab Content */}
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
                {activeTab === "llm" && <LLMTab />}
                {activeTab === "calendar" && <CalendarTab />}
                {activeTab === "contacts" && <ContactsTab />}
                {activeTab === "approvals" && <ApprovalsTab />}
            </div>
        </div>
    );
}

// ── TAB 1: LLM Provider ───────────────────────────────────────────────────────
function LLMTab() {
    const [config, setConfig] = useState({ provider: "ollama", modelName: "gemma4:latest", apiKey: "", baseUrl: "" });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);
    const [ollamaModels, setOllamaModels] = useState([]);

    useEffect(() => {
        fetch(`${API}/api/llm-config`).then(r => r.json()).then(setConfig).catch(() => {});
        // Fetch available Ollama models
        fetch("http://localhost:11434/api/tags").then(r => r.json()).then(d => {
            setOllamaModels((d.models || []).map(m => m.name));
        }).catch(() => {});
    }, []);

    const providerInfo = LLM_PROVIDERS.find(p => p.value === config.provider) || LLM_PROVIDERS[0];

    const handleSave = async () => {
        setSaving(true); setMsg(null);
        try {
            const res = await fetch(`${API}/api/llm-config`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config)
            });
            const data = await res.json();
            setConfig(data);
            setMsg({ type: "success", text: "LLM configuration saved! Active on next message." });
        } catch { setMsg({ type: "error", text: "Failed to save." }); }
        finally { setSaving(false); }
    };

    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Config Card */}
            <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 24, backdropFilter: "blur(20px)" }}>
                <SectionTitle icon="🧠">LLM Provider Configuration</SectionTitle>

                <div style={{ marginBottom: 18 }}>
                    <FormLabel>AI Provider</FormLabel>
                    <Select value={config.provider} onChange={e => setConfig(c => ({ ...c, provider: e.target.value, apiKey: "" }))}>
                        {LLM_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </Select>
                </div>

                <div style={{ marginBottom: 18 }}>
                    <FormLabel>Model Name</FormLabel>
                    {config.provider === "ollama" && ollamaModels.length > 0 ? (
                        <Select value={config.modelName} onChange={e => setConfig(c => ({ ...c, modelName: e.target.value }))}>
                            {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
                        </Select>
                    ) : (
                        <Input value={config.modelName || ""} placeholder={providerInfo.modelPlaceholder}
                            onChange={e => setConfig(c => ({ ...c, modelName: e.target.value }))} />
                    )}
                </div>

                {providerInfo.needsKey && (
                    <div style={{ marginBottom: 18 }}>
                        <FormLabel>API Key</FormLabel>
                        <Input type="password" value={config.apiKey || ""} placeholder="Paste your API key here..."
                            onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))} />
                        <p style={{ fontSize: 11, color: "#475569", marginTop: 5 }}>Stored securely in local SQLite. Never sent externally by this dashboard.</p>
                    </div>
                )}

                {config.provider === "grok" && (
                    <div style={{ marginBottom: 18 }}>
                        <FormLabel>Base URL (optional)</FormLabel>
                        <Input value={config.baseUrl || ""} placeholder="https://api.x.ai/v1"
                            onChange={e => setConfig(c => ({ ...c, baseUrl: e.target.value }))} />
                    </div>
                )}

                {msg && (
                    <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, fontSize: 13,
                        background: msg.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)",
                        color: msg.type === "success" ? "#6ee7b7" : "#fda4af",
                        border: `1px solid ${msg.type === "success" ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.3)"}` }}>
                        {msg.text}
                    </div>
                )}

                <SaveButton onClick={handleSave} saving={saving} />
            </div>

            {/* Info Card */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Current Status */}
                <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 20, backdropFilter: "blur(20px)" }}>
                    <FormLabel>Active Configuration</FormLabel>
                    <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 8 }}>
                        <div style={{ marginBottom: 6 }}>Provider: <Badge color={config.provider === "ollama" ? "indigo" : "emerald"}>{providerInfo.label}</Badge></div>
                        <div>Model: <span style={{ color: "#a5b4fc", fontWeight: 600 }}>{config.modelName || "—"}</span></div>
                    </div>
                </div>

                {/* Ollama Local Models */}
                {config.provider === "ollama" && ollamaModels.length > 0 && (
                    <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 20, backdropFilter: "blur(20px)" }}>
                        <FormLabel>Detected Ollama Models</FormLabel>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                            {ollamaModels.map(m => (
                                <div key={m} onClick={() => setConfig(c => ({ ...c, modelName: m }))}
                                    style={{ padding: "7px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12,
                                        background: config.modelName === m ? "rgba(99,102,241,0.25)" : "rgba(30,27,75,0.5)",
                                        border: `1px solid ${config.modelName === m ? "rgba(99,102,241,0.5)" : "rgba(99,102,241,0.1)"}`,
                                        color: config.modelName === m ? "#a5b4fc" : "#64748b" }}>
                                    {m}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Provider Tips */}
                <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 14, padding: 20, backdropFilter: "blur(20px)" }}>
                    <FormLabel>💡 Provider Tips</FormLabel>
                    <ul style={{ fontSize: 12, color: "#64748b", margin: 0, padding: "0 0 0 16px", lineHeight: 1.8 }}>
                        <li><strong style={{ color: "#94a3b8" }}>Ollama</strong> — Free & local. Requires Ollama running at :11434. Best for privacy.</li>
                        <li><strong style={{ color: "#94a3b8" }}>Gemini Flash</strong> — Fast, free tier. Get key at ai.google.dev</li>
                        <li><strong style={{ color: "#94a3b8" }}>Claude Haiku</strong> — Affordable, great reasoning. anthropic.com</li>
                        <li><strong style={{ color: "#94a3b8" }}>GPT-4o-mini</strong> — Reliable. platform.openai.com</li>
                        <li><strong style={{ color: "#94a3b8" }}>Grok</strong> — xAI model. console.x.ai</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

// ── TAB 2: Calendar & Tasks ───────────────────────────────────────────────────
function CalendarTab() {
    const [config, setConfig] = useState({ calendarProvider: "google", tasksProvider: "google" });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        fetch(`${API}/api/calendar-config`).then(r => r.json()).then(setConfig).catch(() => {});
    }, []);

    const handleSave = async () => {
        setSaving(true); setMsg(null);
        try {
            await fetch(`${API}/api/calendar-config`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config)
            });
            setMsg({ type: "success", text: "Calendar configuration saved!" });
        } catch { setMsg({ type: "error", text: "Failed to save." }); }
        finally { setSaving(false); }
    };

    const InfoBox = ({ title, items }) => (
        <div style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(99,102,241,0.1)", borderRadius: 10, padding: 16, marginTop: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</p>
            <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12, color: "#475569", lineHeight: 1.9 }}>
                {items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
        </div>
    );

    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 24, backdropFilter: "blur(20px)" }}>
                <SectionTitle icon="📅">Calendar & Tasks Integration</SectionTitle>

                <div style={{ marginBottom: 18 }}>
                    <FormLabel>Calendar Provider (Read Availability)</FormLabel>
                    <Select value={config.calendarProvider} onChange={e => setConfig(c => ({ ...c, calendarProvider: e.target.value }))}>
                        {CALENDAR_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </Select>
                </div>

                <div style={{ marginBottom: 22 }}>
                    <FormLabel>Tasks / Reminders Provider (Write Notes)</FormLabel>
                    <Select value={config.tasksProvider} onChange={e => setConfig(c => ({ ...c, tasksProvider: e.target.value }))}>
                        {CALENDAR_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </Select>
                    <p style={{ fontSize: 11, color: "#475569", marginTop: 5 }}>
                        Calendar and Tasks can use different providers independently.
                    </p>
                </div>

                {msg && (
                    <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, fontSize: 13,
                        background: msg.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)",
                        color: msg.type === "success" ? "#6ee7b7" : "#fda4af",
                        border: `1px solid ${msg.type === "success" ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.3)"}` }}>
                        {msg.text}
                    </div>
                )}

                <SaveButton onClick={handleSave} saving={saving} />
            </div>

            <div>
                <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 20, backdropFilter: "blur(20px)" }}>
                    <FormLabel>📋 Provider Requirements</FormLabel>

                    <InfoBox title="Google (default)" items={[
                        "Requires credentials.json + token.json in the engine root",
                        "Run the auth flow once to generate token.json",
                        "Reads Calendar API, writes to Google Tasks"
                    ]} />
                    <InfoBox title="macOS (AppleScript)" items={[
                        "Requires macOS 12+ with Calendar & Reminders apps",
                        "Grant Automation permissions in System Settings → Privacy → Automation",
                        "Reads Calendar.app events, writes to Reminders.app",
                        "Does NOT share your data with any external service"
                    ]} />
                    <InfoBox title="Windows (Outlook COM)" items={[
                        "Requires Microsoft Outlook installed and signed in",
                        "PowerShell must be allowed to run COM scripts",
                        "Reads Outlook Calendar, writes to Outlook Tasks"
                    ]} />
                </div>
            </div>
        </div>
    );
}

// ── TAB 3: Contact Policies ────────────────────────────────────────────────────
function ContactsTab() {
    const [policies, setPolicies] = useState([]);
    const [editing, setEditing] = useState(null); // null or policy object
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(null);

    const fetchPolicies = useCallback(() => {
        fetch(`${API}/api/contact-policies`).then(r => r.json()).then(setPolicies).catch(() => {});
    }, []);

    useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

    const newPolicy = () => setEditing({
        contactId: "", displayName: "", tone: "auto", infoLevel: "full",
        restrictedTopics: "", requiresApproval: false, customInstructions: ""
    });

    const handleSave = async () => {
        if (!editing.contactId || !editing.displayName) return alert("Contact ID and Display Name are required.");
        setSaving(true);
        try {
            const payload = {
                ...editing,
                restrictedTopics: editing.restrictedTopics
                    ? JSON.stringify(editing.restrictedTopics.split(",").map(t => t.trim()).filter(Boolean))
                    : null
            };
            await fetch(`${API}/api/contact-policies`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            setEditing(null);
            fetchPolicies();
        } catch { alert("Failed to save policy."); }
        finally { setSaving(false); }
    };

    const handleDelete = async (contactId) => {
        if (!confirm("Delete policy for this contact?")) return;
        setDeleting(contactId);
        try {
            await fetch(`${API}/api/contact-policies/${encodeURIComponent(contactId)}`, { method: "DELETE" });
            fetchPolicies();
        } catch { alert("Failed to delete."); }
        finally { setDeleting(null); }
    };

    const getRestrictedTopicsString = (policy) => {
        if (!policy.restrictedTopics) return "";
        try { return JSON.parse(policy.restrictedTopics).join(", "); } catch { return policy.restrictedTopics; }
    };

    return (
        <div style={{ display: "grid", gridTemplateColumns: editing ? "1fr 1fr" : "1fr", gap: 16 }}>
            {/* Contact List */}
            <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 24, backdropFilter: "blur(20px)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <SectionTitle icon="👥">Contact Policies</SectionTitle>
                    <button onClick={newPolicy} style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 600, fontSize: 12 }}>
                        + New Policy
                    </button>
                </div>

                {policies.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>
                        <div style={{ fontSize: 32, opacity: 0.4, marginBottom: 8 }}>👥</div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>No contact policies yet</div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>Add a policy to customize tone, restrict topics, or enable approval workflow for specific contacts.</div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {policies.map(p => (
                            <div key={p.contactId} style={{ background: "rgba(30,27,75,0.5)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 10, padding: 14 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div>
                                        <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>{p.displayName}</div>
                                        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{p.contactId}</div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                                            <Badge color="indigo">Tone: {p.tone}</Badge>
                                            <Badge color={p.infoLevel === "full" ? "emerald" : p.infoLevel === "limited" ? "amber" : "rose"}>
                                                {p.infoLevel}
                                            </Badge>
                                            {p.requiresApproval && <Badge color="amber">⏳ Approval Required</Badge>}
                                            {p.restrictedTopics && <Badge color="rose">🚫 Restricted Topics</Badge>}
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button onClick={() => setEditing({ ...p, restrictedTopics: getRestrictedTopicsString(p) })}
                                            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(99,102,241,0.3)", background: "transparent", color: "#a5b4fc", cursor: "pointer", fontSize: 12 }}>
                                            Edit
                                        </button>
                                        <button onClick={() => handleDelete(p.contactId)} disabled={deleting === p.contactId}
                                            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(244,63,94,0.3)", background: "transparent", color: "#fda4af", cursor: "pointer", fontSize: 12 }}>
                                            {deleting === p.contactId ? "..." : "Delete"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Panel */}
            {editing && (
                <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 14, padding: 24, backdropFilter: "blur(20px)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                        <SectionTitle icon="✏️">{editing.id ? "Edit Policy" : "New Policy"}</SectionTitle>
                        <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18 }}>✕</button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                            <FormLabel>Display Name *</FormLabel>
                            <Input value={editing.displayName} placeholder="e.g. John Smith"
                                onChange={e => setEditing(ed => ({ ...ed, displayName: e.target.value }))} />
                        </div>
                        <div>
                            <FormLabel>WhatsApp Contact ID *</FormLabel>
                            <Input value={editing.contactId} placeholder="e.g. 919876543210@c.us"
                                onChange={e => setEditing(ed => ({ ...ed, contactId: e.target.value }))} />
                            <p style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Format: country code + number + @c.us. Check dashboard logs for the exact ID.</p>
                        </div>
                        <div>
                            <FormLabel>Response Tone</FormLabel>
                            <Select value={editing.tone} onChange={e => setEditing(ed => ({ ...ed, tone: e.target.value }))}>
                                {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </Select>
                        </div>
                        <div>
                            <FormLabel>Information Level</FormLabel>
                            <Select value={editing.infoLevel} onChange={e => setEditing(ed => ({ ...ed, infoLevel: e.target.value }))}>
                                {INFO_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                            </Select>
                        </div>
                        <div>
                            <FormLabel>Restricted Topics (comma-separated)</FormLabel>
                            <Input value={editing.restrictedTopics || ""} placeholder="e.g. salary, project budget, personal address"
                                onChange={e => setEditing(ed => ({ ...ed, restrictedTopics: e.target.value }))} />
                            <p style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>AI will politely decline to discuss these topics with this contact.</p>
                        </div>
                        <div>
                            <FormLabel>Custom Instructions</FormLabel>
                            <textarea value={editing.customInstructions || ""} placeholder="Any special handling instructions for this contact..."
                                onChange={e => setEditing(ed => ({ ...ed, customInstructions: e.target.value }))}
                                rows={3}
                                style={{ width: "100%", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, color: "#e2e8f0", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical" }}
                            />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input type="checkbox" id="req-approval" checked={!!editing.requiresApproval}
                                onChange={e => setEditing(ed => ({ ...ed, requiresApproval: e.target.checked }))}
                                style={{ width: 16, height: 16, accentColor: "#6366f1", cursor: "pointer" }} />
                            <label htmlFor="req-approval" style={{ fontSize: 13, color: "#94a3b8", cursor: "pointer" }}>
                                Require your approval before sending any reply to this contact
                            </label>
                        </div>

                        <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                            <SaveButton onClick={handleSave} saving={saving} label="Save Policy" />
                            <button onClick={() => setEditing(null)} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.2)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 13 }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── TAB 4: Approval Queue ─────────────────────────────────────────────────────
function ApprovalsTab() {
    const [approvals, setApprovals] = useState([]);
    const [editingDraft, setEditingDraft] = useState({}); // id → text
    const [processing, setProcessing] = useState(null);
    const [filter, setFilter] = useState("pending");

    const fetchApprovals = useCallback(() => {
        fetch(`${API}/api/approvals?status=${filter}`).then(r => r.json()).then(setApprovals).catch(() => {});
    }, [filter]);

    useEffect(() => { fetchApprovals(); const t = setInterval(fetchApprovals, 5000); return () => clearInterval(t); }, [fetchApprovals]);

    const handleApprove = async (approval) => {
        setProcessing(approval.id);
        try {
            const editedResponse = editingDraft[approval.id] ?? approval.aiDraft;
            await fetch(`${API}/api/approvals/${approval.id}/approve`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ editedResponse })
            });
            fetchApprovals();
        } catch { alert("Failed to approve."); }
        finally { setProcessing(null); }
    };

    const handleReject = async (id) => {
        if (!confirm("Reject this message? No reply will be sent.")) return;
        setProcessing(id);
        try {
            await fetch(`${API}/api/approvals/${id}/reject`, { method: "POST" });
            fetchApprovals();
        } catch { alert("Failed to reject."); }
        finally { setProcessing(null); }
    };

    return (
        <div style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: 24, backdropFilter: "blur(20px)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <SectionTitle icon="✅">Approval Queue</SectionTitle>
                <div style={{ display: "flex", gap: 6 }}>
                    {["pending", "approved", "rejected", "sent"].map(s => (
                        <button key={s} onClick={() => setFilter(s)}
                            style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(99,102,241,0.2)", cursor: "pointer", fontSize: 11, fontWeight: 600,
                                background: filter === s ? "rgba(99,102,241,0.3)" : "transparent",
                                color: filter === s ? "#a5b4fc" : "#64748b" }}>
                            {s}
                        </button>
                    ))}
                    <button onClick={fetchApprovals} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(99,102,241,0.2)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 11 }}>
                        ↻
                    </button>
                </div>
            </div>

            {approvals.length === 0 ? (
                <div style={{ textAlign: "center", padding: "50px 0", color: "#475569" }}>
                    <div style={{ fontSize: 32, opacity: 0.4, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>No {filter} approvals</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Messages from contacts marked "Requires Approval" will appear here.</div>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {approvals.map(a => (
                        <div key={a.id} style={{ background: "rgba(30,27,75,0.5)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 12, padding: 18 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                <div>
                                    <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>👤 {a.senderName}</div>
                                    <div style={{ fontSize: 11, color: "#475569" }}>{a.contactId} · {new Date(a.createdAt).toLocaleString()}</div>
                                </div>
                                <Badge color={a.status === "pending" ? "amber" : a.status === "approved" || a.status === "sent" ? "emerald" : "rose"}>
                                    {a.status}
                                </Badge>
                            </div>

                            {/* Incoming message */}
                            <div style={{ marginBottom: 12 }}>
                                <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Incoming Message</p>
                                <div style={{ background: "rgba(15,23,42,0.5)", padding: "10px 14px", borderRadius: 8, fontSize: 13, color: "#cbd5e1", borderLeft: "3px solid rgba(99,102,241,0.5)" }}>
                                    {a.message}
                                </div>
                            </div>

                            {/* AI Draft */}
                            {a.aiDraft && (
                                <div style={{ marginBottom: 14 }}>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>AI Draft Reply (edit before sending)</p>
                                    <textarea
                                        value={editingDraft[a.id] ?? a.aiDraft}
                                        onChange={e => setEditingDraft(ed => ({ ...ed, [a.id]: e.target.value }))}
                                        rows={3}
                                        disabled={a.status !== "pending"}
                                        style={{ width: "100%", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 8, color: "#6ee7b7", padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical", opacity: a.status !== "pending" ? 0.6 : 1 }}
                                    />
                                </div>
                            )}

                            {a.status === "pending" && (
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={() => handleApprove(a)} disabled={processing === a.id}
                                        style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", fontWeight: 600, fontSize: 13 }}>
                                        {processing === a.id ? "Sending..." : "✅ Approve & Send"}
                                    </button>
                                    <button onClick={() => handleReject(a.id)} disabled={processing === a.id}
                                        style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(244,63,94,0.3)", background: "transparent", color: "#fda4af", cursor: "pointer", fontSize: 13 }}>
                                        ✕ Reject
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
