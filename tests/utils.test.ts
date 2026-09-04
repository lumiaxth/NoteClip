import { describe, it, expect } from 'vitest';
import { textFragmentUrl, escHighlighted } from '@/utils/format';

describe('textFragmentUrl', () => {
  it('appends a text fragment for web URLs', () => {
    expect(textFragmentUrl('https://a.com/post', 'Hello world')).toBe(
      'https://a.com/post#:~:text=Hello%20world',
    );
  });

  it('encodes dashes and commas (fragment syntax characters)', () => {
    const url = textFragmentUrl('https://a.com/p', 'a-b, c');
    expect(url).toBe('https://a.com/p#:~:text=a%2Db%2C%20c');
  });

  it('returns the plain URL for image-only clips, non-web pages and existing fragments', () => {
    expect(textFragmentUrl('https://a.com/p', '')).toBe('https://a.com/p');
    expect(textFragmentUrl('https://a.com/p', '   ')).toBe('https://a.com/p');
    expect(textFragmentUrl('chrome-extension://x/y', 'text')).toBe('chrome-extension://x/y');
    expect(textFragmentUrl('https://a.com/p#sec', 'text')).toBe('https://a.com/p#sec');
  });

  it('collapses whitespace and caps the fragment at 80 chars', () => {
    const long = 'a '.repeat(60).trim();
    const url = textFragmentUrl('https://a.com/p', long);
    const frag = decodeURIComponent(url.split('#:~:text=')[1]!).replace(/%2D/g, '-');
    expect(frag.length).toBeLessThanOrEqual(80);
    expect(frag).not.toContain('\n');
  });
});

describe('escHighlighted', () => {
  it('wraps case-insensitive hits in <mark>', () => {
    expect(escHighlighted('Foo bar FOO', 'foo')).toBe(
      '<mark class="nc-hl">Foo</mark> bar <mark class="nc-hl">FOO</mark>',
    );
  });

  it('escapes HTML inside and around hits', () => {
    expect(escHighlighted('a<b', '<b')).toBe('a<mark class="nc-hl">&lt;b</mark>');
    expect(escHighlighted('<b>x</b>', 'x')).toBe('&lt;b&gt;<mark class="nc-hl">x</mark>&lt;/b&gt;');
  });

  it('behaves like plain esc when the query is empty', () => {
    expect(escHighlighted('x<y', '  ')).toBe('x&lt;y');
  });

  it('treats the query as literal text, not a regex', () => {
    expect(escHighlighted('a.c abc', 'a.c')).toBe(
      '<mark class="nc-hl">a.c</mark> abc',
    );
  });
});
