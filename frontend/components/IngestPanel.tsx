"use client";
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link2, Upload, Plus, X, Check, Loader2, Clock, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";

interface IngestPanelProps { masterId: string; onIngested: () => void; }
type Tab = "url" | "file" | "local";

interface QueueItem {
  id: string;
  name: string;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

export function IngestPanel({ masterId, onIngested }: IngestPanelProps) {
  const [tab, setTab] = useState<Tab>("url");

  // URL tab
  const [url, setUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [urlSuccess, setUrlSuccess] = useState("");

  // File tab
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [analyseMovements, setAnalyseMovements] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const analyseMovementsRef = useRef(false);

  // Local path tab
  const [localPath, setLocalPath] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");
  const [localAnalyseMovements, setLocalAnalyseMovements] = useState(false);
  const [localSources, setLocalSources] = useState<{ label: string; path: string; type: string; detail: string }[]>([]);
  const [localScanLoading, setLocalScanLoading] = useState(false);
  const [ingestingPath, setIngestingPath] = useState<string | null>(null);

  const setQueueSynced = (updater: (prev: QueueItem[]) => QueueItem[]) => {
    setQueue((prev) => {
      const next = updater(prev);
      queueRef.current = next;
      return next;
    });
  };

  const handleIngestUrl = async () => {
    if (!url.trim()) return;
    setUrlLoading(true); setUrlError(""); setUrlSuccess("");
    try {
      await api.ingest.url(masterId, url.trim());
      setUrlSuccess("Queued — processing in background"); setUrl("");
      setTimeout(() => { setUrlSuccess(""); onIngested(); }, 2500);
    } catch (e: any) { setUrlError(e.message || "Ingestion failed"); }
    finally { setUrlLoading(false); }
  };

  const handleIngestLocalPath = async (path?: string) => {
    const target = (path || localPath).trim();
    if (!target) { setLocalError("Please enter a path first"); return; }
    if (path) setIngestingPath(path);
    else setLocalLoading(true);
    setLocalError(""); setLocalSuccess("");
    try {
      await api.ingest.localPath(masterId, target, localAnalyseMovements);
      setLocalSuccess("Queued — processing in background");
      setTimeout(() => { setLocalSuccess(""); onIngested(); }, 2500);
    } catch (e: any) { setLocalError(e.message || "Failed to ingest path"); }
    finally { setLocalLoading(false); setIngestingPath(null); }
  };

  const handleScanLocal = async () => {
    setLocalScanLoading(true);
    try {
      const result = await api.ingest.scanLocal(masterId);
      setLocalSources(result.sources || []);
    } catch { setLocalSources([]); }
    finally { setLocalScanLoading(false); }
  };

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (true) {
      const pending = queueRef.current.find((q) => q.status === "queued");
      if (!pending) break;

      setQueueSynced((prev) =>
        prev.map((q) => q.id === pending.id ? { ...q, status: "uploading" } : q)
      );

      try {
        const file = fileMapRef.current.get(pending.id);
        if (!file) throw new Error("File not found");
        const result = await api.ingest.file(masterId, file, analyseMovementsRef.current);
        if (result.detail) throw new Error(result.detail);
        setQueueSynced((prev) =>
          prev.map((q) => q.id === pending.id ? { ...q, status: "done" } : q)
        );
        onIngested();
      } catch (e: any) {
        setQueueSynced((prev) =>
          prev.map((q) => q.id === pending.id ? { ...q, status: "error", error: e.message || "Upload failed" } : q)
        );
      }

      fileMapRef.current.delete(pending.id);
      await new Promise((r) => setTimeout(r, 300));
    }

    processingRef.current = false;
  }, [masterId, onIngested]);

  const fileMapRef = useRef<Map<string, File>>(new Map());

