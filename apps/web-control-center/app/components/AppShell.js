"use client";
import { useEffect, useState } from "react";
import {
    IconMessage, IconSettings, IconServer, IconBrain, IconCalendar,
    IconUsers, IconInbox, IconActivity, IconShield
} from "./icons";
import { VersionPill, useSystemInfo } from "./AppChrome";

const NAV = [
    { href: "/", id: "dashboard", label: "Dashboard", Icon: IconActivity },
    { href: "/settings/?tab=llm", id: "llm", label: "LLM Provider", Icon: IconBrain },
    { href: "/settings/?tab=calendar", id: "calendar", label: "Calendar", Icon: IconCalendar },
    { href: "/settings/?tab=contacts", id: "contacts", label: "Policies", Icon: IconUsers },
    { href: "/settings/?tab=approvals", id: "approvals", label: "Approvals", Icon: IconInbox },
    { href: "/settings/?tab=system", id: "system", label: "System", Icon: IconShield },
];

function SidebarToggleIcon({ collapsed }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d={collapsed ? "M6 3v10" : "M6 3v10"} stroke="currentColor" strokeWidth="1.4" />
            {!collapsed && <path d="M8.5 6.5L10.5 8L8.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
            {collapsed && <path d="M9.5 6.5L7.5 8L9.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
    );
}

export default function AppShell({
    children,
    active = "dashboard",
    title = "Dashboard",
    subtitle,
    engineOnline,
    topRight,
}) {
    const { system } = useSystemInfo();
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        try {
            const v = localStorage.getItem("wa-sidebar-collapsed");
            if (v === "1") setCollapsed(true);
        } catch { /* ignore */ }
    }, []);

    const toggle = () => {
        setCollapsed((c) => {
            const next = !c;
            try { localStorage.setItem("wa-sidebar-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
            return next;
        });
    };

    return (
        <div className={`mac-app ${collapsed ? "sidebar-collapsed" : ""}`}>
            <aside className="mac-sidebar" aria-label="Main">
                <div className="mac-sidebar-traffic" aria-hidden />
                <div className="mac-sidebar-brand">
                    <div className="mac-sidebar-logo"><IconMessage width={18} height={18} /></div>
                    {!collapsed && (
                        <div className="mac-sidebar-brand-text">
                            <div className="mac-sidebar-title">WA Assistant</div>
                            <VersionPill system={system} />
                        </div>
                    )}
                </div>

                <nav className="mac-nav">
                    {NAV.map(({ href, id, label, Icon }) => (
                        <a
                            key={id}
                            href={href}
                            className={`mac-nav-item ${active === id ? "active" : ""}`}
                            title={label}
                        >
                            <Icon width={16} height={16} />
                            {!collapsed && <span>{label}</span>}
                        </a>
                    ))}
                </nav>

                <div className="mac-sidebar-footer">
                    <div className={`mac-engine-chip ${engineOnline ? "on" : "off"}`} title={engineOnline ? "Engine online" : "Engine offline"}>
                        <IconServer width={13} height={13} />
                        {!collapsed && <span>{engineOnline ? "Engine online" : "Offline"}</span>}
                    </div>
                    <button type="button" className="mac-icon-btn" onClick={toggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label="Toggle sidebar">
                        <SidebarToggleIcon collapsed={collapsed} />
                    </button>
                </div>
            </aside>

            <div className="mac-main">
                <header className="mac-toolbar">
                    <div className="mac-toolbar-left">
                        <button type="button" className="mac-icon-btn toolbar-toggle" onClick={toggle} title="Toggle sidebar" aria-label="Toggle sidebar">
                            <SidebarToggleIcon collapsed={collapsed} />
                        </button>
                        <div>
                            <h1 className="mac-page-title">{title}</h1>
                            {subtitle ? <p className="mac-page-subtitle">{subtitle}</p> : null}
                        </div>
                    </div>
                    <div className="mac-toolbar-right">
                        {topRight}
                    </div>
                </header>
                <main className="mac-content">
                    {children}
                </main>
            </div>
        </div>
    );
}
