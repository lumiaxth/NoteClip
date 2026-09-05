import 'fake-indexeddb/auto';
import zhMessagesJson from '../public/_locales/zh_CN/messages.json';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { vi } from 'vitest';

vi.stubGlobal('browser', fakeBrowser);

// Real zh_CN messages so export-document i18n is assertable in tests.
const zhMessages = zhMessagesJson as Record<string, { message: string }>;
Object.assign(fakeBrowser.i18n, {
  getMessage: (key: string, substitutions?: string | string[]): string => {
    let msg = zhMessages[key]?.message ?? '';
    const subs = substitutions == null ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
    subs.forEach((s) => {
      msg = msg.replace(/\{[a-z0-9]+\}/i, String(s));
    });
    return msg || key;
  },
});

// Node 24 lacks global FileReader; provide a minimal implementation for io.ts tests.
class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  error: unknown = null;
  onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
        this.onload?.({} as ProgressEvent<FileReader>);
      })
      .catch((e) => {
        this.error = e;
        this.onerror?.({} as ProgressEvent<FileReader>);
      });
  }

  readAsText(blob: Blob): void {
    blob
      .text()
      .then((text) => {
        this.result = text;
        this.onload?.({} as ProgressEvent<FileReader>);
      })
      .catch((e) => {
        this.error = e;
        this.onerror?.({} as ProgressEvent<FileReader>);
      });
  }
}

vi.stubGlobal('FileReader', NodeFileReader);

