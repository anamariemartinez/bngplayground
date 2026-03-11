/**
 * miniZip.ts — Minimal ZIP creator (STORE method, no compression).
 *
 * Creates valid ZIP archives for text-only files (BNGL, SED-ML, RDF).
 * Zero external dependencies.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Create a ZIP archive from entries using STORE (no compression).
 */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataSize = entry.data.length;

    // CRC-32
    const crc = crc32(entry.data);

    // Local file header (30 + nameLen + data)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);

    lv.setUint32(0, 0x04034b50, true);  // Local file header signature
    lv.setUint16(4, 20, true);           // Version needed to extract
    lv.setUint16(6, 0, true);            // General purpose bit flag
    lv.setUint16(8, 0, true);            // Compression method: STORE
    lv.setUint16(10, 0, true);           // Last mod time
    lv.setUint16(12, 0, true);           // Last mod date
    lv.setUint32(14, crc, true);         // CRC-32
    lv.setUint32(18, dataSize, true);    // Compressed size
    lv.setUint32(22, dataSize, true);    // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // Filename length
    lv.setUint16(28, 0, true);           // Extra field length

    localHeader.set(nameBytes, 30);
    localHeaders.push(localHeader);
    localHeaders.push(entry.data);

    // Central directory header (46 + nameLen)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);

    cv.setUint32(0, 0x02014b50, true);  // Central directory header signature
    cv.setUint16(4, 20, true);           // Version made by
    cv.setUint16(6, 20, true);           // Version needed to extract
    cv.setUint16(8, 0, true);            // General purpose bit flag
    cv.setUint16(10, 0, true);           // Compression method: STORE
    cv.setUint16(12, 0, true);           // Last mod time
    cv.setUint16(14, 0, true);           // Last mod date
    cv.setUint32(16, crc, true);         // CRC-32
    cv.setUint32(20, dataSize, true);    // Compressed size
    cv.setUint32(24, dataSize, true);    // Uncompressed size
    cv.setUint16(28, nameBytes.length, true); // Filename length
    cv.setUint16(30, 0, true);           // Extra field length
    cv.setUint16(32, 0, true);           // File comment length
    cv.setUint16(34, 0, true);           // Disk number start
    cv.setUint16(36, 0, true);           // Internal file attributes
    cv.setUint32(38, 0, true);           // External file attributes
    cv.setUint32(42, offset, true);      // Relative offset of local header

    centralHeader.set(nameBytes, 46);
    centralHeaders.push(centralHeader);

    offset += 30 + nameBytes.length + dataSize;
  }

  // End of central directory record
  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((s, h) => s + h.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);

  ev.setUint32(0, 0x06054b50, true);       // EOCD signature
  ev.setUint16(4, 0, true);                 // Disk number
  ev.setUint16(6, 0, true);                 // Disk where central directory starts
  ev.setUint16(8, entries.length, true);     // Number of central directory records on this disk
  ev.setUint16(10, entries.length, true);    // Total number of central directory records
  ev.setUint32(12, centralDirSize, true);    // Size of central directory
  ev.setUint32(16, centralDirOffset, true);  // Offset of start of central directory
  ev.setUint16(20, 0, true);                 // Comment length

  // Combine all parts
  const totalSize = offset + centralDirSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;

  for (const header of localHeaders) {
    result.set(header, pos);
    pos += header.length;
  }
  for (const header of centralHeaders) {
    result.set(header, pos);
    pos += header.length;
  }
  result.set(eocd, pos);

  return result;
}

// ── CRC-32 ───────────────────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
