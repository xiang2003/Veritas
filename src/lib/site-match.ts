/**
 * Chrome match patterns (as used in the manifest's content_scripts.matches), e.g. "https://*.cnn.com/*".
 * Supports the scheme, host (with an optional leading "*." for subdomains) and path wildcards.
 */
export function matchPatternToRegExp(pattern: string): RegExp {
  const match = /^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(pattern);
  if (!match) throw new Error(`Invalid match pattern: ${pattern}`);
  const [, scheme, host, path] = match as unknown as [string, string, string, string];
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const schemePart = scheme === '*' ? 'https?' : escape(scheme);
  const hostPart =
    host === '*' ? '[^/]+' : host.startsWith('*.') ? `(?:[^/]+\\.)?${escape(host.slice(2))}` : escape(host);
  const pathPart = escape(path).replace(/\*/g, '.*');
  return new RegExp(`^${schemePart}://${hostPart}(?::\\d+)?${pathPart}$`);
}

/** Whether `url` is on one of the news sites Veritas supports. */
export function isNewsUrl(url: string | undefined, patterns: readonly string[]): boolean {
  if (!url) return false;
  return patterns.some((p) => matchPatternToRegExp(p).test(url));
}
