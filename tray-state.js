// tray-state.js - the tray icon says the overlay's state (user 2026-11-27; same copy in both
// overlays): grey = hidden - by the user (☰ → 표시 → 숨김; not the short "game is behind" hide of
// 게임 앞) or for want of a game window (nogame.js; the tooltip says why), a red dot = a problem (the
// same list as the ☰ ⚠). Both together are possible. The
// variants are drawn from the program's own tray.png / tray@2x.png at start - no extra files.
'use strict';

const { nativeImage } = require('electron');
const path = require('path');

const DOT = [229, 72, 77];             // red (R, G, B)
const RING = [255, 255, 255];          // keeps the dot apart from the icon

// one scale of the base icon -> its grey / dotted variant (premultiplied BGRA, as toBitmap gives)
function draw(buf, w, h, grey, dot) {
  const out = Buffer.from(buf);
  if (grey) {
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      const l = 0.0722 * out[i] + 0.7152 * out[i + 1] + 0.2126 * out[i + 2];   // B G R
      // a mid grey on light and dark taskbars alike (0.22..0.77 of white), the letters kept apart; premultiplied
      const g = Math.round(0.22 * a + 0.55 * l);
      out[i] = g; out[i + 1] = g; out[i + 2] = g;
    }
  }
  if (dot) {
    const s = w / 16;                  // 1 at 16 px, 2 at 32 px
    const r = 2.6 * s;                 // the dot
    const ring = 1.0 * s;              // its white edge
    const cx = w - r - ring - 0.2 * s;
    const cy = h - r - ring - 0.2 * s;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const outer = Math.max(0, Math.min(1, r + ring + 0.5 - d));
        if (!outer) continue;
        const inner = Math.max(0, Math.min(1, r + 0.5 - d));
        const i = (y * w + x) * 4;
        // colour at this pixel: the red dot inside, the ring around it (both opaque)
        const c = [0, 1, 2].map((k) => DOT[k] * inner + RING[k] * (1 - inner));      // R G B
        out[i] = Math.round(out[i] * (1 - outer) + c[2] * outer);
        out[i + 1] = Math.round(out[i + 1] * (1 - outer) + c[1] * outer);
        out[i + 2] = Math.round(out[i + 2] * (1 - outer) + c[0] * outer);
        out[i + 3] = Math.round(out[i + 3] * (1 - outer) + 255 * outer);
      }
    }
  }
  return out;
}

function variant(base, grey, dot) {
  if (!grey && !dot) return base;
  const img = nativeImage.createEmpty();
  const size = base.getSize();
  for (const scaleFactor of [1, 2]) {
    const w = size.width * scaleFactor;
    const h = size.height * scaleFactor;
    const buf = base.toBitmap({ scaleFactor });
    if (!buf.length || buf.length !== w * h * 4) continue;
    const png = nativeImage.createFromBitmap(draw(buf, w, h, grey, dot), { width: w, height: h, scaleFactor }).toPNG({ scaleFactor });
    img.addRepresentation({ scaleFactor, width: w, height: h, buffer: png });
  }
  return img.isEmpty() ? base : img;
}

// create({ tray, dir, name }) -> { update({ hidden, why, problem }), image(hidden, problem) }
function create(o) {
  const base = nativeImage.createFromPath(path.join(o.dir, 'tray.png'));   // tray@2x.png comes along
  const cache = new Map();
  const image = (hidden, problem) => {
    const key = `${!!hidden}${!!problem}`;
    if (!cache.has(key)) cache.set(key, variant(base, !!hidden, !!problem));
    return cache.get(key);
  };
  let last = '';
  // why: what hid it, when not the user (nogame.js: '게임 없음' - grey all the same)
  function update({ hidden, why, problem }) {
    const tip = [o.name + (hidden ? ` · 숨김${why ? ` (${why})` : ''}` : '') + (problem ? ` · ⚠ ${problem}` : ''),
      hidden ? '클릭: 보이기' : '클릭: 숨기기'].join('\n').slice(0, 120);
    const key = `${!!hidden}|${why || ''}|${problem || ''}`;
    if (key === last || !o.tray || o.tray.isDestroyed()) return;
    last = key;
    o.tray.setImage(image(hidden, problem));
    o.tray.setToolTip(tip);
  }
  return { update, image };
}

module.exports = { create };
