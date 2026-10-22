"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    const { data, error } = await createClient().rpc("accept_space_invite", {
      p_raw_token: token,
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.replace(`/circles/${data}`);
    router.refresh();
  }
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">≋</span>
          <span>NestList</span>
        </div>
        <h1>Join this Circle</h1>
        <p>
          Accepting adds this signed-in account to the shared space. The
          invitation must match your account email.
        </p>
        <button className="button" onClick={accept} disabled={busy}>
          {busy ? "Joining…" : "Accept invitation"}
        </button>
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </section>
    </main>
  );
}
