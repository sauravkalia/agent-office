// A small PNG encoder that actually compresses: per-row Sub/Up filters, then deflate with fixed
// Huffman codes and run matches. Pixel art scaled by whole numbers is mostly repeats, so a sharp
// 504×459 frame (about 900 KB of pixels) comes out in a few kilobytes. Pure; no `$`.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC[(c ^ b) & 255] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const adler32 = (bytes: Uint8Array) => {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i += 1) {
    a += bytes[i] ?? 0
    if (a >= 65521) a -= 65521
    b += a
    if (b >= 65521) b -= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Bits written least significant first, as deflate packs them. */
class Bits {
  buf: Uint8Array
  pos = 0
  bit = 0
  cur = 0
  constructor(size: number) {
    this.buf = new Uint8Array(size)
  }
  put(value: number, n: number) {
    for (let i = 0; i < n; i += 1) {
      this.cur |= ((value >>> i) & 1) << this.bit
      this.bit += 1
      if (this.bit === 8) this.flush()
    }
  }
  /** A Huffman code: written most significant bit first. */
  code(value: number, n: number) {
    for (let i = n - 1; i >= 0; i -= 1) {
      this.cur |= ((value >>> i) & 1) << this.bit
      this.bit += 1
      if (this.bit === 8) this.flush()
    }
  }
  flush() {
    if (this.pos >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2)
      next.set(this.buf)
      this.buf = next
    }
    this.buf[this.pos] = this.cur
    this.pos += 1
    this.cur = 0
    this.bit = 0
  }
  end() {
    if (this.bit > 0) this.flush()
    return this.buf.subarray(0, this.pos)
  }
}

const literal = (w: Bits, v: number) => {
  if (v < 144) w.code(0x30 + v, 8)
  else w.code(0x190 + (v - 144), 9)
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

const match = (w: Bits, len: number, dist: number) => {
  let i = LEN_BASE.length - 1
  while ((LEN_BASE[i] ?? 0) > len) i -= 1
  const sym = 257 + i
  if (sym < 280) w.code(sym - 256, 7)
  else w.code(0xc0 + (sym - 280), 8)
  w.put(len - (LEN_BASE[i] ?? 0), LEN_EXTRA[i] ?? 0)
  let d = DIST_BASE.length - 1
  while ((DIST_BASE[d] ?? 0) > dist) d -= 1
  w.code(d, 5)
  w.put(dist - (DIST_BASE[d] ?? 0), DIST_EXTRA[d] ?? 0)
}

/**
 * Deflate (one fixed-Huffman block): runs of one byte (distance 1) and repeats of the previous
 * filtered row (distance = row length) become matches; everything else is a literal.
 */
export const deflate = (data: Uint8Array, rowLen: number) => {
  const w = new Bits(Math.max(1024, data.length >> 3))
  w.put(1, 1)
  w.put(1, 2)
  let i = 0
  while (i < data.length) {
    let best = 0
    let bestDist = 0
    for (const dist of rowLen > 1 && rowLen <= 32768 ? [1, rowLen] : [1]) {
      if (i < dist) continue
      let n = 0
      while (n < 258 && i + n < data.length && data[i + n] === data[i + n - dist]) n += 1
      if (n > best) {
        best = n
        bestDist = dist
      }
    }
    if (best >= 3) {
      match(w, best, bestDist)
      i += best
    } else {
      literal(w, data[i] ?? 0)
      i += 1
    }
  }
  w.code(0, 7)
  return w.end()
}

const u32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)

const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const chunk = (type: string, body: Uint8Array) => {
  const t = Uint8Array.from(type, ch => ch.charCodeAt(0))
  return concat([u32(body.length), t, body, u32(crc32(concat([t, body])))])
}

/** RGB pixels (3 bytes each) as a compressed PNG. */
export const encodePngRgb = (width: number, height: number, rgb: Uint8Array): Uint8Array => {
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    const out = y * (stride + 1)
    const same = y > 0 && rgb.subarray(row, row + stride).every((v, x) => v === rgb[row - stride + x])
    if (same) {
      raw[out] = 2 // Up: the whole row is zeros
      continue
    }
    raw[out] = 1 // Sub: repeated pixels become zeros
    for (let x = 0; x < stride; x += 1) raw[out + 1 + x] = ((rgb[row + x] ?? 0) - (x >= 3 ? (rgb[row + x - 3] ?? 0) : 0)) & 255
  }
  const z = concat([Uint8Array.of(0x78, 0x01), deflate(raw, stride + 1), u32(adler32(raw))])
  const ihdr = concat([u32(width), u32(height), Uint8Array.of(8, 2, 0, 0, 0)])
  return concat([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))])
}
