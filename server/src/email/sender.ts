import { config } from '../config.js';

let configured = false;

export function initEmail() {
  if (!config.resendApiKey) {
    console.warn('RESEND_API_KEY not set — emails will be logged to console');
    return;
  }
  configured = true;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const from = config.emailFrom || 'noreply@sellserv.local';

  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Email is not configured (RESEND_API_KEY not set) — cannot send emails in production',
      );
    }
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Email send failed: ${err.message || res.statusText}`);
  }
}
