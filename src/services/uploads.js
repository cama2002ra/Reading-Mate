// Cloudflare Worker + Backblaze B2 uploads for session media (photos and
// documents).
//
// Why this exists (see README's "File uploads" setup section): a
// Firestore document is capped at 1 MiB total, so an uploaded photo can't
// be inlined as base64 directly in a session's `messages` array once a
// session can gain new photos (or documents) throughout its life, not
// just at creation — see SessionScreen.js's mid-session upload. Only the
// download URL and storage path are written to Firestore, as
// { url, storagePath, mimeType }.
//
// Also covers PDF/document uploads ("Choose file" in NewSessionScreen.js /
// SessionScreen.js) — same mechanics as a photo, just a different file
// extension and a size ceiling generous enough for a real document. A
// plain .txt/.md file never reaches this module at all: it's read locally
// and sent through simplifyText() like pasted text (see
// NewSessionScreen.js), since there's no bytes worth uploading for
// something that's already just a string.
//
// ---------------------------------------------------------------------------
// WHY BACKBLAZE B2 + A CLOUDFLARE WORKER, NOT FIREBASE STORAGE
// ---------------------------------------------------------------------------
// Firebase Storage filled this role originally. As of Feb 2026, Google
// requires the paid Blaze plan to provision or use any Storage bucket at
// all, which this project deliberately avoids. Cloudflare R2 was
// considered next, but activating R2 specifically requires a credit card
// on file even to stay within its free tier — also ruled out. Backblaze B2
// has a genuinely card-free free tier (10 GB, no card, ever) but only if
// the bucket stays *private*; B2 asks for a card specifically to enable a
// *public* bucket. A private B2 bucket has no concept of "let this
// Firebase-authenticated user touch only their own files" on its own
// (unlike storage.rules), so a small Cloudflare Worker (see worker/src
// /index.js) sits in front of it: it verifies the caller's Firebase ID
// token, scopes every read/write/delete to that uid's own path prefix,
// and is the only thing holding the actual B2 credentials — the same
// threat model storage.rules used to cover, enforced in the Worker
// instead of a rules file.
//
// ---------------------------------------------------------------------------
// WHY THIS TALKS TO THE WORKER WITH RAW BYTES OR A FILE-URI FORMDATA PART,
// NEVER A BLOB
// ---------------------------------------------------------------------------
// React Native >= 0.74 (this app is on 0.86.2) throws on
// `new Blob([arrayBuffer])` — confirmed by pulling the actual installed
// react-native@0.86.2 source (Libraries/Blob/BlobManager.js): Meta removed
// that path on purpose, no flag to restore it. This is why the Firebase
// Storage SDK never worked here in the first place (it builds a Blob
// internally regardless of input shape) — and it's exactly as true
// talking to our own Worker as it was talking to Firebase, so the fix
// carries over unchanged: send the file's bytes as a raw
// Uint8Array/ArrayBuffer directly as an XMLHttpRequest body, never
// wrapped in `new Blob(...)`. React Native's own networking layer
// (Libraries/Network/convertRequestBody.js) has a dedicated, fully
// supported path for exactly this — an ArrayBufferView body gets
// base64-encoded on the JS side and handed to the native module as
// `{ base64: ... }`, decoded back to real bytes natively before it ever
// hits the wire. That path never touches BlobManager at all.
//
// uploadSessionMedia below has a *second*, newer body type alongside that
// one: a FormData containing a `{ uri, name, type }` file part, used
// whenever the caller passes `fileUri` instead of `base64` (see that
// function's comment). This also never touches BlobManager — RN composes
// that kind of FormData part into the multipart body natively, reading
// the file straight off disk/ContentResolver itself — so it's exempt from
// the same restriction for a different reason than the raw-bytes path is.
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { auth } from './firebase';

// Fill this in after deploying the Worker (see README's "File uploads"
// setup section) — the *.workers.dev URL wrangler prints after
// `npx wrangler deploy`, or your own custom domain if you set one up. No
// trailing slash.
//
// Exported (not just module-local) so PdfReader.js can set the WebView's
// `baseUrl` to this same origin — see that file for why.
export const WORKER_BASE_URL = 'https://reading-mate-uploads.readingmate.workers.dev';

