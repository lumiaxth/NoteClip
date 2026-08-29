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
  /** image blob for `image` kind */
  image?: Blob;
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

export interface ExportSnippet {
  id: string;
  kind: SnippetKind;
  text?: string;
  imageDataUrl?: string;
  url: string;
  title: string;
  comment?: string;
  tags: string[];
  starred: boolean;
  timestamp: number;
}

export interface ExportFile {
  app: 'NoteClip';
  version: 1;
  exportedAt: number;
  snippets: ExportSnippet[];
  tags: Tag[];
}

export type BgMessage =
  | { type: 'saveText'; text: string; url: string; title: string }
  | { type: 'saveImage'; src: string; pageUrl: string; pageTitle: string }
  | { type: 'startCapture' };

export type BgResponse = { ok: true; id?: string } | { ok: false; error?: string };
