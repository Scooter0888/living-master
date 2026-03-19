const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ACCESS_TOKEN = process.env.NEXT_PUBLIC_ACCESS_TOKEN || "";

function headers(extra: Record<string, string> = {}): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {}),
    ...extra,
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// --- Masters ---
export interface Master {
  id: string;
  name: string;
  description?: string;
  avatar_color: string;
  profile_photo_url?: string;
  source_count: number;
  total_chunks: number;
  created_at: string;
  updated_at: string;
  sources?: Source[];
  voice_id?: string;
  voice_status?: "none" | "cloning" | "ready";
}

export interface Source {
  id: string;
  master_id: string;
  url?: string;
  title?: string;
  content_type: string;
  status: "pending" | "processing" | "completed" | "failed" | "needs_speaker_id";
  error_message?: string;
  chunk_count?: number;
  duration_seconds?: number;
  thumbnail_url?: string;
  author?: string;
  created_at: string;
  has_diarization?: boolean;
  speaker_count?: number;
  speaker_label?: string;
  has_movement_analysis?: boolean;
  speaker_samples?: Record<string, string[]>;
  processing_stage?: string;
  progress_pct?: number;
}

export interface Photo {
  id: string;
  filename: string;
  caption?: string;
  url: string;
  created_at: string;
}

export interface VoiceStatus {
  voice_status: "none" | "cloning" | "ready";
  voice_id?: string;
}

export interface EdgeVoice {
  id: string;
  name: string;
  accent: string;
  gender: string;
  description: string;
}

export interface DiscoveryResult {
  name: string;
  total_found: number;
  categories: {
    label: string;
    items: DiscoveryItem[];
  }[];
}

export interface DiscoveryItem {
  title: string;
  url: string;
  snippet?: string;
  thumbnail_url?: string;
  content_type: string;
  author?: string;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface TranscriptResponse {
  source_id: string;
  title: string;
  url?: string;
  content_type: string;
  author?: string;
  duration_seconds?: number;
  word_count: number;
  pages_estimate: number;
  chunk_count: number;
  text: string;
  segments?: TranscriptSegment[];
  speaker_label?: string;
  has_diarization?: boolean;
}

export interface Capabilities {
  diarization: boolean;
  voice_cloning: boolean;
  movement_analysis: boolean;
  tts: boolean;
  rag: boolean;
}

export interface KnowledgeStats {
  master_name: string;
  total_sources: number;
  total_chunks: number;
  total_words: number;
  estimated_pages: number;
  by_type: Record<string, { count: number; words: number }>;
  sources: {
    id: string;
    title: string;
    url?: string;
    content_type: string;
    author?: string;
    word_count: number;
    pages_estimate: number;
    chunk_count: number;
    duration_seconds?: number;
  }[];
}

export const api = {
  masters: {
    list: () => request<Master[]>("/masters/"),
    get: (id: string) => request<Master>(`/masters/${id}`),
    create: (data: { name: string; description?: string; avatar_color?: string }) =>
      request<Master>("/masters/", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Master>) =>
      request<Master>(`/masters/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) =>
      fetch(`${API_BASE}/masters/${id}`, { method: "DELETE", headers: headers() }),
    uploadProfilePhoto: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${API_BASE}/masters/${id}/profile-photo`, {
        method: "POST",
        headers: ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {},
        body: form,
      }).then((r) => r.json() as Promise<Master>);
    },
    deleteProfilePhoto: (id: string) =>
      fetch(`${API_BASE}/masters/${id}/profile-photo`, { method: "DELETE", headers: headers() }),
  },

