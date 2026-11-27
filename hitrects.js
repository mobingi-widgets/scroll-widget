// hitrects.js - the page side of hitpoll.js (same file in both overlays): reports the rectangles
// that take the mouse (CSS px, window-relative) whenever they change, so the main process can
// switch click-through from the cursor position alone - also while the game (run as administrator)
// is in front and no mouse moves reach a click-through window.
//
// watchHitRects(selector, send, opts?) - selector: what takes the mouse; opts.whole (or a plain
// string): a container that takes it as a whole (its insides are not listed one by one; rows
// scrolled out of sight would otherwise stick out of it). Elements with pointer-events: none
// and hidden ones are left out - unless opts.inert (areas that only need to be known, like the
// "near" region where the size bars show).
(function () {
  window.watchHitRects = function (selector, send, opts) {
    const o = typeof opts === 'string' ? { whole: opts } : (opts || {});
    let last = '';
    let queued = false;
    function rects() {
      const out = [];
      for (const e of document.querySelectorAll(selector)) {
        if (o.whole && !e.matches(o.whole) && e.closest(o.whole)) continue;
        if (!o.inert && getComputedStyle(e).pointerEvents === 'none') continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push([Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)]);
      }
      return out;
    }
    function report() {
      queued = false;
      const list = rects();
      const key = JSON.stringify(list);
      if (key === last) return;
      last = key;
      send(list);
    }
    function soon() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(report);
    }
    new ResizeObserver(soon).observe(document.body);
    new MutationObserver(soon).observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'],
    });
    window.addEventListener('resize', soon);
    setInterval(soon, 1000);             // whatever moved without a mutation (fonts, zoom)
    soon();
  };
}());
