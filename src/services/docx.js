// Local .docx text extraction — no upload, no AI call.
//
// A .docx is a zip archive; the body text lives in word/document.xml as
// <w:p> paragraphs containing <w:r> runs of <w:t> text. Pulling that out
// is enough for a reading app (headings, tables and lists all arrive as
// paragraphs; images and styling are dropped). Pure JS via jszip, so it
// works in Expo Go with no native module.

import JSZip from 'jszip';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function docxXmlToText(xml) {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const lines = paragraphs.map((p) => {
    // Walk text, tabs and line breaks in document order.
    const parts = p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\s*\/?>|<w:cr\s*\/>/g) || [];
    return parts
      .map((part) => {
        if (part.startsWith('<w:tab')) return '\t';
        if (part.startsWith('<w:br') || part.startsWith('<w:cr')) return '\n';
        return decodeEntities(part.replace(/<[^>]+>/g, ''));
      })
      .join('')
      .trimEnd();
  });
  // Collapse runs of blank paragraphs to a single blank line.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// `data` is a base64 string (what readPickedFileAsBase64 returns).
export async function extractDocxText(base64) {
  let zip;
  try {
    zip = await JSZip.loadAsync(base64, { base64: true });
  } catch {
    throw new Error('That does not look like a valid .docx file.');
  }
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('That does not look like a valid .docx file.');
  return docxXmlToText(await entry.async('string'));
}
