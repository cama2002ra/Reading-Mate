// All Firestore reads/writes for Reading Mate live here.
//
// Data model:
//   users/{uid}                        { geminiApiKey, themeMode, readingFontSize, createdAt }
//   users/{uid}/sessions/{sessionId}   { title, level, createdAt, updatedAt,
//                                         mode: 'reader' | absent (== 'chat'),
//                                         sourceFile: { storagePath, name, mimeType, pageCount } | absent,
//                                         messages: [{ role, type, content, timestamp }] }
//     - type 'image' and type 'file' messages carry { url, storagePath,
//       mimeType } going forward (see services/uploads.js) — a photo or
//       PDF's bytes live in Firebase Storage, not inline in this document,
//       since a single Firestore document is capped at 1 MiB and a session
//       can now gain photos/files throughout its life, not just at
//       creation. Older recorded sessions may still have the pre-Storage
//       image { base64, mimeType } shape; rendering code (ChatBubble.js)
//       supports both.
//     - type 'selection' messages (PDF reader pivot, §6) carry
//       { selectionText, pageIndex, action, customInstruction } — a
//       request logged from the WebView reader's selection-action menu.
//       `mode` and `sourceFile` are only ever written for reader-mode
//       sessions (see createSession() below) — every session created
//       before this pivot, and every non-PDF session created after it,
//       simply has neither field, which is read everywhere as "mode:
//       'chat'" (no migration needed, matches §6 exactly).
//   users/{uid}/progress/summary       { streak, passagesRead, lastReadDate,
//                                         wordsLearned: string[],
//                                         vocabSchedule: { [word]: VocabEntry },
//                                         recentQuizScores: [{ level, score, timestamp }] }
//     - VocabEntry (see services/spacedRepetition.js) is the SM-2-lite
//       schedule for one word: { word, definition, ease, intervalDays,
//       reps, createdAt, lastReviewedAt, dueAt }. Deliberately a SEPARATE
//       field from wordsLearned, not a replacement — see the migration
//       note in spacedRepetition.js's header comment.
//   users/{uid}/bookmarks/{bookmarkId} { sessionId, sessionTitle, text, timestamp,
//                                         messageIndex? | pageIndex? }
//     - Exactly one of messageIndex/pageIndex is set. messageIndex bookmarks
//       a turn in a 'chat'-mode session (or a selection-action reply in a
//       reader-mode one — those live in `messages` same as any other
//       turn); pageIndex bookmarks a PDF page itself, which isn't a
//       message at all (§5 build-order item 4, "bookmarks parity").
//
// Note on recentQuizScores: the build brief sketches this as a flat
// number[], but the adaptive level-up suggestion needs "the last 3 scores
// *at the current level*" — which isn't answerable from bare numbers once a
// student has quizzes at more than one level. Storing {level, score,
// timestamp} objects keeps that logic correct; it's a small refinement of
// the sketch, not a different feature.
//
// Security: every path here is scoped per-user by firestore.rules (project
// root) — request.auth.uid must match the {uid} segment for any read or
// write, so cross-account access is rejected before it reaches this code.
// Uploaded photos/PDFs are scoped the same way by the Cloudflare Worker in
// worker/ (see its src/index.js) rather than a Firebase rules file.
// firestore.rules didn't need changes for the PDF reader pivot — it
// already scopes everything under users/{uid}/**, which covers the new
// fields/message type/bookmark shape without any new rule.

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';
import { createVocabEntry, scheduleNextReview } from './spacedRepetition';

// ---------- User profile (Gemini API key) ----------

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

const EMPTY_PROGRESS = {
  streak: 0,
  passagesRead: 0,
  lastReadDate: null,
  wordsLearned: [],
  vocabSchedule: {},
  recentQuizScores: [],
};

function progressDocRef(uid) {
  return doc(db, 'users', uid, 'progress', 'summary');
}

// Call once, right after sign-up: seeds the user's profile doc and an
// empty progress doc so every later read can assume both exist.
export async function initializeUserData(uid) {
  await setDoc(userDocRef(uid), {
    geminiApiKey: '',
    themeMode: 'system',
    readingFontSize: 'medium',
    createdAt: serverTimestamp(),
  });
  await setDoc(progressDocRef(uid), { ...EMPTY_PROGRESS });
}

