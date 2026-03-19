"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, MessageSquare, Database, Search, BookOpen, Image, Trash2, ScrollText, HardDrive } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MasterAvatar } from "@/components/MasterAvatar";
import { ChatInterface } from "@/components/ChatInterface";
import { SourceLibrary } from "@/components/SourceLibrary";
import { IngestPanel } from "@/components/IngestPanel";
import { DiscoveryPanel } from "@/components/DiscoveryPanel";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { PhotoGallery } from "@/components/PhotoGallery";
import { VoicePanel } from "@/components/VoicePanel";
import { TranscriptViewer } from "@/components/TranscriptViewer";
import BackupPanel from "@/components/BackupPanel";
import { api, Master, Source, Capabilities } from "@/lib/api";

type Tab = "chat" | "sources" | "discover" | "knowledge" | "media" | "transcripts" | "backup";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "chat",        label: "Chat",        icon: <MessageSquare size={13} /> },
  { id: "sources",     label: "Sources",     icon: <Database size={13} /> },
  { id: "discover",    label: "Discover",    icon: <Search size={13} /> },
  { id: "knowledge",   label: "Knowledge",   icon: <BookOpen size={13} /> },
  { id: "media",       label: "Media",       icon: <Image size={13} /> },
  { id: "transcripts", label: "Transcripts", icon: <ScrollText size={13} /> },
  { id: "backup",      label: "Backup",      icon: <HardDrive size={13} /> },
];

