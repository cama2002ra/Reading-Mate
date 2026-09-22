// A simplified SM-2 (the classic Anki/SuperMemo spaced-repetition
// algorithm) for the vocabulary review feature — see §5 item 5 of the
// PDF-Native Reader Pivot plan: "give it a due date... instead of the flat
// wordsLearned array."
//
// Migration decision (the plan explicitly asks for one, "either is fine,
// just pick one and note it in the commit"): existing progress.wordsLearned
// entries are left exactly as they are — still a flat array, still shown
// on the Progress screen as "words you've learned" the same way they
// always have been. The new schedule below is a SEPARATE field
// (progress.vocabSchedule, see firestore.js's recordWordLearned) that only
// starts getting entries from new lookups going forward. Simplest
// possible migration (none at all) at the cost of old words not being
// reviewable until looked up again — reasonable given a re-lookup costs
// nothing and old entries have no definition/context stored to seed a
// flashcard with anyway.
//
// Three-button grading (Again / Good / Easy) rather than SM-2's original
// 0-5 quality scale — simpler UI, same adaptive shape: an interval that
// grows geometrically on success and resets on failure.

export const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// A brand-new vocabulary entry, due for its first review tomorrow.
// `word` should already be normalized (trim + lowercase — see firestore.js).
export function createVocabEntry({ word, definition, now = Date.now() }) {
  return {
    word,
    definition: definition || '',
    ease: INITIAL_EASE,
    intervalDays: 1,
    reps: 0,
    createdAt: now,
    lastReviewedAt: null,
    dueAt: now + ONE_DAY_MS,
  };
}

// Returns a NEW entry object (never mutates `entry`) reflecting one review
// with the given grade. `now` is injectable for testability; callers
// should otherwise just omit it.
export function scheduleNextReview(entry, grade, now = Date.now()) {
  const ease = entry.ease || INITIAL_EASE;
  const reps = entry.reps || 0;

  if (grade === 'again') {
    return {
      ...entry,
      ease: Math.max(MIN_EASE, ease - 0.2),
      reps: 0,
      intervalDays: 1,
      lastReviewedAt: now,
      dueAt: now + ONE_DAY_MS,
    };
  }

  const isEasy = grade === 'easy';
  let intervalDays;
  if (reps === 0) intervalDays = isEasy ? 4 : 1;
  else if (reps === 1) intervalDays = isEasy ? 8 : 6;
  else intervalDays = Math.round((entry.intervalDays || 1) * ease * (isEasy ? 1.3 : 1));

  return {
    ...entry,
    ease: isEasy ? ease + 0.15 : ease,
    reps: reps + 1,
    intervalDays,
    lastReviewedAt: now,
    dueAt: now + intervalDays * ONE_DAY_MS,
  };
}

// Words due for review right now, soonest-due first — what the Progress
// screen's "Due for review" section (see VocabReviewModal.js) reads from.
export function dueVocabWords(vocabSchedule, now = Date.now()) {
  return Object.values(vocabSchedule || {})
    .filter((entry) => entry.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
}