// expo-image-picker (and, below, our own document-reading helpers) hand
// back data as a base64 string. This decodes that into a real Uint8Array
// — deliberately NOT via a `Blob` (see the top comment for why), and
// deliberately NOT via a global `atob()` either: Hermes only picked up
// atob/btoa fairly recently (facebook/hermes#1178) and this avoids caring
// whether the Expo Go build a given device is running already has it.
// It's a plain, dependency-free base64 decoder — nothing exotic, just
// enough to turn "the bytes of a photo or PDF" into something an XHR can
// send as-is.
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    lookup[BASE64_CHARS.charCodeAt(i)] = i;
  }
  return lookup;
})();

function base64ToUint8Array(base64) {
  // Strips whitespace/newlines a picker or FileReader result might carry,
  // then counts trailing '=' padding separately so the byte-length math
  // below comes out exact instead of over-allocating.
  const clean = base64.replace(/\s/g, '');
  const padLength = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const withoutPad = padLength ? clean.slice(0, -padLength) : clean;

  const byteLength = Math.floor((withoutPad.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  for (let i = 0; i < withoutPad.length; i += 4) {
    const c0 = BASE64_LOOKUP[withoutPad.charCodeAt(i)];
    const c1 = BASE64_LOOKUP[withoutPad.charCodeAt(i + 1)];
    const c2 = i + 2 < withoutPad.length ? BASE64_LOOKUP[withoutPad.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < withoutPad.length ? BASE64_LOOKUP[withoutPad.charCodeAt(i + 3)] : 0;

    if (byteIndex < byteLength) bytes[byteIndex++] = (c0 << 2) | (c1 >> 4);
    if (byteIndex < byteLength) bytes[byteIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (byteIndex < byteLength) bytes[byteIndex++] = ((c2 & 0x03) << 6) | c3;
  }

  return bytes;
}

// Reads a picked document (SessionScreen.js's attachFile / NewSessionScreen
// .js's startFromFile) as base64 — used instead of expo-file-system's
// `File` class (native-only, and even then can fail with
// ERR_INVALID_PERMISSION on a content:// URI from expo-document-picker's
// cache copy, since that URI isn't automatically grantable to the File
// API's own permission model).
//
// Native and web genuinely need different implementations here — this
// isn't a style choice, it's two independently-confirmed on-device bugs:
//   - Native: the obvious cross-platform choice, fetch(uri).then(r =>
//     r.blob()) then FileReader.readAsDataURL(), crashes on-device. This
//     is a *separate* bug from the Blob-construction restriction
//     described in uploadSessionMedia below — it reproduces even though
//     nothing here calls `new Blob([...])` directly; it's an
//     RN Blob/FileReader-adjacent bug. expo-file-system/legacy's
//     readAsStringAsync(uri, { encoding: 'base64' }) is confirmed fine on
//     the same devices, and the /legacy subpath is real, exported, and
//     "Included in Expo Go" per Expo's SDK 57 docs.
//   - Web: there's no expo-file-system at all on web (`new File(uri)`
//     throws "this.validatePath is not a function" the moment it's
//     called), so the fetch+Blob+FileReader path is kept there —
//     confirmed fine on the web preview.
//
// CONFIRMED-BROKEN UPDATE (Android, Expo Go, SDK 57): even with
// `copyToCacheDirectory: true` set on the picker call (NewSessionScreen
// .js's startFromFile), readAsStringAsync can still throw ERR_UNEXPECTED
// / "Location ... isn't readable" on the very next line, for a `file://`
// URI already inside the app's own cache dir. This is a long-standing,
// intermittent Expo Go race (github.com/expo/expo/issues/21792 is the
// same symptom on SDK 48; still reproduces on 57) — the picker's promise
// resolves a beat before the native cache-copy is actually flushed and
// visible to *other* native modules, so the very first read attempt can
// lose that race. There's no event to await instead (the picker API
// doesn't expose "copy finished"), so this retries the read itself a
// handful of times with a short backoff instead. Not verified yet against
// the actual device from the bug report (no device on hand here) — if it
// turns out this specific IOException isn't transient after all, the
// retries will just exhaust and surface the same error a beat later, so
// this is safe to ship and check against the real device next. NOT a fix
// for a genuinely unreadable file (wrong permissions, provider revoked
// access); those keep failing the same way on every attempt and still
// surface as an error once the retries are exhausted.
async function readFileWithRetry(readOnce, { attempts = 4, delayMs = 250 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await readOnce();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export async function readPickedFileAsBase64(uri) {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read that file.'));
      reader.onload = () => {
        // readAsDataURL yields "data:<mime>;base64,<data>" — only the part
        // after the comma is the base64 payload gemini.js /
        // uploadSessionMedia below actually want.
        const dataUrl = String(reader.result);
        const commaIndex = dataUrl.indexOf(',');
        resolve(commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1));
      };
      reader.readAsDataURL(blob);
    });
  }
  return readFileWithRetry(() => FileSystem.readAsStringAsync(uri, { encoding: 'base64' }));
}

// Same fetch()-based read as before for the .txt/.md branch, now wrapped
// in the same retry as the base64 path above — a freshly-copied
// DocumentPicker cache file is just as liable to lose the same race
// whether it's read via expo-file-system or via fetch(), and the retry is
// free insurance either way.
export async function readPickedFileAsText(uri) {
  return readFileWithRetry(async () => {
    const response = await fetch(uri);
    return response.text();
  });
}

// Every message that gets attached to a session (photo, document, or
// otherwise) is stamped with one of these, so it has a stable id to build
// its storage path from before it's ever written to Firestore. Not a
// cryptographically strong id — just needs to not collide within one
// session, which timestamp + a random suffix comfortably covers.
export function generateMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// A generous ceiling shared by photos and documents alike — keeping an
// upload and the Gemini call after it reasonably fast and inexpensive.
// Must match MAX_UPLOAD_BYTES in worker/src/index.js; if that number
// changes, change it in both places.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function sessionMediaPath(uid, sessionId, messageId, extension) {
  return `users/${uid}/sessions/${sessionId}/${messageId}.${extension}`;
}

export function sessionPhotoPath(uid, sessionId, messageId) {
  return sessionMediaPath(uid, sessionId, messageId, 'jpg');
}

// Percent-encodes a storage path one segment at a time, preserving the
// literal '/' between segments — the Worker decodes it the same way (see
// worker/src/index.js's pathFromPathname()). This deliberately does NOT
// reuse Firebase's old whole-string encodeURIComponent convention (which
// turns '/' into %2F): B2 filenames use a literal '/' to represent
// virtual folders, and the Worker's uid-prefix check
// (path.startsWith(`users/${uid}/`)) needs the decoded, literal-'/' form
// to work at all.
function encodePathSegments(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

// Turns a REST-call failure into a { code, message } shape, so
// friendlyUploadErrorMessage() below (and the catch blocks in
// SessionScreen.js/NewSessionScreen.js that key off err.code) keep
// working unchanged.
function restStorageError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Every write needs a fresh ID token — this is what lets the Worker's
// uid check resolve to the signed-in user at all. getIdToken() returns
// Firebase's already-cached token when it's not expired yet and silently
// refreshes it otherwise, so this is cheap to call before every upload
// rather than something to cache ourselves.
async function currentIdToken() {
  const user = auth.currentUser;
  if (!user) {
    throw restStorageError('storage/unauthorized', 'You need to be signed in to upload files.');
  }
  return user.getIdToken();
}

// Two ways to get bytes to the Worker, picked by which of `base64` /
// `fileUri` the caller passes:
//
//   - `base64`: the old path, unchanged. Decoded to a Uint8Array and sent
//     as a raw XHR body — see the top-of-file comment for why never a
//     Blob. Used whenever the caller already has the bytes in JS for
//     another reason (a photo, since expo-image-picker is called with
//     `base64: true` already; or a mid-session PDF attach, since Gemini's
//     document API needs the base64 in JS regardless of upload
//     mechanics).
//
//   - `fileUri`: NEW. Skips reading the file into JS at all — the picked
//     document's own `file://`/`content://` URI is handed straight to a
//     FormData part, exactly like RN's own file-upload docs recommend
//     (reactnative.dev/docs/network#using-formdata-objects). This is a
//     *different* code path inside RN from the base64 one: FormData's
//     `{ uri, name, type }` shorthand is composed into the multipart body
//     natively (Networking.m / NetworkingModule.java open the file
//     themselves via the OS's own file/ContentResolver APIs), never
//     touching BlobManager and never calling back into
//     expo-file-system's readAsStringAsync — so it sidesteps both the
//     Blob-construction restriction at the top of this file AND the
//     Expo Go cache-read race documented on readPickedFileAsBase64 above.
//     This is the path NewSessionScreen.js's startFromFile now uses for
//     the initial "open a PDF" flow, since nothing downstream of it needs
//     base64 in JS (reader-mode makes no Gemini call on open — see
//     that file's comment on the 'pdf' branch).
async function uploadSessionMedia({ uid, sessionId, messageId, base64, fileUri, fileName, mimeType, extension, onProgress }) {
  const storagePath = sessionMediaPath(uid, sessionId, messageId, extension);
  const idToken = await currentIdToken();
  const uploadUrl = `${WORKER_BASE_URL}/o/${encodePathSegments(storagePath)}`;

  // Build the request body up front (before opening the XHR at all) since
  // the web branch below needs an await.
  let body;
  const usingFormData = !!fileUri;
  if (usingFormData) {
    const formData = new FormData();
    formData.append('type', mimeType);
    if (Platform.OS === 'web') {
      // The `{ uri, name, type }` FormData shorthand below is a
      // React-Native-native-bridge-only convention (Networking.m /
      // NetworkingModule.java specifically know how to expand it into a
      // multipart file part) — on web, FormData is just the browser's own
      // implementation, which only accepts a real Blob/File as a value.
      // Handing it that plain object instead silently stringifies to
      // "[object Object]", which is exactly why the Worker started
      // rejecting this as "no file" (400) the moment this ran on web.
      // `fileUri` here is a blob: URL from expo-document-picker's web
      // implementation, which — unlike the on-device fetch+Blob bug noted
      // on readPickedFileAsBase64 above (a React Native bridge bug, not a
      // web one) — is perfectly safe to fetch() on web: it's a real
      // browser Blob, no RN bridge involved at all.
      const blob = await (await fetch(fileUri)).blob();
      formData.append('file', blob, fileName || `upload.${extension}`);
    } else {
      formData.append('file', { uri: fileUri, name: fileName || `upload.${extension}`, type: mimeType });
    }
    body = formData;
  } else {
    body = base64ToUint8Array(base64);
  }

  // XMLHttpRequest instead of fetch() specifically for
  // xhr.upload.onprogress — fetch() has no equivalent hook for upload (as
  // opposed to download) progress on React Native. Works the same way for
  // both body types below.
  const responseJson = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

    xhr.upload.onprogress = (event) => {
      // As before, a file small enough to fit in one request may never
      // report a meaningful midpoint — NewSessionScreen.js/
      // SessionScreen.js's progress text already tolerates that.
      if (onProgress && event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (parseErr) {
          reject(restStorageError('storage/unknown', 'Upload succeeded but the response could not be read.'));
        }
      } else if (xhr.status === 401 || xhr.status === 403) {
        // The Worker rejected this (wrong uid, invalid/expired token).
        reject(restStorageError('storage/unauthorized', `Upload rejected (${xhr.status}).`));
      } else if (xhr.status === 413 || xhr.status === 415) {
        // Too large, or wrong content type.
        reject(restStorageError('storage/unauthorized', `Upload rejected (${xhr.status}).`));
      } else {
        reject(restStorageError('storage/unknown', `Upload failed with status ${xhr.status}.`));
      }
    };
    xhr.onerror = () => reject(restStorageError('storage/retry-limit-exceeded', 'Network error during upload.'));
    xhr.onabort = () => reject(restStorageError('storage/canceled', 'Upload canceled.'));

    // Deliberately NOT setting a Content-Type header for the FormData
    // case — the moment the body is a FormData, the networking layer
    // (RN's native bridge, or the browser on web) sets
    // `multipart/form-data; boundary=...` itself, and overriding it would
    // just supply the wrong boundary. The Worker (see
    // worker/src/index.js's handleUpload) reads the real mime type back
    // out of the 'type' field above instead.
    if (!usingFormData) {
      xhr.setRequestHeader('Content-Type', mimeType);
    }
    xhr.send(body);
  });

  // The Worker returns { downloadToken } on success — a permanent,
  // unguessable token for this exact path, playing the same role
  // Firebase Storage's own downloadTokens metadata used to. Building the
  // final URL here, once, means every consumer (ChatBubble.js's <Image>,
  // PdfReader.js's WebView) keeps reading message.content.url as a plain,
  // already-authorized URL — nothing outside this file needs to know a
  // token exists at all.
  const url = `${WORKER_BASE_URL}/download/${encodePathSegments(storagePath)}?token=${responseJson.downloadToken}`;

  return { url, storagePath, mimeType };
}

