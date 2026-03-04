"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ExternalLink, Check, ChevronDown, ChevronUp, Zap, Youtube, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { api, DiscoveryResult, DiscoveryItem, Source } from "@/lib/api";
import { CONTENT_TYPE_ICONS, CONTENT_TYPE_LABELS } from "@/lib/utils";

interface DiscoveryPanelProps {
  masterId: string;
  masterName: string;
  existingSources: Source[];
  onIngested: () => void;
}

export function DiscoveryPanel({ masterId, masterName, existingSources, onIngested }: DiscoveryPanelProps) {
  // Web discovery
  const [query, setQuery] = useState(masterName);
  const [context, setContext] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveryResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  // Channel import
  const [channelUrl, setChannelUrl] = useState("");
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelVideos, setChannelVideos] = useState<DiscoveryItem[] | null>(null);
  const [channelSelected, setChannelSelected] = useState<Set<string>>(new Set());
  const [channelError, setChannelError] = useState("");

  // Ingestion shared state
  const [ingesting, setIngesting] = useState(false);
  const [success, setSuccess] = useState("");

  const existingUrls = new Set(
    existingSources.filter((s) => s.status !== "failed").map((s) => s.url).filter(Boolean) as string[]
  );

  // ── Web discovery ──────────────────────────────────────────────
  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true); setError(""); setResults(null); setSelected(new Set());
    try {
      const data = await api.discover.search(query.trim(), 10, context.trim());
      setResults(data);
      if (data.categories[0]) setExpanded(new Set([data.categories[0].label]));
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const toggleItem = (url: string) => {
    if (existingUrls.has(url)) return;
    setSelected((prev) => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  };

  const selectableCount = results
    ? results.categories.flatMap((c) => c.items).filter((i) => !existingUrls.has(i.url)).length : 0;

  const handleIngest = async (urls: string[]) => {
    if (!urls.length) return;
    setIngesting(true); setError(""); setChannelError("");
    try {
      const filtered = urls.filter((u) => !existingUrls.has(u));
      const result = await api.discover.bulkIngest(masterId, filtered);
      setSuccess(`Queued ${result.queued} sources for ingestion`);
      setSelected(new Set()); setChannelSelected(new Set());
      setTimeout(() => { setSuccess(""); onIngested(); }, 2500);
    } catch (e: any) {
      setError(e.message || "Ingest failed");
    } finally {
      setIngesting(false);
    }
  };

  // ── Channel import ─────────────────────────────────────────────
  const handleChannelLoad = async () => {
    if (!channelUrl.trim()) return;
    setChannelLoading(true); setChannelError(""); setChannelVideos(null); setChannelSelected(new Set());
    try {
      const data = await api.discover.channelVideos(channelUrl.trim());
      setChannelVideos(data.videos);
      // Pre-select all videos not already added
      const selectable = data.videos.filter((v) => !existingUrls.has(v.url)).map((v) => v.url);
      setChannelSelected(new Set(selectable));
    } catch (e: any) {
      setChannelError(e.message || "Could not load channel");
    } finally {
      setChannelLoading(false);
    }
  };

  const toggleChannel = (url: string) => {
    if (existingUrls.has(url)) return;
    setChannelSelected((prev) => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

      {/* ── Section 1: Web Discovery ── */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Web Discovery
          </h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
            Search across interviews, articles, podcasts, and YouTube. Add a qualifier to filter out people with the same name.
          </p>
        </div>

        {/* Search inputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {/* Name row */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                placeholder="Name or topic…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 13, color: "var(--text-primary)", outline: "none" }}
                onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
              />
            </div>
            <Button variant="accent" size="md" loading={searching} onClick={handleSearch} disabled={!query.trim()}>
              Search
            </Button>
          </div>

          {/* Context qualifier */}
          <div style={{ position: "relative" }}>
            <input
              placeholder='Qualifier to narrow results — e.g. "Systema Russian martial arts instructor"'
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              style={{ width: "100%", padding: "9px 12px 9px 36px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 12, color: "var(--text-primary)", outline: "none" }}
              onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
            />
            <Info size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          </div>
          {context && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 2 }}>
              Searching for: <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>"{query}" {context}</span>
            </p>
          )}
        </div>

        {error && <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 10 }}>{error}</p>}

        {/* Results */}
        <AnimatePresence>
          {results && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{results.total_found}</span> results found
                </p>
                {selectableCount > 0 && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setSelected(new Set(results.categories.flatMap(c => c.items.map(i => i.url)).filter(u => !existingUrls.has(u))))}
                      style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>
                      Select all
                    </button>
                    <button onClick={() => setSelected(new Set())}
                      style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                      None
                    </button>
                  </div>
                )}
              </div>

              {results.categories.map((cat) => (
                cat.items.length === 0 ? null : (
                  <div key={cat.label} style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(cat.label) ? n.delete(cat.label) : n.add(cat.label); return n; })}
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface)", border: "none", cursor: "pointer" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                        {cat.label} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {cat.items.length}</span>
                      </span>
                      {expanded.has(cat.label) ? <ChevronUp size={12} color="var(--text-muted)" /> : <ChevronDown size={12} color="var(--text-muted)" />}
                    </button>
                    <AnimatePresence>
                      {expanded.has(cat.label) && (
                        <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} style={{ overflow: "hidden" }}>
                          <div style={{ borderTop: "1px solid var(--border)" }}>
                            {cat.items.map((item) => (
                              <DiscoveryItemRow key={item.url} item={item}
                                selected={selected.has(item.url)}
                                alreadyAdded={existingUrls.has(item.url)}
                                onToggle={() => toggleItem(item.url)} />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              ))}

              {selected.size > 0 && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: "var(--surface)", border: "1px solid rgba(91,94,244,0.3)", boxShadow: "var(--shadow-md)", position: "sticky", bottom: 0 }}>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{selected.size}</span> selected
                  </p>
                  <Button variant="accent" size="sm" loading={ingesting} onClick={() => handleIngest(Array.from(selected))}>
                    <Zap size={13} /> Add to Knowledge Base
                  </Button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: "var(--border)" }} />

      {/* ── Section 2: YouTube Channel Import ── */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Youtube size={15} style={{ color: "#ff0000" }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              Import YouTube Channel
            </h3>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
            Paste a YouTube channel or playlist URL to import all its videos at once.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            placeholder="https://www.youtube.com/@channelname/videos"
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleChannelLoad()}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 13, color: "var(--text-primary)", outline: "none" }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
          />
          <Button variant="accent" size="md" loading={channelLoading} onClick={handleChannelLoad} disabled={!channelUrl.trim()}>
            Load
          </Button>
        </div>

        {channelError && <p style={{ fontSize: 12, color: "var(--color-error)", marginBottom: 10 }}>{channelError}</p>}
        {success && <p style={{ fontSize: 12, color: "var(--color-success)", marginBottom: 10 }}>{success}</p>}

        <AnimatePresence>
          {channelVideos && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{channelVideos.length}</span> videos found
                  {channelSelected.size > 0 && <span> · <span style={{ color: "var(--accent)", fontWeight: 600 }}>{channelSelected.size}</span> selected</span>}
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setChannelSelected(new Set(channelVideos.filter(v => !existingUrls.has(v.url)).map(v => v.url)))}
                    style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>
                    Select all
                  </button>
                  <button onClick={() => setChannelSelected(new Set())}
                    style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                    None
                  </button>
                </div>
              </div>

              {/* Video list */}
              <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
                {channelVideos.map((video) => (
                  <DiscoveryItemRow
                    key={video.url}
                    item={video}
                    selected={channelSelected.has(video.url)}
                    alreadyAdded={existingUrls.has(video.url)}
                    onToggle={() => toggleChannel(video.url)}
                  />
                ))}
              </div>

              {channelSelected.size > 0 && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: "var(--surface)", border: "1px solid rgba(91,94,244,0.3)", boxShadow: "var(--shadow-md)" }}>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{channelSelected.size}</span> videos selected
                  </p>
                  <Button variant="accent" size="sm" loading={ingesting} onClick={() => handleIngest(Array.from(channelSelected))}>
                    <Zap size={13} /> Add to Knowledge Base
                  </Button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}

