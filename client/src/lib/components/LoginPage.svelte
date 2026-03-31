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
  import { APP_NAME } from '$lib/constants';
  import { loadChannels } from '$lib/stores/channels';
  import { connectWs } from '$lib/ws';
  import { api } from '$lib/api';
  import { fade } from 'svelte/transition';
  import { onMount } from 'svelte';

  let mode = $state<'login' | 'register'>('login');
  let username = $state('');
  let password = $state('');
  let email = $state('');
  let confirmPassword = $state('');
  let displayName = $state('');
  let agreedToTerms = $state(false);
  let turnstileSiteKey = $state<string | null>(null);
  let captchaToken = $state<string | null>(null);
  let turnstileWidgetId = $state<string | null>(null);
  let registrationOpen = $state(true);
  let termsUrl = $state('');
  let privacyUrl = $state('');
  let serverName = $state(APP_NAME);

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
      const res = await api.get<{ turnstileSiteKey: string | null; registrationOpen: boolean; termsUrl?: string; privacyUrl?: string }>('/api/auth/setup-status');
      turnstileSiteKey = res.turnstileSiteKey ?? null;
      registrationOpen = res.registrationOpen ?? true;
      termsUrl = res.termsUrl || '';
      privacyUrl = res.privacyUrl || '';
    } catch {
      // Use defaults
    }
  }

  // Check setup status and load server name on load
  onMount(() => {
    checkSetupStatus();
    loadPublicSettings();
  });

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

  // Mouse parallax state
  let mouseX = $state(0);
  let mouseY = $state(0);
  let rafId = 0;

  function handleMouseMove(e: MouseEvent) {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 20;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 20;
      rafId = 0;
    });
  }

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="login-container" onmousemove={handleMouseMove} class:desktop={isDesktop}>
  <div class="stellar-bg">
    <div class="stars" style="transform: translate({mouseX * 0.5}px, {mouseY * 0.5}px)"></div>
    <div class="grid-overlay" style="--mx: {mouseX * 5 + 50}%; --my: {mouseY * 5 + 50}%"></div>
    <div class="aurora aurora-1" style="transform: translate({mouseX * -1}px, {mouseY * -1}px)"></div>
    <div class="aurora aurora-2" style="transform: translate({mouseX * 1.5}px, {mouseY * 1.5}px)"></div>
    <div class="mouse-glow" style="transform: translate(calc({mouseX * 5 + 50}vw - 50%), calc({mouseY * 5 + 50}vh - 50%))"></div>
  </div>

  <div class="login-stage" in:fade={{ duration: 800 }}>
    <div class="brand-section">
      <div class="logo-wrapper">
        <a href="https://info.sellserv.net" target="_blank" rel="noopener" class="logo-link">
          <img src="/icon-512x512.png" alt="" class="hero-logo" />
        </a>
      </div>
      <h1 class="hero-brand">{serverName}</h1>
      
      <div class="brand-specs">
        <div class="waveform">
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
        </div>
      </div>
    </div>

    <div class="crystal-card">
      {#if $forgotPasswordState}
        <div class="form-wrapper" in:fade={{ duration: 150 }}>
          {#if $forgotPasswordState.step === 'username'}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                handleForgotPasswordStart();
              }}
            >
              <h2 class="form-title">Reset Password</h2>
              <p class="mfa-prompt">Enter your username to reset your password.</p>

              <div class="field-group">
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
              </div>

              {#if error}<p class="error">{error}</p>{/if}

              <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
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
              <h2 class="form-title">Verification</h2>
              <p class="mfa-prompt">
                Enter the 6-digit verification code.
              </p>

              <div class="field-group">
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
              </div>

              {#if error}<p class="error">{error}</p>{/if}

              <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
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
              <h2 class="form-title">New Password</h2>
              <p class="mfa-prompt">Set your new password.</p>

              <div class="field-group">
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
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    bind:value={fpConfirmPassword}
                    placeholder="Confirm new password"
                    required
                    autocomplete="new-password"
                  />
                </label>
              </div>

              {#if error}<p class="error">{error}</p>{/if}

              <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>

              <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
            </form>
          {/if}
        </div>
      {:else if $emailRequired}
        <div class="form-wrapper" in:fade={{ duration: 150 }}>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              handleSetEmail();
            }}
          >
            <h2 class="form-title">Account Update</h2>
            <p class="mfa-prompt">
              An email address is now required for your account.
            </p>

            <div class="field-group">
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
            </div>

            {#if error}<p class="error">{error}</p>{/if}

            <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
              {loading ? 'Please wait...' : 'Add Email'}
            </button>

            <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
          </form>
        </div>
      {:else if $emailVerificationPending}
        <div class="form-wrapper" in:fade={{ duration: 150 }}>
          {#if changingVerificationEmail}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                handleChangeVerificationEmail();
              }}
            >
              <h2 class="form-title">Change Email</h2>
              <div class="field-group">
                <label class="field">
                  <span>New Email</span>
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
              </div>

              {#if error}<p class="error">{error}</p>{/if}

              <button type="submit" class="submit-btn crystal-btn" disabled={loading || !newVerificationEmail}>
                {loading ? 'Sending...' : 'Send Code'}
              </button>

              <button
                type="button"
                class="back-btn"
                onclick={() => {
                  changingVerificationEmail = false;
                  error = '';
                }}>Back</button
              >
            </form>
          {:else}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                handleVerifyEmail();
              }}
            >
              <h2 class="form-title">Verify Email</h2>
              <p class="mfa-prompt">Enter the verification code sent to your email.</p>

              <div class="field-group">
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
              </div>

              {#if error}<p class="error">{error}</p>{/if}

              <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
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
                  Change email
                </button>
              {/if}

              <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
            </form>
          {/if}
        </div>
      {:else if $passwordExpired}
        <div class="form-wrapper" in:fade={{ duration: 150 }}>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              handleChangePassword();
            }}
          >
            <h2 class="form-title">Password Expired</h2>
            <div class="field-group">
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
                <span>New Password</span>
                <input
                  type="password"
                  bind:value={cpNewPassword}
                  placeholder="Enter new password"
                  required
                  autocomplete="new-password"
                />
              </label>

              <label class="field">
                <span>Confirm Password</span>
                <input
                  type="password"
                  bind:value={cpConfirmPassword}
                  placeholder="Confirm new password"
                  required
                  autocomplete="new-password"
                />
              </label>
            </div>

            {#if error}<p class="error">{error}</p>{/if}

            <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
              {loading ? 'Changing...' : 'Change Password'}
            </button>

            <button type="button" class="back-btn" onclick={resetAll}>Back to login</button>
          </form>
        </div>
      {:else if $accountLocked}
        <div class="form-wrapper" in:fade={{ duration: 150 }}>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              handleUnlockAccount();
            }}
          >
            <h2 class="form-title">Account Locked</h2>
            <p class="mfa-prompt">
              {#if $accountLocked.mfaMethod === 'totp'}
                Enter the authenticator code.
              {:else}
                Enter the code sent to your email.
              {/if}
            </p>

            <div class="field-group">
              <label class="field">
                <span>Unlock Code</span>
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
            </div>

            {#if error}<p class="error">{error}</p>{/if}

            <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
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
        </div>
      {:else if $mfaPending}
        <div class="form-wrapper" in:fade={{ duration: 150 }}>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              handleMfaSubmit();
            }}
          >
            <h2 class="form-title">Security Check</h2>
            <p class="mfa-prompt">
              {#if $mfaPending.mfaMethod === 'totp'}
                Enter the authenticator code.
              {:else}
                Enter the code sent to your email.
              {/if}
            </p>

            <div class="field-group">
              <label class="field">
                <span>{$mfaPending.mfaMethod === 'totp' ? 'Authenticator Code' : 'Email Code'}</span>
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
            </div>

            {#if error}<p class="error">{error}</p>{/if}

            <button type="submit" class="submit-btn crystal-btn" disabled={loading}>
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
        </div>
      {:else}
        <div class="form-wrapper">
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
                error = registrationOpen ? '' : 'Registration is closed.';
              }}>Register</button
            >
          </div>

          <form
            onsubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div class="field-group">
              <label class="field">
                <span>Username</span>
                <input
                  type="text"
                  bind:value={username}
                  placeholder="Your username"
                  required
                  autocomplete="username"
                  aria-invalid={!!error}
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
                    aria-invalid={!!error}
                  />
                </label>

                <label class="field">
                  <span>Display Name <small>(optional)</small></span>
                  <input type="text" bind:value={displayName} placeholder="Your name" />
                </label>
              {/if}

              <label class="field">
                <span
                  >Password {#if mode === 'register'}<small>(min 15 characters)</small>{/if}</span
                >
                <input
                  type="password"
                  bind:value={password}
                  placeholder="••••••••••••"
                  required
                  autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
                  aria-invalid={!!error}
                />
              </label>

              {#if mode === 'register'}
                <label class="field">
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    bind:value={confirmPassword}
                    placeholder="••••••••••••"
                    required
                    autocomplete="new-password"
                  />
                </label>

                {#if turnstileSiteKey && turnstileLoaded}
                  <div class="turnstile-container" use:renderTurnstile></div>
                {/if}

                {#if termsUrl || privacyUrl}
                  <label class="terms-checkbox">
                    <input type="checkbox" bind:checked={agreedToTerms} />
                    <span>I agree to the {#if termsUrl}<a href={termsUrl} target="_blank" rel="noopener">Terms of Service</a>{/if}{#if termsUrl && privacyUrl} and {/if}{#if privacyUrl}<a href={privacyUrl} target="_blank" rel="noopener">Privacy Policy</a>{/if}</span>
                  </label>
                {/if}
              {/if}
            </div>

            {#if error}<p class="error">{error}</p>{/if}

            <button type="submit" class="submit-btn crystal-btn" disabled={loading || (mode === 'register' && (!registrationOpen || ((termsUrl || privacyUrl) && !agreedToTerms)))}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}
            </button>

            {#if mode === 'login'}
              <button
                type="button"
                class="forgot-link"
                onclick={() => {
                  forgotPasswordState.set({ step: 'username' });
                  error = '';
                }}
              >
                Forgot Password?
              </button>
            {/if}
          </form>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #020205;
    position: relative;
    overflow: hidden;
    color: white;
    font-family: var(--font);
    padding: 40px 20px;
  }

  .login-container.desktop {
    -webkit-app-region: drag;
    height: calc(100vh - 32px);
    min-height: 0;
  }

  /* Interactive Stellar Background */
  .stellar-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background: radial-gradient(circle at 50% 50%, #050510 0%, #020205 100%);
  }

  .grid-overlay {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 100px 100px;
    mask-image: radial-gradient(circle at var(--mx) var(--my), black 0%, transparent 50%);
    -webkit-mask-image: radial-gradient(circle at var(--mx) var(--my), black 0%, transparent 50%);
    opacity: 0.4;
    z-index: 1;
  }

  .stars {
    position: absolute;
    inset: -100px;
    background-image: 
      radial-gradient(1px 1px at 20px 30px, #fff, rgba(0,0,0,0)),
      radial-gradient(1.5px 1.5px at 40px 70px, #fff, rgba(0,0,0,0)),
      radial-gradient(2px 2px at 150px 160px, #fff, rgba(0,0,0,0)),
      radial-gradient(1px 1px at 290px 40px, #fff, rgba(0,0,0,0)),
      radial-gradient(1px 1px at 430px 80px, #fff, rgba(0,0,0,0)),
      radial-gradient(2px 2px at 560px 120px, #fff, rgba(0,0,0,0));
    background-repeat: repeat;
    background-size: 600px 600px;
    opacity: 0.25;
    transition: transform 0.1s ease-out;
    will-change: transform;
  }

  .aurora {
    position: absolute;
    border-radius: 50%;
    filter: blur(160px);
    opacity: 0.2;
    mix-blend-mode: screen;
    transition: transform 0.2s ease-out;
    will-change: transform;
  }

  .aurora-1 {
    width: 1200px;
    height: 1200px;
    background: radial-gradient(circle, rgba(88, 101, 242, 0.4) 0%, transparent 70%);
    top: -500px;
    left: -400px;
    animation: nebula-float 20s infinite alternate ease-in-out;
  }

  .aurora-2 {
    width: 1000px;
    height: 1000px;
    background: radial-gradient(circle, rgba(45, 212, 168, 0.3) 0%, transparent 70%);
    bottom: -400px;
    right: -300px;
    animation: nebula-float 25s infinite alternate-reverse ease-in-out;
  }

  @keyframes nebula-float {
    from { transform: translate(0, 0) scale(1) rotate(0deg); }
    to { transform: translate(100px, 50px) scale(1.1) rotate(10deg); }
  }

  .mouse-glow {
    position: absolute;
    width: 800px;
    height: 800px;
    background: radial-gradient(circle, rgba(88, 101, 242, 0.12) 0%, transparent 70%);
    border-radius: 50%;
    pointer-events: none;
    left: 0;
    top: 0;
    z-index: 1;
    mix-blend-mode: plus-lighter;
    will-change: transform;
    animation: glow-pulse 4s infinite alternate ease-in-out;
  }

  @keyframes glow-pulse {
    from { opacity: 0.8; transform: scale(1); }
    to { opacity: 1; transform: scale(1.05); }
  }

  /* Centered Stage Layout */
  .login-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 460px;
    z-index: 10;
    gap: 24px;
  }

  .brand-section {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .logo-wrapper {
    position: relative;
    width: 80px;
    height: 80px;
    margin-bottom: 24px;
  }

  .logo-link {
    display: block;
    width: 100%;
    height: 100%;
    -webkit-app-region: no-drag;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .logo-link:hover {
    transform: scale(1.05);
  }

  .hero-logo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    position: relative;
    z-index: 2;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }

  .hero-brand {
    font-size: 2.5rem;
    font-weight: 900;
    margin: 0 0 16px;
    letter-spacing: -0.04em;
    color: #fff;
    line-height: 1;
  }

  .brand-specs {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .waveform {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 16px;
    opacity: 0.6;
  }

  .waveform .bar {
    width: 2px;
    background: var(--accent);
    border-radius: 1px;
    animation: bar-pulse 1.5s ease-in-out infinite;
  }

  .waveform .bar:nth-child(1) { height: 40%; animation-delay: 0.1s; }
  .waveform .bar:nth-child(2) { height: 80%; animation-delay: 0.3s; }
  .waveform .bar:nth-child(3) { height: 60%; animation-delay: 0.5s; }
  .waveform .bar:nth-child(4) { height: 100%; animation-delay: 0.2s; }
  .waveform .bar:nth-child(5) { height: 50%; animation-delay: 0.4s; }
  .waveform .bar:nth-child(6) { height: 70%; animation-delay: 0.6s; }

  @keyframes bar-pulse {
    0%, 100% { transform: scaleY(1); opacity: 0.5; }
    50% { transform: scaleY(0.6); opacity: 1; }
  }

  /* Crystal Card */
  .crystal-card {
    width: 100%;
    background: rgba(10, 10, 20, 0.3);
    backdrop-filter: blur(60px) saturate(160%);
    -webkit-backdrop-filter: blur(60px) saturate(160%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 32px;
    padding: 40px;
    position: relative;
    box-shadow: 
      0 40px 100px -20px rgba(0, 0, 0, 0.8),
      inset 0 1px 1px rgba(255, 255, 255, 0.1);
    overflow: hidden;
    -webkit-app-region: no-drag;
  }

  .form-title {
    font-size: 1.5rem;
    font-weight: 800;
    margin: 0 0 8px;
    letter-spacing: -0.02em;
    text-align: center;
  }

  .tabs {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.4);
    padding: 4px;
    border-radius: 14px;
    margin-bottom: 32px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .tab {
    flex: 1;
    padding: 10px;
    border-radius: 11px;
    background: transparent;
    color: var(--text-dim);
    font-weight: 800;
    font-size: 0.8rem;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: none;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .tab.active {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field span {
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.12em;
    margin-bottom: 8px;
    display: block;
    opacity: 0.6;
  }

  .field input {
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 14px 18px;
    border-radius: 12px;
    color: white;
    font-size: 1rem;
    transition: all 0.3s;
  }

  .field input:focus {
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--accent);
    box-shadow: var(--shadow);
    outline: none;
  }

  .terms-checkbox {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 12px;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .terms-checkbox input[type="checkbox"] {
    width: 16px;
    height: 16px;
    margin-top: 1px;
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .terms-checkbox a {
    color: var(--accent);
    text-decoration: none;
  }

  .terms-checkbox a:hover {
    text-decoration: underline;
  }

  .submit-btn {
    width: 100%;
    padding: 16px;
    background: var(--accent);
    color: white;
    font-weight: 900;
    font-size: 1rem;
    border-radius: 14px;
    margin-top: 24px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    border: none;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .submit-btn::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition: 0.5s;
  }

  .submit-btn:hover::after {
    left: 100%;
    transition: 0.5s;
  }

  .submit-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px var(--accent-glow);
    filter: brightness(1.1);
  }

  .forgot-link {
    display: block;
    text-align: center;
    margin-top: 20px;
    color: var(--text-dim);
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.2s;
  }

  .forgot-link:hover {
    color: var(--accent);
  }

  .back-btn {
    width: 100%;
    margin-top: 16px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .mfa-prompt {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.6;
    margin: 0 0 12px;
  }

  .disclaimer {
    text-align: center;
    color: var(--text-dim);
    font-size: 0.65rem;
    line-height: 1.5;
    margin: 8px 0 0;
    font-weight: 500;
  }

  .error {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
    padding: 12px;
    border-radius: 10px;
    font-size: 0.85rem;
    margin-top: 16px;
    border: 1px solid rgba(248, 113, 113, 0.2);
    font-weight: 600;
  }

  @media (max-width: 480px) {
    .login-container {
      padding: 0;
    }
    .crystal-card {
      max-width: 100%;
      height: 100vh;
      border-radius: 0;
      padding: 60px 24px;
      justify-content: center;
      border: none;
      box-shadow: none;
      background: transparent;
      backdrop-filter: none;
    }
    .login-stage {
      max-width: 100%;
      gap: 20px;
    }
    .hero-brand {
      font-size: 2rem;
    }
    .stellar-bg {
      opacity: 0.5;
    }
  }
</style>
