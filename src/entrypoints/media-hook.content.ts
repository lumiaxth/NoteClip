export default defineContentScript({
  matches: [
    '*://*.douyin.com/*',
    '*://*.xiaohongshu.com/*',
    '*://*.weibo.com/*',
    '*://*.weibo.cn/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    /** Latest album payloads per post/note id (bounded FIFO). */
    const cache = new Map<string, string[][]>();
    let dirty = false;

    function record(id: string, images: string[][]): void {
      const key = String(id);
      if (!key || images.length === 0 || cache.has(key)) return;
      cache.set(key, images);
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
      dirty = true;
    }

    /**
     * Walk arbitrary JSON looking for Douyin aweme / XHS note / Weibo mblog
     * album shapes; keeps original-image URL lists only (skips video CDNs
     * that appear inside Douyin url_list entries).
     */
    function scan(node: unknown, depth: number): void {
      if (depth > 20 || typeof node !== 'object' || node === null) return;
      if (Array.isArray(node)) {
        for (const item of node) scan(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;

      const pickKeys = (...keys: string[]): string | null => {
        for (const key of keys) {
          const value = obj[key];
          if (typeof value === 'string' && value) return value;
          if (typeof value === 'number') return String(value);
        }
        return null;
      };

      // Video / live-photo frames must not enter image albums: <img> cannot
      // render them (black frames). Douyin live-photo videos sometimes hide
      // on CDNs without the douyinvod marker, hence the file-extension and
      // mime param checks.
      const videoCdn =
        /douyinvod\.|mime_type=video|\/video\/|\.mp4(?=$|[?#])|\.mov(?=$|[?#])|\/livephoto\//i;

      // Douyin: aweme.images[k].url_list (mirrors of the k-th picture)
      const awemeId = pickKeys('aweme_id', 'awemeId');
      if (awemeId && Array.isArray(obj.images) && !cache.has(awemeId)) {
        const images: string[][] = [];
        let ok = true;
        for (const image of obj.images as unknown[]) {
          const lists =
            Array.isArray((image as { urlList?: unknown[] })?.urlList)
              ? ((image as { urlList?: unknown[] }).urlList as unknown[])
              : Array.isArray((image as { url_list?: unknown[] })?.url_list)
                ? ((image as { url_list?: unknown[] }).url_list as unknown[])
                : null;
          if (lists) {
            const urls = (lists as unknown[]).filter(
              (u): u is string => typeof u === 'string' && !videoCdn.test(u),
            );
            if (urls.length > 0) images.push(urls);
            else ok = false;
          } else {
            ok = false;
          }
          if (!ok) break;
        }
        if (ok) record(awemeId, images);
      }

      // Xiaohongshu: note.imageList[k].urlDefault / url
      const noteId = pickKeys('note_id', 'noteId', 'id');
      if (noteId && Array.isArray(obj.imageList) && !cache.has(noteId)) {
        const images: string[][] = [];
        let ok = true;
        for (const image of obj.imageList as unknown[]) {
          let url: string | null = null;
          if (typeof (image as { urlDefault?: unknown })?.urlDefault === 'string')
            url = (image as { urlDefault: string }).urlDefault;
          else if (typeof (image as { url?: unknown })?.url === 'string')
            url = (image as { url: string }).url;
          if (url) images.push([url]);
          else {
            ok = false;
            break;
          }
        }
        if (ok) record(noteId, images);
      }

      // Weibo: mblog.pic_infos.<key>.large/mw2000/original.url
      const mblogId = pickKeys('mblogid', 'id');
      const picInfos = obj.pic_infos as Record<string, unknown> | undefined;
      if (mblogId && picInfos && typeof picInfos === 'object' && !cache.has(mblogId)) {
        const images: string[][] = [];
        for (const info of Object.values(picInfos)) {
          const variants = info as Record<string, { url?: unknown }>;
          let url: string | null = null;
          if (typeof variants?.large?.url === 'string') url = variants.large.url;
          else if (typeof variants?.mw2000?.url === 'string') url = variants.mw2000.url;
          else if (typeof variants?.original?.url === 'string') url = variants.original.url;
          if (url) images.push([url]);
        }
        if (images.length > 0) record(mblogId, images);
      }

      for (const value of Object.values(obj)) scan(value, depth + 1);
    }

    /** Publish the cache snapshot to the isolated-world content script. */
    function flush(): void {
      if (!dirty) return;
      dirty = false;
      try {
        window.dispatchEvent(
          new CustomEvent('nc-aweme-cache', { detail: JSON.stringify(Object.fromEntries(cache)) }),
        );
      } catch (e) {
        console.debug('[NoteClip hook]', e);
      }
    }

    // The isolated-world content script starts after the SSR scan finished;
    // when it probes, republish the current snapshot.
    window.addEventListener('nc-aweme-cache-probe', () => {
      dirty = true;
      flush();
    });

    // Douyin / XHS / Weibo JSON APIs (SSR + XHR both feed these).
    const albumUrl = /aweme\/v1|iesdouyin\.com|iteminfo|aweme\/detail|aweme\/post|\/feed|\/api\/sns\/web|\/ajax\/statuses/i;

    const nativeFetch = window.fetch;
    type FetchArgs = Parameters<typeof fetch>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.fetch = async (...args: FetchArgs) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (nativeFetch as (...a: FetchArgs) => Promise<Response>)(...args);
      try {
        const input = args[0] as string | { url?: string };
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (albumUrl.test(url)) {
          response
            .clone()
            .json()
            .then((data) => {
              scan(data, 0);
              flush();
            })
            .catch((e) => console.debug('[NoteClip hook]', e));
        }
      } catch (e) {
        console.debug('[NoteClip hook]', e);
      }
      return response;
    };

    const proto = XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    proto.open = function (this: XMLHttpRequest & { __ncUrl?: string }, ...args: unknown[]) {
      this.__ncUrl = String(args[1] ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return nativeOpen.apply(this, args as any);
    };
    proto.send = function (this: XMLHttpRequest & { __ncUrl?: string }, ...args: unknown[]) {
      this.addEventListener('load', () => {
        try {
          if (!albumUrl.test(this.__ncUrl ?? '')) return;
          const body = (this as unknown as { responseType?: string }).responseType === 'json'
            ? (this as unknown as XMLHttpRequest).response
            : (this as unknown as XMLHttpRequest).responseText;
          if (body == null) return;
          scan(typeof body === 'string' ? JSON.parse(body) : body, 0);
          flush();
        } catch (e) {
          console.debug('[NoteClip hook]', e);
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return nativeSend.apply(this, args as any);
    };

    /** Initial page hydration data (SSR payloads embedded in the document). */
    function scanPageData(): void {
      const window0 = window as unknown as { __pace_f?: unknown; __INITIAL_STATE__?: unknown; $render_data?: unknown };
      try {
        const el = document.getElementById('RENDER_DATA');
        if (el?.textContent) scan(JSON.parse(decodeURIComponent(el.textContent)), 0);
      } catch {
        /* no RENDER_DATA on this page */
      }
      try {
        if (window0.__pace_f != null) scan(window0.__pace_f, 0);
      } catch {
        /* no pace f */
      }
      try {
        if (window0.__INITIAL_STATE__ != null) scan(window0.__INITIAL_STATE__, 0);
      } catch {
        /* no initial state */
      }
      try {
        if (window0.$render_data != null) scan(window0.$render_data, 0);
      } catch {
        /* no render data */
      }
      flush();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scanPageData);
    } else {
      scanPageData();
    }
  },
});