  ingest: {
    url: (masterId: string, url: string) =>
      request<{ source_id: string; status: string }>(`/masters/${masterId}/ingest/url`, {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
    file: (masterId: string, file: File, analyseMovements = false) => {
      const form = new FormData();
      form.append("file", file);
      form.append("analyse_movements", analyseMovements ? "1" : "0");
      return fetch(`${API_BASE}/masters/${masterId}/ingest/file`, {
        method: "POST",
        headers: ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {},
        body: form,
      }).then((r) => r.json());
    },
    deleteSource: (masterId: string, sourceId: string) =>
      fetch(`${API_BASE}/masters/${masterId}/ingest/sources/${sourceId}`, {
        method: "DELETE",
        headers: headers(),
      }),
    reingestSource: (masterId: string, sourceId: string) =>
      request<{ source_id: string; status: string }>(`/masters/${masterId}/ingest/sources/${sourceId}/reingest`, {
        method: "POST",
      }),
    localPath: (masterId: string, path: string, analyseMovements = false) =>
      request<{ source_id: string; status: string }>(`/masters/${masterId}/ingest/local-path`, {
        method: "POST",
        body: JSON.stringify({ path, analyse_movements: analyseMovements }),
      }),
    retryAllFailed: (masterId: string) =>
      request<{ retried: number; message: string }>(`/masters/${masterId}/ingest/retry-failed`, {
        method: "POST",
      }),
    scanLocal: (masterId: string) =>
      request<{ sources: { label: string; path: string; type: string; detail: string }[] }>(
        `/masters/${masterId}/ingest/scan-local`
      ),
  },

  sources: {
    getStatus: (sourceId: string) => request<Source>(`/sources/${sourceId}/status`),
    getTranscript: (sourceId: string) => request<TranscriptResponse>(`/sources/${sourceId}/transcript`),
    translate: (sourceId: string, targetLanguage: string) =>
      request<{ source_id: string; target_language: string; text: string; segments: TranscriptSegment[] }>(
        `/sources/${sourceId}/translate`,
        { method: "POST", body: JSON.stringify({ target_language: targetLanguage }) }
      ),
  },

  media: {
    listPhotos: (masterId: string) => request<Photo[]>(`/masters/${masterId}/media/photos`),
    uploadPhoto: (masterId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${API_BASE}/masters/${masterId}/media/photos`, {
        method: "POST",
        headers: ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {},
        body: form,
      }).then((r) => r.json() as Promise<Photo>);
    },
    deletePhoto: (masterId: string, photoId: string) =>
      fetch(`${API_BASE}/masters/${masterId}/media/photos/${photoId}`, {
        method: "DELETE",
        headers: headers(),
      }),
    updateCaption: (masterId: string, photoId: string, caption: string) =>
      request<Photo>(`/masters/${masterId}/media/photos/${photoId}`, {
        method: "PATCH",
        body: JSON.stringify({ caption }),
      }),
  },

  voice: {
    getStatus: (masterId: string) => request<VoiceStatus>(`/masters/${masterId}/voice/status`),
    getVoices: (masterId: string) =>
      request<{ voices: EdgeVoice[] }>(`/masters/${masterId}/voice/voices`),
    selectVoice: (masterId: string, voiceId: string) =>
      request<{ status: string; voice_id: string }>(`/masters/${masterId}/voice/select`, {
        method: "POST",
        body: JSON.stringify({ voice_id: voiceId }),
      }),
    previewVoice: async (masterId: string, voiceName: string, text?: string): Promise<Blob> => {
      const res = await fetch(`${API_BASE}/masters/${masterId}/voice/preview`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ voice_name: voiceName, text }),
      });
      if (!res.ok) throw new Error("Preview failed");
      return res.blob();
    },
    clone: (masterId: string, sourceIds?: string[]) =>
      request<{ status: string; message: string }>(`/masters/${masterId}/voice/clone`, {
        method: "POST",
        body: JSON.stringify({ source_ids: sourceIds ?? null }),
      }),
    synthesize: async (masterId: string, text: string): Promise<Blob> => {
      const res = await fetch(`${API_BASE}/masters/${masterId}/voice/synthesize`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("TTS synthesis failed");
      return res.blob();
    },
    identifySpeaker: (
      masterId: string,
      sourceId: string,
      masterSpeaker: string,
      otherRoles: Record<string, "interviewer" | "translator" | "skip"> = {}
    ) =>
      request<{ status: string }>(`/masters/${masterId}/voice/identify-speaker`, {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, master_speaker: masterSpeaker, other_roles: otherRoles }),
      }),
    reindexAll: (masterId: string) =>
      request<{ queued: number; message: string }>(`/masters/${masterId}/voice/reindex-all`, { method: "POST" }),
    autoIdentifyAll: (masterId: string) =>
      request<{
        queued: number;
        low_confidence: number;
        message: string;
        results: {
          source_id: string;
          source_title: string;
          matched_speaker: string;
          score: number;
          gap: number;
          confident: boolean;
          speaker_scores: Record<string, number>;
        }[];
      }>(`/masters/${masterId}/voice/auto-identify-all`, { method: "POST", body: JSON.stringify({}) }),
  },

  export: {
    getStats: (masterId: string) => request<KnowledgeStats>(`/masters/${masterId}/export/stats`),
    downloadPdf: async (masterId: string, title: string, content: string, includePhotos = true): Promise<Blob> => {
      const res = await fetch(`${API_BASE}/masters/${masterId}/export/book/pdf`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ title, content, include_photos: includePhotos }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      return res.blob();
    },
    analyseMovements: (masterId: string, sourceId: string) =>
      request<{ status: string }>(`/masters/${masterId}/export/sources/${sourceId}/analyse-movements`, {
        method: "POST",
      }),
    streamTopics: async function* (masterId: string): AsyncGenerator<string> {
      const res = await fetch(`${API_BASE}/masters/${masterId}/export/topics/stream`, {
        headers: ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {},
      });
      if (!res.ok || !res.body) throw new Error("Stream request failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;
            if (data.startsWith("[ERROR]")) throw new Error(data.slice(8));
            yield data.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
          }
        }
      }
    },
    streamBook: async function* (masterId: string, topic?: string): AsyncGenerator<string> {
      const res = await fetch(`${API_BASE}/masters/${masterId}/export/book/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {}),
        },
        body: JSON.stringify({ topic: topic || null }),
      });
      if (!res.ok || !res.body) throw new Error("Stream request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;
            if (data.startsWith("[ERROR]")) throw new Error(data.slice(8));
            yield data.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
          }
        }
      }
    },
  },

  backup: {
    status: () =>
      request<{
        data_dir: string;
        components: Record<string, { exists: boolean; size_mb: number; files: number }>;
        total_size_mb: number;
        estimated_zip_mb: number;
      }>("/backup/status"),

    exportUrl: () => `${API_BASE}/backup/export${ACCESS_TOKEN ? `?token=${encodeURIComponent(ACCESS_TOKEN)}` : ""}`,

    exportDownload: async (): Promise<void> => {
      const res = await fetch(`${API_BASE}/backup/export`, {
        headers: ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {},
      });
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "living_master_backup.zip";
      a.click();
      URL.revokeObjectURL(url);
    },

    import: async (file: File): Promise<{ status: string; restored: string[]; skipped: string[]; message: string }> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/backup/import`, {
        method: "POST",
        headers: ACCESS_TOKEN ? { "X-Access-Token": ACCESS_TOKEN } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Import failed: ${res.status}`);
      }
      return res.json();
    },
  },

  capabilities: () => request<Capabilities>("/capabilities"),

  discover: {
    search: (name: string, maxPerCategory = 10, context = "") =>
      request<DiscoveryResult>("/discover/search", {
        method: "POST",
        body: JSON.stringify({ name, max_per_category: maxPerCategory, context }),
      }),
    bulkIngest: (masterId: string, urls: string[]) =>
      request<{ queued: number; sources: { source_id: string; url: string }[] }>(
        "/discover/ingest-bulk",
        {
          method: "POST",
          body: JSON.stringify({ master_id: masterId, urls }),
        }
      ),
    channelVideos: (channelUrl: string) =>
      request<{ channel_url: string; total: number; videos: DiscoveryItem[] }>(
        "/discover/channel-videos",
        {
          method: "POST",
          body: JSON.stringify({ channel_url: channelUrl }),
        }
      ),
  },

  query: {
    suggest: (masterId: string) => request<{ question: string }>(`/masters/${masterId}/query/suggest`),
    stream: (_masterId: string, _question: string): EventSource => {
      return null as any; // handled via streamFetch
    },
    streamFetch: async function* (masterId: string, question: string, mode = "strict"): AsyncGenerator<string> {
      const res = await fetch(`${API_BASE}/masters/${masterId}/query/stream`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ question, stream: true, mode }),
      });
      if (!res.ok || !res.body) throw new Error("Stream request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;
            if (data.startsWith("[ERROR]")) throw new Error(data.slice(8));
            yield data;
          }
        }
      }
    },
  },
};
