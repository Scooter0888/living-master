"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Lock, Globe } from "lucide-react";
import type { Master } from "@/lib/api";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { MasterAvatar } from "@/components/MasterAvatar";
import { getRole } from "@/lib/auth";

export function MasterCard({ master, onUpdated }: { master: Master; onUpdated?: (m: Master) => void }) {
  const [isPrivate, setIsPrivate] = useState(master.is_private ?? false);
  const [toggling, setToggling] = useState(false);
  const isAdmin = getRole() === "admin";

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin || toggling) return;
    setToggling(true);
    try {
      const res = await api.masters.togglePrivacy(master.id);
      setIsPrivate(res.is_private);
      onUpdated?.({ ...master, is_private: res.is_private });
    } catch (err) { console.error(err); }
    finally { setToggling(false); }
  };

  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      style={{
        borderRadius: 16, background: "var(--surface)",
        border: `1px solid ${isPrivate ? "rgba(245,158,11,0.25)" : "var(--border)"}`,
        overflow: "hidden", transition: "border-color 0.2s, box-shadow 0.2s", cursor: "pointer",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = isPrivate ? "rgba(245,158,11,0.4)" : master.avatar_color + "50";
        el.style.boxShadow = `0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px ${isPrivate ? "rgba(245,158,11,0.15)" : master.avatar_color + "22"}`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = isPrivate ? "rgba(245,158,11,0.25)" : "var(--border)";
        el.style.boxShadow = "none";
      }}
    >
      <Link href={`/masters/${master.id}`} style={{ display: "block", padding: "17px 20px", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <MasterAvatar master={master} size={42} borderRadius="50%" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                {master.name}
              </span>
              {isPrivate && (
                <span style={{ fontSize: 10, fontWeight: 600, color: "#d97706", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 6, padding: "1px 6px", letterSpacing: "0.02em" }}>
                  PRIVATE
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {master.description || (master.source_count > 0
                ? `${master.source_count} source${master.source_count !== 1 ? "s" : ""}`
                : "No sources yet")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 }}>
              {formatRelativeTime(master.updated_at)}
            </div>
            {isAdmin && (
              <button
                onClick={handleToggle}
                disabled={toggling}
                title={isPrivate ? "Private — click to make visible to shared users" : "Public — click to hide from shared users"}
                style={{
                  width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isPrivate ? "rgba(245,158,11,0.1)" : "transparent",
                  border: `1px solid ${isPrivate ? "rgba(245,158,11,0.3)" : "transparent"}`,
                  color: isPrivate ? "#d97706" : "var(--text-muted)",
                  cursor: toggling ? "not-allowed" : "pointer", opacity: toggling ? 0.5 : 1,
                  transition: "all 0.15s", flexShrink: 0,
                }}
                onMouseOver={e => {
                  if (!toggling) {
                    e.currentTarget.style.background = isPrivate ? "rgba(245,158,11,0.15)" : "var(--surface-2)";
                    e.currentTarget.style.borderColor = isPrivate ? "rgba(245,158,11,0.4)" : "var(--border)";
                    e.currentTarget.style.color = isPrivate ? "#d97706" : "var(--text-secondary)";
                  }
                }}
                onMouseOut={e => {
                  e.currentTarget.style.background = isPrivate ? "rgba(245,158,11,0.1)" : "transparent";
                  e.currentTarget.style.borderColor = isPrivate ? "rgba(245,158,11,0.3)" : "transparent";
                  e.currentTarget.style.color = isPrivate ? "#d97706" : "var(--text-muted)";
                }}
              >
                {isPrivate ? <Lock size={12} /> : <Globe size={12} />}
              </button>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