// Uploads one photo for a session. `onProgress` (optional) is called with
// a 0-1 fraction as the upload proceeds, for a visible progress indicator
// instead of a silent wait. Resolves to { url, storagePath, mimeType } —
// the exact shape stored on the message going forward (see firestore.js /
// gemini.js / ChatBubble.js).
export async function uploadSessionPhoto({ uid, sessionId, messageId, base64, mimeType, onProgress }) {
  return uploadSessionMedia({ uid, sessionId, messageId, base64, mimeType, extension: 'jpg', onProgress });
}

// Same as uploadSessionPhoto, for an uploaded document (PDF). `extension`
// defaults to 'pdf' since that's the only document type
// simplifyFromDocument() in gemini.js currently reads — see
// NewSessionScreen.js's classifyPickedFile(). Pass either `base64` (when
// the caller already needs the bytes in JS, e.g. for a Gemini call) or
// `fileUri` + `fileName` (when it doesn't — see uploadSessionMedia above
// for why the latter is preferred whenever it's an option).
export async function uploadSessionDocument({
  uid,
  sessionId,
  messageId,
  base64,
  fileUri,
  fileName,
  mimeType,
  extension,
  onProgress,
}) {
  return uploadSessionMedia({
    uid,
    sessionId,
    messageId,
    base64,
    fileUri,
    fileName,
    mimeType,
    extension: extension || 'pdf',
    onProgress,
  });
}

// Not currently called anywhere (deleting a session doesn't yet clean up
// its uploaded files — a known gap, same spirit as the README's other
// "Known gaps" notes) but kept here as the one place that would do it, so
// that follow-up is a one-line call to this function, not a new call
// written from scratch.
export async function deleteSessionMedia(storagePath) {
  if (!storagePath) return;
  try {
    const idToken = await currentIdToken();
    await fetch(`${WORKER_BASE_URL}/o/${encodePathSegments(storagePath)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    // Best-effort, same as the previous version.
  }
}

// Turns an upload error into the kind of specific, visible message the
// rest of the app already shows for Gemini errors (see GeminiError usage
// in NewSessionScreen.js / SessionScreen.js) — no silent failures.
export function friendlyUploadErrorMessage(err) {
  const code = err?.code || '';
  if (code === 'storage/unauthorized') {
    return "Couldn't upload that — it may be too large, or of the wrong type.";
  }
  if (code === 'storage/canceled') {
    return 'Upload canceled.';
  }
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/unknown') {
    return "Couldn't reach the file server — check your internet connection and try again.";
  }
  return 'Could not upload that. Try again.';
}
