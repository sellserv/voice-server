# Stripe Setup Guide

Connect Stripe to enable self-service Pro subscriptions ($5/month).

Without Stripe configured, admins can still manually assign the Pro role via Instance Admin > Users.

## 1. Create a Stripe Account

Sign up at https://dashboard.stripe.com. Use **test mode** first (`sk_test_...` keys) to verify everything works with fake cards before going live.

## 2. Create a Product + Price

- Go to **Products** > **Add product**
- Name: `SellServ Pro`
- Price: `$5.00/month`, recurring
- Copy the **Price ID** (starts with `price_`)

## 3. Enable the Customer Portal

- Go to **Settings** > **Billing** > **Customer portal**
- Enable it and configure cancellation/update options
- This lets users manage or cancel their subscription without admin intervention

## 4. Create a Webhook Endpoint

- Go to **Developers** > **Webhooks** > **Add endpoint**
- URL: `https://<your-domain>/api/webhooks/stripe`
- Events to listen for:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copy the **Webhook signing secret** (starts with `whsec_`)

## 5. Set Environment Variables

Add these to your `.env` file (or server environment):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PORTAL_RETURN_URL=https://chat.sellserv.net
```

For staging, use test mode keys and point the portal return URL to `https://staging.sellserv.net`.

## 6. Restart the Server

On restart, the server will log that billing routes are active instead of "Stripe not configured — billing routes disabled".

## How It Works

1. User clicks **Upgrade to Pro** in Settings > Billing
2. Server creates a Stripe Checkout session and redirects user to Stripe's hosted payment page
3. On successful payment, Stripe sends a `checkout.session.completed` webhook
4. The webhook handler assigns the global Pro role and sets `premium_tier = 'pro'`
5. A `user:updated` WebSocket event broadcasts to all clients so the Pro badge appears immediately
6. When a subscription is canceled/expired, the webhook removes the Pro role automatically

## Going Live

1. Switch from `sk_test_...` to `sk_live_...` keys
2. Create a new webhook endpoint pointing to your production domain
3. Update `STRIPE_PORTAL_RETURN_URL` to the production URL
4. Update all env vars on the production server
