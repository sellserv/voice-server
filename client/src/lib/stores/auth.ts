import { writable } from 'svelte/store';
import { api } from '../api';
import { isDesktop, setDesktopToken, setDesktopCsrf, loadDesktopTokens, clearDesktopTokens } from './server';
import type { User, LoginResponse, MfaMethod } from '@voip-server/shared';

export interface ChangePasswordBody {
  user_id?: string;
  current_password: string;
  new_password: string;
}

export const currentUser = writable<User | null>(null);
export const authLoading = writable(true);
export const mfaPending = writable<{
  required: boolean;
  userId: string;
  mfaMethod: MfaMethod;
} | null>(null);
export const passwordExpired = writable<{ userId: string } | null>(null);
export const emailVerificationPending = writable<{
  userId: string;
  canChangeEmail: boolean;
} | null>(null);
export const emailRequired = writable<{ userId: string } | null>(null);
export const accountLocked = writable<{ userId: string; mfaMethod: MfaMethod } | null>(null);
export const forgotPasswordState = writable<{
  step: 'username' | 'code' | 'reset';
  username?: string;
  resetToken?: string;
} | null>(null);

export async function checkAuth() {
  authLoading.set(true);
  await loadDesktopTokens();
  try {
    const user = await api.get<User & { token?: string; csrf?: string }>('/api/auth/me');
    if (isDesktop && user.token) {
      setDesktopToken(user.token);
    }
    if (isDesktop && user.csrf) {
      setDesktopCsrf(user.csrf);
    }
    currentUser.set(user);
  } catch {
    currentUser.set(null);
  } finally {
    authLoading.set(false);
  }
}

export async function login(username: string, password: string) {
  const res = await api.post<LoginResponse>('/api/auth/login', { username, password });

  if ('account_locked' in res && res.account_locked) {
    accountLocked.set({ userId: res.user_id, mfaMethod: res.mfa_method });
    return null;
  }

  if ('mfa_required' in res && res.mfa_required) {
    mfaPending.set({ required: true, userId: res.mfa_user_id, mfaMethod: res.mfa_method });
    return null;
  }

  if ('password_expired' in res && res.password_expired) {
    passwordExpired.set({ userId: res.user_id });
    return null;
  }

  if ('email_not_verified' in res && res.email_not_verified) {
    emailVerificationPending.set({ userId: res.user_id, canChangeEmail: false });
    return null;
  }

  if ('email_required' in res && res.email_required) {
    emailRequired.set({ userId: res.user_id });
    return null;
  }

  const user = res as User & { token?: string; csrf?: string };
  console.log('[AUTH] Login response has token:', !!user.token, 'isDesktop:', isDesktop);
  if (isDesktop && user.token) {
    setDesktopToken(user.token);
    console.log('[AUTH] Token stored for WS');
  }
  if (isDesktop && user.csrf) {
    setDesktopCsrf(user.csrf);
  }
  currentUser.set(user);
  mfaPending.set(null);
  passwordExpired.set(null);
  emailVerificationPending.set(null);
  emailRequired.set(null);
  accountLocked.set(null);
  return user;
}

export async function verifyMfa(userId: string, code: string, mfaMethod: MfaMethod) {
  const res = await api.post<LoginResponse>('/api/auth/login/mfa', {
    user_id: userId,
    code,
    mfa_method: mfaMethod,
  });

  if ('password_expired' in res && res.password_expired) {
    mfaPending.set(null);
    passwordExpired.set({ userId: res.user_id });
    return null;
  }

  const user = res as User & { token?: string; csrf?: string };
  if (isDesktop && user.token) {
    setDesktopToken(user.token);
  }
  if (isDesktop && user.csrf) {
    setDesktopCsrf(user.csrf);
  }
  currentUser.set(user);
  mfaPending.set(null);
  passwordExpired.set(null);
  return user;
}

export async function register(
  username: string,
  password: string,
  email: string,
  display_name?: string,
  invite_code?: string,
  captcha_token?: string,
) {
  const res = await api.post<LoginResponse>('/api/auth/register', {
    username,
    password,
    email,
    display_name,
    invite_code,
    captcha_token,
  });

  if ('verification_required' in res && res.verification_required) {
    emailVerificationPending.set({ userId: res.user_id, canChangeEmail: true });
    return null;
  }

  const user = res as User;
  currentUser.set(user);
  return user;
}

export async function verifyEmail(userId: string, code: string) {
  await api.post('/api/email/verify', { user_id: userId, code });
  emailVerificationPending.set(null);
}

export async function resendVerification(userId: string) {
  await api.post('/api/email/resend-verification', { user_id: userId });
}

export async function resendMfaCode(userId: string) {
  await api.post('/api/email/resend-mfa', { user_id: userId });
}

export async function unlockAccount(userId: string, code: string, mfaMethod: MfaMethod) {
  await api.post('/api/auth/unlock-account', { user_id: userId, code, mfa_method: mfaMethod });
  accountLocked.set(null);
}

export async function setEmail(userId: string, email: string, password: string) {
  const res = await api.post<LoginResponse>('/api/auth/set-email', {
    user_id: userId,
    email,
    password,
  });
  if ('verification_required' in res && res.verification_required) {
    emailRequired.set(null);
    emailVerificationPending.set({ userId: res.user_id, canChangeEmail: true });
  }
}

export async function forgotPassword(username: string) {
  await api.post<{ ok: boolean }>('/api/auth/forgot-password', { username });
  forgotPasswordState.set({
    step: 'code',
    username,
  });
}

export async function forgotPasswordVerify(username: string, code: string) {
  const res = await api.post<{ reset_token: string }>('/api/auth/forgot-password/verify', {
    username,
    code,
  });
  forgotPasswordState.set({
    step: 'reset',
    username,
    resetToken: res.reset_token,
  });
}

export async function resetPassword(resetToken: string, newPassword: string) {
  await api.post('/api/auth/reset-password', {
    reset_token: resetToken,
    new_password: newPassword,
  });
  forgotPasswordState.set(null);
}

export async function logout() {
  await api.post('/api/auth/logout');
  clearDesktopTokens();
  currentUser.set(null);
}

export async function changePassword(
  userId: string | undefined,
  currentPassword: string,
  newPassword: string,
) {
  const body: ChangePasswordBody = { current_password: currentPassword, new_password: newPassword };
  if (userId) body.user_id = userId;
  const user = await api.post<User & { token?: string; csrf?: string }>('/api/auth/change-password', body);
  if (isDesktop && user.token) {
    setDesktopToken(user.token);
  }
  if (isDesktop && user.csrf) {
    setDesktopCsrf(user.csrf);
  }
  currentUser.set(user);
  passwordExpired.set(null);
  mfaPending.set(null);
  return user;
}

export async function updateProfile(data: {
  display_name?: string;
  avatar_url?: string | null;
  bio?: string;
  banner_url?: string | null;
  name_font?: string | null;
  name_color?: string | null;
}) {
  const user = await api.patch<User>('/api/users/me', data);
  currentUser.set(user);
  return user;
}
