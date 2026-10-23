"use client";
import { useEffect, useState, useCallback } from "react";
import ThemeToggle from "../components/ThemeToggle";
import {
    IconSettings, IconArrowLeft, IconBrain, IconCalendar, IconUsers, IconInbox,
    IconRefresh, IconPlus, IconPencil, IconTrash, IconCheck, IconX, IconKey
} from "../components/icons";

import { getApiBase } from "../lib/apiBase";
import { AppFooter, SystemPanel } from "../components/AppChrome";
import AppShell from "../components/AppShell";


const LLM_PROVIDERS = [
    { value: "ollama", label: "Ollama (Local LLM)", needsKey: false, modelPlaceholder: "e.g. gemma4:latest, qwen3:4b, llama3.2" },
    { value: "gemini", label: "Google Gemini", needsKey: true, modelPlaceholder: "e.g. gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro" },
    { value: "claude", label: "Anthropic Claude", needsKey: true, modelPlaceholder: "e.g. claude-3-5-haiku-20241022, claude-sonnet-4" },
    { value: "openai", label: "OpenAI GPT", needsKey: true, modelPlaceholder: "e.g. gpt-4o-mini, gpt-4o" },
    { value: "grok", label: "xAI Grok", needsKey: true, modelPlaceholder: "e.g. grok-beta, grok-2-mini" },
];

const CALENDAR_PROVIDERS = [
    { value: "google", label: "Google Calendar / Tasks" },
    { value: "macos", label: "macOS Calendar + Reminders (AppleScript)" },
    { value: "windows", label: "Windows Outlook (PowerShell/COM)" },
];

const TONE_OPTIONS = [
    { value: "auto", label: "Auto (mirror sender style)" },
    { value: "formal", label: "Formal & professional" },
    { value: "casual", label: "Casual & friendly" },
    { value: "tamil", label: "Tamil" },
    { value: "tanglish", label: "Tanglish (Tamil + English)" },
];

const INFO_LEVELS = [
    { value: "full", label: "Full — share all available info" },
    { value: "limited", label: "Limited — general availability only" },
    { value: "minimal", label: "Minimal — unavailable, reply later" },
];

const TABS = [
    { id: "llm", label: "LLM Provider", Icon: IconBrain },
    { id: "calendar", label: "Calendar & Tasks", Icon: IconCalendar },
    { id: "contacts", label: "Contact Policies", Icon: IconUsers },
    { id: "approvals", label: "Approval Queue", Icon: IconInbox },
    { id: "system", label: "System & Updates", Icon: IconKey },
];

function SectionTitle({ Icon, children }) {
    return (
        <h2 className="section-title">
            <span className="section-icon">{Icon ? <Icon width={16} height={16} /> : null}</span>
            {children}
        </h2>
    );
}

function SaveButton({ onClick, saving, label = "Save Changes" }) {
    return (
        <button onClick={onClick} disabled={saving} className="btn-primary">
            {saving ? "Saving..." : label}
        </button>
    );
}

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("llm");
    const [processing, setProcessing] = useState(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab");
        if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab);
    }, []);

    const selectTab = (id) => {
        setActiveTab(id);
        if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("tab", id);
            window.history.replaceState({}, "", url.toString());
        }
    };

    const handleGoogleAuth = useCallback(async () => {
        setProcessing("google");
        try {
            const res = await fetch(`${getApiBase()}/api/calendar/google-auth/init`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to start auth flow.");
            window.location.assign(data.url);
        } catch (error) {
            alert(error.message || "Failed to start auth flow.");
            setProcessing(null);
        }
    }, []);

    const settingsActive = activeTab === "system" ? "system" : activeTab === "approvals" ? "approvals" : activeTab === "contacts" ? "contacts" : activeTab === "calendar" ? "calendar" : "llm";
    return (
        <AppShell
            active={settingsActive}
            title="Settings"
            subtitle="Providers · policies · approvals · system"
            engineOnline={true}
            topRight={<ThemeToggle />}
        >
            <div className="settings-shell">
                <div className="tab-bar">
                    {TABS.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            type="button"
                            className={`tab-btn ${activeTab === id ? "active" : ""}`}
                            onClick={() => selectTab(id)}
                        >
                            <Icon width={15} height={15} />
                            {label}
                        </button>
                    ))}
                </div>

                {activeTab === "llm" && <LLMTab />}
                {activeTab === "calendar" && (
                    <CalendarTab handleGoogleAuth={handleGoogleAuth} processing={processing} />
                )}
                {activeTab === "contacts" && <ContactsTab />}
                {activeTab === "approvals" && <ApprovalsTab />}
                {activeTab === "system" && <SystemPanel />}
            </div>
            <AppFooter />
        </AppShell>
    );
}


