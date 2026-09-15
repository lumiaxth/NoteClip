import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { t } from '@/utils/i18n';
import { findAlbum, resourceId, type AwemeAlbum } from '@/utils/aweme';
import type { BgResponse, ClipFetchResponse, ClipPageTitleResponse } from '@/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    /** Album data captured by the MAIN-world hook (awemeId → original urls). */
    const albumCache = new Map<string, string[][]>();

    // The MAIN-world hook publishes its cache on every data mutation; our
    // listener registers after that first publish (SSR scan), so ask for a
    // fresh snapshot right away. dispatchEvent is synchronous.
    window.addEventListener('nc-aweme-cache', (e) => {
      try {
        albumCache.clear();
        const data = JSON.parse((e as CustomEvent<string>).detail) as Record<string, string[][]>;
        for (const [id, images] of Object.entries(data)) albumCache.set(id, images);
      } catch {
        /* malformed hook payload */
      }
    });
    window.dispatchEvent(new CustomEvent('nc-aweme-cache-probe'));

    const btn = document.createElement('button');
    btn.textContent = t('floatingCapture');
    btn.setAttribute('type', 'button');
    btn.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'display:none',
      'padding:6px 14px',
      'font:600 13px/1.4 system-ui,sans-serif',
      'color:#ffffff',
      'background:#4f46e5',
      'border:0',
      'border-radius:8px',
      'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      'cursor:pointer',
    ].join(';');

    let visible = false;
    let lastText = '';
    /** Enabled by the "floating clip button" setting; live-updated. */
    let enabled = true;
    /** Current accent color; the album picker buttons follow it. */
    let accentColor = '#4f46e5';
    /** True while the user is pressing the button — page/selection events are ignored. */
    let pressing = false;
    /** Auto-hide timers: both floating buttons vanish after 3 s idle. */
    let btnHideTimer = 0;
    let imgHideTimer = 0;
    /** Cursor position at the last mouseup (for text button placement). */
    let lastMouseX = 4;
    let lastMouseY = 4;

    function hide(): void {
      if (visible) {
        btn.style.display = 'none';
        visible = false;
      }
      if (btnHideTimer) {
        window.clearTimeout(btnHideTimer);
        btnHideTimer = 0;
      }
    }

    function show(): void {
      if (!enabled) return;
      btn.style.display = 'block';
      visible = true;
      if (btnHideTimer) window.clearTimeout(btnHideTimer);
      btnHideTimer = window.setTimeout(() => hide(), 3000);
    }

    function isEditable(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    }

    function getSelectionText(): string {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return '';
      const raw = sel.toString();
      if (!raw.trim()) return '';
      if (isEditable(document.activeElement)) return '';
      if (isEditable(sel.anchorNode?.parentElement ?? null)) return '';
      return raw;
    }

    /** Place a button directly LEFT of the cursor (vertically centered),
     * falling back to above it when the viewport's left edge blocks that. */
    function placeLeftOf(
      button: HTMLElement,
      cursorX: number,
      cursorY: number,
      fallbackY?: number,
    ): void {
      const w = button.offsetWidth || 96;
      const h = button.offsetHeight || 29;
      const y = fallbackY ?? cursorY;
      // Vertical: centered on the cursor.
      let top = Math.max(4, Math.min(cursorY - h / 2, window.innerHeight - h - 4));
      // Horizontal: left of the cursor; if there is no room, above the
      // selection anchor (fallbackY) instead.
      let x = cursorX - w - 14;
      if (x < 4) {
        x = Math.max(4, Math.min(y - 8, window.innerWidth - w - 4));
        top = Math.max(4, cursorY - h - 8);
      }
      button.style.left = `${Math.min(x, window.innerWidth - w - 4)}px`;
      button.style.top = `${top}px`;
    }

    function positionButton(): void {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        hide();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }
      // Left of the last mouseup cursor; the selection rect anchors the
      // vertical fallback when the viewport's left edge blocks placement.
      placeLeftOf(btn, lastMouseX, lastMouseY, rect.top);
    }

    document.addEventListener('mouseup', (e) => {
      if (pressing || btn.contains(e.target as Node)) return;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      const text = getSelectionText();
      if (!text) {
        hide();
        return;
      }
      lastText = text;
      // Show before measuring so placeLeftOf sees the real button size.
      show();
      positionButton();
    });

    document.addEventListener('selectionchange', () => {
      if (pressing) return;
      if (visible && !getSelectionText()) hide();
    });

    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('mousedown', (e) => {
      if (!btn.contains(e.target as Node)) hide();
    });

    // Isolate the button from page handlers and keep the selection intact
    // while pressing, so the click event always lands on the button.
    btn.addEventListener('pointerdown', (e) => {
      pressing = true;
      e.stopPropagation();
    });
    btn.addEventListener('pointerup', (e) => e.stopPropagation());
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('mouseup', (e) => e.stopPropagation());
    btn.addEventListener('dragstart', (e) => e.preventDefault());
    // If the press is aborted (released outside the button), no click event
    // will ever fire — release the flag so page events work again.
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!btn.contains(e.target as Node)) pressing = false;
      },
      true,
    );

    function flash(label: string, failed: boolean, ms: number): void {
      btn.textContent = label;
      setTimeout(() => {
        btn.textContent = t('floatingCapture');
        if (!failed) hide();
      }, ms);
    }

    btn.addEventListener('click', async () => {
      pressing = false;
      const text = lastText;
      if (!text) return;
      let resp: BgResponse | undefined;
      try {
        resp = await browser.runtime.sendMessage({
          type: 'saveText',
          text,
          url: location.href,
          title: document.title,
        });
      } catch {
        resp = { ok: false };
      }
      // The background saves fire-and-forget; a missing response still means saved.
      if (resp?.ok !== false) {
        flash(t('floatingSaved'), false, 1200);
        lastText = '';
      } else {
        flash(t('floatingSaveFailed'), true, 1500);
      }
    });

    // ---------- Image clip fallback (protected sites: overlays, blob: URLs,
    // custom right-click menus that block the native context menu) ----------

    const imgBtn = document.createElement('button');
    imgBtn.textContent = t('floatingClipImage');
    imgBtn.setAttribute('type', 'button');
    imgBtn.style.cssText = btn.style.cssText;

    /** Image URL found under the right-click point; '' when none. */
    let imgTarget = '';
    /** Nearby post text captured at right-click time (saves as the title). */
    let imgTitle = '';
    /** Author/profile link captured at right-click time (snippet source). */
    let imgSourceUrl = '';
    let imgPressing = false;

    interface PostInfo {
      /** Card body text ([class*="wbtext"]), '' when the post has no text. */
      text: string;
      /** Author of the post; '' when the card header link is missing. */
      author: string;
      /** Normalized author/post link from the header anchor. */
      authorUrl: string;
      /** Post-specific link (weibo permalink / XHS note page); '' when none. */
      sourceUrl: string;
    }

    const TITLE_LIMIT = 60;

    /** Compose "正文 - 用户名" (or "图片 - 用户名" for pure-image posts),
     * capped at 60 chars total; the author suffix always survives. */
    function composeTitle(bodyText: string, author: string): string {
      const body = bodyText.trim() || t('imageKind');
      if (!author) return body.slice(0, TITLE_LIMIT);
      const room = Math.min(TITLE_LIMIT - 3, Math.max(2, TITLE_LIMIT - 3 - author.length));
      const text = body.length > room ? body.slice(0, room) + '|' : body;
      return `${text} - ${author}`.slice(0, TITLE_LIMIT);
    }

    const isXhsHost = (): boolean =>
      /(^|\.)xiaohongshu\.com$/i.test(location.hostname);

    const isDouyinHost = (): boolean =>
      /(^|\.)douyin\.com$/i.test(location.hostname);

    /**
     * Douyin feed extraction (the image-note card is a side-scrolling video
     * player): container `[data-e2e="feed-active-video"]` carries the
     * `data-e2e-vid` aweme id; body `.title[data-e2e="video-desc"]`
     * (includes the #tags as text); author
     * `.account-name[data-e2e="feed-video-nickname"]` (leading `@` stripped)
     * with the profile anchor `a[data-e2e="video-avatar"]`; the snippet
     * source link is the normalized note permalink `/note/<id>`.
     */
    function extractDouyinPost(el: Element | null): PostInfo {
      const info: PostInfo = { text: '', author: '', authorUrl: '', sourceUrl: '' };
      if (!el) return info;
      const norm = (href: string): string => {
        try {
          return new URL(href, location.origin).href;
        } catch {
          return '';
        }
      };
      const card = el.closest<HTMLElement>('[data-e2e="feed-active-video"]') ??
        el.closest<HTMLElement>('[data-e2e="feed-item"]');
      if (!card) return info;
      const vid = card.getAttribute('data-e2e-vid') || '';
      info.text =
        card.querySelector<HTMLElement>('.title[data-e2e="video-desc"]')?.textContent
          ?.replace(/\s+/g, ' ')
          .trim() ?? '';
      const nick = card.querySelector<HTMLElement>(
        '.account-name[data-e2e="feed-video-nickname"]',
      );
      info.author = (nick?.textContent?.trim() ?? '').replace(/^@+/, '');
      const avatarAnchor = card.querySelector<HTMLAnchorElement>('a[data-e2e="video-avatar"]');
      if (avatarAnchor) info.authorUrl = norm(avatarAnchor.href);
      if (vid) info.sourceUrl = `https://www.douyin.com/note/${vid}`;
      return info;
    }

    /** Post/note id inside the current page URL, '' when absent. */
    function pageIdFromUrl(): string {
      return (
        /\/(?:explore|discovery|item|note|video|status)\/([A-Za-z0-9_-]+)/.exec(
          location.pathname,
        )?.[1] ?? ''
      );
    }

    /**
     * Xiaohongshu DOM extraction (their anchors/labels differ from weibo):
     * - detail page: `#noteContainer.note-container` → title `#detail-title`
     *   (h1), body `#detail-desc .note-text`, author `.author-wrapper a.name`
     *   (its text is the username); the page itself is the post permalink.
     * - home feed card: `section.note-item` → title `.footer a.title`,
     *   author `.footer .author-wrapper a.author`, source link = the card's
     *   cover/title anchor (`/user/profile/<uid>/<noteId>?xsec_token=…`).
     */
    function extractXhsPost(el: Element | null): PostInfo {
      const info: PostInfo = { text: '', author: '', authorUrl: '', sourceUrl: '' };
      if (!el) return info;
      const norm = (href: string): string => {
        try {
          return new URL(href, location.origin).href;
        } catch {
          return '';
        }
      };
      const note = el.closest<HTMLElement>('#noteContainer') ??
        el.closest<HTMLElement>('.note-container');
      if (note) {
        info.text = note.querySelector<HTMLElement>('#detail-title')?.textContent?.trim() ??
          '';
        if (!info.text) {
          info.text = note.querySelector<HTMLElement>('#detail-desc .note-text')?.textContent
            ?.trim() ?? '';
        }
        info.author =
          note.querySelector('.author-wrapper a.name')?.textContent?.trim() ?? '';
        // Author profile link (username anchor); the page itself is the post link.
        const nameAnchor = note.querySelector<HTMLAnchorElement>(
          '.author-wrapper a.name[href*="/user/profile/"]',
        );
        if (nameAnchor) info.authorUrl = norm(nameAnchor.href);
        if (note.classList.contains('note-container')) info.sourceUrl = location.href;
        return info;
      }
      const item = el.closest<HTMLElement>('section.note-item');
      if (item) {
        info.text = item.querySelector<HTMLElement>('.footer a.title')?.textContent?.trim()
          ?? '';
        const nameEl = item.querySelector<HTMLElement>(
          '.footer .author-wrapper a.author .name',
        );
        info.author = nameEl?.textContent?.trim() ?? '';
        const authorAnchor = item.querySelector<HTMLAnchorElement>(
          '.footer .author-wrapper a.author[href*="/user/profile/"]',
        );
        info.authorUrl = authorAnchor ? norm(authorAnchor.href) : '';
        // Post link with the access token: the cover/title anchor.
        const postAnchor = item.querySelector<HTMLAnchorElement>(
          'a[href*="/user/profile/"][href*="/explore/"]',
        ) ?? item.querySelector<HTMLAnchorElement>('a.cover');
        if (postAnchor) info.sourceUrl = norm(postAnchor.href);
        return info;
      }
      return info;
    }

    /**
     * The post card the image belongs to (weibo feeds). The card bounds:
     * the enclosing `article` (e.g. `article.woo-panel-main`), falling back
     * to the nearest ancestor containing a body node (`[class*="wbtext"]`).
     * From the card: body text from `[class*="wbtext"]`, author name from
     * the header anchor's `aria-label`, and the snippet source link from
     * the post permalink (the time anchor `weibo.com/<uid>/<postid>`),
     * falling back to the author anchor's href.
     */
    function extractPostInfo(el: Element | null): PostInfo {
      if (isXhsHost()) return extractXhsPost(el);
      if (isDouyinHost()) return extractDouyinPost(el);
      const info: PostInfo = { text: '', author: '', authorUrl: '', sourceUrl: '' };
      if (!el) return info;
      const norm = (href: string): string => {
        try {
          return new URL(href, location.origin).href;
        } catch {
          return '';
        }
      };
      const textNode = (root: Element | null): HTMLElement | null =>
        root?.matches('[class*="wbtext"]')
          ? (root as HTMLElement)
          : root?.querySelector<HTMLElement>('[class*="wbtext"]') ?? null;
      const permalinkRe = /^https?:\/\/[^/]+\/\d+\/[A-Za-z0-9_-]+\/?$/;

      let card = el.closest<HTMLElement>('article');
      if (!card) {
        let node: Element | null = el;
        let hops = 0;
        while (node && hops < 8) {
          if (textNode(node)) break;
          node = node.parentElement;
          hops++;
        }
        card = node as HTMLElement | null;
      }
      if (!card) return info;

      info.text = (textNode(card)?.textContent?.trim() ?? '').replace(/\s+/g, ' ').trim();

      // Author: the header's labelled anchor (avatar link carries aria-label).
      const headerAnchor = card.querySelector<HTMLAnchorElement>('a[aria-label]');
      if (headerAnchor && headerAnchor.getAttribute('aria-label')) {
        info.author = headerAnchor.getAttribute('aria-label') ?? '';
      }

      // Source link: the post permalink (the time anchor), else the author
      // profile anchor as a fallback.
      const anchors = [...card.querySelectorAll<HTMLAnchorElement>('a[href]')];
      const postLink =
        anchors.find((a) => {
          try {
            return permalinkRe.test(new URL(a.href, location.origin).href);
          } catch {
            return false;
          }
        }) ?? null;
      if (postLink) {
        info.authorUrl = norm(postLink.href);
      } else if (headerAnchor) {
        info.authorUrl = norm(headerAnchor.href);
      }
      return info;
    }

    /** Title for the image currently under the right-click, "" → page title. */
    function titleForImage(src: string): string {
      if (imgTarget === src && imgTitle) return imgTitle;
      // Right-click-menu path: locate the <img> by URL, then extract nearby.
      for (const img of document.images) {
        if (img.src === src) {
          const info = extractPostInfo(img);
          return composeTitle(info.text, info.author);
        }
      }
      return '';
    }

    function hideImgBtn(): void {
      imgBtn.style.display = 'none';
      if (imgHideTimer) {
        window.clearTimeout(imgHideTimer);
        imgHideTimer = 0;
      }
    }

    /** Show the image-clip button directly LEFT of the cursor (a native
     * context menu opens down-right, so the left side stays clear), and
     * schedule the 3-second auto-hide shared by all floating buttons. */
    function showImgBtnAt(x: number, y: number): void {
      if (!enabled) return;
      imgBtn.style.display = 'block';
      placeLeftOf(imgBtn, x, y);
      if (imgHideTimer) window.clearTimeout(imgHideTimer);
      imgHideTimer = window.setTimeout(() => hideImgBtn(), 3000);
    }

    /** Walk the stack of elements at the point: <img> first, then CSS backgrounds. */
    function findImageUrlAt(x: number, y: number): string {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el instanceof HTMLImageElement && el.src) return el.src;
        if (el instanceof Element) {
          const bg = getComputedStyle(el).backgroundImage;
          const m = bg && bg !== 'none' ? /url\(["']?([^"')]+)["']?\)/.exec(bg) : null;
          if (m?.[1]) {
            try {
              return new URL(m[1], location.href).href;
            } catch {
              return '';
            }
          }
        }
      }
      return '';
    }

    // Show the floating clip-image button for EVERY image right-click (the
    // native context menu stays untouched, the button sits left of the
    // cursor), except video URLs (.mp4/.mov live-photo frames) that <img>
    // could never save anyway.
    const videoUrlRe = /\.mp4(?=$|[?#])|\.mov(?=$|[?#])|mime_type=video/i;
    document.addEventListener(
      'contextmenu',
      (e) => {
        if (!enabled || imgPressing) return;
        const url = findImageUrlAt(e.clientX, e.clientY);
        if (!url || !/^(https?|blob|data):/i.test(url) || videoUrlRe.test(url)) return;
        imgTarget = url;
        const info = extractPostInfo(e.target as Element | null);
        imgTitle = composeTitle(info.text, info.author);
        // The snippet's source link prefers the post-specific permalink.
        imgSourceUrl = info.sourceUrl || info.authorUrl;
        showImgBtnAt(e.clientX, e.clientY);
      },
      true,
    );

    document.addEventListener('mousedown', (e) => {
      if (!imgBtn.contains(e.target as Node)) {
        hideImgBtn();
        imgTarget = '';
        imgTitle = '';
        imgSourceUrl = '';
      }
    });
    window.addEventListener('scroll', hideImgBtn, true);
    window.addEventListener('resize', hideImgBtn);

    // Isolate the button from page handlers, mirroring the text clip button.
    imgBtn.addEventListener('pointerdown', (e) => {
      imgPressing = true;
      e.stopPropagation();
    });
    imgBtn.addEventListener('pointerup', (e) => e.stopPropagation());
    imgBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    imgBtn.addEventListener('mouseup', (e) => e.stopPropagation());
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!imgBtn.contains(e.target as Node)) imgPressing = false;
      },
      true,
    );

    /** Fetch an image from the page context (cookies, page referrer, blob: OK). */
    async function fetchAsDataUrl(src: string): Promise<string> {
      if (/^data:/i.test(src)) return src;
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    function flashImg(label: string, failed: boolean, ms: number): void {
      imgBtn.textContent = label;
      setTimeout(() => {
        imgBtn.textContent = t('floatingClipImage');
        if (!failed) hideImgBtn();
      }, ms);
    }

    imgBtn.addEventListener('click', async () => {
      imgPressing = false;
      const src = imgTarget;
      imgTarget = '';
      if (!src) return;
      const rid = resourceId(src);
      let album = rid ? findAlbum(albumCache, rid) : null;
      if (!album) {
        // Hash matching missed (e.g. xhscdn url decoration differs from the
        // album's stored urls): fall back to the post id in the page URL.
        const pageId = pageIdFromUrl();
        const images = pageId ? albumCache.get(pageId) : undefined;
        album = images && images.length ? { awemeId: pageId!, images } : null;
        console.debug('[NoteClip] album hit by', album ? 'page-id' : 'none', {
          rid,
          pageId,
          cacheSize: albumCache.size,
        });
      } else {
        console.debug('[NoteClip] album hit by hash', { rid });
      }
      if (album && album.images.length > 1) {
        // Album image: open the picker instead of saving this one picture.
        hideImgBtn();
        openAlbumPicker(album);
        return;
      }
      // Xiaohongshu: the XHR/SSR album capture is unreliable for their API,
      // but note-detail pages keep every slide in the DOM — collect the
      // media-container images instead. Swiper renders each slide twice, so
      // dedupe by resource id; data: placeholders and <video> posters skip.
      if (isXhsHost()) {
        const mediaBox =
          document.querySelector('#noteContainer .media-container') ??
          document.querySelector('.note-container .media-container');
        const seen = new Set<string>();
        const urls: string[] = [];
        if (mediaBox) {
          for (const img of mediaBox.querySelectorAll('img')) {
            const src2 =
              img.getAttribute('src')?.startsWith('http') ? img.getAttribute('src')! : '';
            if (!src2) continue;
            const rid2 = resourceId(src2);
            if (!rid2 || seen.has(rid2)) continue;
            seen.add(rid2);
            urls.push(src2);
          }
        }
        console.debug('[NoteClip] xhs dom album', { count: urls.length });
        if (urls.length > 1) {
          hideImgBtn();
          openAlbumPicker({ awemeId: pageIdFromUrl(), images: urls.map((u) => [u]) });
          return;
        }
      }
      // Douyin: the XHR/SSR album capture often misses, but image-note cards
      // keep every slide in the DOM (`.focusPanel` swiper). Each picture is
      // rendered twice (sharp + blurred backdrop) — dedupe by resource id.
      if (isDouyinHost()) {
        const card = document.querySelector('[data-e2e="feed-active-video"]') ??
          document.querySelector('[data-e2e="feed-item"]');
        const panel = card?.querySelector('.focusPanel .RFe2KjM2') ??
          card?.querySelector('.focusPanel');
        const seen = new Set<string>();
        const urls: string[] = [];
        if (panel) {
          for (const img of panel.querySelectorAll('img')) {
            const src2 =
              img.getAttribute('src')?.startsWith('http') ? img.getAttribute('src')! : '';
            if (!src2) continue;
            const rid2 = resourceId(src2);
            if (!rid2 || seen.has(rid2)) continue;
            seen.add(rid2);
            urls.push(src2);
          }
        }
        console.debug('[NoteClip] douyin dom album', { count: urls.length });
        if (urls.length > 1) {
          hideImgBtn();
          const vid =
            document
              .querySelector<HTMLElement>('[data-e2e="feed-active-video"]')
              ?.getAttribute('data-e2e-vid') ?? pageIdFromUrl();
          openAlbumPicker({
            awemeId: vid,
            images: urls.map((u) => [u]),
          });
          return;
        }
      }
      // Douyin covers (~noop thumbnails) mean the album data was not captured;
      // save the clicked cover and tell the user. saveOriginals manages its
      // own button feedback.
      const douyinCover = /douyinpic|byteimg/i.test(src) && rid !== '';
      void saveOriginals([src], douyinCover);
    });

    /**
     * Save `srcs` as ONE snippet through the background retry matrix, using
     * page-context fallbacks. Shows progress on the floating image button.
     * Returns true when the save message went through. `title` lets the
     * album picker pass a snapshot captured before its own mousedown clears
     * the shared right-click cache.
     */
    async function saveOriginals(
      srcs: string[],
      coverFallback = false,
      title?: string,
      sourceUrl?: string,
    ): Promise<boolean> {
      const dataUrls: string[] = [];
      for (let i = 0; i < srcs.length; i++) {
        flashImg(t('savingProgress').replace('{p}', String(i)).replace('{t}', String(srcs.length)), false, 86400000);
        try {
          const resp = (await browser.runtime.sendMessage({ type: 'fetchImage', src: srcs[i] })) as
            | { ok: boolean; dataUrl?: string }
            | undefined;
          if (resp?.ok && resp.dataUrl) dataUrls.push(resp.dataUrl);
        } catch {
          /* errors are logged in the background; skip this picture */
        }
      }
      if (!dataUrls.length) {
        flashImg(t('floatingSaveFailed'), true, 1500);
        return false;
      }
      try {
        const resp = (await browser.runtime.sendMessage({
          type: 'saveImage',
          dataUrls,
          pageUrl: location.href,
          // Nearby post text captured at right-click time; background still
          // falls back to the tab title when it is empty. The author/post
          // anchor becomes the snippet's source link when present.
          pageTitle: title || imgTitle || document.title,
          sourceUrl: sourceUrl || imgSourceUrl || undefined,
        })) as BgResponse | undefined;
        if (resp?.ok !== false) {
          flashImg(coverFallback ? t('albumCoverFallback') : t('floatingSaved'), false, 2000);
          return true;
        }
      } catch {
        /* fall through */
      }
      flashImg(t('floatingSaveFailed'), true, 1500);
      return false;
    }

    /**
     * In-page picker: screen-centered panel with enlarged 2-column
     * thumbnails, each with a corner checkbox; master tri-state checkbox at
     * the title row's right. Default all UNselected; save all or the chosen
     * subset as one multi-image snippet. Backdrop click / Escape closes it.
     */
    function openAlbumPicker(album: AwemeAlbum): void {
      if (document.getElementById('nc-album-picker')) return;
      const variants = album.images.filter((list) => Array.isArray(list) && list.some(Boolean));
      if (variants.length < 2) return;
      const originals = variants.map((list) => list[0]!);
      // Snapshot before any picker interaction: the global mousedown handler
      // clears the shared right-click cache, which would lose the body text.
      const openTitle = imgTitle || document.title;
      const openSourceUrl = imgSourceUrl;

      const overlay = document.createElement('div');
      overlay.id = 'nc-album-picker';
      overlay.style.cssText =
        'position:fixed;z-index:2147483647;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,18,30,.5);font:600 13px/1.4 system-ui,sans-serif;';

      const panel = document.createElement('div');
      panel.style.cssText =
        'background:#fff;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.35);padding:14px 16px;max-height:82vh;display:flex;flex-direction:column;gap:10px;text-align:left;';

      // Title row: label on the left, tri-state master checkbox on the right.
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
      const title = document.createElement('div');
      title.textContent = t('albumPick');
      title.style.cssText = 'color:#1f2330;font-weight:600;';
      const master = document.createElement('input');
      master.type = 'checkbox';
      master.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:#4f46e5;flex:none;';

      const grid = document.createElement('div');
      grid.style.cssText =
        'display:grid;grid-template-columns:repeat(2,150px);gap:8px;overflow-y:auto;padding-right:2px;align-content:flex-start;';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';

      const btnStyle =
        'flex:1;border:0;border-radius:8px;padding:8px 10px;cursor:pointer;font:600 13px/1.4 system-ui,sans-serif;color:#fff;';
      const saveSel = document.createElement('button');
      saveSel.setAttribute('type', 'button');
      saveSel.style.cssText = btnStyle + `background:${accentColor};`;
      const saveAll = document.createElement('button');
      saveAll.setAttribute('type', 'button');
      saveAll.style.cssText = btnStyle + `background:${accentColor};opacity:.75;`;
      saveAll.textContent = t('saveAll');

      const selected = originals.map(() => false); // default: none selected
      const childBoxes: HTMLInputElement[] = [];
      const cellUpdaters: (() => void)[] = [];
      const repaint = () => {
        for (const update of cellUpdaters) update();
        const n = selected.filter(Boolean).length;
        // Tri-state master checkbox: all / none / partial (indeterminate).
        master.checked = n === selected.length;
        master.indeterminate = n > 0 && n < selected.length;
        for (let i = 0; i < childBoxes.length; i++) childBoxes[i]!.checked = !!selected[i];
        saveSel.textContent = t('saveSelected').replace('{n}', String(n));
        saveSel.disabled = n === 0;
        saveAll.disabled = n === selected.length;
      };

      for (let k = 0; k < originals.length; k++) {
        const cell = document.createElement('div');
        cell.style.cssText = 'position:relative;cursor:pointer;';
        const thumb = document.createElement('img');
        // sinaimg 等 CDN 有 Referer 防盗链，缩略图必须带页面 Referer（不做
        // no-referrer），加载失败时回退到该图的下一个 CDN 镜像。
        thumb.src = originals[k]!;
        thumb.style.cssText =
          'width:100%;height:190px;object-fit:cover;border-radius:8px;display:block;border:3px solid transparent;';
        thumb.addEventListener('error', () => {
          const mirrors = variants[k]!;
          const idx = mirrors.indexOf(thumb.src);
          const next = idx >= 0 ? mirrors[idx + 1] : undefined;
          if (next) thumb.src = next;
        });

        // Corner checkbox at the thumbnail's top-left.
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.style.cssText =
          'position:absolute;top:6px;left:6px;width:16px;height:16px;cursor:pointer;accent-color:#4f46e5;';
        cellUpdaters.push(() => {
          const on = !!selected[k];
          box.checked = on;
          thumb.style.opacity = on ? '1' : '.45';
          thumb.style.borderColor = on ? accentColor : 'transparent';
        });
        cell.addEventListener('click', () => {
          selected[k] = !selected[k]!;
          repaint();
        });
        cell.append(thumb, box);
        childBoxes.push(box);
        grid.appendChild(cell);
      }
      // Master checkbox: unchecked → select all; checked/indeterminate → select none.
      master.addEventListener('change', () => {
        const all = master.checked;
        for (let k = 0; k < selected.length; k++) selected[k] = all;
        repaint();
      });
      repaint();

      actions.append(saveSel, saveAll);
      head.append(title, master);
      panel.append(head, grid, actions);
      overlay.append(panel);
      document.documentElement.appendChild(overlay);

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
      };
      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) close();
      });

      saveAll.addEventListener('click', () => {
        close();
        void saveOriginals(originals, false, openTitle, openSourceUrl);
      });
      saveSel.addEventListener('click', () => {
        const chosen = originals.filter((_, k) => selected[k]);
        close();
        void saveOriginals(chosen, false, openTitle, openSourceUrl);
      });
    }


    // Background asks this frame to fetch an image from the page context.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const type = (message as { type?: unknown }).type;
      if (type === 'clipPageTitle') {
        const src = (message as { src?: unknown }).src;
        const title = typeof src === 'string' ? titleForImage(src) : '';
        let url = '';
        if (typeof src === 'string') {
          for (const img of document.images) {
            if (img.src === src) {
              const info = extractPostInfo(img);
              url = info.sourceUrl || info.authorUrl;
              break;
            }
          }
        }
        return Promise.resolve<ClipPageTitleResponse>({ ok: true, title, url: url || undefined });
      }
      if (type !== 'clipFetchImage') {
        return;
      }
      const src = (message as { src?: unknown }).src;
      if (typeof src !== 'string') {
        return Promise.resolve<ClipFetchResponse>({ ok: false, error: 'bad request' });
      }
      return fetchAsDataUrl(src)
        .then(
          (dataUrl): ClipFetchResponse => ({ ok: true, dataUrl }),
        )
        .catch(
          (e): ClipFetchResponse => ({ ok: false, error: String(e) }),
        );
    });

    // Settings: accent color + on/off toggle, applied live (both buttons).
    function applySettings(
      s: { accent?: string; floatingButton?: boolean } | undefined,
    ): void {
      if (s?.accent) {
        btn.style.background = s.accent;
        imgBtn.style.background = s.accent;
        accentColor = s.accent;
      }
      enabled = s?.floatingButton !== false;
      if (!enabled) {
        hide();
        hideImgBtn();
      }
    }
    void browser.storage.local.get('noteclip:settings').then((res) => {
      applySettings(res['noteclip:settings'] as { accent?: string; floatingButton?: boolean } | undefined);
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes['noteclip:settings'];
      if (!change) return;
      applySettings(change.newValue as { accent?: string; floatingButton?: boolean } | undefined);
    });

    document.documentElement.appendChild(btn);
    document.documentElement.appendChild(imgBtn);
  },
});
