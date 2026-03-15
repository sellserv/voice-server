// Utility for parsing name_color values (solid hex or gradient)
// Solid: "#ff0000"
// Gradient: "gradient:#ff0000,#0000ff"

export function isGradient(value: string | null | undefined): boolean {
  return !!value && value.startsWith('gradient:');
}

const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgb\(\d{1,3},\s?\d{1,3},\s?\d{1,3}\)|hsl\(\d{1,3},\s?\d{1,3}%,\s?\d{1,3}%\))$/;

function sanitizeColor(c: string, fallback = '#ffffff'): string {
  return CSS_COLOR_RE.test(c.trim()) ? c.trim() : fallback;
}

export function parseGradientColors(value: string): [string, string] {
  const parts = value.replace('gradient:', '').split(',');
  return [sanitizeColor(parts[0] || '#ffffff'), sanitizeColor(parts[1] || '#ffffff')];
}

/**
 * Returns an inline style string for a name color value.
 * Handles both solid hex colors and gradient strings.
 * Optionally appends font-family if provided.
 */
export function nameStyle(
  nameColor: string | null | undefined,
  fallbackColor?: string | null,
  fontFamily?: string | null,
): string {
  const parts: string[] = [];

  if (nameColor && isGradient(nameColor)) {
    const [c1, c2] = parseGradientColors(nameColor);
    parts.push(
      `background:linear-gradient(to right,${c1},${c2})`,
      '-webkit-background-clip:text',
      '-webkit-text-fill-color:transparent',
      'background-clip:text',
      'max-width:max-content',
    );
  } else {
    const color = nameColor || fallbackColor;
    if (color) parts.push(`color:${sanitizeColor(color)}`);
  }

  // Whitelist font-family to prevent CSS injection
  if (fontFamily) {
    const safe = fontFamily.replace(/[^a-zA-Z0-9\s,\-']/g, '');
    if (safe) parts.push(`font-family:${safe}`);
  }

  return parts.join(';');
}
