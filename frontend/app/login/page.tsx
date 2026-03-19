"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { saveToken, saveRole, isAuthenticated } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Already logged in — skip to home
  useEffect(() => {
    if (isAuthenticated()) router.replace("/");
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/auth/verify`, {
        headers: { "X-Access-Token": password.trim() },
      });
      if (res.ok) {
        saveToken(password.trim());
        // Fetch role so UI can show admin controls
        try {
          const me = await fetch(`${API_BASE}/auth/me`, { headers: { "X-Access-Token": password.trim() } });
          const data = await me.json();
          saveRole(data.role || "viewer");
        } catch { saveRole("viewer"); }
        router.replace("/");
      } else {
        setError("Incorrect password. Try again.");
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--background)", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 36 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, #5b5ef4, #818cf8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 20px rgba(91,94,244,0.35)", marginBottom: 14,
          }}>
            <Sparkles size={22} color="#fff" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: 0 }}>
            Living Master
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 6 }}>
            Enter your access password to continue
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ position: "relative" }}>
            <Lock size={15} style={{
              position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
              color: "var(--text-muted)", pointerEvents: "none",
            }} />
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Password"
              autoFocus
              style={{
                width: "100%", padding: "12px 44px 12px 40px",
                borderRadius: 12, border: `1.5px solid ${error ? "var(--color-error)" : "var(--border)"}`,
                background: "var(--surface)", color: "var(--text-primary)",
                fontSize: 14, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={e => { if (!error) e.target.style.borderColor = "var(--accent)"; }}
              onBlur={e => { if (!error) e.target.style.borderColor = "var(--border)"; }}
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)",
                display: "flex", padding: 4,
              }}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && (
            <p style={{ fontSize: 12.5, color: "var(--color-error)", margin: 0, textAlign: "center" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "12px 20px", borderRadius: 12,
              background: "var(--accent)", border: "none", color: "#fff",
              fontSize: 14, fontWeight: 600, cursor: loading || !password.trim() ? "not-allowed" : "pointer",
              opacity: loading || !password.trim() ? 0.6 : 1,
              boxShadow: "0 2px 12px var(--accent-glow)", transition: "all 0.15s",
            }}
          >
            {loading
              ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Verifying…</>
              : "Sign in"
            }
          </button>
        </form>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
