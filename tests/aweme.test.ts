import { describe, it, expect } from 'vitest';
import { resourceId, findAlbum } from '@/utils/aweme';

describe('resourceId', () => {
  it('extracts the hash segment from douyin CDN urls', () => {
    const id = resourceId(
      'https://p3-pc-sign.douyinpic.com/tos-cn-i-0813c000-ce/o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP~noop.jpeg?biz_tag=pcweb_cover&x-signature=x',
    );
    expect(id).toBe('o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP');
    // Original (no ~noop suffix) keeps the same resource hash.
    expect(resourceId('https://p26.douyinpic.com/aweme/xxx/o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP.jpeg')).toBe(id);
  });

  it('returns empty for invalid or imageless urls', () => {
    expect(resourceId('not a url')).toBe('');
    expect(resourceId('https://a.com/')).toBe('');
    expect(resourceId('https://a.com/page.html')).toBe('');
  });

  it('strips xiaohongshu style suffixes (!nd_dft…)', () => {
    const id = resourceId(
      'https://sns-webpic-q.xhscdn.com/202609/1040g008307hbpetkt06g4a5o6k06v4ahvfq1q60!nd_dft_phll_web_draft_1417w.jpg',
    );
    expect(id).toBe('1040g008307hbpetkt06g4a5o6k06v4ahvfq1q60');
  });

  it('extracts plain weibo file names', () => {
    expect(resourceId('https://wx1.sinaimg.cn/large/008aBcDeFgHiJkLmNoPQ12.jpg')).toBe(
      '008aBcDeFgHiJkLmNoPQ12',
    );
  });
});

describe('findAlbum', () => {
  const cache = new Map<string, string[][]>([
    [
      'aweme-1',
      [
        [
          'https://p3-pc-sign.douyinpic.com/tos-cn-i/o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP~noop.jpeg',
          'https://p6.douyinpic.com/img/o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP.jpeg',
        ],
        ['https://p9.douyinpic.com/img/AbCdEfGHIJKLmNoPqRsT12345~noop.jpeg'],
      ],
    ],
  ]);

  it('matches by resource id across cover/original url variants', () => {
    const album = findAlbum(cache, 'o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP');
    expect(album?.awemeId).toBe('aweme-1');
    expect(album?.images).toHaveLength(2);
  });

  it('returns null for unknown or empty ids', () => {
    expect(findAlbum(cache, 'zzzzzzzz')).toBeNull();
    expect(findAlbum(cache, '')).toBeNull();
  });

  it('works with an empty cache', () => {
    expect(findAlbum(new Map(), 'o8HM8BaPATgICiivnwWAp65BzhpcPYEkAIAAP')).toBeNull();
  });
});
