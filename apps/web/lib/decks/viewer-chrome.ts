// Server-rendered "viewer chrome" injected into the deck runtime bundle.
//
// Why this exists: the bundle assembled by lib/decks/bundler.ts is a vertical
// stack of <section class="slide"> elements. That works as a preview but
// doesn't feel like a presentation editor (no prev/next, no slide picker).
// This module injects a small CSS + JS payload that switches the runtime
// into a single-slide view and exposes a postMessage API so the admin
// shell (deck-editor.tsx) — or a future share-recipient chrome — can drive
// it from outside the iframe without owning all the markup.
//
// Always injected (team users + share recipients). The bundle itself stays
// audience-agnostic; this is layered on at response time alongside the
// comments overlay (see lib/comments/overlay.ts).
//
// postMessage protocol (origin-checked against window.location.origin):
//   parent -> iframe:
//     { type: 'bip:embed' }            // signals an embedding chrome owns
//                                      // its own controls; runtime hides
//                                      // overlay's floating buttons.
//     { type: 'bip:goto', slideId }    // jump to slide by id
//     { type: 'bip:next' | 'bip:prev' }
//     { type: 'bip:comments-toggle' }  // opens/closes the comments panel
//     { type: 'bip:pin-toggle' }       // toggles pin-placement mode
//   iframe -> parent:
//     { type: 'bip:ready', slides: [{ id, title, index }], current }
//     { type: 'bip:slide-change', slideId, index }
//     { type: 'bip:comments-state', open: boolean }
//     { type: 'bip:pin-state', on: boolean }

export function renderViewerChrome(): string {
  return `
<style data-source="bip-viewer-chrome">${VIEWER_CSS}</style>
<script data-source="bip-viewer-chrome">
(function(){
${VIEWER_JS}
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
// We hide non-active slides via `display: none` and let the active one fill
// the viewport. `min-height: 100vh` not `height` so authored content taller
// than the viewport can still scroll within the slide.
//
// Authored slides may set their own height; we override only via a top-level
// `body.bip-viewer-single` selector so the rule is easy to opt out of by
// the AI editor in the future.

const VIEWER_CSS = `
html.bip-viewer-single,
body.bip-viewer-single {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bip-stage-bg, #e5e7eb);
}
/* The deck becomes a centered stage; each active slide is a 16:9 "page"
   that scales to fit both viewport dimensions, with a gutter and shadow
   so it visually reads as a presentation slide.
   Use !important to override authored deck CSS that commonly sets
   .deck { min-height: 100vh } or a flex/grid layout for the multi-slide
   scroll runtime. */
body.bip-viewer-single main.deck,
body.bip-viewer-single .deck {
  height: 100vh !important;
  min-height: 0 !important;
  max-height: 100vh !important;
  width: 100vw !important;
  max-width: 100vw !important;
  display: grid !important;
  place-items: center !important;
  padding: 1.5rem !important;
  margin: 0 !important;
  box-sizing: border-box !important;
  gap: 0 !important;
  overflow: hidden !important;
}
body.bip-viewer-single .deck > .slide { display: none; }
/* Authored slide CSS commonly uses width: 100vw / height: 100vh to fill
   the viewport. In the embedded admin preview vw/vh resolve to the iframe
   viewport, not the inner stage, so without !important overrides the slide
   bleeds past the stage. */
body.bip-viewer-single .deck > .slide.bip-active {
  display: block !important;
  position: relative !important;
  width: min(100%, calc((100vh - 3rem) * 16 / 9)) !important;
  height: auto !important;
  max-height: calc(100vh - 3rem) !important;
  aspect-ratio: 16 / 9 !important;
  background: #fff;
  border-radius: 8px;
  box-shadow:
    0 10px 40px -10px rgba(0,0,0,0.22),
    0 2px 6px -1px rgba(0,0,0,0.1);
  overflow: hidden !important;
  margin: 0 !important;
  box-sizing: border-box !important;
}
/* When parent chrome is hosting the controls, hide the overlay's floating
   toggle + pin buttons so we don't double up. The comments overlay listens
   for bip:embed and hides itself; this is a defensive fallback. */
body.bip-embedded .bip-c-toggle,
body.bip-embedded .bip-c-pin-toggle { display: none !important; }
`;

// ---------------------------------------------------------------------------
// JS (IIFE, vanilla — same constraints as overlay.ts: the bundle has no
// build step so we hand-write).
// ---------------------------------------------------------------------------

const VIEWER_JS = `
var slides = [];
var activeIndex = 0;
var embedded = false;
var ORIGIN = window.location.origin;

function $$slides() {
  return Array.prototype.slice.call(document.querySelectorAll('.deck > .slide[data-slide-id]'));
}

function activate(idx) {
  if (!slides.length) return;
  if (idx < 0) idx = 0;
  if (idx >= slides.length) idx = slides.length - 1;
  if (idx === activeIndex && slides[idx].classList.contains('bip-active')) return;
  for (var i = 0; i < slides.length; i++) slides[i].classList.remove('bip-active');
  slides[idx].classList.add('bip-active');
  activeIndex = idx;
  // Force focus into the slide so a viewer's arrow keys land here, not on
  // the parent admin shell.
  try { window.scrollTo(0, 0); } catch (e) {}
  postUp({
    type: 'bip:slide-change',
    slideId: slides[idx].getAttribute('data-slide-id'),
    index: idx,
  });
}

function gotoById(slideId) {
  for (var i = 0; i < slides.length; i++) {
    if (slides[i].getAttribute('data-slide-id') === slideId) { activate(i); return; }
  }
}

function postUp(msg) {
  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage(msg, ORIGIN); } catch (e) {}
  }
}

function setEmbedded(on) {
  embedded = !!on;
  if (on) document.body.classList.add('bip-embedded');
  else document.body.classList.remove('bip-embedded');
}

function emitReady() {
  postUp({
    type: 'bip:ready',
    slides: slides.map(function(s, i) {
      return {
        id: s.getAttribute('data-slide-id'),
        title: s.getAttribute('data-slide-title') || null,
        index: i,
      };
    }),
    current: activeIndex,
  });
}

window.addEventListener('message', function(ev) {
  if (ev.origin !== ORIGIN) return;
  var data = ev.data;
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'bip:embed': setEmbedded(true); emitReady(); break;
    case 'bip:goto': if (data.slideId) gotoById(data.slideId); break;
    case 'bip:next': activate(activeIndex + 1); break;
    case 'bip:prev': activate(activeIndex - 1); break;
    case 'bip:comments-toggle':
      // Forwarded to the comments overlay via a CustomEvent — the overlay
      // listens for both postMessage and this event so it doesn't need to
      // know about embedding directly.
      document.dispatchEvent(new CustomEvent('bip:comments-toggle'));
      break;
    case 'bip:pin-toggle':
      document.dispatchEvent(new CustomEvent('bip:pin-toggle'));
      break;
  }
});

// Arrow-key navigation inside the iframe.
window.addEventListener('keydown', function(ev) {
  if (ev.defaultPrevented) return;
  var tag = ev.target && ev.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
  if (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === ' ') {
    activate(activeIndex + 1); ev.preventDefault();
  } else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') {
    activate(activeIndex - 1); ev.preventDefault();
  }
});

function init() {
  slides = $$slides();
  document.body.classList.add('bip-viewer-single');
  if (slides.length) {
    slides[0].classList.add('bip-active');
    activeIndex = 0;
  }
  emitReady();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
`;
