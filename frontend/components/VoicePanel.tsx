"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Mic, MicOff, Loader2, CheckCircle2, AlertCircle, Play, Square } from "lucide-react";
import { api, Master, VoiceStatus, EdgeVoice } from "@/lib/api";

interface VoicePanelProps {
  master: Master;
  onVoiceReady?: () => void;
}

type PanelTab = "select" | "clone";

export function VoicePanel({ master, onVoiceReady }: VoicePanelProps) {
  const [tab, setTab] = useState<PanelTab>("select");
  const [status, setStatus] = useState<VoiceStatus>({
    voice_status: (master.voice_status as VoiceStatus["voice_status"]) || "none",
    voice_id: master.voice_id,
  });

  // Voice picker state
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(master.voice_id || "");
  const [selecting, setSelecting] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clone state
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [cloneMessage, setCloneMessage] = useState("");
  const [selectError, setSelectError] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.voice.getStatus(master.id);
      setStatus(s);
      if (s.voice_id) setSelectedVoiceId(s.voice_id);
      if (s.voice_status === "ready" && onVoiceReady) onVoiceReady();
      return s.voice_status;
    } catch { return "none"; }
  }, [master.id, onVoiceReady]);

  // Load voice catalog
  useEffect(() => {
    setVoicesLoading(true);
    api.voice.getVoices(master.id)
      .then(r => setVoices(r.voices))
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
  }, [master.id]);

  // Poll while cloning
  useEffect(() => {
    if (status.voice_status !== "cloning") return;
    const interval = setInterval(async () => {
      const s = await refreshStatus();
      if (s !== "cloning") {
        clearInterval(interval);
        setCloning(false);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [status.voice_status, refreshStatus]);

  const handleSelectVoice = async (voiceId: string) => {
    setSelecting(true);
    setSelectError("");
    try {
      await api.voice.selectVoice(master.id, voiceId);
      setSelectedVoiceId(voiceId);
      await refreshStatus();
    } catch (e: any) {
      setSelectError(e.message || "Failed to select voice");
    } finally {
      setSelecting(false);
    }
  };

  const handlePreview = async (voiceName: string, voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewingId === voiceId) {
      // Stop
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    setPreviewingId(voiceId);
    try {
      const blob = await api.voice.previewVoice(master.id, voiceName);
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPreviewingId(null); URL.revokeObjectURL(url); };
      audio.onerror = () => setPreviewingId(null);
      await audio.play();
    } catch { setPreviewingId(null); }
  };

  const handleClone = async () => {
    setCloning(true);
    setCloneError("");
    setCloneMessage("");
    try {
      const res = await api.voice.clone(master.id);
      if (res?.status === "ready") {
        await refreshStatus();
        setCloning(false);
      } else {
        setCloneMessage(res?.message || "Cloning started…");
        setStatus(prev => ({ ...prev, voice_status: "cloning" }));
      }
    } catch (e: any) {
      setCloneError(e.message || "Clone failed");
      setCloning(false);
    }
  };

  const activeVoiceIsEdge = status.voice_id?.startsWith("edge:");
  const activeVoiceIsClone = status.voice_id && !activeVoiceIsEdge;
  const isReady = status.voice_status === "ready";

  // Find active edge voice metadata for display
  const activeEdgeVoice = voices.find(v => `edge:${v.id}` === status.voice_id);

  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Mic size={15} style={{ color: "var(--accent)" }} />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Voice</h3>
          {isReady && (
            <span style={{
              marginLeft: "auto", fontSize: 10.5, fontWeight: 600, padding: "2px 8px",
              borderRadius: 20, background: "var(--color-success-bg, rgba(22,163,74,0.08))",
              color: "var(--color-success)", border: "1px solid rgba(22,163,74,0.2)",
            }}>
              {activeEdgeVoice ? activeEdgeVoice.name : activeVoiceIsClone ? "Cloned" : "Ready"}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {(["select", "clone"] as PanelTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: tab === t ? 600 : 500,
                background: "transparent", border: "none",
                color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
                cursor: "pointer", transition: "color 0.12s",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t === "select" ? "Select Voice" : "Clone Voice"}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Select Voice */}
      {tab === "select" && (
        <div style={{ padding: "14px 20px 18px" }}>
          <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
            Choose a free preset voice. Click ▶ to preview. Click the row to select.
          </p>

          {selectError && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6,
              padding: "8px 10px", borderRadius: 8, marginBottom: 10,
              background: "var(--color-error-bg)", border: "1px solid rgba(248,113,113,0.2)",
              color: "var(--color-error)", fontSize: 11.5, lineHeight: 1.5,
            }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              {selectError}
            </div>
          )}

          {voicesLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {voices.map(v => {
                const vId = `edge:${v.id}`;
                const isActive = selectedVoiceId === vId && isReady;
                const isPreviewing = previewingId === vId;
                return (
                  <div
                    key={v.id}
                    onClick={() => handleSelectVoice(vId)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", borderRadius: 10, cursor: "pointer",
                      background: isActive ? "var(--accent-dim)" : "var(--surface-2)",
                      border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                      transition: "all 0.12s",
                    }}
                    onMouseOver={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-3)"; }}
                    onMouseOut={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-2)"; }}
                  >
                    {/* Preview button */}
                    <button
                      onClick={(e) => handlePreview(v.id, vId, e)}
                      style={{
                        width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isPreviewing ? "var(--accent)" : "var(--surface)",
                        border: `1px solid ${isPreviewing ? "var(--accent)" : "var(--border)"}`,
                        color: isPreviewing ? "#fff" : "var(--text-muted)",
                        cursor: "pointer", transition: "all 0.12s",
                      }}
                      title={isPreviewing ? "Stop" : "Preview this voice"}
                    >
                      {isPreviewing ? <Square size={10} /> : <Play size={10} />}
                    </button>

                    {/* Voice info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
                        {v.name}
                        <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>
                          {v.accent} · {v.gender}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{v.description}</div>
                    </div>

                    {/* Selected indicator */}
                    {isActive && (
                      <CheckCircle2 size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    )}
                    {selecting && selectedVoiceId === vId && (
                      <Loader2 size={14} style={{ color: "var(--accent)", flexShrink: 0, animation: "spin 1s linear infinite" }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Clone Voice */}
      {tab === "clone" && (
        <div style={{ padding: "14px 20px 18px" }}>
          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            {status.voice_status === "ready" && activeVoiceIsClone ? (
              <CheckCircle2 size={14} style={{ color: "var(--color-success)", flexShrink: 0 }} />
            ) : status.voice_status === "cloning" ? (
              <Loader2 size={14} style={{ color: "var(--color-info)", flexShrink: 0, animation: "spin 1s linear infinite" }} />
            ) : (
              <MicOff size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 12.5, fontWeight: 500, color:
              status.voice_status === "ready" && activeVoiceIsClone ? "var(--color-success)"
              : status.voice_status === "cloning" ? "var(--color-info)"
              : "var(--text-muted)"
            }}>
              {status.voice_status === "ready" && activeVoiceIsClone
                ? `${master.name}'s cloned voice is active`
                : status.voice_status === "cloning"
                ? "Cloning in progress…"
                : "No voice cloned yet"}
            </span>
          </div>

          <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.6 }}>
            {status.voice_status === "cloning"
              ? cloneMessage || "Downloading audio samples and sending to ElevenLabs. This may take 1–3 minutes."
              : status.voice_status === "ready" && activeVoiceIsClone
              ? "Cloned voice active. Enable Voice in Chat to hear responses."
              : "Creates an actual clone of this person's voice using ElevenLabs AI. Pulls audio directly from their YouTube sources — no file upload needed."}
          </p>

          {cloneError && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6,
              padding: "8px 10px", borderRadius: 8, marginBottom: 12,
              background: "var(--color-error-bg)", border: "1px solid rgba(248,113,113,0.2)",
              color: "var(--color-error)", fontSize: 11.5, lineHeight: 1.5,
            }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              {cloneError}
            </div>
          )}

          {status.voice_status !== "cloning" && (
            <button
              onClick={handleClone}
              disabled={cloning}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "9px 16px", borderRadius: 9,
                background: status.voice_status === "ready" && activeVoiceIsClone ? "var(--surface-2)" : "var(--accent)",
                border: status.voice_status === "ready" && activeVoiceIsClone ? "1px solid var(--border)" : "none",
                color: status.voice_status === "ready" && activeVoiceIsClone ? "var(--text-secondary)" : "#fff",
                fontSize: 13, fontWeight: 600,
                cursor: cloning ? "not-allowed" : "pointer",
                opacity: cloning ? 0.6 : 1, transition: "all 0.15s",
              }}
            >
              <Mic size={13} />
              {status.voice_status === "ready" && activeVoiceIsClone ? "Re-clone Voice" : "Clone Voice from YouTube"}
            </button>
          )}

          <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
            Requires <code style={{ fontSize: 10, background: "var(--surface-2)", padding: "1px 4px", borderRadius: 3 }}>ELEVENLABS_API_KEY</code> in backend/.env
          </p>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
