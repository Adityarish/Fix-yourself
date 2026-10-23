"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Mail,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type MessageKind = "error" | "info" | "success";

function readableEmailError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  if (
    code === "over_email_send_rate_limit" ||
    /rate limit|too many requests/i.test(message)
  ) {
    return "Supabase has temporarily limited sign-in emails. Wait before requesting another message. For production, configure Custom SMTP in Supabase Auth.";
  }
  if (/not authorized/i.test(message)) {
    return "Supabase's test email service only delivers to project team addresses. Configure Custom SMTP in Supabase Auth to send OTPs to every user.";
  }
  return message || "The sign-in email could not be sent.";
}

function safeNextPath() {
  const requested =
    new URLSearchParams(location.search).get("next") || "/today";
  return requested.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/today";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<MessageKind>("info");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const oauthStarted = useRef(false);
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const next = safeNextPath();
    let active = true;

    async function finishAuthentication() {
      if (configured) {
        try {
          const {
            data: { user },
          } = await createClient().auth.getUser();
          if (!active) return;
          if (user) {
            location.replace(next);
            return;
          }
        } catch {
          // Show the callback error below if session lookup is unavailable.
        }
      }
      if (!active) return;

      if (params.get("session") === "cleared") {
        setMessage(
          "Old local sign-in cookies were cleared. You can sign in now.",
        );
        setMessageKind("success");
        return;
      }
      if (params.get("error") !== "auth") return;
      const reason = params.get("reason");
      setMessageKind("error");
      if (reason === "missing_verifier")
        setMessage(
          "That sign-in link was opened in a different browser or the request is no longer available. Request a fresh link below.",
        );
      else if (reason === "expired_code")
        setMessage(
          "That sign-in link has expired or was already used. Request a new one.",
        );
      else if (reason === "google_not_enabled")
        setMessage(
          "Google sign-in is not enabled in Supabase yet. Enable the Google provider and try again.",
        );
      else if (reason === "google_cancelled")
        setMessage("Google sign-in was cancelled. You can try again below.");
      else if (reason === "oauth_failed")
        setMessage(
          "Google could not complete sign-in. Check its Supabase provider settings and try again.",
        );
      else if (reason === "configuration")
        setMessage("Supabase authentication is not configured correctly.");
      else
        setMessage(
          "The sign-in link could not be completed. Request a fresh link.",
        );
    }

    void finishAuthentication();
    return () => {
      active = false;
    };
  }, [configured]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  async function continueWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setSent(false);
    setMessage("");

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const next = safeNextPath();
      const { error } = await createClient().auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${location.origin}/auth/email-confirm?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;

      setSent(true);
      setSentEmail(normalizedEmail);
      setOtp("");
      setResendSeconds(60);
      setMessageKind("success");
      setMessage(
        `Email requested for ${normalizedEmail}. Delivery can take a minute; check Spam or Promotions too. Enter the code below without leaving this app.`,
      );
    } catch (error) {
      setMessageKind("error");
      setMessage(readableEmailError(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = otp.replace(/\D/g, "").slice(0, 6);
    if (!sentEmail || token.length !== 6) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await createClient().auth.verifyOtp({
        email: sentEmail,
        token,
        type: "email",
      });
      if (error) throw error;
      location.replace(safeNextPath());
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "That one-time code could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (oauthStarted.current) return;
    oauthStarted.current = true;
    setBusy(true);
    setSent(false);
    setMessage("");
    try {
      const next = safeNextPath();
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback?provider=google&next=${encodeURIComponent(next)}`,
          queryParams: {
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
    } catch (error) {
      oauthStarted.current = false;
      setBusy(false);
      setMessageKind("error");
      setMessage(
        error instanceof Error ? error.message : "Google sign-in failed.",
      );
    }
  }

  return (
    <main className="auth-wrap login-page">
      <div className="login-background" aria-hidden="true">
        <span className="login-orb login-orb-one" />
        <span className="login-orb login-orb-two" />
        <span className="login-grid" />
      </div>

      <div className="login-layout">
        <section
          className="login-showcase"
          aria-label="NestList planner preview"
        >
          <div className="login-kicker">
            <Sparkles size={15} />
            Calm planning for busy days
          </div>
          <h1>Your day, beautifully in sync.</h1>
          <p>
            Plan personal tasks, build routines, and coordinate shared lists in
            one focused space.
          </p>

          <div className="planner-preview">
            <div className="preview-topbar">
              <div className="preview-window-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="preview-date">
                <CalendarDays size={14} /> Friday, October 23
              </div>
              <div className="preview-avatars">
                <span>AS</span>
                <span>RK</span>
              </div>
            </div>

            <div className="preview-body">
              <div className="preview-heading">
                <div>
                  <span>Today</span>
                  <strong>Make space for what matters.</strong>
                </div>
                <span className="preview-count">3 of 5 done</span>
              </div>

              <div className="preview-progress">
                <span />
              </div>

              <div className="preview-tasks">
                <div className="preview-task complete">
                  <span className="preview-check">
                    <Check size={13} />
                  </span>
                  <span>Morning focus routine</span>
                  <small>08:00</small>
                </div>
                <div className="preview-task complete">
                  <span className="preview-check">
                    <Check size={13} />
                  </span>
                  <span>Review shared project plan</span>
                  <small>10:30</small>
                </div>
                <div className="preview-task">
                  <span className="preview-check" />
                  <span>Prepare tomorrow&apos;s priorities</span>
                  <small>18:00</small>
                </div>
              </div>

              <div className="preview-footer-cards">
                <div>
                  <span className="preview-icon purple">
                    <Clock3 size={15} />
                  </span>
                  <p>
                    <strong>12 day</strong> routine streak
                  </p>
                </div>
                <div>
                  <span className="preview-icon cyan">
                    <UsersRound size={15} />
                  </span>
                  <p>
                    <strong>4 people</strong> in Home circle
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="login-benefits">
            <span>
              <CheckCircle2 size={15} /> Works offline
            </span>
            <span>
              <CheckCircle2 size={15} /> Shared in real time
            </span>
            <span>
              <CheckCircle2 size={15} /> Gentle reminders
            </span>
          </div>
        </section>

        <section className="auth-card login-card">
          <div className="brand">
            <span className="brand-mark">≋</span>
            <span>NestList</span>
          </div>

          <div className="login-card-copy">
            <span className="login-card-eyebrow">Welcome</span>
            <h2>Start with your email</h2>
            <p>
              We&apos;ll send a secure link and one-time code. New emails get an
              account automatically.
            </p>
          </div>

          <form className="email-login-form" onSubmit={continueWithEmail}>
            <label htmlFor="login-email">Email address</label>
            <div className="auth-input-shell">
              <Mail size={18} aria-hidden="true" />
              <input
                id="login-email"
                autoComplete="email"
                inputMode="email"
                required
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setSent(false);
                  setSentEmail("");
                  setOtp("");
                  setResendSeconds(0);
                }}
                placeholder="you@example.com"
              />
            </div>
            <button
              className="button email-continue"
              type="submit"
              disabled={!configured || busy || resendSeconds > 0}
            >
              <span>
                {busy
                  ? "Sending verification code…"
                  : resendSeconds > 0
                    ? `Resend available in ${resendSeconds}s`
                    : sent
                      ? "Send another code"
                      : "Continue with email"}
              </span>
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          {sent && sentEmail && (
            <form className="email-code-form" onSubmit={confirmEmailCode}>
              <div className="email-code-heading">
                <div>
                  <strong>Enter the code from your email</strong>
                  <span>
                    Look for “Your NestList verification code”. Enter the
                    six-digit code without leaving this app.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setSentEmail("");
                    setOtp("");
                    setMessage("");
                    setResendSeconds(0);
                  }}
                >
                  Change email
                </button>
              </div>
              <input
                aria-label="One-time email code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
              />
              <button
                className="button"
                type="submit"
                disabled={otp.length !== 6 || busy}
              >
                {busy ? "Verifying…" : "Verify and open NestList"}
              </button>
            </form>
          )}

          <div className="auth-divider">
            <span>or</span>
          </div>

          <button
            className="subtle-button google-button"
            type="button"
            disabled={!configured || busy}
            onClick={google}
          >
            <span className="google-mark">G</span>
            Continue with Google
          </button>

          <div className="login-security-note">
            <ShieldCheck size={16} />
            <span>
              No password to remember. Each email link can be used once.
            </span>
          </div>

          {!configured && (
            <div className="auth-feedback error">
              Add the Supabase URL and publishable key to{" "}
              <code>.env.local</code>.
            </div>
          )}
          {message && (
            <div className={`auth-feedback ${messageKind}`} role="status">
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
