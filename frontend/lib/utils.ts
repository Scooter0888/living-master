import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export const CONTENT_TYPE_ICONS: Record<string, string> = {
  youtube: "▶",
  web: "◉",
  audio: "♪",
  video: "◈",
  pdf: "⊟",
  docx: "⊞",
  text: "≡",
};

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  web: "Web",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
  docx: "Document",
  text: "Text",
};

export const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400",
  processing: "text-blue-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
};
