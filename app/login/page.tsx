"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  async function submit(mode: "signin" | "signup") {
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${location.origin}/auth/callback` },
            });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session)
        setMessage("Check your email to confirm your account, then sign in.");
      else
        router.replace(
          new URLSearchParams(location.search).get("next") || "/today",
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    try {
      const supabase = createClient();
      const next = new URLSearchParams(location.search).get("next") || "/today";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Google sign-in failed.",
      );
    }
  }

  async function resetPassword() {
    if (!email) return setMessage("Enter your email first.");
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
    });
    setMessage(
      error ? error.message : "Check your email for a password reset link.",
    );
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">≋</span>
          <span>NestList</span>
        </div>
        <h1>Make room for what matters.</h1>
        <p>
          Sign in to bring your plans with you. After the first sync, your
          personal tasks stay available offline.
        </p>
        <label>
          Email
          <input
            autoComplete="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={!configured || busy || !email || !password}
          onClick={() => submit("signin")}
        >
          {busy ? "Please wait…" : "Sign in"}
        </button>
        <button
          className="subtle-button"
          disabled={!configured || busy || !email || password.length < 8}
          onClick={() => submit("signup")}
        >
          Create an account
        </button>
        <button
          className="subtle-button"
          disabled={!configured || busy}
          onClick={google}
        >
          Continue with Google
        </button>
        <button
          className="subtle-button"
          disabled={!configured || busy || !email}
          onClick={resetPassword}
        >
          Forgot password
        </button>
        {!configured && (
          <div className="toast">
            Add the Supabase URL and publishable key from your Supabase project
            to <code>.env.local</code>.
          </div>
        )}
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </section>
    </main>
  );
}
