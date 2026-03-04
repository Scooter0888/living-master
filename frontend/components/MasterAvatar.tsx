"use client";
import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { Master } from "@/lib/api";
import { api } from "@/lib/api";

interface MasterAvatarProps {
  master: Master;
  size: number;
  borderRadius?: number | string;
  editable?: boolean;
  onUpdated?: (updated: Master) => void;
  /** extra box-shadow e.g. a glow — applied on top of default */
  glow?: string;
}

export function MasterAvatar({ master, size, borderRadius, editable = false, onUpdated, glow }: MasterAvatarProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const initials = master.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const br = borderRadius ?? size * 0.38;
  const fontSize = size * 0.33;

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const photoUrl = master.profile_photo_url
    ? master.profile_photo_url.startsWith("http")
      ? master.profile_photo_url
      : `${API_BASE}${master.profile_photo_url}`
    : null;

  const handleUpload = async (file: File) => {
    if (!editable || !onUpdated) return;
    setUploading(true);
    try {
      const updated = await api.masters.uploadProfilePhoto(master.id, file);
      onUpdated(updated);
    } catch (e) {
      console.error("Profile photo upload failed:", e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
      onClick={() => editable && inputRef.current?.click()}
    >
      {/* Avatar */}
      <div style={{
        width: size, height: size,
        borderRadius: typeof br === "number" ? br : br,
        background: photoUrl ? "transparent" : master.avatar_color,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize, fontWeight: 700,
        boxShadow: glow ?? `0 0 ${size * 0.45}px ${master.avatar_color}50`,
        overflow: "hidden",
        cursor: editable ? "pointer" : "default",
        transition: "opacity 0.15s",
        opacity: uploading ? 0.5 : 1,
      }}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={master.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initials
        )}
      </div>

      {/* Camera overlay on hover */}
      {editable && (
        <div style={{
          position: "absolute", inset: 0,
          borderRadius: typeof br === "number" ? br : br,
          background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0, transition: "opacity 0.15s",
          cursor: "pointer",
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = "0"; }}
        >
          <Camera size={size * 0.3} color="#fff" />
        </div>
      )}

      {/* Hidden file input */}
      {editable && (
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
        />
      )}
    </div>
  );
}
