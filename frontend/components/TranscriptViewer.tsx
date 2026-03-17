"use client";
import { useEffect, useState, useRef } from "react";
import { X, Copy, Check, FileText, Users, Languages, ChevronDown, RotateCcw } from "lucide-react";
import { api, Source, TranscriptResponse, TranscriptSegment } from "@/lib/api";
import { CONTENT_TYPE_LABELS, formatDuration } from "@/lib/utils";

const LANGUAGES = [
  "English", "Spanish", "French", "German", "Portuguese", "Italian",
  "Dutch", "Russian", "Chinese (Simplified)", "Chinese (Traditional)",
  "Japanese", "Korean", "Arabic", "Hindi", "Turkish", "Polish",
  "Ukrainian", "Swedish", "Norwegian", "Danish",
];

interface TranscriptViewerProps {
  source: Source | null;
  masterName?: string;
  onClose: () => void;
}

function buildSpeakerLabels(
  segments: TranscriptSegment[],
  masterSpeakerLabel: string | undefined,
  masterName: string | undefined,
): Record<string, string> {
  const seen: string[] = [];
  for (const seg of segments) {
    if (seg.speaker && !seen.includes(seg.speaker)) seen.push(seg.speaker);
  }
  const labels: Record<string, string> = {};
  let otherIndex = 1;
  for (const id of seen) {
    if (masterSpeakerLabel && id === masterSpeakerLabel) {
      labels[id] = masterName || "Mikhail";
    } else {
      labels[id] = otherIndex === 1 ? "Interviewer" : `Speaker ${otherIndex + 1}`;
      otherIndex++;
    }
  }
  return labels;
}

const SPEAKER_COLORS = [
  { bg: "rgba(99,102,241,0.07)", border: "rgba(99,102,241,0.25)", name: "#6366f1" },
  { bg: "rgba(20,184,166,0.07)", border: "rgba(20,184,166,0.25)", name: "#14b8a6" },
  { bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.25)", name: "#f59e0b" },
  { bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.25)", name: "#ef4444" },
  { bg: "rgba(34,197,94,0.07)", border: "rgba(34,197,94,0.25)", name: "#22c55e" },
  { bg: "rgba(168,85,247,0.07)", border: "rgba(168,85,247,0.25)", name: "#a855f7" },
];
function getSpeakerColor(index: number) { return SPEAKER_COLORS[index % SPEAKER_COLORS.length]; }

interface SpeakerBlock { speaker?: string; label: string; colorIndex: number; texts: string[]; }

function groupSegments(segments: TranscriptSegment[], speakerLabels: Record<string, string>): SpeakerBlock[] {
  const colorMap: Record<string, number> = {};
  let nextColor = 0;
  const getColor = (id: string) => { if (!(id in colorMap)) colorMap[id] = nextColor++; return colorMap[id]; };
  const blocks: SpeakerBlock[] = [];
  for (const seg of segments) {
    const label = seg.speaker ? (speakerLabels[seg.speaker] || seg.speaker) : "Unknown";
    const colorIndex = seg.speaker ? getColor(seg.speaker) : 0;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === seg.speaker) { last.texts.push(seg.text); }
    else { blocks.push({ speaker: seg.speaker, label, colorIndex, texts: [seg.text] }); }
  }
  return blocks;
}

