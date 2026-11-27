// Small real pictures for the tests (png, gif, jpeg, webp headers), built here: nothing is stored.
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), out.length - 4);
  return out;
};
/** A grey png w × h (a valid file a browser decodes). */
export const png = (w = 8, h = 6) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits, grey
  const raw = Buffer.alloc((w + 1) * h, 0x99);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
/** A png header only: the size a file claims (the rest is cut off). */
export const pngHeader = (w, h) => {
  const b = Buffer.from(png(1, 1).subarray(0, 33));
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
/** A gif of two frames, w × h (a real one: a browser plays it). */
export const gif = (w = 4, h = 3) => {
  const head = Buffer.alloc(13);
  head.write('GIF89a');
  head.writeUInt16LE(w, 6);
  head.writeUInt16LE(h, 8);
  head[10] = 0x80; // a 2-colour table follows
  const table = Buffer.from([0, 0, 0, 255, 255, 255]);
  const frame = () => Buffer.concat([Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0]), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0, 2, 2, 0x44, 1, 0])]);
  return Buffer.concat([head, table, frame(), frame(), Buffer.from([0x3b])]);
};
/** A jpeg whose first marker is a SOF0 saying w × h (enough for a sniff; not a picture a browser can draw). */
export const jpegHeader = (w, h) => {
  const b = Buffer.alloc(40);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]).copy(b);
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
};
/** A webp header: kind 'VP8 ', 'VP8L' or 'VP8X', saying w × h. */
export const webpHeader = (kind, w, h) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0);
  b.write('WEBP', 8);
  b.write(kind, 12, 'latin1');
  if (kind === 'VP8 ') {
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  } else if (kind === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21);
  } else {
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
  }
  return b;
};
