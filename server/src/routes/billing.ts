import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { getDb } from '../adapters/index.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { isAlphaPhase } from '../auth/permissions.js';
import { logAuditEvent } from '../audit/log.js';
import { broadcast } from '../ws/index.js';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!config.stripe.secretKey) {
      throw new Error('Stripe is not configured');
    }
    stripe = new Stripe(config.stripe.secretKey);
  }
  return stripe;
}

export default async function billingRoutes(app: FastifyInstance) {
  const stripeConfigured = !!config.stripe.secretKey;

  // Billing status always available (reads from local DB, no Stripe needed)
  app.get(
    '/api/billing/status',
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.user.userId;
      const user = await getDb().queryOne<{ premium_tier: string }>(
        'SELECT premium_tier FROM users WHERE id = ?',
        [userId],
      );
      const sub = await getDb().queryOne<{ status: string; tier: string; current_period_end: string | null }>(
        "SELECT status, tier, current_period_end FROM subscriptions WHERE user_id = ? AND status != 'canceled' ORDER BY created_at DESC LIMIT 1",
        [userId],
      );

      let tier = user?.premium_tier || 'free';
      if (await isAlphaPhase()) {
        tier = 'pro';
      }

      return {
        tier,
        subscription: sub || null,
        stripeConfigured,
      };
    },
  );

  // Skip Stripe-dependent routes if not configured
  if (!stripeConfigured) {
    app.log.info('Stripe not configured — checkout/portal/webhook routes disabled');
    return;
  }

  // Create a Stripe Checkout session for Pro subscription
  app.post(
    '/api/billing/create-checkout-session',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const user = await getDb().queryOne<{ id: string; email: string | null; username: string; premium_tier: string }>(
        'SELECT id, email, username, premium_tier FROM users WHERE id = ?',
        [userId],
      );

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      if (await isAlphaPhase() || user.premium_tier === 'pro') {
        return reply.code(400).send({ error: 'Already subscribed to Pro' });
      }

      if (!config.stripe.priceId) {
        return reply.code(500).send({ error: 'Stripe price not configured' });
      }

      try {
        const s = getStripe();
        const session = await s.checkout.sessions.create({
          mode: 'subscription',
          line_items: [{ price: config.stripe.priceId, quantity: 1 }],
          customer_email: user.email || undefined,
          metadata: { userId: user.id, username: user.username },
          success_url: `${config.stripe.portalReturnUrl || '/'}?billing=success`,
          cancel_url: `${config.stripe.portalReturnUrl || '/'}?billing=canceled`,
        });

        return { url: session.url };
      } catch (err: any) {
        app.log.error('Stripe checkout error:', err);
        return reply.code(500).send({ error: 'Failed to create checkout session' });
      }
    },
  );

  // Create a Stripe Customer Portal session (manage/cancel subscription)
  app.post(
    '/api/billing/portal',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const sub = await getDb().queryOne<{ stripe_customer_id: string }>(
        "SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? AND status != 'canceled' LIMIT 1",
        [userId],
      );

      if (!sub?.stripe_customer_id) {
        return reply.code(400).send({ error: 'No active subscription found' });
      }

      try {
        const s = getStripe();
        const session = await s.billingPortal.sessions.create({
          customer: sub.stripe_customer_id,
          return_url: config.stripe.portalReturnUrl || '/',
        });

        return { url: session.url };
      } catch (err: any) {
        app.log.error('Stripe portal error:', err);
        return reply.code(500).send({ error: 'Failed to create portal session' });
      }
    },
  );

  // ─── Stripe Webhook ──────────────────────────────────────
  // Encapsulate webhook in its own plugin so the raw body parser doesn't affect other routes
  app.register(async (webhook) => {
    webhook.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        (_req as any).rawBody = body;
        done(null, body);
      },
    );

    webhook.post(
      '/api/webhooks/stripe',
      async (request, reply) => {
        const sig = request.headers['stripe-signature'] as string;
        if (!sig || !config.stripe.webhookSecret) {
          return reply.code(400).send({ error: 'Missing signature' });
        }

        let event: Stripe.Event;
        try {
          const s = getStripe();
          event = s.webhooks.constructEvent(
            (request as any).rawBody,
            sig,
            config.stripe.webhookSecret,
          );
        } catch (err: any) {
          webhook.log.error('Webhook signature verification failed:', err.message);
          return reply.code(400).send({ error: 'Invalid signature' });
        }

      try {
        switch (event.type) {
          case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;
            const userId = session.metadata?.userId;
            if (!userId || !session.subscription || !session.customer) break;

            const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
            const custId = typeof session.customer === 'string' ? session.customer : session.customer.id;

            // Fetch subscription details for period end
            const s = getStripe();
            const sub = await s.subscriptions.retrieve(subId) as any;
            const periodEnd = sub.current_period_end || sub.items?.data?.[0]?.current_period_end;

            await getDb().run(
              `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, status, tier, current_period_end)
               VALUES (?, ?, ?, ?, 'active', 'pro', ?)`,
              [randomUUID(), userId, subId, custId, periodEnd ? new Date(periodEnd * 1000).toISOString() : null],
            );

            // Assign Pro role
            await assignProRole(userId);
            await logAuditEvent('role_change', userId, userId, '', { action: 'add', role: 'Pro', source: 'stripe' });
            break;
          }

          case 'customer.subscription.updated': {
            const sub = event.data.object as any;
            const existing = await getDb().queryOne<{ user_id: string }>(
              'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?',
              [sub.id],
            );
            if (!existing) break;

            const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';
            const updatedPeriodEnd = sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
            await getDb().run(
              'UPDATE subscriptions SET status = ?, current_period_end = ? WHERE stripe_subscription_id = ?',
              [status, updatedPeriodEnd ? new Date(updatedPeriodEnd * 1000).toISOString() : null, sub.id],
            );

            if (status === 'active') {
              await assignProRole(existing.user_id);
            } else if (status === 'canceled') {
              await removeProRole(existing.user_id);
            }
            break;
          }

          case 'customer.subscription.deleted': {
            const sub = event.data.object as Stripe.Subscription;
            const existing = await getDb().queryOne<{ user_id: string }>(
              'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?',
              [sub.id],
            );
            if (!existing) break;

            await getDb().run(
              "UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = ?",
              [sub.id],
            );

            await removeProRole(existing.user_id);
            await logAuditEvent('role_change', existing.user_id, existing.user_id, '', { action: 'remove', role: 'Pro', source: 'stripe' });
            break;
          }
        }
      } catch (err: any) {
        webhook.log.error('Webhook handler error:', err);
        return reply.code(500).send({ error: 'Webhook processing failed' });
      }

        return { received: true };
      },
    );
  });
}

async function assignProRole(userId: string) {
  const proRole = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM roles WHERE server_id IS NULL AND pro = 1 LIMIT 1",
  );
  if (!proRole) return;

  await getDb().run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, proRole.id]);
  await getDb().run("UPDATE users SET premium_tier = 'pro' WHERE id = ?", [userId]);
  broadcast({ type: 'user:updated', userId });
}

async function removeProRole(userId: string) {
  const proRole = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM roles WHERE server_id IS NULL AND pro = 1 LIMIT 1",
  );
  if (!proRole) return;

  await getDb().run('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [userId, proRole.id]);

  // Check if user still has any other pro role
  const stillPro = await getDb().queryOne(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.pro = 1`,
    [userId],
  );
  if (!stillPro) {
    await getDb().run("UPDATE users SET premium_tier = 'free' WHERE id = ?", [userId]);
  }
  broadcast({ type: 'user:updated', userId });
}
