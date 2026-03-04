"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Trash2, Check, X, Image as ImageIcon } from "lucide-react";
import { api, Photo } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface PhotoGalleryProps {
  masterId: string;
}

export function PhotoGallery({ masterId }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    try {
      const data = await api.media.listPhotos(masterId);
      setPhotos(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [masterId]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const photo = await api.media.uploadPhoto(masterId, file);
      setPhotos((prev) => [...prev, photo]);
    } catch (e) { console.error(e); }
    finally { setUploading(false); }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [masterId]);

  const handleDelete = async (photo: Photo) => {
    if (!confirm(`Remove photo "${photo.filename}"?`)) return;
    setDeletingId(photo.id);
    try {
      await api.media.deletePhoto(masterId, photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  };

  const startEdit = (photo: Photo) => {
    setEditingId(photo.id);
    setCaptionDraft(photo.caption || "");
  };

  const saveCaption = async (photo: Photo) => {
    try {
      const updated = await api.media.updateCaption(masterId, photo.id, captionDraft);
      setPhotos((prev) => prev.map((p) => p.id === photo.id ? updated : p));
    } catch (e) { console.error(e); }
    finally { setEditingId(null); }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
      <div style={{ width: 14, height: 14, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      Loading photos…
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Upload dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 8, padding: "20px 16px", borderRadius: 12,
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
          background: dragging ? "rgba(99,102,241,0.04)" : "var(--surface-2)",
          cursor: uploading ? "not-allowed" : "pointer", transition: "all 0.15s",
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? (
          <div style={{ width: 18, height: 18, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        ) : (
          <Upload size={18} style={{ color: "var(--text-muted)" }} />
        )}
        <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", margin: 0 }}>
          {uploading ? "Uploading…" : <>Drop a photo here or <span style={{ color: "var(--accent)" }}>browse</span></>}
        </p>
        <p style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.7, margin: 0 }}>JPEG · PNG · WEBP · GIF</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        accept=".jpg,.jpeg,.png,.webp,.gif"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
      />

      {/* Photo grid */}
      {photos.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "32px 16px", color: "var(--text-muted)", textAlign: "center" }}>
          <ImageIcon size={28} style={{ opacity: 0.3 }} />
          <p style={{ fontSize: 13, margin: 0 }}>No photos yet — upload some above</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="photo-card"
              style={{ borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden", background: "var(--surface-2)", position: "relative" }}
            >
              <div style={{ aspectRatio: "1", overflow: "hidden", background: "var(--surface-3)" }}>
                <img
                  src={`${API_BASE}${photo.url}`}
                  alt={photo.caption || photo.filename}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>

              {/* Delete button overlay */}
              <button
                className="photo-del"
                onClick={() => handleDelete(photo)}
                disabled={deletingId === photo.id}
                style={{
                  position: "absolute", top: 6, right: 6,
                  width: 26, height: 26, borderRadius: 6,
                  background: "rgba(0,0,0,0.55)", border: "none",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", opacity: 0, transition: "opacity 0.15s",
                }}
              >
                <Trash2 size={12} />
              </button>

              {/* Caption */}
              <div style={{ padding: "8px 10px" }}>
                {editingId === photo.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      autoFocus
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCaption(photo); if (e.key === "Escape") setEditingId(null); }}
                      placeholder="Add caption…"
                      style={{
                        flex: 1, fontSize: 11, padding: "3px 6px",
                        border: "1px solid var(--accent)", borderRadius: 5,
                        background: "var(--surface)", color: "var(--text-primary)", outline: "none",
                      }}
                    />
                    <button onClick={() => saveCaption(photo)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-success)", display: "flex" }}>
                      <Check size={12} />
                    </button>
                    <button onClick={() => setEditingId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p
                    onClick={() => startEdit(photo)}
                    style={{
                      fontSize: 11, color: photo.caption ? "var(--text-secondary)" : "var(--text-muted)",
                      margin: 0, cursor: "pointer", lineHeight: 1.4,
                      fontStyle: photo.caption ? "normal" : "italic",
                    }}
                    title="Click to edit caption"
                  >
                    {photo.caption || "Add caption…"}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .photo-card:hover .photo-del { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
