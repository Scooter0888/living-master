"use client";
import { useState } from "react";
import { Users, Check, Loader2, X, MessageSquare, Languages, EyeOff } from "lucide-react";
import { api, Source } from "@/lib/api";

type OtherRole = "interviewer" | "translator" | "skip";

const ROLE_OPTIONS: { value: OtherRole; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "interviewer",
    label: "Interviewer",
    description: "Questions kept as context alongside answers",
    icon: <MessageSquare size={13} />,
    color: "#6366f1",
  },
  {
    value: "translator",
    label: "Translator",
    description: "Their words are treated as the master's own speech",
    icon: <Languages size={13} />,
    color: "#14b8a6",
  },
  {
    value: "skip",
    label: "Skip",
    description: "Ignored — not indexed at all",
    icon: <EyeOff size={13} />,
    color: "var(--text-muted)",
  },
];

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

  // Step 1: pick master speaker
  const [selected, setSelected] = useState<string | null>(null);
  // Step 2: label other speakers
  const [step, setStep] = useState<1 | 2>(1);
  const [otherRoles, setOtherRoles] = useState<Record<string, OtherRole>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const otherSpeakers = speakers.filter(s => s !== selected);

  const handleNext = () => {
    if (!selected) return;
    if (otherSpeakers.length === 0) {
      handleConfirm();
      return;
    }
    // Default all other speakers to interviewer
    const defaults: Record<string, OtherRole> = {};
    otherSpeakers.forEach(s => { defaults[s] = "interviewer"; });
    setOtherRoles(defaults);
    setStep(2);
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await api.voice.identifySpeaker(masterId, source.id, selected, otherRoles);
      onConfirmed();
    } catch (e: any) {
      setError(e.message || "Failed to identify speaker");
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
        maxWidth: 500, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        border: "1px solid var(--border)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={16} style={{ color: "var(--accent)" }} />
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              {step === 1 ? `Identify ${masterName}` : "Label other speakers"}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4 }}>
            <X size={15} />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {["Pick master", "Label others"].map((label, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: step > i + 1 ? "var(--color-success)" : step === i + 1 ? "var(--accent)" : "var(--surface-2)",
                color: step >= i + 1 ? "#fff" : "var(--text-muted)",
                border: step === i + 1 ? "none" : "1px solid var(--border)",
              }}>
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11.5, color: step === i + 1 ? "var(--text-primary)" : "var(--text-muted)", fontWeight: step === i + 1 ? 600 : 400 }}>
                {label}
              </span>
              {i === 0 && <span style={{ color: "var(--border)", fontSize: 12 }}>→</span>}
            </div>
          ))}
        </div>

        {/* ── Step 1: Pick master speaker ── */}
        {step === 1 && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
              We detected <strong>{speakerCount} distinct speakers</strong> in &ldquo;{source.title}&rdquo;.
              Which one is <strong>{masterName}</strong>?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {speakers.map((spk, i) => {
                const spkSamples = samples[spk] || [];
                return (
                  <label key={spk} style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                    border: `1.5px solid ${selected === spk ? "var(--accent)" : "var(--border)"}`,
                    background: selected === spk ? "rgba(99,102,241,0.05)" : "var(--surface-2)",
                    transition: "all 0.15s",
                  }}>
                    <input
                      type="radio" name="speaker" value={spk}
                      checked={selected === spk} onChange={() => setSelected(spk)}
                      style={{ accentColor: "var(--accent)", width: 16, height: 16, flexShrink: 0, marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                        Speaker {i + 1}
                        <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>{spk}</span>
                      </div>
                      {spkSamples.length > 0 ? (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                          {spkSamples.map((quote, qi) => (
                            <div key={qi} style={{
                              fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic",
                              borderLeft: "2px solid var(--border)", paddingLeft: 8, lineHeight: 1.5,
                            }}>
                              &ldquo;{quote}&rdquo;
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>No sample text</div>
                      )}
                    </div>
                  </label>
                );
              })}

              <label style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                border: `1.5px solid ${selected === "none" ? "var(--border-hover)" : "var(--border)"}`,
                background: "var(--surface-2)", transition: "all 0.15s", opacity: 0.7,
              }}>
                <input
                  type="radio" name="speaker" value="none"
                  checked={selected === "none"} onChange={() => setSelected("none")}
                  style={{ accentColor: "var(--text-muted)", width: 16, height: 16, flexShrink: 0 }}
                />
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Keep all speakers (don&apos;t filter)</div>
              </label>
            </div>

            {error && (
              <div style={{ padding: 10, borderRadius: 8, background: "var(--color-error-bg)", color: "var(--color-error)", fontSize: 12, marginBottom: 12 }}>{error}</div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={handleNext}
                disabled={!selected}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "9px 16px", borderRadius: 9, background: "var(--accent)",
                  border: "none", color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: !selected ? "not-allowed" : "pointer", opacity: !selected ? 0.5 : 1,
                }}
              >
                {selected === "none" || otherSpeakers.length === 0 ? <Check size={13} /> : null}
                {selected === "none" ? "Confirm" : otherSpeakers.length === 0 ? "Confirm" : "Next →"}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Label other speakers ── */}
        {step === 2 && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
              How should the other {otherSpeakers.length === 1 ? "speaker" : `${otherSpeakers.length} speakers`} be handled?
              <span style={{ color: "var(--text-muted)", display: "block", marginTop: 4, fontSize: 12 }}>
                Interviewer questions are kept as context alongside {masterName}&apos;s answers.
              </span>
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              {otherSpeakers.map((spk, si) => {
                const spkSamples = samples[spk] || [];
                const currentRole = otherRoles[spk] || "interviewer";
                return (
                  <div key={spk} style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                      Speaker {speakers.indexOf(spk) + 1}
                      <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>{spk}</span>
                    </div>
                    {spkSamples.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        {spkSamples.slice(0, 2).map((quote, qi) => (
                          <div key={qi} style={{ fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic", borderLeft: "2px solid var(--border)", paddingLeft: 8, lineHeight: 1.5, marginBottom: 3 }}>
                            &ldquo;{quote}&rdquo;
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      {ROLE_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setOtherRoles(r => ({ ...r, [spk]: opt.value }))}
                          style={{
                            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            padding: "8px 6px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                            border: `1.5px solid ${currentRole === opt.value ? opt.color : "var(--border)"}`,
                            background: currentRole === opt.value ? `${opt.color}15` : "var(--surface)",
                            color: currentRole === opt.value ? opt.color : "var(--text-muted)",
                            cursor: "pointer", transition: "all 0.15s",
                          }}
                        >
                          <span style={{ color: currentRole === opt.value ? opt.color : "var(--text-muted)" }}>{opt.icon}</span>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6, marginBottom: 0 }}>
                      {ROLE_OPTIONS.find(o => o.value === currentRole)?.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {error && (
              <div style={{ padding: 10, borderRadius: 8, background: "var(--color-error-bg)", color: "var(--color-error)", fontSize: 12, marginBottom: 12 }}>{error}</div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setStep(1)} style={{ padding: "9px 16px", borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                ← Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "9px 16px", borderRadius: 9, background: "var(--accent)",
                  border: "none", color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={13} />}
                {loading ? "Re-indexing…" : "Confirm & Re-index"}
              </button>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
