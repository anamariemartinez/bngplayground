import { describe, it, expect } from 'vitest';
import { createZip, ZipEntry } from '../src/utils/miniZip';

describe('miniZip', () => {
  it('creates ZIP with correct magic bytes', () => {
    const entries: ZipEntry[] = [
      { name: 'test.txt', data: new TextEncoder().encode('hello') },
    ];
    const zip = createZip(entries);
    // PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  it('ZIP contains EOCD signature', () => {
    const entries: ZipEntry[] = [
      { name: 'a.txt', data: new TextEncoder().encode('data') },
    ];
    const zip = createZip(entries);
    // Search for EOCD signature (PK\x05\x06)
    let found = false;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('multiple files are all present', () => {
    const encoder = new TextEncoder();
    const entries: ZipEntry[] = [
      { name: 'file1.txt', data: encoder.encode('content1') },
      { name: 'file2.txt', data: encoder.encode('content2') },
      { name: 'dir/file3.txt', data: encoder.encode('content3') },
    ];
    const zip = createZip(entries);

    // Check that all filenames appear in the central directory
    const decoder = new TextDecoder();
    const zipStr = decoder.decode(zip);
    expect(zipStr).toContain('file1.txt');
    expect(zipStr).toContain('file2.txt');
    expect(zipStr).toContain('dir/file3.txt');
  });

  it('file data is recoverable (STORE method)', () => {
    const content = 'Hello, world! This is a test of miniZip.';
    const entries: ZipEntry[] = [
      { name: 'test.txt', data: new TextEncoder().encode(content) },
    ];
    const zip = createZip(entries);

    // Find the data in the ZIP (after local header: 30 + filename length)
    const nameLen = 'test.txt'.length;
    const dataOffset = 30 + nameLen;
    const decoder = new TextDecoder();
    const recovered = decoder.decode(zip.slice(dataOffset, dataOffset + content.length));
    expect(recovered).toBe(content);
  });

  it('handles Unicode filenames', () => {
    const entries: ZipEntry[] = [
      { name: 'données.txt', data: new TextEncoder().encode('utf8') },
    ];
    const zip = createZip(entries);
    expect(zip.length).toBeGreaterThan(0);
    // Should not throw
  });

  it('handles empty file', () => {
    const entries: ZipEntry[] = [
      { name: 'empty.txt', data: new Uint8Array(0) },
    ];
    const zip = createZip(entries);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });

  it('correct EOCD entry count', () => {
    const entries: ZipEntry[] = [
      { name: 'a.txt', data: new TextEncoder().encode('a') },
      { name: 'b.txt', data: new TextEncoder().encode('b') },
      { name: 'c.txt', data: new TextEncoder().encode('c') },
    ];
    const zip = createZip(entries);

    // Find EOCD and check entry count
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
        const view = new DataView(zip.buffer, zip.byteOffset + i);
        const count = view.getUint16(8, true);
        expect(count).toBe(3);
        break;
      }
    }
  });
});
