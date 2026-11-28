// fade-ui.js - the page side of fade.js (same copy in both overlays): while main swaps the overlay's size, the page
// dims to the floor it is told and comes back. On <html>, so it multiplies with everything under it - the list's
// own opacity while locked (lock.css --lock-dim, the dwell fade) stays as it is.
(function () {
  const api = window.mangho || window.widget;
  const root = document.documentElement;
  api.onFeed((d) => {
    if (!d || d.type !== 'fade') return;
    root.style.transition = `opacity ${Number(d.ms) || 120}ms ease`;
    root.style.opacity = d.on ? String(Number(d.floor) || 0.35) : '';
  });
}());
