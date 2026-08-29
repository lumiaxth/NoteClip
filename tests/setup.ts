import 'fake-indexeddb/auto';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { vi } from 'vitest';

vi.stubGlobal('browser', fakeBrowser);

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

