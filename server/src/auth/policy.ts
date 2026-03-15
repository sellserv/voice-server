export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_MAX_AGE_DAYS = 90;

export function isPasswordStrong(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  
  // Requirement: at least one uppercase, one lowercase, and one number
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  return hasUpper && hasLower && hasNumber;
}

export function getPasswordExpiryStatus(passwordChangedAt: string | null): { expired: boolean; daysRemaining: number } {
  if (!passwordChangedAt) return { expired: true, daysRemaining: 0 };
  
  const changed = new Date(passwordChangedAt + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - changed.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  const expired = diffDays > PASSWORD_MAX_AGE_DAYS;
  const daysRemaining = Math.max(0, PASSWORD_MAX_AGE_DAYS - Math.floor(diffDays));
  
  return { expired, daysRemaining };
}
