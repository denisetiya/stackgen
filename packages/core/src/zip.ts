import JSZip from 'jszip';
import type { FileEntry } from './generator.js';

export async function bundleZip(files: FileEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.path, f.content);
  }
  return await zip.generateAsync({ type: 'nodebuffer' });
}

export function bundleFiles(files: FileEntry[]): string {
  // For preview: return concatenated with delimiters
  return files.map(f => `--- ${f.path} ---\n${f.content}\n`).join('\n');
}
