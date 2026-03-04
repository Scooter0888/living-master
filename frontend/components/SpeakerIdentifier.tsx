"use client";
import { useState } from "react";
import { Users, Check, Loader2, X } from "lucide-react";
import { api, Source } from "@/lib/api";

interface SpeakerIdentifierProps {
  source: Source;
  masterId: string;
  masterName: string;
  onConfirmed: () => void;
  onClose: () => void;
}

export function SpeakerIdentifier({ source, masterId, masterName, onConfirmed, onClose }: SpeakerIdentifierProps) {
  const speakerCount = source.speaker_count || 2;
  const speakers = Array.from({ length: speakerCount }, (_, i) => `SPEAKER_0${i}`);
  const samples = source.speaker_samples || {};
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await api.voice.identifySpeaker(masterId, source.id, selected);
      onConfirmed();
    } catch (e: any) {
      setError(e.message || "Failed to identify speaker");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "var(--surface)", borderRadius: 16, padding: 24,
        maxWidth: 480, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        border: "1px solid var(--border)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={16} style={{ color: "var(--accent)" }} />
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Identify {masterName}</h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4 }}>
            <X size={15} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
          We detected <strong>{speakerCount} distinct speakers</strong> in &ldquo;{source.title}&rdquo;.
          Which one is <strong>{masterName}</strong>? Select their speaker track and we&apos;ll re-index only their speech.
        </p>

        {/* Speaker options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {speakers.map((spk, i) => {
            const spkSamples = samples[spk] || [];
            return (
              <label
                key={spk}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                  border: `1.5px solid ${selected === spk ? "var(--accent)" : "var(--border)"}`,
                  background: selected === spk ? "rgba(99,102,241,0.05)" : "var(--surface-2)",
                  transition: "all 0.15s",
                }}
              >
                <input
                  type="radio"
                  name="speaker"
                  value={spk}
                  checked={selected === spk}
                  onChange={() => setSelected(spk)}
                  style={{ accentColor: "var(--accent)", width: 16, height: 16, flexShrink: 0, marginTop: 2 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    Speaker {i + 1}
                    <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>
                      {spk}
                    </span>
                  </div>
                  {spkSamples.length > 0 ? (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {spkSamples.map((quote, qi) => (
                        <div key={qi} style={{
                          fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic",
                          borderLeft: "2px solid var(--border)", paddingLeft: 8,
                          lineHeight: 1.5,
                        }}>
                          &ldquo;{quote}&rdquo;
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      No sample text available
                    </div>
                  )}
                </div>
              </label>
            );
          })}

          {/* None of them option */}
          <label
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", borderRadius: 10, cursor: "pointer",
              border: `1.5px solid ${selected === "none" ? "var(--border-hover)" : "var(--border)"}`,
              background: "var(--surface-2)", transition: "all 0.15s", opacity: 0.7,
            }}
          >
            <input
              type="radio"
              name="speaker"
              value="none"
              checked={selected === "none"}
              onChange={() => setSelected("none")}
              style={{ accentColor: "var(--text-muted)", width: 16, height: 16, flexShrink: 0 }}
            />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Keep all speakers (don&apos;t filter)
            </div>
          </label>
        </div>

        {error && (
          <div style={{ padding: 10, borderRadius: 8, background: "var(--color-error-bg)", color: "var(--color-error)", fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "9px 16px", borderRadius: 9, background: "var(--surface-2)",
              border: "1px solid var(--border)", color: "var(--text-secondary)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || loading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: 9, background: "var(--accent)",
              border: "none", color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: (!selected || loading) ? "not-allowed" : "pointer",
              opacity: (!selected || loading) ? 0.5 : 1,
            }}
          >
            {loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={13} />}
            Confirm
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
