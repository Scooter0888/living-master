"use client";
import { useEffect, useState } from "react";
import { X, Copy, Check, FileText } from "lucide-react";
import { api, Source, TranscriptResponse } from "@/lib/api";
import { CONTENT_TYPE_LABELS, formatDuration } from "@/lib/utils";

interface TranscriptViewerProps {
  source: Source | null;
  onClose: () => void;
}

export function TranscriptViewer({ source, onClose }: TranscriptViewerProps) {
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!source) return;
    setTranscript(null);
    setError(null);
    setLoading(true);
    api.sources.getTranscript(source.id)
      .then(setTranscript)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [source?.id]);

  const handleCopy = async () => {
    if (!transcript?.text) return;
    await navigator.clipboard.writeText(transcript.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!source) return null;

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
        width: "min(700px, 92vw)",
        height: "100%",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flexShrink: 0,
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
                      <strong style={{ color: "var(--text-secondary)" }}>
                        {transcript.word_count.toLocaleString()}
                      </strong> words
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>≈
                      <strong style={{ color: "var(--text-secondary)" }}> {transcript.pages_estimate}</strong> pages
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      <strong style={{ color: "var(--text-secondary)" }}>{transcript.chunk_count}</strong> chunks
                    </span>
                  </>
                )}
                {source.author && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>by {source.author}</span>
                )}
                {source.duration_seconds && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDuration(source.duration_seconds)}</span>
                )}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {CONTENT_TYPE_LABELS[source.content_type] || source.content_type}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {transcript?.text && (
                <button
                  onClick={handleCopy}
                  title="Copy transcript"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 10px", borderRadius: 8,
                    background: copied ? "rgba(22,163,74,0.1)" : "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: copied ? "var(--color-success)" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                    transition: "all 0.15s",
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
            transcript.text ? (
              <pre style={{
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.75,
                color: "var(--text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
              }}>
                {transcript.text}
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
