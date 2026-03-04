"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import type { Master } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { MasterAvatar } from "@/components/MasterAvatar";

export function MasterCard({ master }: { master: Master }) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      style={{
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        overflow: "hidden",
        transition: "border-color 0.2s, box-shadow 0.2s",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = master.avatar_color + "50";
        el.style.boxShadow = `0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px ${master.avatar_color}22`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--border)";
        el.style.boxShadow = "none";
      }}
    >
      <Link href={`/masters/${master.id}`} style={{ display: "block", padding: "17px 20px", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <MasterAvatar master={master} size={42} borderRadius="50%" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
              {master.name}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {master.description || (master.source_count > 0
                ? `${master.source_count} source${master.source_count !== 1 ? "s" : ""}`
                : "No sources yet")}
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 }}>
            {formatRelativeTime(master.updated_at)}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
