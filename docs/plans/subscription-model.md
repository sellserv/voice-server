# Premium Subscription Infrastructure Plan

Implement a $5/month "Pro" subscription model using Stripe to monetize high-value features.

## 1. Monetization Strategy: What to Charge For?

I recommend a single "Pro" tier ($5/month) that provides both personal and server-wide benefits:

### A. Personal "Pro" Benefits
- **Custom Identity:** Access to custom name colors and premium fonts (already in DB, needs UI gating).
- **Animated Profile:** Support for GIF avatars and profile banners.
- **Higher Upload Limits:** Increase default file upload limit (e.g., from 10MB to 100MB).
- **Global Badge:** A unique "Pro" badge next to the username in all chats.
- **Exclusive Apps:** Access to "Voice Changer" and "Effects" apps across all servers.

### B. "Server Boost" Benefits
- A "Pro" user could receive one "Server Boost" to apply to their favorite community.
- Boosted servers could get:
  - Higher bitrate voice channels.
  - Custom invite backgrounds.
  - More soundboard slots / custom emoji slots.

## 2. Infrastructure Design

### Payment Provider: Stripe
- **Stripe Checkout:** For a secure, hosted payment page.
- **Stripe Customer Portal:** For users to manage or cancel their subscriptions.
- **Stripe Webhooks:** To keep the local database in sync with Stripe's state.

### Database Changes (SQLite)
New table `subscriptions`:
- `id` (TEXT, PK)
- `user_id` (TEXT, FK to users)
- `stripe_subscription_id` (TEXT, Unique)
- `stripe_customer_id` (TEXT)
- `status` (TEXT: 'active', 'past_due', 'canceled')
- `tier` (TEXT: 'pro')
- `current_period_end` (TEXT: ISO date)

Update `users` table:
- `premium_tier` (TEXT DEFAULT 'free')

### Backend Architecture
- **Stripe Service:** A new utility in `server/src/stripe/` to handle API calls.
- **Webhook Handler:** A public route `/api/webhooks/stripe` to handle `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- **Gating Middleware:** Refactor `permissions.ts` or add a new helper `isPremium(userId)` to check tier status before allowing certain actions.

## 3. Implementation Phases

### Phase 1: Core Billing
1.  Set up Stripe account and Product/Price for the $5 tier.
2.  Add `subscriptions` table and migrate `users` table.
3.  Implement `/api/billing/create-checkout-session` route.
4.  Implement Stripe Webhook listener.

### Phase 2: Feature Gating
1.  **File Uploads:** Modify the upload route to check `premium_tier` for the file size limit.
2.  **Profile Customization:** Gate the name color/font API behind a premium check.
3.  **App Usage:** Check premium status in the "use_apps" permission logic.

### Phase 3: Frontend Integration
1.  **Settings:** Add a "Billing" or "Premium" tab in `SettingsModal.svelte`.
2.  **Upsells:** Add subtle "Get Pro" prompts near gated features (e.g., in the emoji picker or profile editor).
3.  **Badges:** Update `Avatar` or `Name` components to render the Pro badge.

## 4. Security & Integrity
- **Webhook Verification:** Strictly verify Stripe signatures to prevent spoofing.
- **Server-Side Validation:** Never trust the frontend; always re-verify premium status on the backend before performing gated actions.

## 5. Role Integration Strategy (The "Pro Role")

To integrate subscriptions seamlessly with the existing platform, we will use a dedicated **Pro Role** system:

### A. Instance-Level (Global) Roles
- **Global Scope:** Pro and Free roles will be "Instance-Level," meaning they have `server_id = NULL` in the database.
- **Global Persistence:** These roles stay with the user across every server they join on the instance.
- **Separation:** Per-server roles (like "Admin", "Moderator", or "VIP" within a specific community) remain entirely separate and are managed by server owners.

### B. Role-Based Pro Status
- Add a `pro` boolean column to the `roles` table.
- Instance Admins can designate any global role as a "Pro Role" in the Instance Admin Panel.

### C. Automated Management (Stripe)
- When a Stripe payment is successful, the server automatically assigns the designated global "Pro Role" to the user.
- If a subscription expires or is canceled, the Stripe Webhook automatically removes the role.

### D. Manual Admin Overrides
- **Bypass Capability:** Instance Admins (Global Admins) will have the power to manually assign or remove global roles (including the Pro role) from any user at any time.
- **Conflict Handling:** The system will prioritize the manual assignment until the next automated Stripe event, or we can add a `manual_override` flag to ensure Stripe doesn't accidentally revoke a role given by an admin.

### E. Instance Admin UI
- **User Management Tab:** A new section in the Instance Admin Panel to search for users globally.
- **Role Control:** A simple UI to toggle global roles (where `server_id IS NULL`) for the selected user.
- **Audit Logging:** All manual role changes will be logged in the `audit_log` with `server_id = NULL` to track admin actions.

### F. Permission Gating & Resolution
- The `getUserPermissions(userId, serverId)` function will be updated to fetch and merge permissions from both server-specific roles and global roles.

### G. Why this is better:
- **Consistency:** It uses the exact same permission system already in place.
- **Visuals:** Users automatically get the role color and badge associated with the Pro role globally.
- **Total Control:** Global admins maintain absolute authority over premium status regardless of billing state.
