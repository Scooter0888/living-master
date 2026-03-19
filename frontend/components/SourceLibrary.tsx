"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2, ExternalLink, RefreshCw, CheckCircle2, XCircle, Clock, Loader2, FileText, Users, Film, RotateCcw, Upload } from "lucide-react";
import { api, Source } from "@/lib/api";
import { CONTENT_TYPE_ICONS, CONTENT_TYPE_LABELS, formatDuration, formatRelativeTime } from "@/lib/utils";
import { TranscriptViewer } from "./TranscriptViewer";
import { SpeakerIdentifier } from "./SpeakerIdentifier";

interface SourceLibraryProps {
  sources: Source[];
  masterId: string;
  masterName?: string;
  onDeleted: () => void;
  onRefresh: () => void;
  initialViewSource?: Source | null;
}

function humanizeError(raw: string): string {
  const e = raw.toLowerCase();
  if (e.includes("expected embeddings") || e.includes("non-empty list") || e.includes("got [] in add"))
    return "No verbal dialogue — clip has no speech for transcription";
  if (e.includes("transcript too short") || e.includes("too short to be useful"))
    return "Transcript too short to be useful";
  if (e.includes("no transcripts available") || e.includes("transcriptsdisabled"))
    return "No captions available and audio transcription failed";
  if (e.includes("403") || e.includes("forbidden"))
    return "Access blocked — this site doesn't allow scraping";
  if (e.includes("404") || e.includes("not found"))
    return "Page no longer exists";
  if (e.includes("timeout") || e.includes("timed out"))
    return "Request timed out — site took too long to respond";
  if (e.includes("could not extract meaningful content"))
    return "Page has no readable text content";
  if (e.includes("wikipedia api returned no content"))
    return "Wikipedia returned no article content";
  if (e.includes("no text could be extracted"))
    return "No text could be extracted from this source";
  if (e.includes("could not access url"))
    return "URL is inaccessible or blocked";
  if (e.includes("ffmpeg") || e.includes("audio extraction failed"))
    return "Audio extraction failed — check ffmpeg is installed";
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

function StatusIcon({ status }: { status: Source["status"] }) {
  if (status === "completed") return <CheckCircle2 size={15} style={{ color: "var(--color-success)", flexShrink: 0 }} />;
  if (status === "failed")    return <XCircle size={15} style={{ color: "var(--color-error)", flexShrink: 0 }} />;
  if (status === "processing") return <Loader2 size={15} style={{ color: "var(--color-info)", flexShrink: 0, animation: "spin 1s linear infinite" }} />;
  if (status === "needs_speaker_id") return <Users size={15} style={{ color: "var(--color-warning)", flexShrink: 0 }} />;
  return <Clock size={15} style={{ color: "var(--color-warning)", flexShrink: 0 }} />;
}

export function SourceLibrary({ sources, masterId, masterName = "Master", onDeleted, onRefresh, initialViewSource }: SourceLibraryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reingestingId, setReingestingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [reuploadingId, setReuploadingId] = useState<string | null>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);
  const reuploadTargetRef = useRef<Source | null>(null);
  const [viewingSource, setViewingSource] = useState<Source | null>(initialViewSource ?? null);
  const [speakerSource, setSpeakerSource] = useState<Source | null>(null);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [autoIdentifying, setAutoIdentifying] = useState(false);
  const [autoIdentifyResult, setAutoIdentifyResult] = useState<{ queued: number; low_confidence: number; message: string } | null>(null);
  const [autoIdentifyError, setAutoIdentifyError] = useState<string | null>(null);
  const hasProcessing = sources.some((s) => s.status === "processing" || s.status === "pending" || s.status === "needs_speaker_id");

  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(onRefresh, 3000);
    return () => clearInterval(interval);
  }, [hasProcessing, onRefresh]);

  const handleDelete = async (source: Source) => {
    if (!confirm(`Remove "${source.title || source.url}"?`)) return;
    setDeletingId(source.id);
    try { await api.ingest.deleteSource(masterId, source.id); onDeleted(); }
    catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  };

  const handleReingest = async (source: Source) => {
    setReingestingId(source.id);
    try { await api.ingest.reingestSource(masterId, source.id); setTimeout(onRefresh, 500); }
    catch (e) { console.error(e); }
    finally { setReingestingId(null); }
  };

  const handleRetryAllFailed = async () => {
    setRetryingAll(true);
    try { await api.ingest.retryAllFailed(masterId); setTimeout(onRefresh, 800); }
    catch (e) { console.error(e); }
    finally { setRetryingAll(false); }
  };

  const handleReupload = (source: Source) => {
    reuploadTargetRef.current = source;
    reuploadInputRef.current?.click();
  };

  const handleReuploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const source = reuploadTargetRef.current;
    if (!file || !source) return;
    e.target.value = "";
    setReuploadingId(source.id);
    try {
      // Delete the old failed entry, then upload the new file
      await api.ingest.deleteSource(masterId, source.id);
      await api.ingest.file(masterId, file);
      setTimeout(onRefresh, 500);
    } catch (err) { console.error(err); }
    finally { setReuploadingId(null); reuploadTargetRef.current = null; }
  };

  const handleAutoIdentify = async () => {
    setAutoIdentifying(true);
    setAutoIdentifyResult(null);
    setAutoIdentifyError(null);
    try {
      const res = await api.voice.autoIdentifyAll(masterId);
      setAutoIdentifyResult({ queued: res.queued, low_confidence: res.low_confidence ?? 0, message: res.message });
      if (res.queued > 0) setTimeout(onRefresh, 2000);
    } catch (e: any) {
      setAutoIdentifyError(e.message || "Auto-identify failed");
    } finally {
      setAutoIdentifying(false);
    }
  };

  const handleAnalyseMovements = async (source: Source) => {
    setAnalysingId(source.id);
    try {
      await api.export.analyseMovements(masterId, source.id);
      setTimeout(onRefresh, 1000);
    } catch (e) { console.error(e); }
    finally { setAnalysingId(null); }
  };

  if (sources.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 0", gap: 8, textAlign: "center" }}>
      <div style={{ fontSize: 28, opacity: 0.2 }}>◉</div>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No sources yet — add a URL or upload a file</p>
    </div>
  );

  const completed = sources.filter(s => s.status === "completed").length;
  const failed = sources.filter(s => s.status === "failed").length;
  const active = sources.filter(s => s.status === "pending" || s.status === "processing").length;

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--color-success)", fontWeight: 600 }}>{completed}</span> ready
            {failed > 0 && <><span style={{ margin: "0 4px", opacity: 0.4 }}>·</span><span style={{ color: "var(--color-error)", fontWeight: 600 }}>{failed}</span> failed</>}
            {active > 0 && <><span style={{ margin: "0 4px", opacity: 0.4 }}>·</span><span style={{ color: "var(--color-info)", fontWeight: 600 }}>{active}</span> processing</>}
          </span>
          {failed > 0 && (
            <button
              onClick={handleRetryAllFailed}
              disabled={retryingAll}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                background: "var(--color-error-bg)", border: "1px solid rgba(248,113,113,0.25)",
                color: "var(--color-error)", cursor: retryingAll ? "not-allowed" : "pointer",
                opacity: retryingAll ? 0.6 : 1, transition: "opacity 0.15s",
              }}
            >
              <RotateCcw size={11} style={{ animation: retryingAll ? "spin 1s linear infinite" : "none" }} />
              {retryingAll ? "Retrying…" : `Retry all ${failed} failed`}
            </button>
          )}
        </div>
        <button onClick={onRefresh} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4, borderRadius: 6 }}>
          <RefreshCw size={12} style={{ animation: hasProcessing ? "spin 1.5s linear infinite" : "none" }} />
        </button>
      </div>

      {/* Auto-identify banner — shown when there are unidentified diarized sources */}
      {(() => {
        const unidentified = sources.filter(
          s => s.has_diarization && !s.speaker_label && (s.status === "completed" || s.status === "needs_speaker_id")
        );
        if (unidentified.length === 0 && !autoIdentifyResult && !autoIdentifyError) return null;
        return (
          <div style={{
            marginBottom: 14, padding: "12px 14px", borderRadius: 10,
            background: autoIdentifyResult ? "rgba(22,163,74,0.06)" : "rgba(99,102,241,0.06)",
            border: `1px solid ${autoIdentifyResult ? "rgba(22,163,74,0.2)" : "rgba(99,102,241,0.2)"}`,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {autoIdentifyResult ? (
                <p style={{ fontSize: 12.5, color: "var(--color-success, #16a34a)", margin: 0, fontWeight: 500 }}>
                  {autoIdentifyResult.message}
                </p>
              ) : autoIdentifyError ? (
                <p style={{ fontSize: 12.5, color: "var(--color-error)", margin: 0 }}>{autoIdentifyError}</p>
              ) : (
                <>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 2px" }}>
                    <Users size={12} style={{ display: "inline", marginRight: 5, verticalAlign: "middle" }} />
                    {unidentified.length} source{unidentified.length !== 1 ? "s" : ""} need speaker identification
                  </p>
                  <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: 0 }}>
                    Once you&apos;ve identified {masterName} in one source, click to auto-label the rest.
                  </p>
                </>
              )}
            </div>
            {!autoIdentifyResult && (
              <button
                onClick={handleAutoIdentify}
                disabled={autoIdentifying}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                  padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)",
                  color: "#6366f1", cursor: autoIdentifying ? "not-allowed" : "pointer",
                  opacity: autoIdentifying ? 0.6 : 1, transition: "opacity 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                <Users size={12} style={{ animation: autoIdentifying ? "spin 1s linear infinite" : "none" }} />
                {autoIdentifying ? "Identifying…" : `Auto-identify ${masterName}`}
              </button>
            )}
          </div>
        );
      })()}

      {/* Table */}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 80px minmax(180px, 1fr) 68px",
          gap: 0,
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
          padding: "8px 14px",
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Source</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Notes</span>
          <span />
        </div>

        {/* Rows */}
        <div>
          {sources.map((source, i) => (
            <SourceRow
              key={source.id}
              source={source}
              isLast={i === sources.length - 1}
              deleting={deletingId === source.id}
              reingesting={reingestingId === source.id}
              reuploading={reuploadingId === source.id}
              analysing={analysingId === source.id}
              onDelete={() => handleDelete(source)}
              onReingest={source.url && (source.status === "completed" || source.status === "failed") ? () => handleReingest(source) : undefined}
              onReupload={!source.url && source.status === "failed" ? () => handleReupload(source) : undefined}
              onViewTranscript={source.status === "completed" ? () => setViewingSource(source) : undefined}
              onIdentifySpeaker={source.status === "needs_speaker_id" ? () => setSpeakerSource(source) : undefined}
              onAnalyseMovements={
                (source.status === "completed" && ["video", "youtube"].includes(source.content_type) && !source.has_movement_analysis)
                  ? () => handleAnalyseMovements(source)
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {/* Hidden file input for re-uploading failed file sources */}
      <input
        ref={reuploadInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.mp4,.mkv,.mov,.vob,.iso,.pdf,.docx"
        style={{ display: "none" }}
        onChange={handleReuploadFile}
      />

      <TranscriptViewer source={viewingSource} onClose={() => setViewingSource(null)} />

      {speakerSource && (
        <SpeakerIdentifier
          source={speakerSource}
          masterId={masterId}
          masterName={masterName}
          onConfirmed={() => { setSpeakerSource(null); onRefresh(); }}
          onClose={() => setSpeakerSource(null)}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes progress-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        .src-row:hover { background: var(--surface-2) !important; }
        .src-row:hover .src-del { opacity: 1 !important; }
        .src-row:hover .src-view { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

function SourceRow({ source, isLast, deleting, reingesting, reuploading, analysing, onDelete, onReingest, onReupload, onViewTranscript, onIdentifySpeaker, onAnalyseMovements }: {
  source: Source;
  isLast: boolean;
  deleting: boolean;
  reingesting?: boolean;
  reuploading?: boolean;
  analysing?: boolean;
  onDelete: () => void;
  onReingest?: () => void;
  onReupload?: () => void;
  onViewTranscript?: () => void;
  onIdentifySpeaker?: () => void;
  onAnalyseMovements?: () => void;
}) {
  const title = source.title && !source.title.startsWith("http") ? source.title : null;
  const displayTitle = title || (source.url ? new URL(source.url).hostname + new URL(source.url).pathname.slice(0, 30) : "Untitled");

  const meta: string[] = [];
  if (source.author) meta.push(source.author);
  if (source.duration_seconds) meta.push(formatDuration(source.duration_seconds));
  if ((source.chunk_count ?? 0) > 0) meta.push(`${source.chunk_count} chunks`);
  meta.push(formatRelativeTime(source.created_at));

  const note = source.status === "failed" && source.error_message
    ? humanizeError(source.error_message)
    : source.status === "pending" ? "Queued…"
    : source.status === "processing" ? (source.processing_stage || "Processing…")
    : source.status === "needs_speaker_id" ? `${source.speaker_count || "Multiple"} speakers detected — identify the master`
    : "";

  return (
    <div
      className="src-row"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 80px 160px 68px",
        gap: 0,
        padding: "10px 14px",
        alignItems: "center",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        background: "transparent",
        transition: "background 0.12s",
      }}
    >
      {/* Title + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, flexShrink: 0, color: "var(--text-muted)" }}>
            {CONTENT_TYPE_ICONS[source.content_type] || "◉"}
          </span>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayTitle}
          </p>
          {source.url && (
            <a href={source.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ flexShrink: 0, color: "var(--text-muted)", display: "flex", textDecoration: "none" }}
              title={source.url}>
              <ExternalLink size={11} />
            </a>
          )}
        </div>
        {meta.length > 0 && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, paddingLeft: 19 }}>
            {CONTENT_TYPE_LABELS[source.content_type]}{meta.length > 0 ? " · " + meta.join(" · ") : ""}
          </p>
        )}
        {/* Progress bar — shown while processing or pending with a known pct */}
        {(source.status === "processing" || source.status === "pending") && (
          <div style={{ paddingLeft: 19, marginTop: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                flex: 1, height: 4, borderRadius: 99,
                background: "var(--surface-2)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  borderRadius: 99,
                  background: "var(--accent)",
                  width: source.progress_pct != null ? `${source.progress_pct}%` : "0%",
                  transition: "width 0.6s ease",
                  // Animate as indeterminate if pending with no pct
                  ...(source.status === "pending" && source.progress_pct == null ? {
                    width: "30%",
                    animation: "progress-slide 1.4s ease-in-out infinite",
                    background: "var(--border-hover)",
                  } : {}),
                }} />
              </div>
              {source.progress_pct != null && (
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", flexShrink: 0, minWidth: 26, textAlign: "right" }}>
                  {source.progress_pct}%
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <StatusIcon status={source.status} />
        <span style={{
          fontSize: 11, fontWeight: 500,
          color: source.status === "completed" ? "var(--color-success)"
               : source.status === "failed" ? "var(--color-error)"
               : source.status === "processing" ? "var(--color-info)"
               : source.status === "needs_speaker_id" ? "var(--color-warning)"
               : "var(--color-warning)",
        }}>
          {source.status === "completed" ? "Ready"
         : source.status === "failed" ? "Failed"
         : source.status === "processing" ? "Processing"
         : source.status === "needs_speaker_id" ? "ID Speaker"
         : "Pending"}
        </span>
      </div>

      {/* Notes */}
      <div style={{ paddingRight: 8 }}>
        {note && (
          <p style={{
            fontSize: 11,
            color: source.status === "failed" ? "var(--color-error)"
                 : source.status === "pending" || source.status === "processing" ? "var(--text-muted)"
                 : "var(--text-muted)",
            lineHeight: 1.4,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}>
            {note}
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
        {onIdentifySpeaker && (
          <button
            onClick={onIdentifySpeaker}
            title="Identify which speaker is the master"
            style={{
              padding: 5, borderRadius: 6, background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)",
              cursor: "pointer", color: "var(--color-warning)", display: "flex", transition: "all 0.12s",
            }}
          >
            <Users size={12} />
          </button>
        )}
        {onAnalyseMovements && (
          <button
            className="src-view"
            onClick={onAnalyseMovements}
            disabled={analysing}
            title="Analyse movements with Claude Vision"
            style={{
              padding: 5, borderRadius: 6, background: "none", border: "none",
              cursor: analysing ? "not-allowed" : "pointer", color: "var(--text-muted)", display: "flex",
              opacity: 0, transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseOver={e => { (e.currentTarget.style.color = "var(--color-purple)"); (e.currentTarget.style.background = "var(--color-purple-bg)"); }}
            onMouseOut={e => { (e.currentTarget.style.color = "var(--text-muted)"); (e.currentTarget.style.background = "none"); }}
          >
            {analysing ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Film size={12} />}
          </button>
        )}
        {source.has_movement_analysis && (
          <span title="Movement analysis complete" style={{ padding: 5, display: "flex", color: "var(--color-purple)" }}>
            <Film size={12} />
          </span>
        )}
        {onReupload && (
          <button
            onClick={onReupload}
            disabled={reuploading}
            title="Upload file again to retry"
            style={{
              padding: 5, borderRadius: 6, border: "none",
              cursor: reuploading ? "not-allowed" : "pointer", display: "flex",
              background: "rgba(59,130,246,0.08)", color: "var(--color-info)", opacity: 1,
            }}
            onMouseOver={e => { (e.currentTarget.style.background = "rgba(59,130,246,0.15)"); }}
            onMouseOut={e => { (e.currentTarget.style.background = "rgba(59,130,246,0.08)"); }}
          >
            {reuploading ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={12} />}
          </button>
        )}
        {onReingest && (
          <button
            className={source.status === "failed" ? undefined : "src-view"}
            onClick={onReingest}
            disabled={reingesting}
            title="Re-ingest (re-transcribe and re-index)"
            style={{
              padding: 5, borderRadius: 6, border: "none",
              cursor: reingesting ? "not-allowed" : "pointer", display: "flex",
              // Always visible on failed, hover-only on completed
              ...(source.status === "failed"
                ? { background: "rgba(59,130,246,0.08)", color: "var(--color-info)", opacity: 1 }
                : { background: "none", color: "var(--text-muted)", opacity: 0, transition: "opacity 0.12s, color 0.12s" }
              ),
            }}
            onMouseOver={e => { (e.currentTarget.style.color = "var(--color-info)"); (e.currentTarget.style.background = "rgba(59,130,246,0.08)"); }}
            onMouseOut={e => {
              if (source.status !== "failed") { (e.currentTarget.style.color = "var(--text-muted)"); (e.currentTarget.style.background = "none"); }
            }}
          >
            {reingesting ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={12} />}
          </button>
        )}
        {onViewTranscript && (
          <button
            className="src-view"
            onClick={onViewTranscript}
            title="View transcript"
            style={{
              padding: 5, borderRadius: 6, background: "none", border: "none",
              cursor: "pointer", color: "var(--text-muted)", display: "flex",
              opacity: 0, transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseOver={e => { (e.currentTarget.style.color = "var(--accent)"); (e.currentTarget.style.background = "rgba(99,102,241,0.08)"); }}
            onMouseOut={e => { (e.currentTarget.style.color = "var(--text-muted)"); (e.currentTarget.style.background = "none"); }}
          >
            <FileText size={12} />
          </button>
        )}
        <button
          className="src-del"
          onClick={onDelete}
          disabled={deleting}
          style={{
            padding: 5, borderRadius: 6, background: "none", border: "none",
            cursor: "pointer", color: "var(--text-muted)", display: "flex",
            opacity: 0, transition: "opacity 0.12s, color 0.12s",
          }}
          onMouseOver={e => { (e.currentTarget.style.color = "var(--color-error)"); (e.currentTarget.style.background = "var(--color-error-bg)"); }}
          onMouseOut={e => { (e.currentTarget.style.color = "var(--text-muted)"); (e.currentTarget.style.background = "none"); }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
