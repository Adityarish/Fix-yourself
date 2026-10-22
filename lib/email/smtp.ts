import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export function hasSmtpConfiguration() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

export async function sendSmtpEmail(message: EmailMessage) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  if (!smtpUser || !smtpPassword)
    throw new Error("SMTP_USER and SMTP_PASSWORD are not configured.");

  const port = Number(process.env.SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("SMTP_PORT is invalid.");

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    auth: { user: smtpUser, pass: smtpPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM_ADDRESS || `NestList <${smtpUser}>`,
    ...message,
  });
}
