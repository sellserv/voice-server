import { config } from '../config.js';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verify a Cloudflare Turnstile token.
 * Returns true if verification succeeds or if Turnstile is not configured.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!config.turnstileSecretKey) return true; // Skip if not configured

  if (!token) return false;

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.turnstileSecretKey,
        response: token,
        remoteip: ip,
      }),
    });

    const data = (await res.json()) as TurnstileResponse;
    if (!data.success) {
      console.warn('Turnstile verification failed:', data['error-codes']);
    }
    return data.success;
  } catch (err) {
    console.error('Turnstile verification error:', err);
    return false;
  }
}

/**
 * Whether Turnstile CAPTCHA is enabled (both keys configured).
 */
export function isTurnstileEnabled(): boolean {
  return !!(config.turnstileSiteKey && config.turnstileSecretKey);
}

/**
 * Check if a request comes from the desktop (Electron) app.
 * Turnstile cannot run in Electron since it loads from localhost.
 */
export function isDesktopClient(userAgent: string | undefined): boolean {
  return !!userAgent && userAgent.includes('Electron');
}
