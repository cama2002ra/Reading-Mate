// Builds the HTML page that runs inside PdfReader.js's WebView.
//
// Why a plain string builder and not a bundled .html asset: Expo/Metro
// doesn't ship a zero-config way to bundle+serve a local static HTML file
// alongside JS the way a web bundler would, and this content is small and
// fully generated (it needs the signed PDF download URL and the current
// theme baked in per-render anyway) — a template string keeps everything
// in one reviewable place instead of splitting a "generate the URL" step
// in JS from a "load the URL" step in a separate asset file. See
// PdfReader.js for the RN-side component that renders this in a WebView.
//
// PDF.js loads from cdnjs as an ES module (recent pdf.js releases dropped
// the old UMD pdf.min.js global-script build in favor of pdf.min.mjs — see
// https://cdnjs.com/libraries/pdf.js). `disableWorker: true` is
// deliberate, not a placeholder: a Worker loaded from a cross-origin CDN
// script hits the browser's same-origin restriction on dedicated workers
// (this WebView's page has no real origin — it's loaded via `source:
// {html}}`, not `source: {uri}}`), and PDF.js's own docs list
// `disableWorker` as the supported way to run parsing on the main thread
// instead. Slightly slower for a very large document; fine for the
// 15 MB-capped, mostly-lecture-slide-and-textbook-chapter documents this
// app handles (see services/uploads.js's MAX_UPLOAD_BYTES).
//
// No backticks anywhere inside PDFJS_VERSION's script body below — this
// whole file is itself a JS template literal in the RN bundle, and a
// nested backtick would break it. Plain string concatenation only inside
// the embedded <script>.

const PDFJS_VERSION = '6.1.200';
const PDFJS_MODULE_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

// Escapes a URL for safe embedding inside a single-quoted JS string literal
// in the generated HTML — download URLs can contain '&' and query params
// but shouldn't ever contain a raw quote; this guards against that anyway.
function jsStringLiteral(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

// `colors` is the small subset of the app's current theme palette this
// reader needs (see PdfReader.js) — keeps the WebView's chrome (toolbar,
// selection-action buttons, scanned-page banner) from looking like a
// foreign surface dropped into the "reading lamp" design system.
export function buildPdfReaderHtml({ fileUrl, colors }) {
  const fileUrlLiteral = jsStringLiteral(fileUrl);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: ${colors.ink}; overscroll-behavior: none; }
  * { box-sizing: border-box; -webkit-touch-callout: none; }
  #topbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px; background: ${colors.paperRaised};
    border-bottom: 1px solid ${colors.border};
    font-family: -apple-system, Roboto, sans-serif;
  }
  #navGroup { display: flex; align-items: center; gap: 6px; }
  .navBtn {
    width: 30px; height: 30px; border-radius: 15px; border: none;
    background: ${colors.paper}; color: ${colors.textPrimary}; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .navBtn:disabled { opacity: 0.35; }
  #pageLabel { color: ${colors.textMuted}; font-size: 12.5px; min-width: 64px; text-align: center; }
  #docArea {
    position: absolute; top: 42px; left: 0; right: 0; bottom: 0;
    overflow: auto; -webkit-overflow-scrolling: touch;
    display: flex; align-items: flex-start; justify-content: center;
    padding: 14px;
  }
  #pageWrap { position: relative; transform-origin: top center; touch-action: pan-x pan-y; }
  #pageWrap canvas { display: block; box-shadow: 0 2px 10px rgba(0,0,0,0.35); background: #fff; }
  .textLayer {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    line-height: 1; overflow: hidden; opacity: 1;
  }
  .textLayer span {
    position: absolute; white-space: pre; color: transparent;
    transform-origin: 0% 0%; cursor: text;
    user-select: text; -webkit-user-select: text;
  }
  .textLayer span::selection { background: ${colors.lampSoft}; color: transparent; }
  .textLayer span.reading-highlight {
    background: ${colors.lampSoft};
    border-radius: 2px;
  }
  #scanBanner {
    position: fixed; left: 10px; right: 10px; bottom: 78px; z-index: 15;
    display: none; align-items: center; justify-content: space-between;
    background: ${colors.paperRaised}; border: 1px solid ${colors.border};
    border-radius: 12px; padding: 9px 12px; font-family: -apple-system, Roboto, sans-serif;
  }
  #scanBanner span { color: ${colors.textMuted}; font-size: 12px; flex: 1; margin-right: 8px; }
  #scanBanner button {
    border: none; border-radius: 999px; background: ${colors.lamp}; color: ${colors.ink};
    font-size: 12px; font-weight: 600; padding: 7px 12px;
  }
  #actionToolbar {
    position: absolute; z-index: 30; display: none;
    background: ${colors.paperRaised}; border: 1px solid ${colors.border};
    border-radius: 999px; padding: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.35);
    font-family: -apple-system, Roboto, sans-serif;
  }
  #actionToolbar .row { display: flex; align-items: center; }
  #actionToolbar button {
    border: none; background: transparent; color: ${colors.textPrimary};
    font-size: 12.5px; font-weight: 600; padding: 7px 10px; white-space: nowrap;
  }
  #actionToolbar button.primary { background: ${colors.lamp}; color: ${colors.ink}; border-radius: 999px; }
  #loadingLabel {
    position: absolute; top: 50%; left: 0; right: 0; text-align: center;
    color: ${colors.textMuted}; font-family: -apple-system, Roboto, sans-serif; font-size: 13px;
  }
