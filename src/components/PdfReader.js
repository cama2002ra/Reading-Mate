// The reader-mode PDF viewer (§4.1 of the PDF-Native Reader Pivot plan).
//
// Renders a local, generated HTML page (see services/pdfReaderHtml.js) in
// a WebView, running PDF.js against the file's Firebase Storage download
// URL. That URL already carries its own access token (how
// getDownloadURL() works — see services/uploads.js), so the WebView can
// fetch the PDF's bytes directly over plain HTTPS with no Firebase Auth
// wiring needed inside the WebView's JS context.
//
// Everything about the page itself — rendering, pinch-zoom, page nav, the
// real text-selection layer, the custom action toolbar, scanned-page
// detection — lives inside the generated HTML/JS. This component's job is
// just the RN <-> WebView bridge:
//   WebView -> RN: onMessage, for page-changed / selection-action /
//                  scanned-page / doc-loaded / doc-error events.
//   RN -> WebView: imperative ref methods (highlightAtChar, jumpToPage),
//                  via injectJavaScript rather than the postMessage prop —
//                  postMessage's WebView-side listener has a well-known
//                  window/document split between iOS and Android, while
//                  injectJavaScript calling a function this HTML already
//                  defines on `window` works identically on both.
//
// SessionScreen.js owns everything above/below this component (the
// selection-action message log, the follow-up bar, bookmarks) — this
// component only knows about "the current page," never about a session's
// Firestore document.

import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../contexts/ThemeContext';
import { buildPdfReaderHtml } from '../services/pdfReaderHtml';
import { WORKER_BASE_URL } from '../services/uploads';

// Only the palette keys the generated HTML actually styles with — see
// pdfReaderHtml.js's <style> block. Kept as an explicit small subset
// (rather than passing the whole `colors` object) so it's obvious at a
// glance which theme tokens this reader depends on.
function readerColors(colors) {
  return {
    ink: colors.ink,
    paper: colors.paper,
    paperRaised: colors.paperRaised,
    border: colors.border,
    textPrimary: colors.textPrimary,
    textMuted: colors.textMuted,
    lamp: colors.lamp,
    lampSoft: colors.lampSoft,
  };
}

const PdfReader = forwardRef(function PdfReader(
  { fileUrl, onDocLoaded, onDocError, onPageChanged, onSelectionAction, onScannedPage, onFullTextExtracted },
  ref
) {
  const theme = useTheme();
  const webViewRef = useRef(null);

  const html = useMemo(
    () => buildPdfReaderHtml({ fileUrl, colors: readerColors(theme.colors) }),
    // Deliberately not re-keyed on theme changes beyond mount — reloading
    // the whole WebView (and re-fetching + re-rendering every page) just
    // because the person flipped light/dark mode mid-session would be a
    // jarring, expensive reset. The reader's colors are set once, from
    // whatever the theme was when this session was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileUrl]
  );

  const handleMessage = useCallback(
    (event) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'doc-loaded':
          onDocLoaded?.(msg.numPages);
          break;
        case 'doc-error':
          onDocError?.(msg.message);
          break;
        case 'page-changed':
          onPageChanged?.({
            pageIndex: msg.pageIndex,
            numPages: msg.numPages,
            pageText: msg.pageText,
            isScanned: msg.isScanned,
          });
          break;
        case 'selection-action':
          onSelectionAction?.({
            action: msg.action,
            selectionText: msg.selectionText,
            pageIndex: msg.pageIndex,
            pageContext: msg.pageContext,
          });
          break;
        case 'scanned-page':
          onScannedPage?.({ pageIndex: msg.pageIndex, base64: msg.base64, mimeType: msg.mimeType });
          break;
        case 'full-text-extracted':
          onFullTextExtracted?.(msg.text || '');
          break;
        default:
          break;
      }
    },
    [onDocLoaded, onDocError, onPageChanged, onSelectionAction, onScannedPage, onFullTextExtracted]
  );

  useImperativeHandle(ref, () => ({
    // Called on every expo-speech onBoundary event during page read-aloud
    // (see SessionScreen.js's toggleSpeakReader) — charIndex is an offset
    // into the exact pageText string that was handed to Speech.speak(),
    // which is the same string this WebView reported via 'page-changed',
    // so the offsets line up without any extra bookkeeping.
    highlightAtChar(charIndex) {
      const arg = charIndex == null ? 'null' : String(charIndex);
      webViewRef.current?.injectJavaScript(`window.__highlightAtChar(${arg}); true;`);
    },
    jumpToPage(pageNumber) {
      webViewRef.current?.injectJavaScript(`window.__jumpToPage(${Number(pageNumber) || 1}); true;`);
    },
    // Triggers the on-demand whole-document text walk (see
    // pdfReaderHtml.js's window.__extractFullText) — result arrives async
    // via the onFullTextExtracted callback prop, not a return value here.
    extractFullText() {
      webViewRef.current?.injectJavaScript('window.__extractFullText(); true;');
    },
  }));

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        // Pins this WebView's origin to the Worker's own origin (Android's
        // `baseUrl` doc: "used for the origin header with CORS requests
        // made from the WebView"). Without it, inline `source: {html}}`
        // content gets loaded with no real origin, and the fetch() inside
        // pdfReaderHtml.js's PDF.js boot sequence goes out as a
        // cross-origin request the WebView has to reason about instead of
        // a same-origin one — pinning it here is what makes that fetch to
        // WORKER_BASE_URL/download/... unambiguously same-origin.
        source={{ html, baseUrl: `${WORKER_BASE_URL}/` }}
        onMessage={handleMessage}
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        // The scanned-page banner and action toolbar are absolutely
        // positioned inside the page; letting the WebView itself bounce
        // would fight the pinch-zoom handled in-page.
        bounces={false}
        overScrollMode="never"
      />
    </View>
  );
});

export default PdfReader;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
});
