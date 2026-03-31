import { describe, it, expect } from 'vitest';
import { translatePlaceholders } from './placeholder.js';

describe('translatePlaceholders', () => {
  it('translates ? to $N', () => {
    expect(translatePlaceholders('SELECT * FROM users WHERE id = ? AND name = ?'))
      .toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
  });

  it('handles no placeholders', () => {
    expect(translatePlaceholders('SELECT 1'))
      .toBe('SELECT 1');
  });

  it('handles IN clauses with multiple ?', () => {
    expect(translatePlaceholders('WHERE id IN (?, ?, ?)'))
      .toBe('WHERE id IN ($1, $2, $3)');
  });

  it('does not replace ? inside single-quoted strings', () => {
    expect(translatePlaceholders("WHERE name = '?' AND id = ?"))
      .toBe("WHERE name = '?' AND id = $1");
  });

  it('translates datetime function', () => {
    expect(translatePlaceholders("datetime('now')"))
      .toBe('NOW()');
  });

  it('translates GROUP_CONCAT to STRING_AGG', () => {
    expect(translatePlaceholders('GROUP_CONCAT(user_id)'))
      .toBe("STRING_AGG(user_id, ',')");
  });
});
