"use client";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        width: 32, height: 32, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent",
        border: "1px solid var(--border)",
        color: "var(--text-muted)",
        cursor: "pointer",
        transition: "all 0.15s",
        flexShrink: 0,
      }}
      onMouseOver={e => {
        e.currentTarget.style.color = "var(--text-primary)";
        e.currentTarget.style.borderColor = "var(--border-hover)";
        e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseOut={e => {
        e.currentTarget.style.color = "var(--text-muted)";
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
