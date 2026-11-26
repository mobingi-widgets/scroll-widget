// blake2b.js - BLAKE2b (RFC 7693), unkeyed, in plain JavaScript. The minisign signatures of the
// releases (algorithm ED) sign the BLAKE2b-512 hash of a file, and Electron's crypto is
// BoringSSL, which has no BLAKE2b ("Digest method not supported" - the 1.4.0 / 1.3.0 updaters
// could not check any release, 2026-11-27). updater.js uses node's own when it has one, this
// otherwise. The overlays share this file (same copy in each program).
//
// 64-bit words are kept as pairs of 32-bit halves in Uint32Arrays: [2i] = low, [2i + 1] = high
// (the layout of the RFC's reference code and of blakejs). Checked against node's blake2b512
// (OpenSSL) for lengths around every block edge and against the RFC's "abc" vector.
'use strict';

const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);

// message schedule; rounds 10 and 11 repeat rounds 0 and 1. Doubled: indexes into the halves.
const SIGMA = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
].map((x) => x * 2);

const v = new Uint32Array(32);   // working vector (16 words)
const m = new Uint32Array(32);   // message block (16 words)

// v[a] += v[b], 64-bit (a Uint32Array keeps the low 32 bits of what is stored)
function add(a, b) {
  const lo = v[a] + v[b];
  v[a + 1] = v[a + 1] + v[b + 1] + (lo > 0xffffffff ? 1 : 0);
  v[a] = lo;
}
// v[a] += m[i]
function addm(a, i) {
  const lo = v[a] + m[i];
  v[a + 1] = v[a + 1] + m[i + 1] + (lo > 0xffffffff ? 1 : 0);
  v[a] = lo;
}

// the mixing function G on words a, b, c, d (as half indexes) with message words x, y
function G(a, b, c, d, x, y) {
  add(a, b); addm(a, x);
  let lo = v[d] ^ v[a];
  let hi = v[d + 1] ^ v[a + 1];
  v[d] = hi; v[d + 1] = lo;                                         // d = (d ^ a) >>> 32
  add(c, d);
  lo = v[b] ^ v[c]; hi = v[b + 1] ^ v[c + 1];
  v[b] = (lo >>> 24) ^ (hi << 8); v[b + 1] = (hi >>> 24) ^ (lo << 8);   // b = (b ^ c) >>> 24
  add(a, b); addm(a, y);
  lo = v[d] ^ v[a]; hi = v[d + 1] ^ v[a + 1];
  v[d] = (lo >>> 16) ^ (hi << 16); v[d + 1] = (hi >>> 16) ^ (lo << 16); // d = (d ^ a) >>> 16
  add(c, d);
  lo = v[b] ^ v[c]; hi = v[b + 1] ^ v[c + 1];
  v[b] = (hi >>> 31) ^ (lo << 1); v[b + 1] = (lo >>> 31) ^ (hi << 1);   // b = (b ^ c) >>> 63
}

function compress(h, block, t, last) {
  for (let i = 0; i < 16; i++) { v[i] = h[i]; v[i + 16] = IV[i]; }
  v[24] ^= t;                               // the byte offset (t < 2^53: its low and high words)
  v[25] ^= Math.floor(t / 0x100000000);
  if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
  for (let i = 0; i < 32; i++) {
    const j = 4 * i;
    m[i] = block[j] | (block[j + 1] << 8) | (block[j + 2] << 16) | (block[j + 3] << 24);
  }
  for (let r = 0; r < 12; r++) {
    const s = r * 16;
    G(0, 8, 16, 24, SIGMA[s], SIGMA[s + 1]);
    G(2, 10, 18, 26, SIGMA[s + 2], SIGMA[s + 3]);
    G(4, 12, 20, 28, SIGMA[s + 4], SIGMA[s + 5]);
    G(6, 14, 22, 30, SIGMA[s + 6], SIGMA[s + 7]);
    G(0, 10, 20, 30, SIGMA[s + 8], SIGMA[s + 9]);
    G(2, 12, 22, 24, SIGMA[s + 10], SIGMA[s + 11]);
    G(4, 14, 16, 26, SIGMA[s + 12], SIGMA[s + 13]);
    G(6, 8, 18, 28, SIGMA[s + 14], SIGMA[s + 15]);
  }
  for (let i = 0; i < 16; i++) h[i] = h[i] ^ v[i] ^ v[i + 16];
}

// data: Buffer / Uint8Array -> Buffer of outLen bytes (default 64 = BLAKE2b-512)
function blake2b(data, outLen = 64) {
  if (!(outLen >= 1 && outLen <= 64)) throw new Error('blake2b: 1..64 bytes out');
  const input = data instanceof Uint8Array ? data : Buffer.from(data);
  const h = new Uint32Array(IV);
  h[0] ^= 0x01010000 ^ outLen;              // parameter block: digest length, no key, fanout 1, depth 1
  const block = new Uint8Array(128);
  let t = 0;
  let pos = 0;
  // every full block but the last one is compressed as it comes; the last (even a full one) at the end
  while (input.length - pos > 128) {
    t += 128;
    compress(h, input.subarray(pos, pos + 128), t, false);
    pos += 128;
  }
  const rest = input.length - pos;
  block.set(input.subarray(pos));
  t += rest;
  compress(h, block, t, true);
  const out = Buffer.alloc(outLen);
  for (let i = 0; i < outLen; i++) out[i] = h[i >> 2] >>> (8 * (i & 3));
  return out;
}

module.exports = { blake2b };
