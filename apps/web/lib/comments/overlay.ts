// Server-rendered "comments overlay" injected into the deck runtime bundle
// when the viewer is authenticated.
//
// Per docs/bip-deck-platform-architecture.md §5: "The same runtime serves
// authenticated commenters (with embed comment overlay active) and
// unauthenticated viewers (read-only)." The bundle itself is cached per
// (deck, commit); identity-dependent chrome is layered on at response time
// by `app/d/[slug]/route.ts` — keep that out of the cache.
//
// Phase 1 scope (docs/bip-deck-platform-phasing.md §1, "Slide-level
// comments: port the comment overlay from the existing tool"):
//   - One floating panel docked to the right edge of the runtime.
//   - Tracks current slide via IntersectionObserver on `<section.slide>`.
//   - List + create + reply + vote + (team-only) status update.
//   - No element-level pins (Phase 2), no @mentions (Phase 2),
//     no continuous mini-triage (Phase 4).
//
// Vanilla JS on purpose: the runtime bundle is plain HTML with no bundler,
// so dropping a React app in would need its own build step. The script is
// small enough to hand-write.

import type { CommentViewer } from '@/lib/comments/viewer';
import { viewerForClient } from '@/lib/comments/viewer';

interface OverlayContext {
  deckId: string;
  viewer: CommentViewer;
}

/**
 * Build the HTML fragment (container + script) to inject before `</body>`.
 * Returns an empty string if no viewer (caller is expected to skip the
 * injection, but we double-check defensively).
 */
