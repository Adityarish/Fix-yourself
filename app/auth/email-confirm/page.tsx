import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmailConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenHash = valueOf(params.token_hash) ?? "";
  const type = valueOf(params.type) ?? "email";
  const requestedNext = valueOf(params.next) ?? "/today";
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/today";
  const valid = Boolean(tokenHash && type);

  return (
    <main className="auth-wrap email-confirm-page">
      <section className="auth-card email-confirm-card">
        <div className="brand">
          <span className="brand-mark">≋</span>
          <span>NestList</span>
        </div>
        <span className="email-confirm-icon" aria-hidden="true">
          <ShieldCheck size={27} />
        </span>
        <p className="login-card-eyebrow">Secure email confirmation</p>
        <h1>
          {valid ? "Ready to open your plan?" : "This link is incomplete"}
        </h1>
        <p>
          {valid
            ? "Continue to verify this one-time link and sign in. This extra tap prevents mail security scanners from using the link before you do."
            : "Request a fresh email from the NestList sign-in page, then use its secure button or one-time code."}
        </p>
        {valid ? (
          <form action="/auth/confirm" method="post">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <button className="button" type="submit">
              Continue securely <ArrowRight size={17} />
            </button>
          </form>
        ) : (
          <Link className="button" href="/login">
            Request a new email <ArrowRight size={17} />
          </Link>
        )}
        <small>Only continue if you requested this NestList email.</small>
      </section>
    </main>
  );
}
