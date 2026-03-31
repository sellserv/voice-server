/**
 * Translate SQLite-style ? placeholders to PostgreSQL $N placeholders.
 * Also translates common SQLite functions to PostgreSQL equivalents.
 * Respects quoted strings — ? inside single quotes is not translated.
 */
export function translatePlaceholders(sql: string): string {
  // First pass: translate SQLite functions to PostgreSQL equivalents
  let result = sql
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/GROUP_CONCAT\((\w+)\s+ORDER\s+BY\s+([^)]+)\)/gi, "STRING_AGG($1, ',' ORDER BY $2)")
    .replace(/GROUP_CONCAT\((\w+)\)/gi, "STRING_AGG($1, ',')");

  // Second pass: replace ? placeholders (skip those inside single quotes)
  let counter = 0;
  let inQuote = false;
  let out = '';

  for (let i = 0; i < result.length; i++) {
    const ch = result[i];

    if (ch === "'" && result[i - 1] !== '\\') {
      inQuote = !inQuote;
      out += ch;
    } else if (ch === '?' && !inQuote) {
      counter++;
      out += `$${counter}`;
    } else {
      out += ch;
    }
  }

  return out;
}
