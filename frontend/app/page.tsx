"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Sparkles, Zap, Brain, Mic } from "lucide-react";
import { MasterCard } from "@/components/MasterCard";
import { CreateMasterModal } from "@/components/CreateMasterModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, Master } from "@/lib/api";

export default function HomePage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchMasters = useCallback(async () => {
    try {
      const data = await api.masters.list();
      setMasters(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMasters(); }, [fetchMasters]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      {/* Header */}
      <header style={{
        background: "rgba(247,247,249,0.88)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: "linear-gradient(135deg, #5b5ef4, #818cf8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 10px rgba(91,94,244,0.35)",
            }}>
              <Sparkles size={15} color="#fff" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" }}>
              Living Master
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThemeToggle />
            {masters.length > 0 && (
            <button
              onClick={() => setShowCreate(true)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "7px 15px", borderRadius: 10,
                background: "var(--accent)", border: "none",
                color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: "pointer", letterSpacing: "-0.01em",
                boxShadow: "0 2px 12px var(--accent-glow)",
                transition: "all 0.15s",
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = "var(--accent-hover)";
                e.currentTarget.style.boxShadow = "0 4px 20px var(--accent-glow)";
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = "var(--accent)";
                e.currentTarget.style.boxShadow = "0 2px 12px var(--accent-glow)";
              }}
            >
              <Plus size={14} strokeWidth={2.5} />
              New Master
            </button>
            )}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px" }} className="page-container">
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ height: 80, borderRadius: 16 }} className="shimmer" />
            ))}
          </div>
        ) : masters.length > 0 ? (
          <>
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
                Your Masters · {masters.length}
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {masters.map((master, i) => (
                <motion.div
                  key={master.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <MasterCard master={master} />
                </motion.div>
              ))}
            </div>
          </>
        ) : (
          /* Hero / landing state */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", padding: "80px 20px 100px",
              position: "relative", overflow: "hidden",
            }}
          >
            {/* Ambient glow */}
            <div style={{
              position: "absolute", top: "35%", left: "50%", transform: "translate(-50%, -50%)",
              width: 500, height: 350, borderRadius: "50%",
              background: "radial-gradient(ellipse, rgba(91,94,244,0.07) 0%, transparent 70%)",
              pointerEvents: "none",
            }} />

            {/* Icon */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: 68, height: 68, borderRadius: 20,
                background: "linear-gradient(135deg, rgba(91,94,244,0.08), rgba(129,140,248,0.12))",
                border: "1px solid rgba(91,94,244,0.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 36, boxShadow: "0 4px 24px rgba(91,94,244,0.12)",
              }}
            >
              <Brain size={28} style={{ color: "var(--accent)" }} />
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              style={{
                fontSize: 44, fontWeight: 800, letterSpacing: "-0.04em",
                lineHeight: 1.1, textAlign: "center", marginBottom: 18,
                background: "linear-gradient(160deg, #0c0c18 20%, #5b5ef4 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Their Knowledge.<br />Forever Accessible.
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{
                fontSize: 16, color: "var(--text-secondary)", textAlign: "center",
                lineHeight: 1.7, maxWidth: 440, marginBottom: 40,
              }}
            >
              Build a Living Master. Feed it their interviews, books, talks, and videos.
              Ask anything. Get answers grounded in their real words — in their own voice.
            </motion.p>

            {/* Feature pills */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              style={{ display: "flex", gap: 8, marginBottom: 44, flexWrap: "wrap", justifyContent: "center" }}
            >
              {[
                { icon: <Zap size={11} />, label: "Any public source" },
                { icon: <Brain size={11} />, label: "RAG knowledge base" },
                { icon: <Mic size={11} />, label: "Voice cloning" },
              ].map(({ icon, label }) => (
                <span key={label} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 20,
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  fontSize: 12, color: "var(--text-secondary)", fontWeight: 500,
                }}>
                  <span style={{ color: "var(--accent)" }}>{icon}</span>
                  {label}
                </span>
              ))}
            </motion.div>

            {/* CTA */}
            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowCreate(true)}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "13px 28px", borderRadius: 14,
                background: "var(--accent)", border: "none",
                color: "#fff", fontSize: 15, fontWeight: 600,
                cursor: "pointer", boxShadow: "0 4px 24px var(--accent-glow)",
                letterSpacing: "-0.01em", transition: "box-shadow 0.2s",
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = "var(--accent-hover)";
                e.currentTarget.style.boxShadow = "0 8px 36px rgba(91,94,244,0.38)";
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = "var(--accent)";
                e.currentTarget.style.boxShadow = "0 4px 24px var(--accent-glow)";
              }}
            >
              <Plus size={16} strokeWidth={2.5} />
              Create your first master
            </motion.button>
          </motion.div>
        )}
      </main>

      <CreateMasterModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchMasters} />
    </div>
  );
}
