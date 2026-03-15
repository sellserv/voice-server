import { describe, it, expect } from 'vitest';
import { isPasswordStrong, getPasswordExpiryStatus, PASSWORD_MAX_AGE_DAYS } from './policy.js';

describe('Password Policy', () => {
  describe('isPasswordStrong', () => {
    it('should return true for a strong password', () => {
      expect(isPasswordStrong('StrongPassword123')).toBe(true);
    });

    it('should return false for a short password', () => {
      expect(isPasswordStrong('Short123')).toBe(false);
    });

    it('should return false for a password without uppercase', () => {
      expect(isPasswordStrong('weakpassword12345')).toBe(false);
    });

    it('should return false for a password without lowercase', () => {
      expect(isPasswordStrong('WEAKPASSWORD12345')).toBe(false);
    });

    it('should return false for a password without numbers', () => {
      expect(isPasswordStrong('WeakPasswordWithoutNumber')).toBe(false);
    });
  });

  describe('getPasswordExpiryStatus', () => {
    it('should return expired true for null passwordChangedAt', () => {
      expect(getPasswordExpiryStatus(null).expired).toBe(true);
    });

    it('should return expired false for a recent password change', () => {
      const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
      const status = getPasswordExpiryStatus(recent);
      expect(status.expired).toBe(false);
      expect(status.daysRemaining).toBe(80);
    });

    it('should return expired true for an old password change', () => {
      const old = new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
      const status = getPasswordExpiryStatus(old);
      expect(status.expired).toBe(true);
      expect(status.daysRemaining).toBe(0);
    });
  });
});
