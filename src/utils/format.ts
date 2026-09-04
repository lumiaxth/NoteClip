export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape a string for safe embedding in HTML (like esc), optionally wrapping
 * case-insensitive matches of `query` in <mark> so search hits stand out.
 */
export function escHighlighted(s: string, query: string): string {
  const q = query.trim();
  if (!q) return esc(s);
  const re = new RegExp(escapeRegExp(q), 'gi');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(re)) {
    const start = m.index ?? 0;
    out += esc(s.slice(last, start)) + '<mark class="nc-hl">' + esc(m[0]) + '</mark>';
    last = start + m[0].length;
  }
  return out + esc(s.slice(last));
}

/**
 * Append a Text Fragment (`#:~:text=`) so Chromium browsers scroll to and
 * highlight the clipped text on the source page. Falls back to the plain URL
 * for non-web pages, image-only clips and URLs that already have a fragment.
 */
export function textFragmentUrl(url: string, text?: string): string {
  const fragSource = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!fragSource || !/^https?:/i.test(url) || url.includes('#')) return url;
  // encodeURIComponent handles commas (fragment syntax); dashes are left
  // as-is by it but are also fragment syntax, so encode them explicitly.
  const encoded = encodeURIComponent(fragSource).replace(/-/g, '%2D');
  return `${url}#:~:text=${encoded}`;
}