export function renderCommentsOverlay(ctx: OverlayContext): string {
  const bootstrap = {
    deckId: ctx.deckId,
    viewer: viewerForClient(ctx.viewer),
  };
  // JSON.stringify with </script> escape — the only way the bootstrap could
  // break out of the script tag is if a future displayName contains "</".
  const json = JSON.stringify(bootstrap).replace(/</g, '\\u003c');

  return `
<div id="bip-comments-root" data-bip-comments></div>
<style data-source="bip-comments">${OVERLAY_CSS}</style>
<script data-source="bip-comments">
(function(){
  var BOOTSTRAP = ${json};
  ${OVERLAY_JS}
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Styles. Scoped via the `.bip-c-` prefix; the root container uses
// `all: initial` so deck CSS can't leak in.
// ---------------------------------------------------------------------------

const OVERLAY_CSS = `
#bip-comments-root, #bip-comments-root * {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.bip-c-toggle {
  position: fixed; top: 12px; right: 12px; z-index: 2147483646;
  background: #1f2937; color: #fff; border: 0; border-radius: 9999px;
  padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.bip-c-toggle:hover { background: #111827; }
.bip-c-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 360px; z-index: 2147483647;
  background: #fff; border-left: 1px solid #e5e7eb; display: none;
  flex-direction: column; box-shadow: -4px 0 20px rgba(0,0,0,0.08);
}
.bip-c-panel.bip-open { display: flex; }
.bip-c-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;
}
.bip-c-title { font-size: 13px; font-weight: 600; color: #111827; }
.bip-c-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
.bip-c-close {
  background: transparent; border: 0; color: #6b7280; cursor: pointer;
  font-size: 18px; line-height: 1; padding: 4px 8px;
}
.bip-c-close:hover { color: #111827; }
.bip-c-list { flex: 1; overflow-y: auto; padding: 10px 14px; }
.bip-c-empty { color: #9ca3af; font-size: 12px; padding: 24px 0; text-align: center; }
.bip-c-comment {
  border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px;
  margin-bottom: 10px; background: #fff;
}
.bip-c-comment.bip-reply { margin-left: 14px; background: #f9fafb; }
.bip-c-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bip-c-author { font-size: 12px; font-weight: 600; color: #111827; }
.bip-c-date { font-size: 11px; color: #9ca3af; }
.bip-c-status {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px; letter-spacing: 0.03em;
}
.bip-c-status-OPEN { background: #dbeafe; color: #1e40af; }
.bip-c-status-IN_REVIEW { background: #fef3c7; color: #92400e; }
.bip-c-status-PLANNED { background: #e0e7ff; color: #3730a3; }
.bip-c-status-DONE { background: #dcfce7; color: #166534; }
.bip-c-status-DISMISSED { background: #f3f4f6; color: #6b7280; }
.bip-c-body { font-size: 13px; color: #1f2937; white-space: pre-wrap; line-height: 1.4; margin: 4px 0 8px; }
.bip-c-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bip-c-vote {
  display: inline-flex; align-items: center; gap: 4px;
  background: #f3f4f6; border: 1px solid transparent; border-radius: 4px;
  padding: 2px 6px; font-size: 11px; color: #4b5563; cursor: pointer;
}
.bip-c-vote.bip-active-up { background: #dcfce7; color: #166534; border-color: #86efac; }
.bip-c-vote.bip-active-down { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
.bip-c-vote:hover { background: #e5e7eb; }
.bip-c-btn {
  background: transparent; border: 0; color: #4b5563; cursor: pointer;
  font-size: 11px; padding: 2px 6px; border-radius: 4px;
}
.bip-c-btn:hover { background: #f3f4f6; color: #111827; }
.bip-c-status-sel {
  font-size: 11px; padding: 2px 4px; border: 1px solid #d1d5db;
  border-radius: 4px; background: #fff; color: #374151;
}
.bip-c-reply-box, .bip-c-composer { margin-top: 8px; }
.bip-c-textarea {
  width: 100%; min-height: 60px; padding: 6px 8px; font-size: 13px;
  border: 1px solid #d1d5db; border-radius: 4px; resize: vertical;
  font-family: inherit;
}
.bip-c-textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb; }
.bip-c-submit {
  margin-top: 6px; background: #2563eb; color: #fff; border: 0;
  padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 4px;
  cursor: pointer;
}
.bip-c-submit:hover { background: #1d4ed8; }
.bip-c-submit:disabled { background: #93c5fd; cursor: not-allowed; }
.bip-c-composer { padding: 12px 14px; border-top: 1px solid #e5e7eb; background: #f9fafb; }
.bip-c-err { color: #b91c1c; font-size: 11px; margin-top: 4px; }
`;

// ---------------------------------------------------------------------------
// Script. Pure ES5 to keep the runtime dependency-free; no JSX, no async/await
// (broadest iframe compatibility, no transpilation step in the bundler).
// ---------------------------------------------------------------------------

const OVERLAY_JS = `
var DECK_ID = BOOTSTRAP.deckId;
var VIEWER = BOOTSTRAP.viewer;
var STATUSES = ['OPEN','IN_REVIEW','PLANNED','DONE','DISMISSED'];

var root = document.getElementById('bip-comments-root');
var currentSlideId = null;
var comments = []; // tree of CommentNode for current slide

// ---- DOM helpers ----------------------------------------------------------
function el(tag, opts, children) {
  var n = document.createElement(tag);
  if (opts) {
    if (opts.className) n.className = opts.className;
    if (opts.text != null) n.textContent = String(opts.text);
    if (opts.attrs) for (var k in opts.attrs) n.setAttribute(k, opts.attrs[k]);
    if (opts.on) for (var ev in opts.on) n.addEventListener(ev, opts.on[ev]);
    if (opts.style) for (var s in opts.style) n.style[s] = opts.style[s];
  }
  if (children) for (var i = 0; i < children.length; i++) if (children[i]) n.appendChild(children[i]);
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function fmtDate(iso) {
  try { var d = new Date(iso); return d.toLocaleString(); } catch(e) { return iso; }
}

// ---- API ------------------------------------------------------------------
function api(path, init) {
  init = init || {};
  init.credentials = 'same-origin';
  init.headers = init.headers || {};
  if (init.body && typeof init.body !== 'string') {
    init.body = JSON.stringify(init.body);
    init.headers['Content-Type'] = 'application/json';
  }
  return fetch(path, init).then(function(res) {
    return res.json().then(function(body) {
      if (!res.ok) {
        var msg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
        throw new Error(msg);
      }
      return body;
    });
  });
}

function loadComments() {
  if (!currentSlideId) { comments = []; render(); return; }
  api('/api/decks/' + encodeURIComponent(DECK_ID) + '/comments?slideId=' + encodeURIComponent(currentSlideId))
    .then(function(body) { comments = body.comments || []; render(); })
    .catch(function(err) { showError(err.message); });
}

// ---- Layout ---------------------------------------------------------------
var toggleBtn = el('button', { className: 'bip-c-toggle', text: 'Comments' });
var panel = el('div', { className: 'bip-c-panel' });
var headerTitle = el('div', { className: 'bip-c-title', text: 'Comments' });
var headerSub = el('div', { className: 'bip-c-sub', text: '' });
var headerTitleWrap = el('div', null, [headerTitle, headerSub]);
var closeBtn = el('button', { className: 'bip-c-close', text: '\u2715',
  on: { click: function() { setOpen(false); } } });
var header = el('div', { className: 'bip-c-header' }, [headerTitleWrap, closeBtn]);
var list = el('div', { className: 'bip-c-list' });
var errBox = el('div', { className: 'bip-c-err' });
var composer = el('div', { className: 'bip-c-composer' });
var composerInput = el('textarea', {
  className: 'bip-c-textarea',
  attrs: { placeholder: 'Add a comment\u2026' }
});
var composerBtn = el('button', { className: 'bip-c-submit', text: 'Post' });
composerBtn.disabled = false;
composerBtn.addEventListener('click', function() { submitComment(composerInput, null, composerBtn); });
composer.appendChild(composerInput);
composer.appendChild(composerBtn);
composer.appendChild(errBox);
panel.appendChild(header);
panel.appendChild(list);
panel.appendChild(composer);
root.appendChild(toggleBtn);
root.appendChild(panel);

toggleBtn.addEventListener('click', function() { setOpen(true); });

function setOpen(open) {
  if (open) {
    panel.classList.add('bip-open');
    toggleBtn.style.display = 'none';
    loadComments();
  } else {
    panel.classList.remove('bip-open');
    toggleBtn.style.display = '';
  }
}

function showError(msg) {
  errBox.textContent = msg || '';
  if (msg) setTimeout(function() { if (errBox.textContent === msg) errBox.textContent = ''; }, 4000);
}

// ---- Slide tracking -------------------------------------------------------
function trackSlides() {
  var slides = document.querySelectorAll('.slide[data-slide-id]');
  if (!slides.length) return;
  // First-visible-on-top wins. Update once the most-visible changes.
  var visibility = new Map();
  var io = new IntersectionObserver(function(entries) {
    for (var i = 0; i < entries.length; i++) {
      visibility.set(entries[i].target, entries[i].intersectionRatio);
    }
    var best = null; var bestR = -1;
    visibility.forEach(function(ratio, node) {
      if (ratio > bestR) { bestR = ratio; best = node; }
    });
    if (best && bestR > 0) {
      var sid = best.getAttribute('data-slide-id');
      if (sid !== currentSlideId) {
        currentSlideId = sid;
        var title = best.getAttribute('data-slide-title') || sid;
        headerSub.textContent = 'Slide: ' + title;
        if (panel.classList.contains('bip-open')) loadComments();
      }
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  for (var i = 0; i < slides.length; i++) io.observe(slides[i]);
  // Seed
  currentSlideId = slides[0].getAttribute('data-slide-id');
  headerSub.textContent = 'Slide: ' + (slides[0].getAttribute('data-slide-title') || currentSlideId);
}

// ---- Render ---------------------------------------------------------------
function render() {
  clear(list);
  if (!comments.length) {
    list.appendChild(el('div', { className: 'bip-c-empty', text: 'No comments on this slide yet.' }));
    return;
  }
  for (var i = 0; i < comments.length; i++) list.appendChild(renderNode(comments[i], false));
}

function renderNode(node, isReply) {
  var c = node.comment;
  var wrap = el('div', { className: 'bip-c-comment' + (isReply ? ' bip-reply' : '') });

  // Meta row
  var meta = el('div', { className: 'bip-c-meta' });
  meta.appendChild(el('span', { className: 'bip-c-author', text: c.authorDisplayName }));
  meta.appendChild(el('span', { className: 'bip-c-date', text: fmtDate(c.createdAt) }));
  if (!isReply) {
    meta.appendChild(el('span', {
      className: 'bip-c-status bip-c-status-' + c.status,
      text: c.status.replace('_', ' ').toLowerCase(),
    }));
  }
  wrap.appendChild(meta);

  // Body
  wrap.appendChild(el('div', { className: 'bip-c-body', text: c.body }));

  // Actions
  var actions = el('div', { className: 'bip-c-actions' });
  var v = node.votes || { score: 0, viewerDirection: 0 };
  var upBtn = el('button', {
    className: 'bip-c-vote' + (v.viewerDirection === 1 ? ' bip-active-up' : ''),
    text: '\u25B2 ' + (v.score > 0 ? '+' + v.score : v.score),
    on: { click: function() { castVote(c.id, v.viewerDirection === 1 ? 0 : 1); } },
  });
  var downBtn = el('button', {
    className: 'bip-c-vote' + (v.viewerDirection === -1 ? ' bip-active-down' : ''),
    text: '\u25BC',
    on: { click: function() { castVote(c.id, v.viewerDirection === -1 ? 0 : -1); } },
  });
  actions.appendChild(upBtn);
  actions.appendChild(downBtn);

  // Reply (only on top-level — matches the existing tool, schema allows
  // nesting but UX is one level deep in Phase 1).
  if (!isReply) {
    var replyOpen = { v: false };
    var replyBtn = el('button', { className: 'bip-c-btn', text: 'Reply' });
    var replyBox = el('div', { className: 'bip-c-reply-box', style: { display: 'none' } });
    var replyArea = el('textarea', {
      className: 'bip-c-textarea',
      attrs: { placeholder: 'Reply\u2026' },
    });
    var replySubmit = el('button', { className: 'bip-c-submit', text: 'Reply' });
    replyBox.appendChild(replyArea);
    replyBox.appendChild(replySubmit);
    replyBtn.addEventListener('click', function() {
      replyOpen.v = !replyOpen.v;
      replyBox.style.display = replyOpen.v ? '' : 'none';
      if (replyOpen.v) replyArea.focus();
    });
    replySubmit.addEventListener('click', function() {
      submitComment(replyArea, c.id, replySubmit);
    });
    actions.appendChild(replyBtn);

    // Status menu (team only)
    if (VIEWER.canModerate) {
      var sel = el('select', { className: 'bip-c-status-sel' });
      for (var i = 0; i < STATUSES.length; i++) {
        var opt = el('option', { text: STATUSES[i].toLowerCase().replace('_',' '), attrs: { value: STATUSES[i] } });
        if (STATUSES[i] === c.status) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', function() {
        api('/api/comments/' + encodeURIComponent(c.id), {
          method: 'PATCH',
          body: { status: sel.value },
        }).then(function() { loadComments(); }).catch(function(err) { showError(err.message); });
      });
      actions.appendChild(sel);
    }

    wrap.appendChild(actions);
    wrap.appendChild(replyBox);

    // Replies
    if (node.replies && node.replies.length) {
      for (var j = 0; j < node.replies.length; j++) {
        wrap.appendChild(renderNode(node.replies[j], true));
      }
    }
  } else {
    wrap.appendChild(actions);
  }

  return wrap;
}

function castVote(commentId, direction) {
  var url = '/api/comments/' + encodeURIComponent(commentId) + '/vote';
  var p = direction === 0
    ? api(url, { method: 'DELETE' })
    : api(url, { method: 'POST', body: { direction: direction } });
  p.then(function() { loadComments(); }).catch(function(err) { showError(err.message); });
}

function submitComment(textArea, parentId, btn) {
  var body = (textArea.value || '').trim();
  if (!body) return;
  if (!currentSlideId) { showError('No active slide'); return; }
  btn.disabled = true;
  api('/api/decks/' + encodeURIComponent(DECK_ID) + '/comments', {
    method: 'POST',
    body: { slideId: currentSlideId, body: body, parentId: parentId || undefined },
  }).then(function() {
    textArea.value = '';
    loadComments();
  }).catch(function(err) {
    showError(err.message);
  }).then(function() {
    btn.disabled = false;
  });
}

// ---- Boot -----------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', trackSlides);
} else {
  trackSlides();
}
`;
