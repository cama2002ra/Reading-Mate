import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { buildPdfReaderHtml } from '../services/pdfReaderHtml';

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
  const iframeRef = useRef(null);

  const html = useMemo(
    () => buildPdfReaderHtml({ fileUrl, colors: readerColors(theme.colors) }),
    // Deliberately not re-keyed on theme changes beyond mount (same as native PdfReader)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileUrl]
  );

  useEffect(() => {
    const handleWindowMessage = (event) => {
      // Ensure the message originated from our iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      let msg;
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || !msg.type) return;

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
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [onDocLoaded, onDocError, onPageChanged, onSelectionAction, onScannedPage, onFullTextExtracted]);

  useImperativeHandle(ref, () => ({
    highlightAtChar(charIndex) {
      try {
        iframeRef.current?.contentWindow?.__highlightAtChar?.(charIndex);
      } catch (err) {
        console.warn('[PdfReader.web] highlightAtChar error:', err);
      }
    },
    jumpToPage(pageNumber) {
      try {
        iframeRef.current?.contentWindow?.__jumpToPage?.(Number(pageNumber) || 1);
      } catch (err) {
        console.warn('[PdfReader.web] jumpToPage error:', err);
      }
    },
    extractFullText() {
      try {
        iframeRef.current?.contentWindow?.__extractFullText?.();
      } catch (err) {
        console.warn('[PdfReader.web] extractFullText error:', err);
      }
    },
  }));

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef}
        srcDoc={html}
        title="PDF Reader"
        style={styles.iframe}
        allow="clipboard-read; clipboard-write"
      />
    </View>
  );
});

export default PdfReader;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    width: '100%',
    height: '100%',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: 'transparent',
  },
});
