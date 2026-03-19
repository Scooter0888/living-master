"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";

interface BackupStatus {
  data_dir: string;
  components: Record<string, { exists: boolean; size_mb: number; files: number }>;
  total_size_mb: number;
  estimated_zip_mb: number;
}

export default function BackupPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    status: string;
    restored: string[];
    skipped: string[];
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const s = await api.backup.status();
      setStatus(s);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      await api.backup.exportDownload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".zip")) {
      setError("Please select a .zip file exported from Living Master.");
      return;
    }

    setImporting(true);
    setImportResult(null);
    setError(null);

    try {
      const result = await api.backup.import(file);
      setImportResult(result);
      await loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const COMPONENT_LABELS: Record<string, string> = {
    "living_master.db": "Database",
    chroma_db: "Vector Embeddings",
    uploads: "Uploaded Files",
    photos: "Photos",
    voice_samples: "Voice Samples",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Backup & Restore</h2>
        <p className="text-sm text-neutral-400">
          Export your entire database, embeddings, and media files as a single zip. Import it on
          Railway (or another machine) to migrate all your data.
        </p>
      </div>

      {/* Status */}
      {loading && (
        <p className="text-sm text-neutral-500 animate-pulse">Loading data status…</p>
      )}
      {status && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-300">Data Directory</span>
            <span className="text-xs text-neutral-500 font-mono truncate max-w-[60%] text-right">
              {status.data_dir}
            </span>
          </div>
          <div className="border-t border-neutral-800 pt-3 space-y-2">
            {Object.entries(status.components).map(([key, info]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${info.exists ? "bg-emerald-500" : "bg-neutral-700"}`}
                  />
                  <span className="text-neutral-300">{COMPONENT_LABELS[key] ?? key}</span>
                </div>
                <span className="text-neutral-500">
                  {info.exists
                    ? `${info.size_mb.toFixed(1)} MB · ${info.files} file${info.files !== 1 ? "s" : ""}`
                    : "empty"}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-neutral-800 pt-3 flex justify-between text-sm">
            <span className="text-neutral-400">Total size</span>
            <span className="text-white font-medium">{status.total_size_mb.toFixed(1)} MB</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Estimated zip size</span>
            <span className="text-neutral-300">~{status.estimated_zip_mb.toFixed(1)} MB</span>
          </div>
        </div>
      )}

      {/* Export */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-1">Export Backup</h3>
        <p className="text-xs text-neutral-500 mb-3">
          Downloads a zip containing the database, all vector embeddings, uploaded files, photos,
          and voice samples.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700
                     text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {exporting ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Building export…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Backup (.zip)
            </>
          )}
        </button>
      </div>

      {/* Import */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-1">Import Backup</h3>
        <p className="text-xs text-neutral-500 mb-3">
          Upload a zip exported from Living Master. This <strong className="text-neutral-300">replaces</strong> all
          existing data. After import, redeploy the backend service for changes to take full effect.
        </p>
        <label
          className={`w-full py-2.5 px-4 border-2 border-dashed rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 text-sm font-medium
            ${importing
              ? "border-neutral-700 text-neutral-600 cursor-not-allowed"
              : "border-neutral-700 hover:border-indigo-500 text-neutral-400 hover:text-indigo-300"
            }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            disabled={importing}
            onChange={handleImport}
          />
          {importing ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Restoring…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
              </svg>
              Choose backup .zip to import
            </>
          )}
        </label>

        {importResult && (
          <div className="mt-3 p-3 bg-emerald-950 border border-emerald-800 rounded-lg space-y-2">
            <p className="text-sm font-medium text-emerald-400">Import successful</p>
            <p className="text-xs text-emerald-300">
              Restored: {importResult.restored.join(", ") || "none"}
            </p>
            {importResult.skipped.length > 0 && (
              <p className="text-xs text-neutral-500">
                Skipped (not in zip): {importResult.skipped.join(", ")}
              </p>
            )}
            <p className="text-xs text-neutral-400 mt-1">{importResult.message}</p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">How to migrate local → Railway</p>
        <ol className="text-xs text-neutral-500 space-y-1 list-decimal list-inside">
          <li>Run this app locally and click <strong className="text-neutral-300">Download Backup</strong></li>
          <li>Open your Railway deployment's Living Master URL</li>
          <li>Go to Settings → Backup & Restore</li>
          <li>Click <strong className="text-neutral-300">Choose backup .zip to import</strong> and select the file</li>
          <li>Wait for the import to complete, then redeploy in Railway dashboard</li>
        </ol>
      </div>

      {error && (
        <div className="p-3 bg-red-950 border border-red-800 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
