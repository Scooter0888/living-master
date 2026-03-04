"use client";
import { useEffect, useState, useRef } from "react";
import { BookOpen, FileText, BarChart2, Sparkles, Copy, Check, ChevronDown, ChevronUp, Layers, ArrowRight, Download } from "lucide-react";
import { api, KnowledgeStats, Source } from "@/lib/api";
import { CONTENT_TYPE_ICONS } from "@/lib/utils";
import { TranscriptViewer } from "./TranscriptViewer";

interface KnowledgePanelProps {
  masterId: string;
  masterName: string;
  sources: Source[];
}

// Very lightweight inline markdown renderer
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      nodes.push(<h1 key={i} style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", margin: "28px 0 8px", letterSpacing: "-0.03em", lineHeight: 1.2 }}>{inlineMarkdown(line.slice(2))}</h1>);
    } else if (line.startsWith("## ")) {
      nodes.push(<h2 key={i} style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: "32px 0 8px", letterSpacing: "-0.02em", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>{inlineMarkdown(line.slice(3))}</h2>);
    } else if (line.startsWith("### ")) {
      nodes.push(<h3 key={i} style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: "20px 0 6px" }}>{inlineMarkdown(line.slice(4))}</h3>);
    } else if (line.startsWith("> ")) {
      nodes.push(<blockquote key={i} style={{ margin: "12px 0", borderLeft: "3px solid var(--accent)", paddingLeft: 16, color: "var(--text-secondary)", fontStyle: "italic", fontSize: 14, lineHeight: 1.7 }}>{inlineMarkdown(line.slice(2))}</blockquote>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      nodes.push(<li key={i} style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.7, marginLeft: 20, marginBottom: 2 }}>{inlineMarkdown(line.slice(2))}</li>);
    } else if (line === "") {
      nodes.push(<br key={i} />);
    } else {
      nodes.push(<p key={i} style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.8, margin: "6px 0" }}>{inlineMarkdown(line)}</p>);
    }
  }
  return <div>{nodes}</div>;
}

function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const CONTENT_TYPE_LABEL_MAP: Record<string, string> = {
  youtube: "YouTube",
  web: "Web",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
  docx: "Document",
  wikipedia: "Wikipedia",
  podcast: "Podcast",
};

interface Topic {
  topic: string;
  description: string;
  keywords: string[];
}

