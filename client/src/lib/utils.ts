export function plainTextPreview(text: string): string {
  if (!text) return '';
  return text
    .replace(/<:([a-zA-Z0-9_]+):[^>]+>/g, ':$1:')
    .replace(/<@everyone>/g, '@everyone')
    .replace(/<@role:[^>]+>/g, '@mention')
    .replace(/<@[^>]+>/g, '@mention');
}
