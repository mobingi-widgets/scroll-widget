// cardsize.js - a card's whole height, for the window that is sized to it (page side; update.js, beta.js, the
// scanner's authors.js). Same copy in both overlays.
// A card may be capped to its window (update.css #card max-height: a window held short by the screen keeps the card
// inside it - the long part scrolls, the buttons stay). Measured with that cap on, the card reports the window's own
// height back and the window never grows (1.15.0 / 1.11.0: the 베타 받기 card opened at its first guess and
// scrolled). So the cap is lifted, the card measured, the cap put back - in one go, no frame drawn between.
'use strict';
window.cardHeight = function cardHeight(el) {
  const cap = el.style.maxHeight;
  el.style.maxHeight = 'none';
  const h = el.getBoundingClientRect().height;
  el.style.maxHeight = cap;
  return h;
};