  const enqueueFile = useCallback((file: File) => {
    const id = Math.random().toString(36).slice(2);
    fileMapRef.current.set(id, file);
    const item: QueueItem = { id, name: file.name, status: "queued" };
    setQueueSynced((prev) => [...prev, item]);
    setTimeout(() => processQueue(), 0);
  }, [processQueue]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    Array.from(e.dataTransfer.files).forEach(enqueueFile);
  }, [enqueueFile]);

  const removeItem = (id: string) => {
    setQueueSynced((prev) => prev.filter((q) => q.id !== id));
    fileMapRef.current.delete(id);
  };

  const statusIcon = (item: QueueItem) => {
    if (item.status === "uploading") return <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />;
    if (item.status === "done") return <Check size={11} />;
    if (item.status === "error") return <X size={11} />;
    return <Clock size={11} />;
  };

  const statusColor = (status: QueueItem["status"]) => {
    if (status === "done") return "var(--color-success)";
    if (status === "error") return "var(--color-error)";
    if (status === "uploading") return "var(--accent)";
    return "var(--text-muted)";
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "url", label: "Link", icon: <Link2 size={12} /> },
    { id: "file", label: "File", icon: <Upload size={12} /> },
    { id: "local", label: "Local", icon: <FolderOpen size={12} /> },
  ];

  return (
    <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "10px 10px 0" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setUrlError(""); setUrlSuccess(""); setLocalError(""); setLocalSuccess(""); }} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 13px",
            fontSize: 12, fontWeight: tab === t.id ? 600 : 500,
            background: tab === t.id ? "var(--surface-2)" : "transparent",
            border: "none", borderRadius: "8px 8px 0 0",
            borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer",
            transition: "color 0.12s",
          }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        <AnimatePresence mode="wait">

          {tab === "url" && (
            <motion.div key="url" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>YouTube, articles, blog posts — any public URL</p>
              <div style={{ display: "flex", gap: 8 }}>
                <Input placeholder="https://youtube.com/watch?v=..." value={url}
                  onChange={(e) => { setUrl(e.target.value); setUrlError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleIngestUrl()}
                  style={{ flex: 1 }} />
                <Button variant="accent" size="md" loading={urlLoading} onClick={handleIngestUrl} disabled={!url.trim()}>
                  <Plus size={14} /> Add
                </Button>
              </div>
              <AnimatePresence>
                {(urlError || urlSuccess) && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{
                      marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 8, padding: "9px 12px", borderRadius: 8, fontSize: 12,
                      background: urlError ? "var(--color-error-bg)" : "var(--color-success-bg)",
                      border: `1px solid ${urlError ? "var(--color-error-border)" : "var(--color-success-border)"}`,
                      color: urlError ? "var(--color-error)" : "var(--color-success)",
                    }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {urlSuccess && <Check size={12} />}{urlError || urlSuccess}
                    </span>
                    <button onClick={() => { setUrlError(""); setUrlSuccess(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}>
                      <X size={12} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {tab === "file" && (
            <motion.div key="file" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>MP3 · MP4 · PDF · DOCX · WAV · MKV · VOB · ISO — drop multiple files</p>
              <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)} onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: "24px 16px", borderRadius: 10,
                  border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
                  background: dragging ? "var(--accent-dim)" : "var(--surface-2)",
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                <Upload size={18} style={{ color: "var(--text-muted)" }} />
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Drop files here or <span style={{ color: "var(--accent)" }}>browse</span>
                </p>
              </div>
              <input ref={fileInputRef} type="file" style={{ display: "none" }} multiple
                accept=".mp3,.wav,.m4a,.ogg,.flac,.mp4,.mkv,.avi,.mov,.webm,.vob,.iso,.pdf,.docx"
                onChange={(e) => {
                  Array.from(e.target.files || []).forEach(enqueueFile);
                  e.target.value = "";
                }} />

              {/* Movement analysis opt-in */}
              <label style={{
                display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10,
                cursor: "pointer", userSelect: "none",
              }}>
                <input
                  type="checkbox"
                  checked={analyseMovements}
                  onChange={(e) => {
                    setAnalyseMovements(e.target.checked);
                    analyseMovementsRef.current = e.target.checked;
                  }}
                  style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Analyse movements with Claude Vision
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>
                    Extracts keyframes + describes physical actions — costs ~$0.01/min of video. Skip for long recordings.
                  </span>
                </span>
              </label>

              <AnimatePresence>
                {queue.length > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                    {queue.map((item) => (
                      <motion.div key={item.id}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 10px", borderRadius: 7, fontSize: 11,
                          background: "var(--surface-2)", border: "1px solid var(--border)",
                          color: statusColor(item.status),
                        }}>
                        <span style={{ flexShrink: 0 }}>{statusIcon(item)}</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                          {item.name}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 10, color: statusColor(item.status) }}>
                          {item.status === "uploading" ? "uploading…" : item.status === "done" ? "queued" : item.status === "error" ? (item.error || "error") : "waiting"}
                        </span>
                        {(item.status === "done" || item.status === "error") && (
                          <button onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, flexShrink: 0 }}>
                            <X size={10} />
                          </button>
                        )}
                      </motion.div>
                    ))}
                    {queue.some((q) => q.status === "done" || q.status === "error") && (
                      <button onClick={() => setQueueSynced((prev) => prev.filter((q) => q.status === "queued" || q.status === "uploading"))}
                        style={{ alignSelf: "flex-end", background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--text-muted)", padding: "2px 4px" }}>
                        Clear done
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {tab === "local" && (
            <motion.div key="local" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>

              {/* Movement analysis toggle */}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={localAnalyseMovements} onChange={(e) => setLocalAnalyseMovements(e.target.checked)}
                  style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--accent)" }} />
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Analyse movements with Claude Vision
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>~$0.01/min of video. Leave unchecked for long DVDs.</span>
                </span>
              </label>

              {/* Scan button */}
              <Button variant="outline" size="sm" loading={localScanLoading} onClick={handleScanLocal}
                style={{ width: "100%", marginBottom: 10, justifyContent: "center" }}>
                <FolderOpen size={13} /> Detect DVDs &amp; Video Files
              </Button>

              {/* Detected sources */}
              <AnimatePresence>
                {localSources.length > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {localSources.map((src) => (
                      <button key={src.path} onClick={() => handleIngestLocalPath(src.path)}
                        disabled={ingestingPath === src.path}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          gap: 8, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                          background: "var(--surface-2)", border: "1px solid var(--border)",
                          textAlign: "left", width: "100%", transition: "border-color 0.12s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                      >
                        <div style={{ overflow: "hidden" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {src.type === "dvd" ? "💿 " : "🎬 "}{src.label}
                          </div>
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>{src.detail}</div>
                        </div>
                        <div style={{ flexShrink: 0, fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                          {ingestingPath === src.path ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : "+ Add"}
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
                {localSources.length === 0 && !localScanLoading && (
                  <></>
                )}
              </AnimatePresence>

              {/* Manual path fallback */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Input placeholder="/Volumes/DISC_NAME or /path/to/file.mp4"
                    value={localPath}
                    onChange={(e) => { setLocalPath(e.target.value); setLocalError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleIngestLocalPath()}
                    style={{ fontFamily: "monospace", fontSize: 11 }} />
                </div>
                <Button variant="accent" size="md" loading={localLoading} onClick={() => handleIngestLocalPath()}>
                  <Plus size={14} /> Add
                </Button>
              </div>

              <AnimatePresence>
                {(localError || localSuccess) && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{
                      marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 8, padding: "9px 12px", borderRadius: 8, fontSize: 12,
                      background: localError ? "var(--color-error-bg)" : "var(--color-success-bg)",
                      border: `1px solid ${localError ? "var(--color-error-border)" : "var(--color-success-border)"}`,
                      color: localError ? "var(--color-error)" : "var(--color-success)",
                    }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {localSuccess && <Check size={12} />}{localError || localSuccess}
                    </span>
                    <button onClick={() => { setLocalError(""); setLocalSuccess(""); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}>
                      <X size={12} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