function DiscoveryItemRow({ item, selected, alreadyAdded, onToggle }: {
  item: DiscoveryItem; selected: boolean; alreadyAdded: boolean; onToggle: () => void;
}) {
  return (
    <div
      onClick={alreadyAdded ? undefined : onToggle}
      style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
        background: selected ? "var(--accent-dim)" : "var(--surface)",
        cursor: alreadyAdded ? "default" : "pointer",
        opacity: alreadyAdded ? 0.5 : 1,
        transition: "background 0.1s",
      }}
      onMouseOver={e => { if (!alreadyAdded && !selected) e.currentTarget.style.background = "var(--surface-2)"; }}
      onMouseOut={e => { if (!alreadyAdded && !selected) e.currentTarget.style.background = "var(--surface)"; }}
    >
      {/* Checkbox */}
      <div style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: alreadyAdded ? "var(--surface-3)" : selected ? "var(--accent)" : "transparent",
        border: `1.5px solid ${alreadyAdded || selected ? "transparent" : "var(--border-hover)"}`,
        transition: "all 0.1s",
      }}>
        {(alreadyAdded || selected) && <Check size={10} color={alreadyAdded ? "var(--text-muted)" : "#fff"} />}
      </div>

      {/* Thumbnail */}
      {item.thumbnail_url ? (
        <img src={item.thumbnail_url} alt="" style={{ width: 52, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 52, height: 36, borderRadius: 6, background: "var(--surface-3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-muted)" }}>
          {CONTENT_TYPE_ICONS[item.content_type] || "◉"}
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</p>
        {item.snippet && <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.snippet}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          {alreadyAdded ? (
            <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface-3)", padding: "1px 6px", borderRadius: 4 }}>Already added</span>
          ) : (
            <Badge variant="default" className="text-[10px] py-0">{CONTENT_TYPE_LABELS[item.content_type] || item.content_type}</Badge>
          )}
          {item.author && !alreadyAdded && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.author}</span>}
        </div>
      </div>

      <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
        style={{ padding: 4, borderRadius: 6, color: "var(--text-muted)", flexShrink: 0, textDecoration: "none", display: "flex" }}>
        <ExternalLink size={11} />
      </a>
    </div>
  );
}
