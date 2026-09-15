// Reading levels, shared across NewSessionScreen (the level picker) and the
// adaptive "try a harder level?" suggestion in services/firestore.js's
// progress tracking. Keeping this in one place (instead of copy-pasted,
// like it was inline in Milestone 1's ReadScreen) means the level picker
// and the level-up logic can never quietly drift apart.

export const LEVELS = [
  { key: 'a 7-year-old beginner reader', label: 'Beginner' },
  { key: 'a 10-year-old reader', label: 'Intermediate' },
  { key: 'a 13-year-old reader', label: 'Advanced' },
];

// Returns the next-harder level object, or null if `currentKey` is already
// the hardest level (or not recognized).
export function nextLevel(currentKey) {
  const index = LEVELS.findIndex((level) => level.key === currentKey);
  if (index === -1 || index === LEVELS.length - 1) return null;
  return LEVELS[index + 1];
}

export function levelLabel(key) {
  return LEVELS.find((level) => level.key === key)?.label || key;
}
