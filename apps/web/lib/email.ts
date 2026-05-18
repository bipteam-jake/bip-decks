// Transactional email. Phase 1 only sends share-link invitations; the
// architecture (§7 "Tech stack — Email: Resend or Postmark") names Resend as
// the default. We hit Resend's REST API directly with `fetch` to avoid
// pulling in their SDK for a single endpoint.
//
// Provider selection lives in env.ts. When EMAIL_PROVIDER=console (the
// default in dev), messages are logged instead of delivered so engineers
// can copy the magic-link URL out of the dev server output.

import { env } from '@/lib/env';

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body. Recommended even when html is set, per Resend docs. */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

export async function sendEmail(msg: SendEmailInput): Promise<void> {
  const provider = env.emailProvider;
  if (provider === 'console') {
    // Dev sink. Log enough that an engineer can paste the magic link into
    // their browser without leaving the terminal. pino lands in a follow-up
    // session per the coding conventions in copilot-instructions.md.
    // eslint-disable-next-line no-console
    console.log('[email:console] would send', {
      to: msg.to,
      subject: msg.subject,
      body: msg.text,
    });
    return;
  }
  if (provider === 'resend') {
    return sendViaResend(msg);
  }
  // Unreachable: env.ts validates the union, but make the exhaustiveness
  // explicit for future provider additions.
  throw new Error(`Email provider not implemented: ${provider as string}`);
}

async function sendViaResend(msg: SendEmailInput): Promise<void> {
  const apiKey = env.emailApiKey;
  if (!apiKey) {
    throw new Error('EMAIL_API_KEY is required when EMAIL_PROVIDER=resend');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 500)}`);
  }
}