export default function MasterPage() {
  const params = useParams();
  const router = useRouter();
  const masterId = params.id as string;

  const [master, setMaster] = useState<Master | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("chat");
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [processingCount, setProcessingCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [transcriptSource, setTranscriptSource] = useState<Source | null>(null);

  const fetchMaster = useCallback(async () => {
    try {
      const data = await api.masters.get(masterId);
      setMaster(data);
      const sources = data.sources || [];
      setProcessingCount(sources.filter(s => s.status === "processing" || s.status === "pending").length);
      setCompletedCount(sources.filter(s => s.status === "completed").length);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [masterId]);

  useEffect(() => { fetchMaster(); }, [fetchMaster]);
  useEffect(() => { api.capabilities().then(setCapabilities).catch(() => {}); }, []);

  // Auto-refresh every 5s while anything is processing
  useEffect(() => {
    if (processingCount === 0) return;
    const interval = setInterval(fetchMaster, 5000);
    return () => clearInterval(interval);
  }, [processingCount, fetchMaster]);

  const handleDelete = async () => {
    if (!master) return;
    setDeleting(true);
    try { await api.masters.delete(master.id); router.push("/"); }
    catch (e) { console.error(e); setDeleting(false); setShowDeleteConfirm(false); }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)" }}>
      <div style={{ width: 22, height: 22, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (!master) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--background)" }}>
      <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Master not found</p>
      <Link href="/" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>← Back to home</Link>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--background)", overflowX: "hidden" }}>
      {/* Header */}
      <header style={{
        background: "var(--header-bg)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 32px" }} className="page-container">

          {/* Top bar */}
          <div style={{ height: 58, display: "flex", alignItems: "center", gap: 12 }}>
            {/* Back */}
            <Link href="/"
              style={{
                width: 30, height: 30, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--text-muted)", textDecoration: "none",
                border: "1px solid var(--border)", background: "var(--surface)",
                flexShrink: 0, transition: "all 0.12s",
              }}
              onMouseOver={e => {
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseOut={e => {
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--surface)";
              }}
            >
              <ArrowLeft size={13} />
            </Link>

            {/* Avatar + name */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <MasterAvatar
                master={master}
                size={34}
                borderRadius="50%"
                editable
                onUpdated={(updated) => setMaster((prev) => prev ? { ...prev, ...updated } : prev)}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                  {master.name}
                </div>
                {master.description && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {master.description}
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }} className="hide-mobile">
              {master.source_count > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  padding: "3px 9px", borderRadius: 20,
                }}>
                  {master.source_count} {master.source_count === 1 ? "source" : "sources"}
                </span>
              )}
              {(master.total_chunks || 0) > 0 && (
                <span style={{
                  fontSize: 11, color: "var(--text-muted)",
                  background: "var(--surface)",
                  padding: "3px 9px", borderRadius: 20,
                  border: "1px solid var(--border)",
                }}>
                  {(master.total_chunks || 0).toLocaleString()} chunks
                </span>
              )}
            </div>

            {/* Theme toggle */}
            <ThemeToggle />

            {/* Delete */}
            {showDeleteConfirm ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }} className="hide-mobile">Delete "{master.name}"?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    padding: "5px 12px", borderRadius: 8,
                    background: "#c0392b", border: "none",
                    color: "#fff", fontSize: 12, fontWeight: 600,
                    cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.7 : 1,
                  }}
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{
                    padding: "5px 12px", borderRadius: 8,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", fontSize: 12, fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete master"
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "1px solid transparent",
                  color: "var(--text-muted)", cursor: "pointer",
                  flexShrink: 0, transition: "all 0.12s",
                }}
                onMouseOver={e => {
                  e.currentTarget.style.color = "#f87171";
                  e.currentTarget.style.borderColor = "rgba(248,113,113,0.2)";
                  e.currentTarget.style.background = "rgba(248,113,113,0.08)";
                }}
                onMouseOut={e => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "transparent";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {/* Processing banner — visible on all tabs */}
          {processingCount > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 0", borderTop: "1px solid var(--border)",
              background: "rgba(59,130,246,0.04)",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-info)", flexShrink: 0, animation: "pulse 1.5s ease-in-out infinite" }} />
              <span style={{ fontSize: 11.5, color: "var(--color-info)", fontWeight: 500 }}>
                {processingCount} source{processingCount !== 1 ? "s" : ""} processing…
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 2 }}>
                {completedCount} completed · refreshing automatically
              </span>
            </div>
          )}

          {/* Tabs — underline indicator style */}
          <div style={{ display: "flex", gap: 0, borderTop: "1px solid var(--border)" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "10px 14px", fontSize: 12.5, fontWeight: tab === t.id ? 600 : 500,
                  background: "transparent", border: "none",
                  color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                  cursor: "pointer", transition: "color 0.12s",
                  borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1, letterSpacing: "-0.01em",
                  position: "relative",
                }}
                onMouseOver={e => { if (tab !== t.id) e.currentTarget.style.color = "var(--text-secondary)"; }}
                onMouseOut={e => { if (tab !== t.id) e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <span style={{ opacity: tab === t.id ? 1 : 0.6 }}>{t.icon}</span>
                {t.id === "sources" && master.source_count > 0
                  ? `Sources · ${master.source_count}`
                  : t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, maxWidth: (tab === "sources" || tab === "knowledge") ? 1200 : 1000, margin: "0 auto", width: "100%", padding: "28px 32px" }} className="page-container">
        <AnimatePresence mode="wait">

          {tab === "chat" && (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              style={{
                height: "calc(100vh - 170px)", borderRadius: 18,
                border: "1px solid var(--border)", background: "var(--surface)",
                overflow: "hidden",
              }}>
              <ChatInterface master={master} />
            </motion.div>
          )}

          {tab === "sources" && (
            <motion.div key="sources" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, alignItems: "start" }}>
              <div>
                <div style={{ marginBottom: 14 }}>
                  <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 3 }}>Add Content</h2>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Paste a link or upload a file to build the knowledge base</p>
                </div>
                <IngestPanel masterId={masterId} onIngested={fetchMaster} />
              </div>

              <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 22 }}>
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 2 }}>Knowledge Base</h2>
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{master.source_count} source{master.source_count !== 1 ? "s" : ""} indexed</p>
                </div>
                <SourceLibrary sources={master.sources || []} masterId={masterId} masterName={master.name} onDeleted={fetchMaster} onRefresh={fetchMaster} />
              </div>
            </motion.div>
          )}

          {tab === "discover" && (
            <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <div style={{ maxWidth: 720, margin: "0 auto" }}>
                <div style={{ marginBottom: 28, textAlign: "center" }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 8 }}>
                    Discover Public Material
                  </h2>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                    Search the web for all publicly available content on {master.name} — interviews, talks, articles, podcasts. Select what to add.
                  </p>
                </div>
                <DiscoveryPanel
                  masterId={masterId} masterName={master.name}
                  existingSources={master.sources || []}
                  onIngested={() => { fetchMaster(); setTab("sources"); }}
                />
              </div>
            </motion.div>
          )}

          {tab === "knowledge" && (
            <motion.div key="knowledge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <KnowledgePanel masterId={masterId} masterName={master.name} sources={master.sources || []} />
            </motion.div>
          )}

          {tab === "transcripts" && (
            <motion.div key="transcripts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <div style={{ maxWidth: 720, margin: "0 auto" }}>
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 6 }}>Transcripts</h2>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
                    Full text and speaker-labelled transcripts for each ingested source.
                  </p>
                </div>

                {(master.sources || []).filter(s => s.status === "completed").length === 0 ? (
                  <div style={{ textAlign: "center", paddingTop: 60, color: "var(--text-muted)", fontSize: 13 }}>
                    No completed sources yet. Add content in the Sources tab.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(master.sources || [])
                      .filter(s => s.status === "completed")
                      .map(source => (
                        <button
                          key={source.id}
                          onClick={() => setTranscriptSource(source)}
                          style={{
                            display: "flex", alignItems: "center", gap: 14,
                            padding: "14px 18px", borderRadius: 12,
                            background: "var(--surface)", border: "1px solid var(--border)",
                            cursor: "pointer", textAlign: "left",
                            transition: "border-color 0.12s, background 0.12s",
                            width: "100%",
                          }}
                          onMouseOver={e => {
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--surface-2)";
                          }}
                          onMouseOut={e => {
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "var(--surface)";
                          }}
                        >
                          <ScrollText size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              marginBottom: 3,
                            }}>
                              {source.title && !source.title.startsWith("http") ? source.title : source.url || "Untitled"}
                            </div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              {source.author && (
                                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>by {source.author}</span>
                              )}
                              {source.chunk_count != null && (
                                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{source.chunk_count} chunks</span>
                              )}
                              {source.has_diarization && (
                                <span style={{
                                  fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 20,
                                  background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                                  color: "#6366f1",
                                }}>
                                  {source.speaker_count ? `${source.speaker_count} speakers` : "Diarized"}
                                </span>
                              )}
                            </div>
                          </div>
                          <span style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 500, flexShrink: 0 }}>View →</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {transcriptSource && (
                <TranscriptViewer
                  source={transcriptSource}
                  masterName={master.name}
                  onClose={() => setTranscriptSource(null)}
                />
              )}
            </motion.div>
          )}

          {tab === "media" && (
            <motion.div key="media" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {capabilities && (
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {([
                    { key: "diarization", label: "Speaker Diarization" },
                    { key: "voice_cloning", label: "Voice Cloning" },
                    { key: "movement_analysis", label: "Movement Analysis" },
                    { key: "tts", label: "Text-to-Speech" },
                    { key: "rag", label: "RAG Chat" },
                  ] as { key: keyof Capabilities; label: string }[]).map(({ key, label }) => {
                    const on = capabilities[key];
                    return (
                      <span key={key} style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, fontWeight: 500, padding: "3px 9px", borderRadius: 20,
                        background: on ? "rgba(22,163,74,0.07)" : "var(--surface-2)",
                        border: `1px solid ${on ? "rgba(22,163,74,0.2)" : "var(--border)"}`,
                        color: on ? "var(--color-success, #16a34a)" : "var(--text-muted)",
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "#16a34a" : "var(--text-muted)", flexShrink: 0 }} />
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
                <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 22 }}>
                  <div style={{ marginBottom: 16 }}>
                    <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 2 }}>Photos</h2>
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Photos are included when generating a PDF book</p>
                  </div>
                  <PhotoGallery masterId={masterId} />
                </div>
                <VoicePanel master={master} onVoiceReady={() => fetchMaster()} />
              </div>
            </motion.div>
          )}

          {tab === "backup" && (
            <motion.div key="backup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <div style={{ maxWidth: 560, margin: "0 auto" }}>
                <BackupPanel />
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}
