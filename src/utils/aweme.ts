export interface AwemeAlbum {
  awemeId: string;
  /** images[k] = ordered CDN mirrors (url_list) of the k-th picture. */
  images: string[][];
}

/**
 * Extract the resource hash segment of a CDN image URL, tolerating the
 * different decoration formats across sites:
 * - Douyin:  `o8HM8BaP...AAAP~noop.jpeg`  (~noop suffix)
 * - Xiaohongshu: `1040g008...q60!nd_dft_phll_web`  (!style suffix)
 * - Weibo:   `008aBcDe...PQ12.jpg`  (plain file name)
 * The same image resource keeps the same hash across cover/thumbnail/
 * original variants, which lets us match the DOM image against the album
 * original URLs captured from the page's own API/SSR data.
 */
export function resourceId(url: string): string {
  try {
    let name = new URL(url).pathname.split('/').pop() ?? '';
    name = name.split('~')[0]!.split('!')[0]!;
    const dot = name.lastIndexOf('.');
    if (dot > 0) name = name.slice(0, dot);
    return /^[A-Za-z0-9_-]{8,}$/.test(name) ? name : '';
  } catch {
    return '';
  }
}

/** Find the album that contains an image with the given resource id. */
export function findAlbum(cache: Map<string, string[][]>, id: string): AwemeAlbum | null {
  if (!id) return null;
  for (const [awemeId, images] of cache.entries()) {
    if (!Array.isArray(images)) continue;
    for (const list of images) {
      if (!Array.isArray(list)) continue;
      if (list.some((url) => typeof url === 'string' && resourceId(url) === id)) {
        return { awemeId, images };
      }
    }
  }
  return null;
}
