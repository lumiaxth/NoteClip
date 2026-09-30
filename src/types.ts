export type SnippetKind = 'text' | 'image';

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

export interface Snippet {
  id: string;
  kind: SnippetKind;
  /** excerpt text for `text` kind */
  text?: string;
  /** single image (legacy field; new multi-image clips use `images`) */
  image?: Blob;
  /** one blob per picture for multi-image clips (Douyin/XHS/Weibo albums) */
  images?: Blob[];
  /** Bumped on every image-list mutation so page-side object-URL caches
   * (keyed by id + index) can drop stale thumbnails after deletions. */
  imgRev?: number;
  /** source URL or file path */
  url: string;
  /** page/file title */
  title: string;
  comment?: string;
  /** tag ids */
  tags: string[];
  starred: boolean;
  timestamp: number;
}

export interface PendingCapture {
  id: string;
  dataUrl: string;
  tabUrl: string;
  tabTitle: string;
  timestamp: number;
}

export interface ErrorLog {
  id: string;
  timestamp: number;
  /** Which feature produced the error, e.g. 'save-image', 'capture' */
  source: string;
  message: string;
  url?: string;
}

export interface ExportSnippet {
  id: string;
  kind: SnippetKind;
  text?: string;
  /** Relative path of the (single) image inside the backup zip — legacy field. */
  imageFile?: string;
  /** Image byte size, used for duplicate detection without reading the file. */
  imageBytes?: number;
  /** Relative paths of the images inside the backup zip, one per picture. */
  imageFiles?: string[];
  url: string;
  title: string;
  comment?: string;
  tags: string[];
  starred: boolean;
  timestamp: number;
}

export interface ExportFile {
  app: 'NoteClip';
  version: 2;
  exportedAt: number;
  snippets: ExportSnippet[];
  tags: Tag[];
}

export type BgMessage =
  | { type: 'saveText'; text: string; url: string; title: string }
  | {
      type: 'saveImage';
      src?: string;
      dataUrl?: string;
      /** Base64 data URLs for a multi-image clip; saved as ONE snippet. */
      dataUrls?: string[];
      pageUrl: string;
      pageTitle: string;
      /** Post-specific source link (weibo author/post anchor); beats pageUrl. */
      sourceUrl?: string;
    }
  | { type: 'clipFetchImage'; src: string }
  | { type: 'clipPageTitle'; src: string }
  | { type: 'fetchImage'; src: string }
  | { type: 'startCapture' };

export type BgResponse = { ok: true; id?: string; dataUrl?: string } | { ok: false; error?: string };

/** Response for the content-script page-context image fetch. */
export type ClipFetchResponse = { ok: true; dataUrl: string } | { ok: false; error?: string };

/** Nearby post text for an image's snipped title (weibo body etc.). */
export type ClipPageTitleResponse = { ok: true; title?: string; url?: string };
