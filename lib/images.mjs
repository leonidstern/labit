// Pictures the lab takes in (a board's frame, a comment's attachment): what their first bytes say they are, and the
// limits. No dependency, and never the name or a header alone: the type and the extension both come from the bytes.
// SVG, HTML, HEIC and AVIF are none of these (the browser draws any picture again as png, jpeg or webp before it is sent;
// a gif goes as it is, so an animation stays one).
export const MAX_IMAGE = 25 * 1024 * 1024; // an upload's most (a GIF that moves goes as it is; the rest is drawn smaller first)
/** A picture's file name in a folder of the lab: a short id, then its extension. */
export const IMAGE_FILE = /^[a-z0-9-]{1,24}\.(png|jpg|webp|gif)$/;

/**
 * @param {Buffer} buf
 * @param {Buffer} [end] the file's last bytes, when buf is only its start (a png must have its IEND chunk: one cut short is
 *   refused; bytes after it, as some tools leave, are not)
 * @returns {{ ext: string, type: string, w: number, h: number } | null} null for anything else, for a cut-off file, a side of 0,
 *   a side over 16384 px or more than 50 megapixels.
 */
export function imageInfo(buf, end = buf) {
  const at = (/** @type {string} */ s, /** @type {number} */ i) => buf.toString('latin1', i, i + s.length) === s;
  let ext = '';
  let w = 0;
  let h = 0;
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && at('IHDR', 12)) {
      if (!(end === buf ? buf.subarray(33) : end).includes('IEND', 0, 'latin1')) return null;
      [ext, w, h] = ['png', buf.readUInt32BE(16), buf.readUInt32BE(20)];
    }
    else if (buf.length > 10 && (at('GIF87a', 0) || at('GIF89a', 0))) [ext, w, h] = ['gif', buf.readUInt16LE(6), buf.readUInt16LE(8)];
    else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      ext = 'jpg';
      for (let i = 2; i + 9 < buf.length; ) {
        const m = buf[i + 1];
        if (buf[i] !== 0xff || m === 0xff || m === 0) i++;
        else if (m >= 0xd0 && m <= 0xd9) i += 2;
        else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          [h, w] = [buf.readUInt16BE(i + 5), buf.readUInt16BE(i + 7)];
          break; // the frame's size, read once: a zero there is checked below, not read again forever
        } else i += 2 + buf.readUInt16BE(i + 2);
      }
    } else if (buf.length > 30 && at('RIFF', 0) && at('WEBP', 8)) {
      ext = 'webp';
      if (at('VP8 ', 12)) [w, h] = [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
      else if (at('VP8L', 12)) [w, h] = [1 + (buf.readUInt32LE(21) & 0x3fff), 1 + ((buf.readUInt32LE(21) >> 14) & 0x3fff)];
      else if (at('VP8X', 12)) [w, h] = [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
      else ext = '';
    }
  } catch {
    return null;
  }
  return ext && w > 0 && h > 0 && w <= 16384 && h <= 16384 && w * h <= 50e6 ? { ext, type: `image/${ext === 'jpg' ? 'jpeg' : ext}`, w, h } : null;
}
