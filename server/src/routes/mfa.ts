import type { FastifyInstance } from 'fastify';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { getDb } from '../adapters/index.js';
import { requireAuth } from '../auth/middleware.js';
import { logAuditEvent } from '../audit/log.js';

async function getServerName(): Promise<string> {
  const row = await getDb().queryOne<{ name: string }>(
    'SELECT name FROM server_settings WHERE id = 1',
  );
  return row?.name || 'SellServ Voice';
}

export default async function mfaRoutes(app: FastifyInstance) {
  // Generate TOTP secret and QR code (does not enable MFA yet)
  app.post('/api/mfa/setup', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user.userId;

    const user = await getDb().queryOne<{ username: string; totp_enabled: number }>(
      'SELECT username, totp_enabled FROM users WHERE id = ?',
      [userId],
    );
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    if (user.totp_enabled) {
      return reply.code(400).send({ error: 'MFA is already enabled' });
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: await getServerName(),
      label: user.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    // Store the secret (not yet enabled)
    await getDb().run('UPDATE users SET totp_secret = ? WHERE id = ?', [secret.base32, userId]);

    const uri = totp.toString();
    const qr_url = await QRCode.toDataURL(uri);

    return { qr_url, secret: secret.base32 };
  });

  // Verify TOTP code to confirm setup and enable MFA
  app.post<{ Body: { totp_code: string } }>(
    '/api/mfa/verify',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { totp_code } = request.body;

      if (!totp_code) {
        return reply.code(400).send({ error: 'TOTP code required' });
      }

      const user = await getDb().queryOne<{ totp_secret: string; totp_enabled: number }>(
        'SELECT totp_secret, totp_enabled FROM users WHERE id = ?',
        [userId],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      if (user.totp_enabled) {
        return reply.code(400).send({ error: 'MFA is already enabled' });
      }
      if (!user.totp_secret) {
        return reply.code(400).send({ error: 'Run /api/mfa/setup first' });
      }

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(user.totp_secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });

      const delta = totp.validate({ token: totp_code, window: 1 });
      if (delta === null) {
        return reply.code(401).send({ error: 'Invalid TOTP code' });
      }

      await getDb().run("UPDATE users SET totp_enabled = 1, mfa_method = 'totp' WHERE id = ?", [userId]);
      await logAuditEvent('mfa_enable', request.user.userId, null, request.ip);

      return { ok: true };
    },
  );

  // Disable MFA (requires current TOTP code)
  app.post<{ Body: { totp_code: string } }>(
    '/api/mfa/disable',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { totp_code } = request.body;

      if (!totp_code) {
        return reply.code(400).send({ error: 'TOTP code required' });
      }

      const user = await getDb().queryOne<{ totp_secret: string; totp_enabled: number }>(
        'SELECT totp_secret, totp_enabled FROM users WHERE id = ?',
        [userId],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      if (!user.totp_enabled || !user.totp_secret) {
        return reply.code(400).send({ error: 'MFA is not enabled' });
      }

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(user.totp_secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });

      const delta = totp.validate({ token: totp_code, window: 1 });
      if (delta === null) {
        return reply.code(401).send({ error: 'Invalid TOTP code' });
      }

      await getDb().run(
        "UPDATE users SET totp_enabled = 0, totp_secret = NULL, mfa_method = 'email' WHERE id = ?",
        [userId],
      );
      await logAuditEvent('mfa_disable', request.user.userId, null, request.ip);

      return { ok: true };
    },
  );
}
