import React, { useState } from "react";
import { supabase } from "../lib/supabase";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setMessage("Check your email to confirm your account (if confirmation is enabled).");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err: any) {
      setError(err?.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <style>{authCss}</style>
      <div className="auth-card">
        <img src="/parhelia-logo.png" alt="Parhelia Bio" className="auth-brand" />
        <h1>Now / Next / Later</h1>
        <p className="muted tiny">Sign in to sync boards with your team.</p>

        <form onSubmit={submit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-ok">{message}</p>}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          className="auth-toggle"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

const authCss = `
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #0b1423;
  color: #e5f2ff;
  font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
}
.auth-card {
  width: 100%;
  max-width: 380px;
  background: #0f1a2b;
  border: 1px solid #203049;
  border-radius: 16px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.auth-brand { height: 48px; width: auto; object-fit: contain; }
.auth-card h1 { font-size: 20px; margin: 0; }
.muted { color: #9fb6d1; }
.tiny { font-size: 12px; }
.auth-form { width: 100%; display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
.auth-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9fb6d1; }
.auth-form input {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #203049;
  background: #0b1423;
  color: #e5f2ff;
  font: inherit;
}
.auth-submit {
  margin-top: 4px;
  padding: 10px;
  border-radius: 8px;
  border: none;
  background: #27b0ff;
  color: #0b1423;
  font-weight: 600;
  cursor: pointer;
}
.auth-submit:disabled { opacity: 0.6; cursor: wait; }
.auth-toggle {
  background: none;
  border: none;
  color: #27b0ff;
  cursor: pointer;
  font-size: 12px;
}
.auth-error { color: #ff6868; font-size: 12px; margin: 0; }
.auth-ok { color: #62e46f; font-size: 12px; margin: 0; }
`;