export function TranscriptViewer({ source, masterName, onClose }: TranscriptViewerProps) {
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Translation state
  const [selectedLang, setSelectedLang] = useState("");
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translatedSegments, setTranslatedSegments] = useState<TranscriptSegment[] | null>(null);
  const [translatedLanguage, setTranslatedLanguage] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  // Cache translations: lang → { text, segments }
  const translationCache = useRef<Record<string, { text: string; segments: TranscriptSegment[] }>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!source) return;
    setTranscript(null);
    setError(null);
    setLoading(true);
    setTranslatedText(null);
    setTranslatedSegments(null);
    setTranslatedLanguage(null);
    setShowOriginal(false);
    setSelectedLang("");
    translationCache.current = {};
    api.sources.getTranscript(source.id)
      .then(setTranscript)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [source?.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleTranslate = async () => {
    if (!selectedLang || !source) return;
    setTranslateError(null);

    // Use cache if available
    if (translationCache.current[selectedLang]) {
      const cached = translationCache.current[selectedLang];
      setTranslatedText(cached.text);
      setTranslatedSegments(cached.segments);
      setTranslatedLanguage(selectedLang);
      setShowOriginal(false);
      return;
    }

    setTranslating(true);
    try {
      const result = await api.sources.translate(source.id, selectedLang);
      translationCache.current[selectedLang] = { text: result.text, segments: result.segments };
      setTranslatedText(result.text);
      setTranslatedSegments(result.segments);
      setTranslatedLanguage(selectedLang);
      setShowOriginal(false);
    } catch (e: any) {
      setTranslateError(e.message || "Translation failed");
    } finally {
      setTranslating(false);
    }
  };

  const handleCopy = async () => {
    const text = showOriginal ? transcript?.text : (translatedText || transcript?.text);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!source) return null;

  // Decide what content to show
  const isShowingTranslation = !!translatedLanguage && !showOriginal;
  const displayText = isShowingTranslation ? translatedText : transcript?.text;
  const displaySegments = isShowingTranslation
    ? (translatedSegments && translatedSegments.length > 0 ? translatedSegments : null)
    : (transcript?.segments && transcript.segments.length > 0 ? transcript.segments : null);
  const hasDiarization = !!(transcript?.has_diarization && transcript?.segments?.length);
  const activeSegments = hasDiarization ? (displaySegments || transcript?.segments || []) : [];
  const speakerLabels = hasDiarization
    ? buildSpeakerLabels(activeSegments, transcript!.speaker_label, masterName)
    : {};
  const blocks = hasDiarization ? groupSegments(activeSegments, speakerLabels) : [];
  const uniqueSpeakerEntries = Object.entries(speakerLabels);

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <div style={{
        width: "min(700px, 92vw)", height: "100%",
        background: "var(--surface)", borderLeft: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <h2 style={{
                  fontSize: 15, fontWeight: 600, color: "var(--text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {source.title && !source.title.startsWith("http") ? source.title : "Transcript"}
                </h2>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {transcript && (
                  <>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      <strong style={{ color: "var(--text-secondary)" }}>{transcript.word_count.toLocaleString()}</strong> words
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>≈
                      <strong style={{ color: "var(--text-secondary)" }}> {transcript.pages_estimate}</strong> pages
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      <strong style={{ color: "var(--text-secondary)" }}>{transcript.chunk_count}</strong> chunks
                    </span>
                  </>
                )}
                {source.author && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>by {source.author}</span>}
                {source.duration_seconds && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDuration(source.duration_seconds)}</span>}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{CONTENT_TYPE_LABELS[source.content_type] || source.content_type}</span>
              </div>

              {/* Speaker legend */}
              {hasDiarization && uniqueSpeakerEntries.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                  <Users size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  {uniqueSpeakerEntries.map(([id, label], idx) => {
                    const color = getSpeakerColor(idx);
                    return (
                      <span key={id} style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                        background: color.bg, border: `1px solid ${color.border}`, color: color.name,
                      }}>{label}</span>
                    );
                  })}
                </div>
              )}

              {/* Translation status badge */}
              {isShowingTranslation && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20,
                    background: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.25)",
                    color: "#0d9488", display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <Languages size={10} /> Translated · {translatedLanguage}
                  </span>
                  <button
                    onClick={() => setShowOriginal(v => !v)}
                    style={{
                      fontSize: 11, color: "var(--text-muted)", background: "none", border: "none",
                      cursor: "pointer", padding: "2px 4px", textDecoration: "underline",
                    }}
                  >
                    Show original
                  </button>
                </div>
              )}
              {showOriginal && translatedLanguage && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20,
                    background: "var(--surface-2)", border: "1px solid var(--border)",
                    color: "var(--text-secondary)",
                  }}>Original</span>
                  <button
                    onClick={() => setShowOriginal(false)}
                    style={{
                      fontSize: 11, color: "var(--text-muted)", background: "none", border: "none",
                      cursor: "pointer", padding: "2px 4px", textDecoration: "underline",
                    }}
                  >
                    Back to translation
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {(displayText || transcript?.text) && (
                <button
                  onClick={handleCopy}
                  title="Copy transcript"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 10px", borderRadius: 8,
                    background: copied ? "rgba(22,163,74,0.1)" : "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: copied ? "var(--color-success)" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
              <button
                onClick={onClose}
                style={{
                  padding: 6, borderRadius: 8,
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", cursor: "pointer", display: "flex",
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Translation toolbar */}
          {transcript && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <Languages size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>Translate to:</span>

              {/* Language dropdown */}
              <div ref={dropdownRef} style={{ position: "relative", flex: 1, maxWidth: 220 }}>
                <button
                  onClick={() => setLangDropdownOpen(v => !v)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 6, padding: "5px 10px", borderRadius: 8,
                    background: "var(--surface-2)", border: "1px solid var(--border)",
                    color: selectedLang ? "var(--text-primary)" : "var(--text-muted)",
                    fontSize: 12, cursor: "pointer",
                  }}
                >
                  <span>{selectedLang || "Select language…"}</span>
                  <ChevronDown size={12} style={{ opacity: 0.5, flexShrink: 0, transform: langDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {langDropdownOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                    zIndex: 100, maxHeight: 260, overflowY: "auto",
                  }}>
                    {LANGUAGES.map(lang => (
                      <button
                        key={lang}
                        onClick={() => { setSelectedLang(lang); setLangDropdownOpen(false); }}
                        style={{
                          width: "100%", textAlign: "left", padding: "8px 12px",
                          background: lang === selectedLang ? "var(--surface-2)" : "transparent",
                          border: "none", color: "var(--text-primary)", fontSize: 12.5,
                          cursor: "pointer", display: "block",
                        }}
                        onMouseOver={e => { e.currentTarget.style.background = "var(--surface-2)"; }}
                        onMouseOut={e => { if (lang !== selectedLang) e.currentTarget.style.background = "transparent"; }}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleTranslate}
                disabled={!selectedLang || translating}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 8, flexShrink: 0,
                  background: selectedLang && !translating ? "var(--accent)" : "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: selectedLang && !translating ? "#fff" : "var(--text-muted)",
                  fontSize: 12, fontWeight: 500,
                  cursor: selectedLang && !translating ? "pointer" : "not-allowed",
                  opacity: !selectedLang || translating ? 0.6 : 1,
                  transition: "all 0.15s",
                }}
              >
                {translating ? (
                  <>
                    <div style={{ width: 10, height: 10, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Translating…
                  </>
                ) : (
                  <>
                    {translationCache.current[selectedLang] ? <RotateCcw size={11} /> : <Languages size={11} />}
                    {translationCache.current[selectedLang] ? "Show" : "Translate"}
                  </>
                )}
              </button>
            </div>
          )}

          {translateError && (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error)", fontSize: 12 }}>
              {translateError}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10, color: "var(--text-muted)", fontSize: 14 }}>
              <div style={{ width: 16, height: 16, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Loading transcript…
            </div>
          )}
          {error && (
            <div style={{ padding: 16, borderRadius: 10, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {transcript && !loading && (
            hasDiarization && blocks.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {blocks.map((block, i) => {
                  const color = getSpeakerColor(block.colorIndex);
                  return (
                    <div key={i} style={{ borderLeft: `3px solid ${color.border}`, paddingLeft: 14 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: color.name,
                        marginBottom: 6, letterSpacing: "0.02em", textTransform: "uppercase",
                      }}>
                        {block.label}
                      </div>
                      <p style={{
                        fontSize: 13.5, lineHeight: 1.75, color: "var(--text-primary)",
                        margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      }}>
                        {block.texts.join(" ")}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : displayText ? (
              <pre style={{
                fontFamily: "inherit", fontSize: 13, lineHeight: 1.75,
                color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0,
              }}>
                {displayText}
              </pre>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", paddingTop: 80 }}>
                No text content available for this source.
              </div>
            )
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