export function KnowledgePanel({ masterId, masterName, sources }: KnowledgePanelProps) {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [showSourceTable, setShowSourceTable] = useState(false);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicsRaw, setTopicsRaw] = useState("");

  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const [bookText, setBookText] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const [viewingSource, setViewingSource] = useState<Source | null>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const bookSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.export.getStats(masterId)
      .then(setStats)
      .catch((e) => setStatsError(e.message))
      .finally(() => setStatsLoading(false));
  }, [masterId]);

  const handleDiscoverTopics = async () => {
    setTopicsLoading(true);
    setTopicsError(null);
    setTopicsRaw("");
    setTopics([]);
    let accumulated = "";
    try {
      for await (const chunk of api.export.streamTopics(masterId)) {
        accumulated += chunk;
        setTopicsRaw(accumulated);
      }
      // Parse JSON from accumulated text
      const match = accumulated.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Topic[];
        setTopics(parsed);
      } else {
        setTopicsError("Could not parse topics response");
      }
    } catch (e: any) {
      setTopicsError(e.message);
    } finally {
      setTopicsLoading(false);
    }
  };

  const handleSelectTopic = (t: Topic) => {
    setTopic(t.topic);
    setTimeout(() => {
      bookSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setBookText("");
    setBookError(null);
    try {
      for await (const chunk of api.export.streamBook(masterId, topic.trim() || undefined)) {
        setBookText((prev) => prev + chunk);
        if (bookRef.current) {
          bookRef.current.scrollTop = bookRef.current.scrollHeight;
        }
      }
    } catch (e: any) {
      setBookError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyBook = async () => {
    if (!bookText) return;
    await navigator.clipboard.writeText(bookText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = async () => {
    if (!bookText || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const title = bookText.match(/^#\s+(.+)/m)?.[1] || `${masterName} — Knowledge Book`;
      const blob = await api.export.downloadPdf(masterId, title, bookText, true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.slice(0, 60).replace(/[^a-z0-9 ]/gi, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("PDF download failed:", e);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const completedSources = sources.filter(s => s.status === "completed");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Stats Section ── */}
      <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 24, boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <BarChart2 size={15} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Knowledge Base Stats</h2>
        </div>

        {statsLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", fontSize: 13, paddingBottom: 8 }}>
            <div style={{ width: 14, height: 14, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            Calculating…
          </div>
        )}
        {statsError && <p style={{ fontSize: 13, color: "var(--color-error)" }}>{statsError}</p>}

        {stats && !statsLoading && (
          <>
            {/* Big stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Words", value: stats.total_words.toLocaleString() },
                { label: "Est. Pages", value: stats.estimated_pages.toLocaleString() },
                { label: "Sources", value: stats.total_sources.toLocaleString() },
              ].map((s) => (
                <div key={s.label} style={{ background: "var(--surface-2)", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* By type breakdown */}
            {Object.entries(stats.by_type).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 8 }}>By Content Type</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(stats.by_type).map(([type, data]) => (
                    <div key={type} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: "var(--surface-2)", borderRadius: 8,
                      padding: "6px 10px", fontSize: 12,
                    }}>
                      <span>{CONTENT_TYPE_ICONS[type] || "◉"}</span>
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{CONTENT_TYPE_LABEL_MAP[type] || type}</span>
                      <span style={{ color: "var(--text-muted)" }}>{data.count} · {data.words.toLocaleString()} words</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-source expandable table */}
            <button
              onClick={() => setShowSourceTable((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12, color: "var(--text-muted)", fontWeight: 500, padding: 0,
              }}
            >
              {showSourceTable ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {showSourceTable ? "Hide" : "Show"} per-source breakdown
            </button>

            {showSourceTable && (
              <div style={{ marginTop: 12, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px 80px 36px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", padding: "8px 12px", gap: 0 }}>
                  {["Source", "Type", "Words", "Pages", ""].map((h, i) => (
                    <span key={i} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>{h}</span>
                  ))}
                </div>
                {stats.sources.map((s, i) => {
                  const src = completedSources.find(cs => cs.id === s.id);
                  return (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px 80px 36px", padding: "8px 12px", gap: 0, borderBottom: i < stats.sources.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
                      <div style={{ overflow: "hidden" }}>
                        <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.title && !s.title.startsWith("http") ? s.title : (s.url ? new URL(s.url).hostname : "Untitled")}
                        </p>
                        {s.author && <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.author}</p>}
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{CONTENT_TYPE_LABEL_MAP[s.content_type] || s.content_type}</span>
                      <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500 }}>{s.word_count.toLocaleString()}</span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.pages_estimate}</span>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        {src && (
                          <button
                            onClick={() => setViewingSource(src)}
                            title="View transcript"
                            style={{ padding: 4, borderRadius: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
                            onMouseOver={e => { (e.currentTarget.style.background = "var(--surface-3)"); (e.currentTarget.style.color = "var(--accent)"); }}
                            onMouseOut={e => { (e.currentTarget.style.background = "none"); (e.currentTarget.style.color = "var(--text-muted)"); }}
                          >
                            <FileText size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Topics Discovery Section ── */}
      <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 24, boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Layers size={15} style={{ color: "var(--accent)" }} />
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Discover Topics</h2>
          </div>
          <button
            onClick={handleDiscoverTopics}
            disabled={topicsLoading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 9,
              background: topicsLoading ? "var(--surface-3)" : "var(--surface-2)",
              border: "1px solid var(--border)",
              color: topicsLoading ? "var(--text-muted)" : "var(--text-secondary)",
              fontSize: 12, fontWeight: 600, cursor: topicsLoading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
            onMouseOver={e => { if (!topicsLoading) (e.currentTarget.style.background = "var(--surface-3)"); }}
            onMouseOut={e => { if (!topicsLoading) (e.currentTarget.style.background = "var(--surface-2)"); }}
          >
            {topicsLoading ? (
              <><div style={{ width: 10, height: 10, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Analysing…</>
            ) : (
              <>{topics.length > 0 ? "Re-analyse" : "Analyse Knowledge Base"}</>
            )}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: topics.length > 0 || topicsLoading ? 16 : 0, lineHeight: 1.6 }}>
          AI scans the entire knowledge base and surfaces the main themes. Click any topic to generate a focused book on it.
        </p>

        {topicsError && (
          <div style={{ padding: 10, borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error)", fontSize: 12 }}>{topicsError}</div>
        )}

        {topicsLoading && topics.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[120, 90, 140, 110, 100, 130].map((w, i) => (
              <div key={i} style={{ height: 60, width: w, borderRadius: 10, background: "var(--surface-2)", animation: "pulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}

        {topics.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {topics.map((t) => (
              <button
                key={t.topic}
                onClick={() => handleSelectTopic(t)}
                style={{
                  textAlign: "left", padding: "12px 14px", borderRadius: 12,
                  background: topic === t.topic ? "rgba(99,102,241,0.08)" : "var(--surface-2)",
                  border: `1.5px solid ${topic === t.topic ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseOver={e => { if (topic !== t.topic) (e.currentTarget.style.borderColor = "var(--accent)"); }}
                onMouseOut={e => { if (topic !== t.topic) (e.currentTarget.style.borderColor = "var(--border)"); }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{t.topic}</span>
                  <ArrowRight size={11} style={{ color: "var(--accent)", flexShrink: 0, opacity: topic === t.topic ? 1 : 0.4 }} />
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>{t.description}</p>
                {t.keywords?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                    {t.keywords.slice(0, 3).map((k) => (
                      <span key={k} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--surface-3)", color: "var(--text-muted)" }}>{k}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Book Generator Section ── */}
      <div ref={bookSectionRef} style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 24, boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <BookOpen size={15} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Generate Knowledge Book</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Claude will read the entire knowledge base and compile it into a structured, readable book with chapters, insights, and direct quotes.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            type="text"
            placeholder={`Topic focus (optional) — e.g. "leadership", "combat philosophy"…`}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !generating) handleGenerate(); }}
            disabled={generating}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--surface-2)",
              fontSize: 13, color: "var(--text-primary)", outline: "none",
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || statsLoading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 18px", borderRadius: 10,
              background: generating ? "var(--surface-3)" : "var(--accent)",
              border: "none", cursor: generating ? "not-allowed" : "pointer",
              color: generating ? "var(--text-muted)" : "#fff",
              fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
              transition: "background 0.15s",
            }}
          >
            {generating ? (
              <>
                <div style={{ width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Writing…
              </>
            ) : (
              <>
                <Sparkles size={13} />
                Generate Book
              </>
            )}
          </button>
        </div>

        {bookError && (
          <div style={{ padding: 12, borderRadius: 10, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error)", fontSize: 13, marginBottom: 16 }}>
            {bookError}
          </div>
        )}

        {(bookText || generating) && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {/* Book header bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                {generating ? "Generating…" : "Complete"}
                {bookText && ` · ${bookText.split(/\s+/).length.toLocaleString()} words`}
              </span>
              {bookText && !generating && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={downloadingPdf}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 10px", borderRadius: 7,
                      background: "transparent", border: "1px solid var(--border)",
                      color: "var(--text-secondary)", fontSize: 12, fontWeight: 500,
                      cursor: downloadingPdf ? "not-allowed" : "pointer",
                      opacity: downloadingPdf ? 0.6 : 1,
                    }}
                  >
                    {downloadingPdf
                      ? <><div style={{ width: 10, height: 10, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> PDF…</>
                      : <><Download size={11} /> PDF</>
                    }
                  </button>
                  <button
                    onClick={handleCopyBook}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 10px", borderRadius: 7,
                      background: copied ? "rgba(22,163,74,0.1)" : "transparent",
                      border: "1px solid var(--border)",
                      color: copied ? "var(--color-success)" : "var(--text-secondary)",
                      fontSize: 12, fontWeight: 500, cursor: "pointer",
                    }}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>

            {/* Book content */}
            <div
              ref={bookRef}
              style={{ padding: "24px 32px", maxHeight: 640, overflowY: "auto", background: "var(--surface)" }}
            >
              <MarkdownBlock text={bookText} />
              {generating && (
                <span style={{ display: "inline-block", width: 2, height: 14, background: "var(--accent)", animation: "blink 1s step-end infinite", marginLeft: 2, verticalAlign: "middle" }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Transcript viewer drawer */}
      <TranscriptViewer source={viewingSource} onClose={() => setViewingSource(null)} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
      `}</style>
    </div>
  );
}
