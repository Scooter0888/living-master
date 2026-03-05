"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
];

interface CreateMasterModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateMasterModal({ open, onClose, onCreated }: CreateMasterModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Auto-assign a color — replaced by profile photo once uploaded
  const [color] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setLoading(true);
    setError("");
    try {
      await api.masters.create({ name: name.trim(), description: description.trim() || undefined, avatar_color: color });
      setName(""); setDescription("");
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to create master");
    } finally {
      setLoading(false);
    }
  };

  const initials = name.trim().split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?";

  return (
    <Modal open={open} onClose={onClose} title="Create New Master" size="sm">
      <div className="p-6 flex flex-col gap-5">
        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-semibold"
            style={{ background: color }}
          >
            {initials}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Color auto-assigned.<br />Replace with a photo anytime.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Name (e.g. Naval Ravikant)"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="accent" size="sm" loading={loading} onClick={handleCreate}>
            Create Master
          </Button>
        </div>
      </div>
    </Modal>
  );
}
