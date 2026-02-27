import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProbeResult {
  url: string;
  status: number | null;
  body: string;
  error: string | null;
}

export default function EdgeDebug() {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [loading, setLoading] = useState<string | null>(null);

  async function probe(key: string, url: string, init: RequestInit) {
    setLoading(key);
    try {
      const resp = await fetch(url, init);
      const text = await resp.text();
      setResults((r) => ({ ...r, [key]: { url, status: resp.status, body: text.slice(0, 500), error: null } }));
    } catch (e: any) {
      setResults((r) => ({ ...r, [key]: { url, status: null, body: "", error: e.message } }));
    } finally {
      setLoading(null);
    }
  }

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { "Content-Type": "application/json" };
    return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
  }

  const fnUrl = (name: string) => `${base}/functions/v1/${name}`;

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Edge Function Debug Probe</h1>

      <p><strong>VITE_SUPABASE_URL:</strong> {base}</p>
      <p><strong>dev-engine-v2 endpoint:</strong> {fnUrl("dev-engine-v2")}</p>
      <p><strong>analyze-project endpoint:</strong> {fnUrl("analyze-project")}</p>

      <hr style={{ margin: "16px 0" }} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button
          disabled={!!loading}
          onClick={() => probe("options-dev", fnUrl("dev-engine-v2"), { method: "OPTIONS" })}
        >
          {loading === "options-dev" ? "…" : "A) Ping dev-engine-v2 (OPTIONS)"}
        </button>

        <button
          disabled={!!loading}
          onClick={async () => {
            const headers = await getAuthHeaders();
            probe("post-dev", fnUrl("dev-engine-v2"), {
              method: "POST",
              headers,
              body: JSON.stringify({ action: "regen-insufficient-status", jobId: "00000000-0000-0000-0000-000000000000" }),
            });
          }}
        >
          {loading === "post-dev" ? "…" : "B) Ping dev-engine-v2 (POST noop)"}
        </button>

        <button
          disabled={!!loading}
          onClick={() => probe("options-analyze", fnUrl("analyze-project"), { method: "OPTIONS" })}
        >
          {loading === "options-analyze" ? "…" : "C) Ping analyze-project (OPTIONS)"}
        </button>
      </div>

      {Object.entries(results).map(([key, r]) => (
        <div key={key} style={{ marginBottom: 16, padding: 12, border: "1px solid #444", borderRadius: 4 }}>
          <p><strong>{key}</strong></p>
          <p>URL: {r.url}</p>
          <p>Status: <span style={{ color: r.status === 200 ? "lime" : r.status === 404 ? "red" : "orange" }}>{r.status ?? "NETWORK ERROR"}</span></p>
          {r.error && <p style={{ color: "red" }}>Error: {r.error}</p>}
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 200, overflow: "auto" }}>{r.body}</pre>
        </div>
      ))}
    </div>
  );
}
