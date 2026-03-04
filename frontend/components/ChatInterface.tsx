"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, RotateCcw, Volume2, VolumeX, Mic, MicOff, Sparkles } from "lucide-react";
import { api, Master } from "@/lib/api";
import { MasterAvatar } from "@/components/MasterAvatar";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  isInference?: boolean;        // contextual inference mode response
  noMaterial?: boolean;         // strict mode found no direct answer — offer inference
  sourceQuestion?: string;      // the question to retry in contextual mode
}

const STARTERS = [
  "What is your core philosophy?",
  "What advice would you give someone just starting out?",
  "How do you think about success and mastery?",
  "What are the most important principles you live by?",
];

// Browser Speech Recognition type shim
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function ChatInterface({ master }: { master: Master }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [listening, setListening] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [generatingQ, setGeneratingQ] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const voiceAvailable = !!master.voice_id || master.voice_status === "ready";
  const speechSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Set up speech recognition
  const startListening = useCallback(() => {
    if (!speechSupported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";

    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      // Auto-send in conversation mode
      if (conversationMode) {
        setTimeout(() => sendMessage(transcript), 300);
      }
    };

    recognitionRef.current = rec;
    rec.start();
  }, [speechSupported, conversationMode]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const playVoice = useCallback(async (text: string): Promise<void> => {
    if (!voiceEnabled || !text) return;
    return new Promise((resolve) => {
      (async () => {
        try {
          setVoicePlaying(true);
          const snippet = text.slice(0, 800);
          const blob = await api.voice.synthesize(master.id, snippet);
          const url = URL.createObjectURL(blob);
          if (audioRef.current) {
            audioRef.current.pause();
            URL.revokeObjectURL(audioRef.current.src);
          }
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { setVoicePlaying(false); URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { setVoicePlaying(false); resolve(); };
          await audio.play();
        } catch (e) {
          console.error("Voice playback failed:", e);
          setVoicePlaying(false);
          resolve();
        }
      })();
    });
  }, [voiceEnabled, master.id]);

  const NO_MATERIAL_PHRASE = "don't have documented material";

  const sendMessage = useCallback(async (question?: string, mode = "strict") => {
    const q = (question || input).trim();
    if (!q || loading) return;
    setInput(""); setLoading(true);

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: q };
    const aId = `a-${Date.now()}`;
    const aMsg: Message = {
      id: aId, role: "assistant", content: "", streaming: true,
      isInference: mode === "contextual",
    };
    // Only show user bubble for new (non-inference) questions
    setMessages((prev) => mode === "contextual"
      ? [...prev, aMsg]
      : [...prev, userMsg, aMsg]
    );

    try {
      let full = "";
      for await (const chunk of api.query.streamFetch(master.id, q, mode)) {
        full += chunk;
        setMessages((prev) => prev.map((m) => m.id === aId ? { ...m, content: full } : m));
      }
      // Mark whether this response found no direct material (offer contextual inference)
      const isNoMaterial = mode === "strict" && full.toLowerCase().includes(NO_MATERIAL_PHRASE);
      setMessages((prev) => prev.map((m) => m.id === aId
        ? { ...m, streaming: false, noMaterial: isNoMaterial, sourceQuestion: isNoMaterial ? q : undefined }
        : m
      ));

      if (voiceEnabled && full && !isNoMaterial) {
        await playVoice(full);
        if (conversationMode) setTimeout(() => startListening(), 400);
      }
    } catch (e: any) {
      setMessages((prev) => prev.map((m) => m.id === aId
        ? { ...m, content: `Error: ${e.message}`, streaming: false }
        : m
      ));
    } finally { setLoading(false); }
  }, [input, loading, master.id, voiceEnabled, playVoice, conversationMode, startListening]);

  const generateQuestion = async () => {
    if (generatingQ || master.source_count === 0) return;
    setGeneratingQ(true);
    try {
      const { question } = await api.query.suggest(master.id);
      setInput(question);
      textareaRef.current?.focus();
    } catch (e) {
      console.error("Could not generate question:", e);
    } finally {
      setGeneratingQ(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface)" }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 28px 8px" }}>
        {messages.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 20 }}>
            <MasterAvatar master={master} size={56} borderRadius={16} />
            <div style={{ textAlign: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6, letterSpacing: "-0.02em" }}>
                Ask {master.name} anything
              </h3>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                {master.source_count > 0
                  ? `Based on ${master.source_count} source${master.source_count !== 1 ? "s" : ""} in the knowledge base`
                  : "Add sources first to enable conversations"}
              </p>
            </div>
            {master.source_count > 0 && (
              <div style={{ width: "100%", maxWidth: 480 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  {STARTERS.map((q) => (
                    <button key={q} onClick={() => sendMessage(q)}
                      style={{
                        textAlign: "left", padding: "11px 14px", borderRadius: 12,
                        border: "1px solid var(--border)", background: "var(--surface-2)",
                        fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer",
                        transition: "all 0.15s", lineHeight: 1.45,
                      }}
                      onMouseOver={e => { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                      onMouseOut={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}>
                      {q}
                    </button>
                  ))}
                </div>
                {/* Generate question button */}
                <button onClick={generateQuestion} disabled={generatingQ}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "10px 14px", borderRadius: 12, fontSize: 12.5, fontWeight: 500,
                    border: "1px dashed var(--accent)", background: "var(--accent-dim)",
                    color: "var(--accent)", cursor: generatingQ ? "not-allowed" : "pointer",
                    transition: "all 0.15s", opacity: generatingQ ? 0.6 : 1,
                  }}>
                  <Sparkles size={13} style={{ animation: generatingQ ? "spin 1s linear infinite" : "none" }} />
                  {generatingQ ? "Generating…" : "Generate a question from the knowledge base"}
                </button>
              </div>
            )}
          </motion.div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                style={{ display: "flex", gap: 11, flexDirection: msg.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
                {msg.role === "assistant" ? (
                  <MasterAvatar master={master} size={26} borderRadius={8} glow="none" />
                ) : (
                  <div style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 2,
                    background: "var(--surface-3)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, color: "var(--text-muted)", fontWeight: 700,
                  }}>YOU</div>
                )}
                <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* inference badge */}
                  {msg.isInference && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--color-warning)", fontWeight: 600 }}>
                      <span>⚡</span> Contextual inference — not a direct quote
                    </div>
                  )}
                  <div style={{
                    padding: "11px 15px", borderRadius: 14, fontSize: 13.5, lineHeight: 1.7,
                    background: msg.isInference
                      ? "rgba(217,119,6,0.06)"
                      : msg.role === "user" ? "var(--surface-3)" : "var(--surface-2)",
                    border: `1px solid ${msg.isInference ? "rgba(217,119,6,0.2)" : "var(--border)"}`,
                    color: "var(--text-primary)",
                    borderBottomRightRadius: msg.role === "user" ? 4 : 14,
                    borderBottomLeftRadius: msg.role === "assistant" ? 4 : 14,
                    whiteSpace: "pre-wrap",
                  }}>
                    {msg.content || (msg.streaming && <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Thinking…</span>)}
                    {msg.streaming && msg.content && <span className="cursor-blink" />}
                  </div>
                  {/* contextual inference offer */}
                  {msg.noMaterial && !msg.streaming && (
                    <button
                      onClick={() => sendMessage(msg.sourceQuestion, "contextual")}
                      disabled={loading}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                        background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.25)",
                        color: "var(--color-warning)", cursor: loading ? "not-allowed" : "pointer",
                        transition: "all 0.15s", alignSelf: "flex-start",
                      }}
                      onMouseOver={e => (e.currentTarget.style.background = "rgba(217,119,6,0.13)")}
                      onMouseOut={e => (e.currentTarget.style.background = "rgba(217,119,6,0.07)")}
                    >
                      ⚡ Try contextual inference — what would {master.name} likely say?
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "14px 20px 18px", background: "var(--surface)" }}>
        {/* Toolbar row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", transition: "color 0.12s" }}
                onMouseOver={e => (e.currentTarget.style.color = "var(--text-secondary)")}
                onMouseOut={e => (e.currentTarget.style.color = "var(--text-muted)")}>
                <RotateCcw size={11} /> New conversation
              </button>
            )}
            {/* Generate question shortcut when chat has messages */}
            {messages.length > 0 && master.source_count > 0 && (
              <button onClick={generateQuestion} disabled={generatingQ}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-muted)", background: "none", border: "none", cursor: generatingQ ? "not-allowed" : "pointer", transition: "color 0.12s", opacity: generatingQ ? 0.5 : 1 }}
                onMouseOver={e => (e.currentTarget.style.color = "var(--accent)")}
                onMouseOut={e => (e.currentTarget.style.color = "var(--text-muted)")}>
                <Sparkles size={11} style={{ animation: generatingQ ? "spin 1s linear infinite" : "none" }} />
                Suggest question
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Conversation mode toggle (only when voice+speech both available) */}
            {voiceAvailable && speechSupported && (
              <button
                onClick={() => setConversationMode(v => !v)}
                title={conversationMode ? "Exit conversation mode" : "Hands-free conversation mode"}
                style={{
                  padding: "4px 10px", borderRadius: 8, fontSize: 11.5,
                  background: conversationMode ? "var(--accent-dim)" : "transparent",
                  border: `1px solid ${conversationMode ? "var(--accent)" : "var(--border)"}`,
                  color: conversationMode ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                {conversationMode ? "🎙 Live" : "Conversation"}
              </button>
            )}

            {/* Voice TTS toggle */}
            <button
              onClick={() => voiceAvailable && setVoiceEnabled(v => !v)}
              title={voiceAvailable ? (voiceEnabled ? "Disable voice" : "Enable voice response") : "Clone voice in the Media tab first"}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, fontSize: 11.5,
                background: voiceEnabled ? "var(--accent-dim)" : "transparent",
                border: `1px solid ${voiceEnabled ? "var(--accent)" : "var(--border)"}`,
                color: voiceEnabled ? "var(--accent)" : "var(--text-muted)",
                cursor: voiceAvailable ? "pointer" : "not-allowed",
                opacity: voiceAvailable ? 1 : 0.35, transition: "all 0.15s",
              }}>
              {voicePlaying ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  {[4, 7, 5, 8, 4].map((h, i) => (
                    <span key={i} style={{ display: "inline-block", width: 2, height: h, background: "var(--accent)", borderRadius: 1, animation: `wave 0.8s ease-in-out ${i * 0.1}s infinite alternate` }} />
                  ))}
                </span>
              ) : voiceEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
              Voice
            </button>
          </div>
        </div>

        {/* Input row */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          {/* Mic button */}
          {speechSupported && (
            <button
              onClick={listening ? stopListening : startListening}
              title={listening ? "Stop listening" : "Speak your question"}
              style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: listening ? "var(--accent)" : "var(--surface-2)",
                border: `1px solid ${listening ? "var(--accent)" : "var(--border)"}`,
                color: listening ? "#fff" : "var(--text-muted)",
                cursor: "pointer", transition: "all 0.15s",
                boxShadow: listening ? "0 0 12px var(--accent-glow)" : "none",
                animation: listening ? "pulse-ring 1.5s ease-in-out infinite" : "none",
              }}>
              {listening ? <Mic size={15} /> : <MicOff size={15} />}
            </button>
          )}

          <textarea
            ref={textareaRef} value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={listening ? "Listening…" : `Ask ${master.name} a question…`}
            rows={1}
            style={{
              flex: 1, resize: "none", background: "var(--surface-2)",
              border: `1px solid ${listening ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 12, padding: "11px 15px", fontSize: 13.5,
              color: "var(--text-primary)", outline: "none",
              fontFamily: "inherit", maxHeight: 120, transition: "border-color 0.15s",
            }}
            onFocus={e => (e.target.style.borderColor = "var(--accent)")}
            onBlur={e => { if (!listening) e.target.style.borderColor = "var(--border)"; }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            style={{
              width: 40, height: 40, borderRadius: 12,
              background: input.trim() && !loading ? "var(--accent)" : "var(--surface-3)",
              border: "none", color: input.trim() && !loading ? "#fff" : "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: input.trim() && !loading ? "pointer" : "default",
              flexShrink: 0, transition: "all 0.15s",
              boxShadow: input.trim() && !loading ? "0 2px 10px var(--accent-glow)" : "none",
            }}
            onMouseOver={e => { if (input.trim() && !loading) e.currentTarget.style.background = "var(--accent-hover)"; }}
            onMouseOut={e => { if (input.trim() && !loading) e.currentTarget.style.background = "var(--accent)"; }}
          >
            <Send size={14} />
          </button>
        </div>
        <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 8, opacity: 0.7 }}>⏎ Send · Shift+⏎ New line{speechSupported ? " · Mic to speak" : ""}</p>
      </div>

      <style>{`
        @keyframes wave { from { transform: scaleY(0.5); } to { transform: scaleY(1.5); } }
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 var(--accent-glow); }
          50% { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>
    </div>
  );
}
