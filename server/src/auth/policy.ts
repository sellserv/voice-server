export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 72;

export function isPasswordStrong(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    return false;
  }

  // Reject passwords with excessive character repetition (e.g. Aaaaaaaaaaaaa1!)
  const uniqueChars = new Set(password).size;
  if (uniqueChars < Math.min(8, password.length / 2)) {
    return false;
  }

  return true;
}
