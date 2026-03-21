<script lang="ts">
  import {
    login,
    register,
    verifyMfa,
    changePassword,
    verifyEmail,
    resendVerification,
    resendMfaCode,
    setEmail,
    forgotPassword,
    forgotPasswordVerify,
    resetPassword,
    unlockAccount,
    mfaPending,
    passwordExpired,
    emailVerificationPending,
    emailRequired,
    forgotPasswordState,
    accountLocked,
  } from '$lib/stores/auth';
  import { loadChannels } from '$lib/stores/channels';
  import { connectWs } from '$lib/ws';
  import { api } from '$lib/api';

  let mode = $state<'login' | 'register'>('login');
  let username = $state('');
  let password = $state('');
  let email = $state('');
  let confirmPassword = $state('');
  let displayName = $state('');
  let turnstileSiteKey = $state<string | null>(null);
  let captchaToken = $state<string | null>(null);
  let turnstileWidgetId = $state<string | null>(null);
  let registrationOpen = $state(true);
  let serverName = $state('SellServ Voice');

  async function loadPublicSettings() {
    try {
      const res = await api.get<{ name: string; icon_url: string | null }>(
        '/api/server-settings/public',
      );
      serverName = res.name;
      document.title = res.name;
    } catch {
      // Use default
    }
  }

  async function checkSetupStatus() {
    try {
      const res = await api.get<{ turnstileSiteKey: string | null; registrationOpen: boolean }>('/api/auth/setup-status');
      turnstileSiteKey = res.turnstileSiteKey ?? null;
      registrationOpen = res.registrationOpen ?? true;
    } catch {
      // Use defaults
    }
  }

  // Check setup status and load server name on load
  checkSetupStatus();
  loadPublicSettings();

  let turnstileLoaded = $state(false);

  function loadTurnstileScript(): Promise<void> {
    if ((window as any).turnstile) {
      turnstileLoaded = true;
      return Promise.resolve();
    }
    if (document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
      return Promise.resolve(); // Already loading
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => { turnstileLoaded = true; resolve(); };
      script.onerror = () => { console.warn('Failed to load Turnstile script'); resolve(); };
      document.head.appendChild(script);
    });
  }

  const isDesktop = !!(window as any).electronAPI;

  // Load turnstile script only when site key is available and not in desktop app
  $effect(() => {
    if (turnstileSiteKey && !isDesktop) {
      loadTurnstileScript();
    }
  });

  function renderTurnstile(container: HTMLElement) {
    if (!turnstileSiteKey || !(window as any).turnstile) return;
    // Reset if already rendered
    if (turnstileWidgetId !== null) {
      (window as any).turnstile.reset(turnstileWidgetId);
      captchaToken = null;
      return;
    }
    try {
      turnstileWidgetId = (window as any).turnstile.render(container, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => { captchaToken = token; },
        'expired-callback': () => { captchaToken = null; },
        'error-callback': () => { console.warn('Turnstile widget error'); captchaToken = null; },
        theme: 'dark',
      });
    } catch (e) {
      console.warn('Turnstile render failed:', e);
    }
  }

  function resetTurnstile() {
    if (turnstileWidgetId !== null && (window as any).turnstile) {
      (window as any).turnstile.reset(turnstileWidgetId);
      captchaToken = null;
    }
  }

  let mfaCode = $state('');
  let error = $state('');
  let loading = $state(false);
  let resendCooldown = $state(false);

  // Password change form state
  let cpCurrentPassword = $state('');
  let cpNewPassword = $state('');
  let cpConfirmPassword = $state('');

  // Email set form state
  let setEmailValue = $state('');
  let setEmailPassword = $state('');
  let changingVerificationEmail = $state(false);
  let newVerificationEmail = $state('');
  let changeEmailPassword = $state('');

  // Unlock code
  let unlockCode = $state('');

  // Verification code
  let verifyCode = $state('');

  // Forgot password state
  let fpUsername = $state('');
  let fpCode = $state('');
  let fpNewPassword = $state('');
  let fpConfirmPassword = $state('');

  async function handleSubmit() {
    error = '';
    loading = true;
    try {
      if (mode === 'login') {
        const result = await login(username, password);
        if (!result) return;
      } else {
        if (password !== confirmPassword) {
          error = 'Passwords do not match';
          return;
        }
        const result = await register(
          username,
          password,
          email,
          displayName || undefined,
          undefined,
          captchaToken || undefined,
        );
        if (!result) return;
      }
      await loadChannels();
      connectWs();
    } catch (e: any) {
      error = e.message;
      resetTurnstile();
    } finally {
      loading = false;
    }
  }

  async function handleMfaSubmit() {
    error = '';
    loading = true;
    try {
      const pending = $mfaPending;
      if (!pending) return;
      const result = await verifyMfa(pending.userId, mfaCode, pending.mfaMethod);
      if (!result) return;
      await loadChannels();
      connectWs();
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleResendMfa() {
    const pending = $mfaPending;
    if (!pending || resendCooldown) return;
    resendCooldown = true;
    try {
      await resendMfaCode(pending.userId);
    } catch (e: any) {
      error = e.message;
    }
    setTimeout(() => (resendCooldown = false), 30000);
  }

  async function handleUnlockAccount() {
    error = '';
    loading = true;
    try {
      const locked = $accountLocked;
      if (!locked) return;
      await unlockAccount(locked.userId, unlockCode, locked.mfaMethod);
      unlockCode = '';
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleResendUnlockCode() {
    const locked = $accountLocked;
    if (!locked || resendCooldown) return;
    resendCooldown = true;
    try {
      await resendMfaCode(locked.userId);
    } catch (e: any) {
      error = e.message;
    }
    setTimeout(() => (resendCooldown = false), 30000);
  }

  async function handleChangePassword() {
    error = '';
    if (cpNewPassword.length < 15) {
      error = 'New password must be at least 15 characters';
      return;
    }
    if (cpNewPassword !== cpConfirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    loading = true;
    try {
      const expired = $passwordExpired;
      if (!expired) return;
      await changePassword(expired.userId, cpCurrentPassword, cpNewPassword);
      await loadChannels();
      connectWs();
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleVerifyEmail() {
    error = '';
    loading = true;
    try {
      const pending = $emailVerificationPending;
      if (!pending) return;
      await verifyEmail(pending.userId, verifyCode);
      // Switch to login page and clear registration fields
      mode = 'login';
      username = '';
      email = '';
      password = '';
      confirmPassword = '';
      displayName = '';
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleResendVerification() {
    const pending = $emailVerificationPending;
    if (!pending || resendCooldown) return;
    resendCooldown = true;
    try {
      await resendVerification(pending.userId);
    } catch (e: any) {
      error = e.message;
    }
    setTimeout(() => (resendCooldown = false), 30000);
  }

  async function handleChangeVerificationEmail() {
    error = '';
    loading = true;
    try {
      const pending = $emailVerificationPending;
      if (!pending) return;
      await setEmail(pending.userId, newVerificationEmail, changeEmailPassword);
      changingVerificationEmail = false;
      newVerificationEmail = '';
      changeEmailPassword = '';
      error = '';
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleSetEmail() {
    error = '';
    loading = true;
    try {
      const req = $emailRequired;
      if (!req) return;
      await setEmail(req.userId, setEmailValue, setEmailPassword);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleForgotPasswordStart() {
    error = '';
    loading = true;
    try {
      await forgotPassword(fpUsername);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleForgotPasswordVerify() {
    error = '';
    loading = true;
    try {
      const state = $forgotPasswordState;
      if (!state || !state.username) return;
      await forgotPasswordVerify(state.username, fpCode);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleResetPassword() {
    error = '';
    if (fpNewPassword.length < 15) {
      error = 'Password must be at least 15 characters';
      return;
    }
    if (fpNewPassword !== fpConfirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    loading = true;
    try {
      const state = $forgotPasswordState;
      if (!state?.resetToken) return;
      await resetPassword(state.resetToken, fpNewPassword);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function resetAll() {
    error = '';
    mfaPending.set(null);
    passwordExpired.set(null);
    emailVerificationPending.set(null);
    emailRequired.set(null);
    forgotPasswordState.set(null);
    accountLocked.set(null);
    mfaCode = '';
    unlockCode = '';
    verifyCode = '';
    setEmailValue = '';
    fpUsername = '';
    fpCode = '';
    fpNewPassword = '';
    fpConfirmPassword = '';
    cpCurrentPassword = '';
    cpNewPassword = '';
    cpConfirmPassword = '';
  }
</script>

<div class="login-container">
  <div class="login-card">
    <img src="/icon-512x512.png" alt="SellServ Voice" class="brand-logo" />
    <h1 class="brand">{serverName}</h1>

    {#if $forgotPasswordState}
      {#if $forgotPasswordState.step === 'username'}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleForgotPasswordStart();
          }}
        >
          <p class="mfa-prompt">Enter your username to reset your password.</p>

          <label class="field">
            <span>Username</span>
            <input
              type="text"
              bind:value={fpUsername}
              placeholder="Enter username"
              required
              autocomplete="username"
            />
          </label>

          {#if error}<p class="error">{error}</p>{/if}

          <button type="submit" class="submit-btn" disabled={loading}>
            {loading ? 'Please wait...' : 'Continue'}
          </button>

          <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
        </form>
      {:else if $forgotPasswordState.step === 'code'}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleForgotPasswordVerify();
          }}
        >
          <p class="mfa-prompt">
            Enter the 6-digit verification code from your email or authenticator app.
          </p>

          <label class="field">
            <span>Verification Code</span>
            <input
              type="text"
              bind:value={fpCode}
              placeholder="000000"
              required
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
            />
          </label>

          {#if error}<p class="error">{error}</p>{/if}

          <button type="submit" class="submit-btn" disabled={loading}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>

          <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
        </form>
      {:else if $forgotPasswordState.step === 'reset'}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleResetPassword();
          }}
        >
          <p class="mfa-prompt">Set your new password.</p>

          <label class="field">
            <span>New Password <small>(min 15 characters)</small></span>
            <input
              type="password"
              bind:value={fpNewPassword}
              placeholder="Enter new password"
              required
              autocomplete="new-password"
            />
          </label>

          <label class="field">
            <span>Confirm New Password</span>
            <input
              type="password"
              bind:value={fpConfirmPassword}
              placeholder="Confirm new password"
              required
              autocomplete="new-password"
            />
          </label>

          {#if error}<p class="error">{error}</p>{/if}

          <button type="submit" class="submit-btn" disabled={loading}>
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
        </form>
      {/if}
    {:else if $emailRequired}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleSetEmail();
        }}
      >
        <p class="mfa-prompt">
          An email address is now required for your account. Please add one to continue.
        </p>

        <label class="field">
          <span>Email Address</span>
          <input
            type="email"
            bind:value={setEmailValue}
            placeholder="you@example.com"
            required
            autocomplete="email"
          />
        </label>

        <label class="field">
          <span>Password</span>
          <input
            type="password"
            bind:value={setEmailPassword}
            placeholder="Confirm your password"
            required
            autocomplete="current-password"
          />
        </label>

        {#if error}<p class="error">{error}</p>{/if}

        <button type="submit" class="submit-btn" disabled={loading}>
          {loading ? 'Please wait...' : 'Add Email'}
        </button>

        <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
      </form>
    {:else if $emailVerificationPending}
      {#if changingVerificationEmail}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleChangeVerificationEmail();
          }}
        >
          <p class="mfa-prompt">Enter a new email address to use instead.</p>

          <label class="field">
            <span>New Email Address</span>
            <input
              type="email"
              bind:value={newVerificationEmail}
              placeholder="you@example.com"
              required
              autocomplete="email"
            />
          </label>

          <label class="field">
            <span>Password</span>
            <input
              type="password"
              bind:value={changeEmailPassword}
              placeholder="Confirm your password"
              required
              autocomplete="current-password"
            />
          </label>

          {#if error}<p class="error">{error}</p>{/if}

          <button type="submit" class="submit-btn" disabled={loading || !newVerificationEmail}>
            {loading ? 'Sending...' : 'Send Verification Code'}
          </button>

          <button
            type="button"
            class="back-btn"
            onclick={() => {
              changingVerificationEmail = false;
              error = '';
            }}>Back to verification</button
          >
        </form>
      {:else}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleVerifyEmail();
          }}
        >
          <p class="mfa-prompt">Enter the 6-digit verification code sent to your email.</p>

          {#if $emailVerificationPending?.canChangeEmail}
            <p class="disclaimer">
              Email aliases and relay addresses may not receive codes. Use a direct email address if
              you don't see one.
            </p>
          {/if}

          <label class="field">
            <span>Verification Code</span>
            <input
              type="text"
              bind:value={verifyCode}
              placeholder="000000"
              required
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
            />
          </label>

          {#if error}<p class="error">{error}</p>{/if}

          <button type="submit" class="submit-btn" disabled={loading}>
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>

          <button
            type="button"
            class="link-btn"
            onclick={handleResendVerification}
            disabled={resendCooldown}
          >
            {resendCooldown ? 'Code sent' : 'Resend code'}
          </button>

          {#if $emailVerificationPending?.canChangeEmail}
            <button
              type="button"
              class="link-btn"
              onclick={() => {
                changingVerificationEmail = true;
                error = '';
              }}
            >
              Use a different email
            </button>
          {/if}

          <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
        </form>
      {/if}
    {:else if $passwordExpired}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleChangePassword();
        }}
      >
        <p class="mfa-prompt">Your password has expired. Please set a new password to continue.</p>

        <label class="field">
          <span>Current Password</span>
          <input
            type="password"
            bind:value={cpCurrentPassword}
            placeholder="Enter current password"
            required
            autocomplete="current-password"
          />
        </label>

        <label class="field">
          <span>New Password <small>(min 15 characters)</small></span>
          <input
            type="password"
            bind:value={cpNewPassword}
            placeholder="Enter new password"
            required
            autocomplete="new-password"
          />
        </label>

        <label class="field">
          <span>Confirm New Password</span>
          <input
            type="password"
            bind:value={cpConfirmPassword}
            placeholder="Confirm new password"
            required
            autocomplete="new-password"
          />
        </label>

        {#if error}<p class="error">{error}</p>{/if}

        <button type="submit" class="submit-btn" disabled={loading}>
          {loading ? 'Changing...' : 'Change Password'}
        </button>

        <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
      </form>
    {:else if $accountLocked}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleUnlockAccount();
        }}
      >
        <p class="mfa-prompt">
          Your account has been locked due to too many failed login attempts.
          {#if $accountLocked.mfaMethod === 'totp'}
            Enter the 6-digit code from your authenticator app to unlock it.
          {:else}
            Enter the 6-digit code sent to your email to unlock it.
          {/if}
        </p>

        <label class="field">
          <span>{$accountLocked.mfaMethod === 'totp' ? 'Authenticator Code' : 'Unlock Code'}</span>
          <input
            type="text"
            bind:value={unlockCode}
            placeholder="000000"
            required
            autocomplete="one-time-code"
            inputmode="numeric"
            maxlength="6"
          />
        </label>

        {#if error}<p class="error">{error}</p>{/if}

        <button type="submit" class="submit-btn" disabled={loading}>
          {loading ? 'Unlocking...' : 'Unlock Account'}
        </button>

        {#if $accountLocked.mfaMethod === 'email'}
          <button
            type="button"
            class="link-btn"
            onclick={handleResendUnlockCode}
            disabled={resendCooldown}
          >
            {resendCooldown ? 'Code sent' : 'Resend code'}
          </button>
        {/if}

        <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
      </form>
    {:else if $mfaPending}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleMfaSubmit();
        }}
      >
        <p class="mfa-prompt">
          {#if $mfaPending.mfaMethod === 'totp'}
            Enter the 6-digit code from your authenticator app.
          {:else}
            Enter the 6-digit code sent to your email.
          {/if}
        </p>

        <label class="field">
          <span>Authentication Code</span>
          <input
            type="text"
            bind:value={mfaCode}
            placeholder="000000"
            required
            autocomplete="one-time-code"
            inputmode="numeric"
            maxlength="6"
          />
        </label>

        {#if error}<p class="error">{error}</p>{/if}

        <button type="submit" class="submit-btn" disabled={loading}>
          {loading ? 'Verifying...' : 'Verify'}
        </button>

        {#if $mfaPending.mfaMethod === 'email'}
          <button
            type="button"
            class="link-btn"
            onclick={handleResendMfa}
            disabled={resendCooldown}
          >
            {resendCooldown ? 'Code sent' : 'Resend code'}
          </button>
        {/if}

        <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
      </form>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div class="tabs">
          <button
            type="button"
            class="tab"
            class:active={mode === 'login'}
            onclick={() => {
              mode = 'login';
              error = '';
            }}>Login</button
          >
          <button
            type="button"
            class="tab"
            class:active={mode === 'register'}
            onclick={() => {
              mode = 'register';
              error = registrationOpen ? '' : 'Registration is currently closed. Please contact an administrator.';
            }}>Register</button
          >
        </div>

        <label class="field">
          <span>Username</span>
          <input
            type="text"
            bind:value={username}
            placeholder="Enter username"
            required
            autocomplete="username"
          />
        </label>

        {#if mode === 'register'}
          <label class="field">
            <span>Email</span>
            <input
              type="email"
              bind:value={email}
              placeholder="you@example.com"
              required
              autocomplete="email"
            />
          </label>

          <label class="field">
            <span>Display Name <small>(optional)</small></span>
            <input type="text" bind:value={displayName} placeholder="What should we call you?" />
          </label>
        {/if}

        <label class="field">
          <span
            >Password {#if mode === 'register'}<small>(min 15 characters)</small>{/if}</span
          >
          <input
            type="password"
            bind:value={password}
            placeholder="Enter password"
            required
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>

        {#if mode === 'register'}
          <label class="field">
            <span>Confirm Password</span>
            <input
              type="password"
              bind:value={confirmPassword}
              placeholder="Confirm password"
              required
              autocomplete="new-password"
            />
          </label>

          {#if turnstileSiteKey && turnstileLoaded}
            <div class="turnstile-container" use:renderTurnstile></div>
          {/if}
        {/if}

        {#if error}<p class="error">{error}</p>{/if}

        <button type="submit" class="submit-btn" disabled={loading || (mode === 'register' && !registrationOpen)}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>

        {#if mode === 'login'}
          <button
            type="button"
            class="link-btn"
            onclick={() => {
              forgotPasswordState.set({ step: 'username' });
              error = '';
            }}
          >
            Forgot Password?
          </button>
        {/if}
      </form>
    {/if}
  </div>
</div>

<style>
  .login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #08080f;
    background-image: 
      radial-gradient(at 0% 0%, rgba(124, 92, 252, 0.15) 0px, transparent 50%),
      radial-gradient(at 100% 100%, rgba(124, 92, 252, 0.1) 0px, transparent 50%);
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  .login-container::before {
    content: '';
    position: absolute;
    inset: 0;
    background: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    opacity: 0.03;
    pointer-events: none;
  }

  .login-card {
    background: rgba(20, 20, 35, 0.65);
    backdrop-filter: blur(32px);
    -webkit-backdrop-filter: blur(32px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 40px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    animation: cardIn 0.4s var(--ease-out);
  }

  @keyframes cardIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .brand-logo {
    display: block;
    margin: 0 auto 10px;
    width: 64px;
    height: 64px;
    border-radius: 14px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }

  .brand {
    text-align: center;
    font-size: 2rem;
    font-weight: 800;
    color: white;
    margin-bottom: 4px;
    letter-spacing: -0.02em;
  }

  .tagline {
    text-align: center;
    color: var(--text-dim);
    font-size: 1rem;
    margin-bottom: 32px;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    background: rgba(0, 0, 0, 0.2);
    padding: 4px;
    border-radius: 8px;
  }

  .tab {
    flex: 1;
    padding: 10px;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    font-size: var(--font-md);
    transition: all 0.2s var(--ease-out);
    border: none;
    cursor: pointer;
  }

  .tab:hover:not(.active) {
    color: var(--text);
    background: rgba(255, 255, 255, 0.05);
  }

  .tab.active {
    background: var(--accent);
    color: white;
    box-shadow: var(--shadow-glow);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .field span {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .field input {
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    color: white;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    font-size: var(--font-md);
    transition: all 0.2s var(--ease-out);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
    background: rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .error {
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
    padding: 10px;
    border-radius: 4px;
    font-size: var(--font-sm);
    margin-bottom: 16px;
    border: 1px solid rgba(248, 113, 113, 0.2);
  }

  .submit-btn {
    width: 100%;
    padding: 12px;
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 1rem;
    border-radius: 4px;
    transition: all 0.2s var(--ease-out);
    margin-top: 8px;
    border: none;
    cursor: pointer;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-glow);
  }

  .submit-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .link-btn {
    width: 100%;
    padding: 12px;
    margin-top: 8px;
    background: transparent;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .link-btn:hover {
    text-decoration: underline;
  }

  .back-btn {
    width: 100%;
    padding: 12px;
    margin-top: 8px;
    background: transparent;
    color: var(--text-dim);
    font-size: var(--font-sm);
    font-weight: 600;
    border: none;
    cursor: pointer;
  }

  .back-btn:hover {
    color: var(--text);
  }

  .mfa-prompt {
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-md);
    margin-bottom: 24px;
    line-height: 1.5;
  }

  .disclaimer {
    text-align: center;
    color: var(--text-dim);
    font-size: var(--font-xs);
    margin-bottom: 16px;
    line-height: 1.4;
  }

  @media (max-width: 480px) {
    .login-card {
      padding: 32px 24px;
      border-radius: 0;
      background: transparent;
      backdrop-filter: none;
      border: none;
      box-shadow: none;
    }
  }
</style>