export function subscribeToUserProfile(uid, callback) {
  return onSnapshot(userDocRef(uid), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

export async function updateApiKey(uid, key) {
  await setDoc(userDocRef(uid), { geminiApiKey: key.trim() }, { merge: true });
}

// 'system' | 'light' | 'dark' — see ThemeContext.js, which is what actually
// calls this. Synced the same way the Gemini key is: this account's
// setting follows the person to their other devices.
export async function updateThemePreference(uid, themeMode) {
  await setDoc(userDocRef(uid), { themeMode }, { merge: true });
}

// 'small' | 'medium' | 'large' — see ThemeContext.js. A reading-comfort
// preference, not a UI theme, but synced identically: this account's
// chosen passage text size follows the person to their other devices.
export async function updateReadingFontSizePreference(uid, readingFontSize) {
  await setDoc(userDocRef(uid), { readingFontSize }, { merge: true });
}

// ---------- Reading progress ----------

export function subscribeToProgress(uid, callback) {
  return onSnapshot(progressDocRef(uid), (snap) => {
    callback(snap.exists() ? { ...EMPTY_PROGRESS, ...snap.data() } : { ...EMPTY_PROGRESS });
  });
}

export async function getProgress(uid) {
  const snap = await getDoc(progressDocRef(uid));
  return snap.exists() ? { ...EMPTY_PROGRESS, ...snap.data() } : { ...EMPTY_PROGRESS };
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function isYesterday(dateString) {
  if (!dateString) return false;
  const diffMs = new Date(todayString()).getTime() - new Date(dateString).getTime();
  return Math.round(diffMs / 86400000) === 1;
}

// Call once per passage completed (a new session's first simplify call).
export async function recordPassageRead(uid) {
  const progress = await getProgress(uid);
  const today = todayString();
  const next = { ...progress };

  if (progress.lastReadDate === today) {
    next.passagesRead += 1;
  } else if (isYesterday(progress.lastReadDate)) {
    next.streak += 1;
    next.passagesRead += 1;
    next.lastReadDate = today;
  } else {
    next.streak = 1;
    next.passagesRead += 1;
    next.lastReadDate = today;
  }

  await setDoc(progressDocRef(uid), next);
  return next;
}

// `definition` is optional and only used to seed a new vocab-schedule
// entry (see spacedRepetition.js) — existing callers that don't pass one
// still work exactly as before, just without a flashcard-ready definition
// stored for later review.
//
// wordsLearned keeps recording every "Got it!" tap the same way it always
// has (§5's migration decision: this array is left alone, not replaced —
// see spacedRepetition.js's header comment). vocabSchedule only gets a
// *new* entry the first time a word is learned — tapping "Got it!" again
// on a word already in the schedule must not reset its due date, or
// spaced repetition never actually spaces anything out.
//
// Nested-object merge, not a dotted-string field path: setDoc(...,
// {merge:true}) recursively merges nested map fields when you pass a
// nested object (see Firestore's own "add a document with nested fields"
// samples) — { vocabSchedule: { [word]: entry } } merges in just that one
// key and leaves every other student's other scheduled words in the map
// untouched. Dotted-string keys like "vocabSchedule.word" are the
// updateDoc() idiom, not a documented setDoc()+merge one — best not to mix
// the two patterns for something this easy to get subtly wrong.
export async function recordWordLearned(uid, word, definition = '') {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return getProgress(uid);

  const progress = await getProgress(uid);
  const isNewWord = !(normalized in (progress.vocabSchedule || {}));

  const updates = { wordsLearned: arrayUnion(normalized) };
  if (isNewWord) {
    updates.vocabSchedule = { [normalized]: createVocabEntry({ word: normalized, definition }) };
  }
  await setDoc(progressDocRef(uid), updates, { merge: true });
  return getProgress(uid);
}

// One flashcard review (see VocabReviewModal.js). `grade` is
// 'again' | 'good' | 'easy' — see spacedRepetition.js's scheduleNextReview
// for what each does to the word's next due date.
export async function reviewVocabWord(uid, word, grade) {
  const normalized = word.trim().toLowerCase();
  const progress = await getProgress(uid);
  const entry = progress.vocabSchedule?.[normalized];
  if (!entry) return progress; // nothing scheduled for this word — no-op

  const updated = scheduleNextReview(entry, grade);
  await setDoc(progressDocRef(uid), { vocabSchedule: { [normalized]: updated } }, { merge: true });
  return getProgress(uid);
}

// level: one of LEVELS[].key (see constants/levels.js); score: 0-100.
export async function recordQuizScore(uid, level, score) {
  const progress = await getProgress(uid);
  const entry = { level, score, timestamp: Date.now() };
  // Keep this bounded — we only ever look at the last 3 per level.
  const trimmed = [...progress.recentQuizScores, entry].slice(-30);
  await setDoc(progressDocRef(uid), { recentQuizScores: trimmed }, { merge: true });
  return trimmed;
}

export async function resetProgress(uid) {
  await setDoc(progressDocRef(uid), { ...EMPTY_PROGRESS });
  return { ...EMPTY_PROGRESS };
}

// ---------- Sessions ----------

function sessionsCollectionRef(uid) {
  return collection(db, 'users', uid, 'sessions');
}

function sessionDocRef(uid, sessionId) {
  return doc(db, 'users', uid, 'sessions', sessionId);
}

export function subscribeToSessions(uid, callback) {
  const q = query(sessionsCollectionRef(uid), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeToSession(uid, sessionId, callback) {
  return onSnapshot(sessionDocRef(uid, sessionId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

// Generates a session id client-side, without writing anything yet. Needed
// when part of the first message — specifically, an uploaded photo's
// Firebase Storage path (users/{uid}/sessions/{sessionId}/...) — has to be
// known *before* the session document itself can be created. See
// NewSessionScreen.js and SessionScreen.js's mid-session photo upload.
export function newSessionId(uid) {
  return doc(sessionsCollectionRef(uid)).id;
}

// Creates a session and returns its id. Pass `sessionId` (from
// newSessionId() above) when the caller already had to know the id ahead
// of time; otherwise one is generated the same way. The title starts as a
// placeholder — see generateSessionTitle() in services/gemini.js, called
// right after this by the screen that starts the session.
//
// `firstMessage` is optional — omit it for a reader-mode session, which
// opens straight into the PDF with an empty message list and makes zero
// Gemini calls until the student selects something (§4.3). Every existing
// call site passes firstMessage and omits mode/sourceFile, so those
// sessions' documents come out byte-for-byte the same shape they always
// have — `mode` and `sourceFile` are only written at all when the caller
// actually passes them, matching §6's "field absent == 'chat', no
// migration needed."
export async function createSession(uid, { sessionId, level, firstMessage, mode, sourceFile }) {
  const id = sessionId || newSessionId(uid);
  const now = serverTimestamp();
  const data = {
    title: 'New reading session',
    level,
    createdAt: now,
    updatedAt: now,
    messages: firstMessage ? [firstMessage] : [],
  };
  if (mode) data.mode = mode;
  if (sourceFile) data.sourceFile = sourceFile;
  await setDoc(sessionDocRef(uid, id), data);
  return id;
}

// Reader-mode sessions don't know a PDF's page count until the WebView
// reader has actually opened it (see PdfReader.js's 'doc-loaded' message /
// SessionScreen.js) — this backfills that one field afterward rather than
// blocking session creation on it.
export async function updateSessionSourceFilePageCount(uid, sessionId, pageCount) {
  await updateDoc(sessionDocRef(uid, sessionId), { 'sourceFile.pageCount': pageCount });
}

// Appends one or more messages to a session and bumps updatedAt.
//
// IMPORTANT: message.timestamp must be a plain number (Date.now()), never
// serverTimestamp() — Firestore does not allow server-timestamp sentinel
// values inside array elements (only as a top-level or nested-map field).
// createdAt/updatedAt on the session doc itself are fine as
// serverTimestamp() since those aren't inside an array.
export async function appendMessages(uid, sessionId, messages) {
  await updateDoc(sessionDocRef(uid, sessionId), {
    messages: arrayUnion(...messages),
    updatedAt: serverTimestamp(),
  });
}

export async function updateSessionTitle(uid, sessionId, title) {
  await updateDoc(sessionDocRef(uid, sessionId), { title });
}

// Was "Next steps (optional, beyond Milestone 2)" in the README — added
// since a sessions list you can never clean up gets unwieldy fast.
// firestore.rules already covers this: the `write` grant on
// users/{uid}/{document=**} includes delete, not just create/update.
export async function deleteSession(uid, sessionId) {
  await deleteDoc(sessionDocRef(uid, sessionId));
}

// ---------- Bookmarks (§7 backlog item 1) ----------
// A small subcollection rather than an array field on each session doc —
// Progress wants to list bookmarks *across* sessions, which is awkward from
// per-session arrays but trivial from users/{uid}/bookmarks, the same shape
// as the existing users/{uid}/progress subcollection.

function bookmarksCollectionRef(uid) {
  return collection(db, 'users', uid, 'bookmarks');
}

export function subscribeToBookmarks(uid, callback) {
  const q = query(bookmarksCollectionRef(uid), orderBy('timestamp', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// `text` is a short excerpt (kept short deliberately — this is a pointer
// back to the moment, not a copy of the whole passage). Exactly one of
// messageIndex/pageIndex should be passed: messageIndex for a turn in the
// message log (unchanged from before the reader pivot), pageIndex for a
// PDF page itself in a reader-mode session, which isn't a message at all.
export async function addBookmark(uid, { sessionId, sessionTitle, text, messageIndex, pageIndex }) {
  const ref = doc(bookmarksCollectionRef(uid));
  const data = {
    sessionId,
    sessionTitle: sessionTitle || 'Reading session',
    text: (text || '').slice(0, 240),
    timestamp: Date.now(),
  };
  if (typeof messageIndex === 'number') data.messageIndex = messageIndex;
  if (typeof pageIndex === 'number') data.pageIndex = pageIndex;
  await setDoc(ref, data);
  return ref.id;
}

export async function removeBookmark(uid, bookmarkId) {
  await deleteDoc(doc(bookmarksCollectionRef(uid), bookmarkId));
}
