"use client";
import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

const STORAGE_KEY = "wa-cc-theme";

export function getInitialTheme() {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}

export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggle}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span className="theme-toggle-track" data-mode={theme}>
        <span className="theme-toggle-thumb">
          {isDark ? <IconMoon width={14} height={14} /> : <IconSun width={14} height={14} />}
        </span>
        <span className="theme-toggle-label">{isDark ? "Dark" : "Light"}</span>
      </span>
    </button>
  );
}