</style>
</head>
<body>
  <div id="topbar">
    <div id="navGroup">
      <button class="navBtn" id="prevBtn">&#8249;</button>
      <span id="pageLabel">Loading…</span>
      <button class="navBtn" id="nextBtn">&#8250;</button>
    </div>
    <div id="navGroup">
      <button class="navBtn" id="zoomOutBtn">&#8722;</button>
      <button class="navBtn" id="zoomInBtn">&#43;</button>
    </div>
  </div>
  <div id="docArea">
    <div id="pageWrap"></div>
    <div id="loadingLabel">Opening document…</div>
  </div>
  <div id="scanBanner">
    <span>This page looks like a scan or image.</span>
    <button id="scanReadBtn">Read it</button>
  </div>
  <div id="actionToolbar"><div class="row" id="actionRow"></div></div>

<script type="module">
  import * as pdfjsLib from ${jsStringLiteral(PDFJS_MODULE_URL)};

  pdfjsLib.GlobalWorkerOptions.workerSrc = ${jsStringLiteral(PDFJS_WORKER_URL)};

  var FILE_URL = ${fileUrlLiteral};

  var state = {
    pdf: null,
    numPages: 0,
    currentPage: 1,
    scale: 1.2,
    baseScale: 1.2,
    cache: {},          // pageNumber -> { textItems, offsets, pageText, isScanned }
    selectionPageIndex: null,
    currentSelectionText: '',
  };

  function post(msg) {
    var payload = JSON.stringify(msg);
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(payload);
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }
  }

  if (!window.ReactNativeWebView) {
    window.ReactNativeWebView = {
      postMessage: function (msg) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(msg, '*');
        }
      }
    };
  }

  function byId(id) { return document.getElementById(id); }

  // ---------- Rendering ----------

  function buildTextLayer(page, viewport, textContent) {
    var layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.style.width = viewport.width + 'px';
    layer.style.height = viewport.height + 'px';

    var offsets = [];
    var runningText = '';

    textContent.items.forEach(function (item, i) {
      var tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      var angle = Math.atan2(tx[1], tx[0]);
      var fontHeight = Math.hypot(tx[2], tx[3]) || 1;
      var span = document.createElement('span');
      span.textContent = item.str;
      span.style.left = tx[4] + 'px';
      span.style.top = (tx[5] - fontHeight) + 'px';
      span.style.fontSize = fontHeight + 'px';
      if (angle !== 0) span.style.transform = 'rotate(' + angle + 'rad)';
      layer.appendChild(span);

      var start = runningText.length;
      runningText += item.str;
      var end = runningText.length;
      offsets.push({ start: start, end: end, el: span });
      if (item.hasEOL) runningText += '\\n';
      else runningText += ' ';
    });

    return { layer: layer, pageText: runningText.trim(), offsets: offsets };
  }

  function updateNavUi() {
    byId('pageLabel').textContent = 'Page ' + state.currentPage + ' of ' + state.numPages;
    byId('prevBtn').disabled = state.currentPage <= 1;
    byId('nextBtn').disabled = state.currentPage >= state.numPages;
  }

  function renderPage(pageNumber) {
    if (state.cache[pageNumber] && state.cache[pageNumber].rendered) {
      return Promise.resolve(state.cache[pageNumber]);
    }
    return state.pdf.getPage(pageNumber).then(function (page) {
      var viewport = page.getViewport({ scale: state.scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');

      return page.render({ canvasContext: ctx, viewport: viewport }).promise
        .then(function () { return page.getTextContent(); })
        .then(function (textContent) {
          var built = buildTextLayer(page, viewport, textContent);
          var isScanned = built.pageText.replace(/\\s/g, '').length < 10;
          var record = {
            canvas: canvas,
            textLayer: built.layer,
            pageText: built.pageText,
            offsets: built.offsets,
            isScanned: isScanned,
            rendered: true,
          };
          state.cache[pageNumber] = record;
          return record;
        });
    });
  }

  function showPage(pageNumber) {
    state.currentPage = pageNumber;
    updateNavUi();
    hideToolbar();

    renderPage(pageNumber).then(function (record) {
      var wrap = byId('pageWrap');
      wrap.innerHTML = '';
      wrap.style.width = record.canvas.width + 'px';
      wrap.style.height = record.canvas.height + 'px';
      wrap.appendChild(record.canvas);
      wrap.appendChild(record.textLayer);
      byId('loadingLabel').style.display = 'none';

      byId('scanBanner').style.display = record.isScanned ? 'flex' : 'none';

      post({
        type: 'page-changed',
        pageIndex: pageNumber,
        numPages: state.numPages,
        pageText: record.pageText,
        isScanned: record.isScanned,
      });

      // §10: preload current page's immediate neighbors only, on demand —
      // not the whole document upfront.
      if (pageNumber + 1 <= state.numPages) renderPage(pageNumber + 1);
      if (pageNumber - 1 >= 1) renderPage(pageNumber - 1);
    });
  }

  function goToPage(pageNumber) {
    var clamped = Math.max(1, Math.min(state.numPages, pageNumber));
    if (clamped !== state.currentPage || !byId('pageWrap').firstChild) showPage(clamped);
  }

  // ---------- Zoom (pinch + buttons) ----------

  function applyScaleTransform() {
    byId('pageWrap').style.transform = 'scale(' + (state.scale / state.baseScale) + ')';
  }

  var pinch = { active: false, startDist: 0, startScale: 1 };

  function touchDist(touches) {
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  byId('docArea').addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      pinch.active = true;
      pinch.startDist = touchDist(e.touches);
      pinch.startScale = state.scale;
    }
  }, { passive: true });

  byId('docArea').addEventListener('touchmove', function (e) {
    if (pinch.active && e.touches.length === 2) {
      var dist = touchDist(e.touches);
      var factor = dist / (pinch.startDist || 1);
      state.scale = Math.max(state.baseScale * 0.6, Math.min(state.baseScale * 3, pinch.startScale * factor));
      applyScaleTransform();
    }
  }, { passive: true });

  byId('docArea').addEventListener('touchend', function (e) {
    if (e.touches.length < 2) pinch.active = false;
  });

  byId('zoomInBtn').addEventListener('click', function () {
    state.scale = Math.min(state.baseScale * 3, state.scale * 1.2);
    applyScaleTransform();
  });
  byId('zoomOutBtn').addEventListener('click', function () {
    state.scale = Math.max(state.baseScale * 0.6, state.scale / 1.2);
    applyScaleTransform();
  });

  // ---------- Page nav ----------

  byId('prevBtn').addEventListener('click', function () { goToPage(state.currentPage - 1); });
  byId('nextBtn').addEventListener('click', function () { goToPage(state.currentPage + 1); });

  // ---------- Scanned-page OCR fallback (§4.2) ----------

  byId('scanReadBtn').addEventListener('click', function () {
    var record = state.cache[state.currentPage];
    if (!record) return;
    var dataUrl = record.canvas.toDataURL('image/png');
    var base64 = dataUrl.split(',')[1];
    post({ type: 'scanned-page', pageIndex: state.currentPage, base64: base64, mimeType: 'image/png' });
  });

  // ---------- Selection -> custom action toolbar (§4.1, replaces the ----------
  // ---------- browser's own copy/paste menu with the canned actions) ----------

  function hideToolbar() {
    byId('actionToolbar').style.display = 'none';
    state.selectionPageIndex = null;
  }

  function pageIndexForNode(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el) {
      if (el.classList && el.classList.contains('textLayer')) return state.currentPage;
      el = el.parentElement;
    }
    return state.currentPage;
  }

  function buildToolbarButtons(isSingleWord) {
    var row = byId('actionRow');
    row.innerHTML = '';
    var actions = [];
    if (isSingleWord) actions.push({ key: 'define', label: 'Define' });
    actions.push({ key: 'explain', label: 'Re-read for me' });
    actions.push({ key: 'loop', label: 'Listen on loop' });
    actions.push({ key: 'simplify', label: 'Simplify' });
    actions.push({ key: 'quiz', label: 'Quiz me' });
    actions.push({ key: 'custom', label: 'Custom…' });

    actions.forEach(function (a, i) {
      var btn = document.createElement('button');
      btn.textContent = a.label;
      if (i === 0) btn.className = 'primary';
      btn.addEventListener('mousedown', function (ev) {
        // Prevent clicking the button from losing the text selection in desktop browsers
        ev.preventDefault();
      });
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        handleActionTap(a.key);
      });
      row.appendChild(btn);
    });
  }

  function handleActionTap(action) {
    var sel = window.getSelection();
    var text = (sel ? sel.toString() : '').trim() || state.currentSelectionText || '';
    if (!text) { hideToolbar(); return; }
    var pageIndex = state.selectionPageIndex || state.currentPage;
    var pageRecord = state.cache[pageIndex];
    post({
      type: 'selection-action',
      action: action,
      selectionText: text,
      pageIndex: pageIndex,
      pageContext: pageRecord ? pageRecord.pageText : '',
    });
    if (sel) sel.removeAllRanges();
    state.currentSelectionText = '';
    hideToolbar();
  }

  var selectionTimer = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(function () {
      var sel = window.getSelection();
      var text = sel ? sel.toString().trim() : '';
      if (!text || sel.rangeCount === 0) { hideToolbar(); return; }

      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { hideToolbar(); return; }

      state.selectionPageIndex = pageIndexForNode(sel.anchorNode);
      state.currentSelectionText = text;
      var isSingleWord = !/\s/.test(text);
      buildToolbarButtons(isSingleWord);

      var toolbar = byId('actionToolbar');
      toolbar.style.display = 'block';
      var top = rect.top + window.scrollY - 46;
      if (top < 46) top = rect.bottom + window.scrollY + 8;
      var left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2));
      toolbar.style.top = top + 'px';
      toolbar.style.left = left + 'px';
      toolbar.style.transform = 'translateX(-50%)';
    }, 120);
  });

  function handleDocPointerDown(e) {
    if (e.target && e.target.closest && e.target.closest('#actionToolbar')) return;
    if (e.target && e.target.tagName === 'SPAN') return;
    hideToolbar();
  }
  byId('docArea').addEventListener('touchstart', handleDocPointerDown, { passive: true });
  byId('docArea').addEventListener('mousedown', handleDocPointerDown);

  // ---------- Read-aloud highlight bridge (§4.5) — called from RN via ----------
  // ---------- injectJavaScript on each expo-speech onBoundary event ----------

  window.__highlightAtChar = function (charIndex) {
    var record = state.cache[state.currentPage];
    if (!record) return;
    for (var i = 0; i < record.offsets.length; i++) {
      var o = record.offsets[i];
      if (o.el.classList.contains('reading-highlight')) o.el.classList.remove('reading-highlight');
    }
    if (charIndex == null) return;
    for (var j = 0; j < record.offsets.length; j++) {
      var off = record.offsets[j];
      if (charIndex >= off.start && charIndex <= off.end) {
        off.el.classList.add('reading-highlight');
        break;
      }
    }
  };

  window.__jumpToPage = function (pageNumber) { goToPage(pageNumber); };

  // On-demand only (never called automatically) — walks every page's
  // getTextContent() to build the whole document's plain text, for the
  // reader's "Quiz me on this document" action (§4.4: "PDF.js already
  // extracts each page's plain text locally... concatenate that").
  // Deliberately NOT the same thing as the current+neighbors canvas
  // preloading in showPage() above — extracting text content is cheap
  // even across many pages since it skips rendering entirely; this only
  // runs when the student actually asks to be quizzed on the whole thing.
  window.__extractFullText = function () {
    if (!state.pdf) { post({ type: 'full-text-extracted', text: '' }); return; }
    var total = state.numPages;
    var texts = new Array(total);
    var remaining = total;
    var settle = function () {
      remaining -= 1;
      if (remaining <= 0) post({ type: 'full-text-extracted', text: texts.join('\\n\\n') });
    };
    for (var n = 1; n <= total; n++) {
      (function (num) {
        if (state.cache[num] && state.cache[num].pageText) {
          texts[num - 1] = state.cache[num].pageText;
          settle();
          return;
        }
        state.pdf.getPage(num)
          .then(function (page) { return page.getTextContent(); })
          .then(function (textContent) {
            texts[num - 1] = textContent.items.map(function (it) { return it.str; }).join(' ');
            settle();
          })
          .catch(function () {
            texts[num - 1] = '';
            settle();
          });
      })(n);
    }
  };

  // ---------- Boot ----------

  // getDocument()'s underlying fetch has no built-in ceiling — a slow or
  // stuck connection (or a server response its network layer can't fully
  // stream, e.g. no Range/Accept-Ranges support) leaves the person staring
  // at "Opening document..." forever with neither a doc-loaded nor a
  // doc-error message ever posted back to SessionScreen.js. This timeout
  // turns that silent hang into the same visible error path a real
  // failure already takes, so there's always something on screen (and in
  // the RN console via onDocError) to act on instead of an indefinite
  // spinner.
  var OPEN_TIMEOUT_MS = 25000;
  var openSettled = false;
  var openTimeoutId = setTimeout(function () {
    if (openSettled) return;
    openSettled = true;
    byId('loadingLabel').textContent = 'Taking too long to open — check your connection and try again.';
    post({ type: 'doc-error', message: 'Timed out opening the document.' });
  }, OPEN_TIMEOUT_MS);

  pdfjsLib.getDocument({
    url: FILE_URL,
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + ${jsStringLiteral(PDFJS_VERSION)} + '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + ${jsStringLiteral(PDFJS_VERSION)} + '/standard_fonts/',
  }).promise
    .then(function (pdf) {
      if (openSettled) return; // the timeout already took over the UI
      openSettled = true;
      clearTimeout(openTimeoutId);
      state.pdf = pdf;
      state.numPages = pdf.numPages;
      post({ type: 'doc-loaded', numPages: pdf.numPages });
      showPage(1);
    })
    .catch(function (err) {
      if (openSettled) return;
      openSettled = true;
      clearTimeout(openTimeoutId);
      byId('loadingLabel').textContent = 'Could not open this document.';
      post({ type: 'doc-error', message: (err && err.message) || 'Unknown error' });
    });
</script>
</body>
</html>`;
}
