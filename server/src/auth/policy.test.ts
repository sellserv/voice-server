import { describe, it, expect } from 'vitest';
import { isPasswordStrong } from './policy.js';

describe('Password Policy', () => {
  describe('isPasswordStrong', () => {
    it('should return true for a strong password', () => {
      expect(isPasswordStrong('StrongPassword123!')).toBe(true);
    });

    it('should return false for a short password', () => {
      expect(isPasswordStrong('Short123!')).toBe(false);
    });

    it('should return false for a password without uppercase', () => {
      expect(isPasswordStrong('weakpassword12345!')).toBe(false);
    });

    it('should return false for a password without lowercase', () => {
      expect(isPasswordStrong('WEAKPASSWORD12345!')).toBe(false);
    });

    it('should return false for a password without numbers', () => {
      expect(isPasswordStrong('WeakPasswordNoNum!')).toBe(false);
    });

    it('should return false for a password without special characters', () => {
      expect(isPasswordStrong('StrongPassword123')).toBe(false);
    });

    it('should return false for a password with excessive repetition', () => {
      expect(isPasswordStrong('Aaaaaaaaaaaaaaa1!')).toBe(false);
    });
  });
});
