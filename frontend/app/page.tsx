"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Sparkles, Zap, Brain, Mic, LogOut, HelpCircle, X } from "lucide-react";
import { MasterCard } from "@/components/MasterCard";
import { CreateMasterModal } from "@/components/CreateMasterModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, Master } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [masters, setMasters] = useState<Master[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleLogout = () => {
    clearToken();
    router.replace("/login");
  };

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
        background: "var(--header-bg)",
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
            <button
              onClick={() => setShowHelp(true)}
              title="Getting started guide"
              style={{
                width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "1px solid transparent", color: "var(--text-muted)", cursor: "pointer",
                transition: "all 0.12s",
              }}
              onMouseOver={e => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--surface)"; }}
              onMouseOut={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
            >
              <HelpCircle size={13} />
            </button>
            <button
              onClick={handleLogout}
              title="Sign out"
              style={{
                width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "1px solid transparent", color: "var(--text-muted)", cursor: "pointer",
                transition: "all 0.12s",
              }}
              onMouseOver={e => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--surface)"; }}
              onMouseOut={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
            >
              <LogOut size={13} />
            </button>
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
                  <MasterCard master={master} onUpdated={(updated) => setMasters(prev => prev.map(m => m.id === updated.id ? updated : m))} />
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
              className="hero-headline"
              style={{
                fontSize: 44, fontWeight: 800, letterSpacing: "-0.04em",
                lineHeight: 1.1, textAlign: "center", marginBottom: 18,
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

      {/* Getting Started Guide */}
      {showHelp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowHelp(false); }}>
          <div style={{ background: "var(--surface)", borderRadius: 18, padding: 28, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <HelpCircle size={18} style={{ color: "var(--accent)" }} />
                <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.02em" }}>Getting Started</h2>
              </div>
              <button onClick={() => setShowHelp(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4 }}><X size={16} /></button>
            </div>

            {[
              {
                step: "1", title: "Create a Master",
                body: "Click New Master and enter a name — a public figure, thinker, athlete, or anyone whose knowledge you want to preserve. This creates their profile.",
              },
              {
                step: "2", title: "Add Sources",
                body: "Go to the Sources tab. Paste any YouTube URL, article link, podcast, Wikipedia page, or upload an audio/video/PDF file. Each source is transcribed and indexed automatically.",
              },
              {
                step: "3", title: "Discover Content",
                body: "Use the Discover tab to search the web for all publicly available interviews and talks. Preview results and add them in bulk — the system checks for duplicates automatically.",
              },
              {
                step: "4", title: "Identify the Speaker",
                body: "For interviews with multiple speakers, go to Transcripts → open the source → click Identify Speaker. Pick which voice is the master. The other speakers can be labelled as Interviewer (questions kept as context) or Translator.",
              },
              {
                step: "5", title: "Chat",
                body: "Go to the Chat tab and ask anything. Answers are drawn directly from the master's actual words. Enable Voice to hear answers in their voice. Enable Conversation Mode to ask natural follow-up questions.",
              },
              {
                step: "6", title: "Generate a Book",
                body: "Go to Knowledge → Generate Book. The AI writes a structured, chapter-based book from all indexed content — in the master's own voice. You can focus it on a specific topic, or export as a PDF.",
              },
              {
                step: "7", title: "Media & Voice",
                body: "Upload photos in the Media tab — they're included in the PDF book. Clone the master's voice from audio sources using ElevenLabs, or pick a free preset voice for text-to-speech.",
              },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ display: "flex", gap: 14, marginBottom: 18 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(99,102,241,0.12)", border: "1.5px solid rgba(99,102,241,0.25)", color: "var(--accent)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                  {step}
                </div>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px", letterSpacing: "-0.01em" }}>{title}</p>
                  <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>{body}</p>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 4, padding: "12px 14px", borderRadius: 10, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-primary)" }}>Tip:</strong> Hover the <strong>ⓘ</strong> icon on any tab or button for a quick description of what it does.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
