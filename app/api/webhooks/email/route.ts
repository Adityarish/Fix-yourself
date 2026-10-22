import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sendSmtpEmail } from "@/lib/email/smtp";

export const runtime = "nodejs";

const emailSchema = z.object({
  to: z.string().email(),
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(20_000),
});

function hasValidBearerToken(request: Request, expected: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const received = authorization.slice("Bearer ".length);
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!webhookSecret)
    return NextResponse.json(
      { error: "Email webhook is not configured." },
      { status: 503 },
    );

  if (!hasValidBearerToken(request, webhookSecret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const parsed = emailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid email payload." },
      { status: 400 },
    );

  try {
    await sendSmtpEmail(parsed.data);
  } catch (error) {
    const configurationError =
      error instanceof Error &&
      (error.message.includes("not configured") ||
        error.message.includes("SMTP_PORT"));
    return NextResponse.json(
      {
        error: configurationError
          ? error.message
          : "Email provider rejected the message.",
      },
      { status: configurationError ? 503 : 502 },
    );
  }

  return NextResponse.json({ delivered: true });
}
