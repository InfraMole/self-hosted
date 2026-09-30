// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { getEnv } from "./env";

/**
 * Outbound email (M8b): plain text only — no HTML, so user-provided names
 * cannot inject markup. SMTP via SMTP_URL + MAIL_FROM; without SMTP, dev
 * prints the mail to the console and production drops it with a warning
 * that never includes the body (it may contain a token).
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Optional Reply-To (feedback: the sender), single line. */
  replyTo?: string;
  /** One-click unsubscribe URL (RFC 8058) for optional mail such as the weekly digest. */
  unsubscribeUrl?: string;
}

type Transport = (mail: Mail) => Promise<void>;

const globalForMail = globalThis as unknown as {
  __depmapMail?: Transport;
  __depmapMailTest?: Transport;
};

/** Tests: capture mail and behave as if SMTP were configured. */
export function setMailTransportForTests(transport: Transport | undefined) {
  globalForMail.__depmapMailTest = transport;
}

/** True when mail really leaves the server (drives email verification). */
export function mailerConfigured(): boolean {
  return Boolean(globalForMail.__depmapMailTest || getEnv().SMTP_URL);
}

async function smtpTransport(): Promise<Transport> {
  const env = getEnv();
  if (!env.MAIL_FROM) throw new Error("MAIL_FROM is required when SMTP_URL is set");
  const { createTransport } = await import("nodemailer");
  const transporter = createTransport(env.SMTP_URL!);
  return async ({ unsubscribeUrl, ...mail }) => {
    await transporter.sendMail({
      from: env.MAIL_FROM,
      ...mail,
      ...(unsubscribeUrl && {
        list: { unsubscribe: { url: unsubscribeUrl, comment: "Unsubscribe" } },
        headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
  };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 200);

export async function sendMail(mail: Mail): Promise<void> {
  const clean = {
    ...mail,
    to: oneLine(mail.to),
    subject: oneLine(mail.subject),
    ...(mail.replyTo && { replyTo: oneLine(mail.replyTo) }),
  };
  if (globalForMail.__depmapMailTest) return globalForMail.__depmapMailTest(clean);
  const env = getEnv();
  if (env.SMTP_URL) {
    globalForMail.__depmapMail ??= await smtpTransport();
    return globalForMail.__depmapMail(clean);
  }
  if (env.NODE_ENV === "production") {
    console.warn(`[mail] SMTP_URL is not set; dropped "${clean.subject}"`);
    return;
  }
  console.info(`\n[mail] To: ${clean.to}\n[mail] Subject: ${clean.subject}\n${clean.text}\n`);
}

// ───────────────────────── Templates ─────────────────────────

const footer = "\n\n— InfraMole · See what depends on what.";

export function verificationMail(to: string, name: string, url: string): Mail {
  return {
    to,
    subject: "Verify your email for InfraMole",
    text: `Hi ${oneLine(name)},\n\nConfirm your email address to finish creating your InfraMole account:\n\n${url}\n\nThe link expires in 1 hour. If you did not sign up, ignore this email.${footer}`,
  };
}

export function resetPasswordMail(to: string, name: string, url: string): Mail {
  return {
    to,
    subject: "Reset your InfraMole password",
    text: `Hi ${oneLine(name)},\n\nSomeone (hopefully you) asked to reset your InfraMole password:\n\n${url}\n\nThe link expires in 1 hour. If it was not you, ignore this email — your password stays the same.${footer}`,
  };
}

export function invitationMail(
  to: string,
  inviter: string,
  workspace: string,
  role: string,
  url: string,
): Mail {
  return {
    to,
    subject: `${oneLine(inviter)} invited you to ${oneLine(workspace)} on InfraMole`,
    text: `${oneLine(inviter)} invited you to the workspace "${oneLine(workspace)}" on InfraMole as ${role}.\n\nAccept the invitation (sign in or create an account with this email address):\n\n${url}\n\nThe link expires in 7 days.${footer}`,
  };
}