function LLMTab() {
    const [config, setConfig] = useState({ provider: "ollama", modelName: "gemma4:latest", apiKey: "", baseUrl: "" });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);
    const [ollamaModels, setOllamaModels] = useState([]);

    useEffect(() => {
        fetch(`${getApiBase()}/api/llm-config`).then((r) => r.json()).then(setConfig).catch(() => {});
        fetch("http://localhost:11434/api/tags").then((r) => r.json()).then((d) => {
            setOllamaModels((d.models || []).map((m) => m.name));
        }).catch(() => {});
    }, []);

    const providerInfo = LLM_PROVIDERS.find((p) => p.value === config.provider) || LLM_PROVIDERS[0];

    const handleSave = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch(`${getApiBase()}/api/llm-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            const data = await res.json();
            setConfig(data);
            setMsg({ type: "success", text: "LLM configuration saved. Active on next message." });
        } catch {
            setMsg({ type: "error", text: "Failed to save." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="settings-grid">
            <div className="glass-card">
                <SectionTitle Icon={IconBrain}>LLM Provider Configuration</SectionTitle>

                <div className="form-group">
                    <label className="form-label">AI Provider</label>
                    <select
                        className="custom-select"
                        value={config.provider}
                        onChange={(e) => setConfig((c) => ({ ...c, provider: e.target.value, apiKey: "" }))}
                    >
                        {LLM_PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label className="form-label">Model Name</label>
                    {config.provider === "ollama" && ollamaModels.length > 0 ? (
                        <select
                            className="custom-select"
                            value={config.modelName}
                            onChange={(e) => setConfig((c) => ({ ...c, modelName: e.target.value }))}
                        >
                            {ollamaModels.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            className="custom-input"
                            value={config.modelName || ""}
                            placeholder={providerInfo.modelPlaceholder}
                            onChange={(e) => setConfig((c) => ({ ...c, modelName: e.target.value }))}
                        />
                    )}
                </div>

                {providerInfo.needsKey && (
                    <div className="form-group">
                        <label className="form-label">API Key</label>
                        <input
                            className="custom-input"
                            type="password"
                            value={config.apiKey || ""}
                            placeholder="Paste your API key here..."
                            onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
                        />
                        <p className="form-hint">Stored securely in local SQLite. Never sent externally by this dashboard.</p>
                    </div>
                )}

                {config.provider === "grok" && (
                    <div className="form-group">
                        <label className="form-label">Base URL (optional)</label>
                        <input
                            className="custom-input"
                            value={config.baseUrl || ""}
                            placeholder="https://api.x.ai/v1"
                            onChange={(e) => setConfig((c) => ({ ...c, baseUrl: e.target.value }))}
                        />
                    </div>
                )}

                {msg && (
                    <div className={`alert ${msg.type === "success" ? "alert-success" : "alert-error"}`}>{msg.text}</div>
                )}

                <SaveButton onClick={handleSave} saving={saving} />
            </div>

            <div className="stack-col">
                <div className="glass-card">
                    <label className="form-label">Active Configuration</label>
                    <div style={{ fontSize: 13, color: "var(--text-main)", display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            Provider:
                            <span className={`badge ${config.provider === "ollama" ? "badge-indigo" : "badge-emerald"}`}>
                                {providerInfo.label}
                            </span>
                        </div>
                        <div>
                            Model: <span className="mono" style={{ color: "var(--indigo-text)", fontWeight: 600 }}>{config.modelName || "—"}</span>
                        </div>
                    </div>
                </div>

                {config.provider === "ollama" && ollamaModels.length > 0 && (
                    <div className="glass-card">
                        <label className="form-label">Detected Ollama Models</label>
                        <div className="chip-list">
                            {ollamaModels.map((m) => (
                                <div
                                    key={m}
                                    className={`chip-item ${config.modelName === m ? "active" : ""}`}
                                    onClick={() => setConfig((c) => ({ ...c, modelName: m }))}
                                >
                                    {m}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="glass-card">
                    <label className="form-label">Provider Tips</label>
                    <ul className="tips-list">
                        <li><strong>Ollama</strong> — Local, private. Requires Ollama at :11434.</li>
                        <li><strong>Gemini</strong> — Use a real model id (e.g. gemini-2.0-flash). Key: ai.google.dev</li>
                        <li><strong>Claude</strong> — Strong reasoning. anthropic.com</li>
                        <li><strong>OpenAI</strong> — platform.openai.com</li>
                        <li><strong>Grok</strong> — console.x.ai · optional custom base URL</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

function CalendarTab({ handleGoogleAuth, processing }) {
    const [config, setConfig] = useState({
        authStatus: { google: "Not configured", macos: "Not configured", windows: "Not configured" },
    });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        fetch(`${getApiBase()}/api/calendar-config`)
            .then((r) => r.json())
            .then((data) => setConfig((current) => ({
                ...current,
                ...data,
                authStatus: { ...current.authStatus, ...(data.authStatus || {}) },
            })))
            .catch(() => {});
    }, []);

    const calKey = config.calendarProvider || "google";
    const tasksKey = config.tasksProvider || "google";
    const usesGoogle = calKey === "google" || tasksKey === "google";
    const statusFor = (key) => config.authStatus?.[key] || (key === "google" ? "Not configured" : "—");
    const readyFor = (key) => {
        const s = statusFor(key);
        return key === "google" ? s === "Authenticated" : s === "Available" || s === "Authenticated";
    };

    const handleSave = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch(`${getApiBase()}/api/calendar-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    calendarProvider: calKey,
                    tasksProvider: tasksKey,
                }),
            });
            const saved = await res.json().catch(() => ({}));
            // Re-fetch full config so authStatus stays accurate after save
            const fresh = await fetch(`${getApiBase()}/api/calendar-config`).then((r) => r.json()).catch(() => null);
            if (fresh) {
                setConfig((current) => ({
                    ...current,
                    ...fresh,
                    authStatus: { ...current.authStatus, ...(fresh.authStatus || {}) },
                }));
            } else if (saved) {
                setConfig((current) => ({ ...current, ...saved }));
            }
            setMsg({ type: "success", text: "Calendar configuration saved." });
        } catch {
            setMsg({ type: "error", text: "Failed to save." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="settings-grid">
            <div className="glass-card">
                <SectionTitle Icon={IconCalendar}>Calendar & Tasks Integration</SectionTitle>

                <div className="form-group">
                    <label className="form-label">Calendar Provider (Read Availability)</label>
                    <select
                        className="custom-select"
                        value={calKey}
                        onChange={(e) => setConfig((c) => ({ ...c, calendarProvider: e.target.value }))}
                    >
                        {CALENDAR_PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <span className="form-hint" style={{ margin: 0 }}>Status:</span>
                        <span className={`badge ${readyFor(calKey) ? "badge-emerald" : "badge-amber"}`}>
                            {statusFor(calKey)}
                        </span>
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Tasks / Reminders Provider (Write Notes)</label>
                    <select
                        className="custom-select"
                        value={tasksKey}
                        onChange={(e) => setConfig((c) => ({ ...c, tasksProvider: e.target.value }))}
                    >
                        {CALENDAR_PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                    <p className="form-hint">Calendar and Tasks can use different providers independently.</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <span className="form-hint" style={{ margin: 0 }}>Status:</span>
                        <span className={`badge ${readyFor(tasksKey) ? "badge-emerald" : "badge-amber"}`}>
                            {statusFor(tasksKey)}
                        </span>
                    </div>
                </div>

                {usesGoogle && (
                <div className="form-group">
                    <label className="form-label">Google OAuth (only when Google is selected)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                        <span className={`badge ${config.authStatus?.google === "Authenticated" ? "badge-emerald" : "badge-amber"}`}>
                            {config.authStatus?.google || "Not configured"}
                        </span>
                        <button
                            type="button"
                            onClick={handleGoogleAuth}
                            disabled={saving || processing}
                            className="btn-primary"
                        >
                            <IconKey width={14} height={14} />
                            {processing === "google" ? "Processing..." : "Re-authenticate Google"}
                        </button>
                    </div>
                    <p className="form-hint">Required only if Calendar or Tasks provider is Google. macOS / Windows do not use this.</p>
                </div>
                )}

                {msg && (
                    <div className={`alert ${msg.type === "success" ? "alert-success" : "alert-error"}`}>{msg.text}</div>
                )}

                <SaveButton onClick={handleSave} saving={saving} />
            </div>

            <div className="glass-card">
                <label className="form-label">Provider Requirements</label>
                <div className="info-box">
                    <p className="info-box-title">Google (default)</p>
                    <ul>
                        <li>Requires credentials.json + token.json in the engine root</li>
                        <li>Run the auth flow once to generate token.json</li>
                        <li>Reads Calendar API, writes to Google Tasks</li>
                    </ul>
                </div>
                <div className="info-box">
                    <p className="info-box-title">macOS (AppleScript)</p>
                    <ul>
                        <li>Requires macOS 12+ with Calendar & Reminders apps</li>
                        <li>Grant Automation permissions in System Settings → Privacy → Automation</li>
                        <li>Reads Calendar.app events, writes to Reminders.app</li>
                    </ul>
                </div>
                <div className="info-box">
                    <p className="info-box-title">Windows (Outlook COM)</p>
                    <ul>
                        <li>Requires Microsoft Outlook installed and signed in</li>
                        <li>PowerShell must be allowed to run COM scripts</li>
                        <li>Reads Outlook Calendar, writes to Outlook Tasks</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

function ContactsTab() {
    const [policies, setPolicies] = useState([]);
    const [editing, setEditing] = useState(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(null);

    const fetchPolicies = useCallback(() => {
        fetch(`${getApiBase()}/api/contact-policies`).then((r) => r.json()).then(setPolicies).catch(() => {});
    }, []);

    useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

    const newPolicy = () => setEditing({
        contactId: "", displayName: "", tone: "auto", infoLevel: "full",
        restrictedTopics: "", requiresApproval: false, customInstructions: "",
    });

    const handleSave = async () => {
        if (!editing.contactId || !editing.displayName) return alert("Contact ID and Display Name are required.");
        setSaving(true);
        try {
            const payload = {
                ...editing,
                restrictedTopics: editing.restrictedTopics
                    ? JSON.stringify(editing.restrictedTopics.split(",").map((t) => t.trim()).filter(Boolean))
                    : null,
            };
            await fetch(`${getApiBase()}/api/contact-policies`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            setEditing(null);
            fetchPolicies();
        } catch {
            alert("Failed to save policy.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (contactId) => {
        if (!confirm("Delete policy for this contact?")) return;
        setDeleting(contactId);
        try {
            await fetch(`${getApiBase()}/api/contact-policies/${encodeURIComponent(contactId)}`, { method: "DELETE" });
            fetchPolicies();
        } catch {
            alert("Failed to delete.");
        } finally {
            setDeleting(null);
        }
    };

    const getRestrictedTopicsString = (policy) => {
        if (!policy.restrictedTopics) return "";
        try { return JSON.parse(policy.restrictedTopics).join(", "); } catch { return policy.restrictedTopics; }
    };

    return (
        <div className="settings-grid" style={{ gridTemplateColumns: editing ? "1fr 1fr" : "1fr" }}>
            <div className="glass-card">
                <div className="panel-header">
                    <SectionTitle Icon={IconUsers}>Contact Policies</SectionTitle>
                    <button type="button" onClick={newPolicy} className="btn-primary">
                        <IconPlus width={14} height={14} />
                        New Policy
                    </button>
                </div>

                {policies.length === 0 ? (
                    <div className="empty-state" style={{ minHeight: 180 }}>
                        <div className="empty-state-icon"><IconUsers width={22} height={22} /></div>
                        <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>No contact policies yet</div>
                        <div style={{ fontSize: 12, maxWidth: 320 }}>
                            Add a policy to customize tone, restrict topics, or enable approval workflow for specific contacts.
                        </div>
                    </div>
                ) : (
                    <div className="stack-list">
                        {policies.map((p) => (
                            <div key={p.contactId} className="policy-card">
                                <div className="meta-row">
                                    <div>
                                        <div className="meta-title">{p.displayName}</div>
                                        <div className="meta-sub mono">{p.contactId}</div>
                                        <div className="badge-row">
                                            <span className="badge badge-indigo">Tone: {p.tone}</span>
                                            <span className={`badge ${p.infoLevel === "full" ? "badge-emerald" : p.infoLevel === "limited" ? "badge-amber" : "badge-rose"}`}>
                                                {p.infoLevel}
                                            </span>
                                            {p.requiresApproval && <span className="badge badge-amber">Approval required</span>}
                                            {p.restrictedTopics && <span className="badge badge-rose">Restricted topics</span>}
                                        </div>
                                    </div>
                                    <div className="inline-actions">
                                        <button
                                            type="button"
                                            className="btn-ghost"
                                            onClick={() => setEditing({ ...p, restrictedTopics: getRestrictedTopicsString(p) })}
                                        >
                                            <IconPencil width={13} height={13} /> Edit
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-danger"
                                            onClick={() => handleDelete(p.contactId)}
                                            disabled={deleting === p.contactId}
                                        >
                                            <IconTrash width={13} height={13} />
                                            {deleting === p.contactId ? "..." : "Delete"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {editing && (
                <div className="glass-card">
                    <div className="panel-header">
                        <SectionTitle Icon={IconPencil}>{editing.id ? "Edit Policy" : "New Policy"}</SectionTitle>
                        <button type="button" className="btn-ghost" onClick={() => setEditing(null)} aria-label="Close">
                            <IconX width={14} height={14} />
                        </button>
                    </div>

                    <div className="stack-col">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Display Name *</label>
                            <input className="custom-input" value={editing.displayName} placeholder="e.g. John Smith"
                                onChange={(e) => setEditing((ed) => ({ ...ed, displayName: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">WhatsApp Contact ID *</label>
                            <input className="custom-input mono" value={editing.contactId} placeholder="e.g. 919876543210@c.us"
                                onChange={(e) => setEditing((ed) => ({ ...ed, contactId: e.target.value }))} />
                            <p className="form-hint">Format: country code + number + @c.us. Check dashboard logs for the exact ID.</p>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Response Tone</label>
                            <select className="custom-select" value={editing.tone}
                                onChange={(e) => setEditing((ed) => ({ ...ed, tone: e.target.value }))}>
                                {TONE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Information Level</label>
                            <select className="custom-select" value={editing.infoLevel}
                                onChange={(e) => setEditing((ed) => ({ ...ed, infoLevel: e.target.value }))}>
                                {INFO_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                            </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Restricted Topics (comma-separated)</label>
                            <input className="custom-input" value={editing.restrictedTopics || ""}
                                placeholder="e.g. salary, project budget, personal address"
                                onChange={(e) => setEditing((ed) => ({ ...ed, restrictedTopics: e.target.value }))} />
                            <p className="form-hint">AI will politely decline to discuss these topics with this contact.</p>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Custom Instructions</label>
                            <textarea className="custom-textarea" rows={3} value={editing.customInstructions || ""}
                                placeholder="Any special handling instructions for this contact..."
                                onChange={(e) => setEditing((ed) => ({ ...ed, customInstructions: e.target.value }))} />
                        </div>
                        <div className="checkbox-row">
                            <input type="checkbox" id="req-approval" checked={!!editing.requiresApproval}
                                onChange={(e) => setEditing((ed) => ({ ...ed, requiresApproval: e.target.checked }))} />
                            <label htmlFor="req-approval">Require approval before sending any reply to this contact</label>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <SaveButton onClick={handleSave} saving={saving} label="Save Policy" />
                            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ApprovalsTab() {
    const [approvals, setApprovals] = useState([]);
    const [editingDraft, setEditingDraft] = useState({});
    const [processing, setProcessing] = useState(null);
    const [filter, setFilter] = useState("pending");

    const fetchApprovals = useCallback(() => {
        fetch(`${getApiBase()}/api/approvals?status=${filter}`).then((r) => r.json()).then(setApprovals).catch(() => {});
    }, [filter]);

    useEffect(() => {
        fetchApprovals();
        const t = setInterval(fetchApprovals, 5000);
        return () => clearInterval(t);
    }, [fetchApprovals]);

    const handleApprove = async (approval) => {
        setProcessing(approval.id);
        try {
            const editedResponse = editingDraft[approval.id] ?? approval.aiDraft;
            await fetch(`${getApiBase()}/api/approvals/${approval.id}/approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ editedResponse }),
            });
            fetchApprovals();
        } catch {
            alert("Failed to approve.");
        } finally {
            setProcessing(null);
        }
    };

    const handleReject = async (id) => {
        if (!confirm("Reject this message? No reply will be sent.")) return;
        setProcessing(id);
        try {
            await fetch(`${getApiBase()}/api/approvals/${id}/reject`, { method: "POST" });
            fetchApprovals();
        } catch {
            alert("Failed to reject.");
        } finally {
            setProcessing(null);
        }
    };

    return (
        <div className="glass-card">
            <div className="panel-header">
                <SectionTitle Icon={IconInbox}>Approval Queue</SectionTitle>
                <div className="filter-row">
                    {["pending", "approved", "rejected", "sent"].map((s) => (
                        <button
                            key={s}
                            type="button"
                            className={`filter-chip ${filter === s ? "active" : ""}`}
                            onClick={() => setFilter(s)}
                        >
                            {s}
                        </button>
                    ))}
                    <button type="button" className="btn-ghost" onClick={fetchApprovals} title="Refresh">
                        <IconRefresh width={14} height={14} />
                    </button>
                </div>
            </div>

            {approvals.length === 0 ? (
                <div className="empty-state" style={{ minHeight: 200 }}>
                    <div className="empty-state-icon"><IconInbox width={22} height={22} /></div>
                    <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>No {filter} approvals</div>
                    <div style={{ fontSize: 12 }}>Messages from contacts marked &quot;Requires Approval&quot; will appear here.</div>
                </div>
            ) : (
                <div className="stack-list">
                    {approvals.map((a) => (
                        <div key={a.id} className="approval-card">
                            <div className="meta-row" style={{ marginBottom: 12 }}>
                                <div>
                                    <div className="meta-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                        {a.senderName}
                                    </div>
                                    <div className="meta-sub mono">{a.contactId} · {new Date(a.createdAt).toLocaleString()}</div>
                                </div>
                                <span className={`badge ${a.status === "pending" ? "badge-amber" : a.status === "approved" || a.status === "sent" ? "badge-emerald" : "badge-rose"}`}>
                                    {a.status}
                                </span>
                            </div>

                            <div style={{ marginBottom: 12 }}>
                                <p className="form-label">Incoming Message</p>
                                <div className="message-block">{a.message}</div>
                            </div>

                            {a.aiDraft && (
                                <div style={{ marginBottom: 14 }}>
                                    <p className="form-label">AI Draft Reply (edit before sending)</p>
                                    <textarea
                                        className="custom-textarea"
                                        value={editingDraft[a.id] ?? a.aiDraft}
                                        onChange={(e) => setEditingDraft((ed) => ({ ...ed, [a.id]: e.target.value }))}
                                        rows={3}
                                        disabled={a.status !== "pending"}
                                        style={{ opacity: a.status !== "pending" ? 0.6 : 1 }}
                                    />
                                </div>
                            )}

                            {a.status === "pending" && (
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <button type="button" className="btn-success" onClick={() => handleApprove(a)} disabled={processing === a.id}>
                                        <IconCheck width={14} height={14} />
                                        {processing === a.id ? "Sending..." : "Approve & Send"}
                                    </button>
                                    <button type="button" className="btn-danger" onClick={() => handleReject(a.id)} disabled={processing === a.id}>
                                        <IconX width={14} height={14} />
                                        Reject
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

