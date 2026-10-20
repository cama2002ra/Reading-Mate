// Milestone 1 kept the Gemini API key in AsyncStorage, on-device only.
// Milestone 2 moves the real source of truth to Firestore
// (users/{uid}.geminiApiKey — see services/firestore.js) so the key follows
// the signed-in account across devices instead of living on one phone.
// Progress tracking (streak, passages, words learned) has moved to
// Firestore too — see services/firestore.js — since it's now per-account
// rather than per-device.
//
// services/gemini.js is unchanged from Milestone 1: every AI call still
// just does `const apiKey = await getApiKey()` without knowing anything
// about accounts, Firestore, or auth state. So this file is now a tiny
// in-memory cache that AuthContext keeps in sync with the signed-in user's
// Firestore profile doc (via subscribeToUserProfile). That keeps every
// single AI call from needing its own Firestore round trip just to read
// the key.

let cachedApiKey = null;

// Called by AuthContext whenever the signed-in user's profile changes
// (sign-in, sign-out, or the key itself being edited in Settings on any
// device).
export function setApiKeyCache(key) {
  cachedApiKey = key || null;
}

export async function getApiKey() {
  return cachedApiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY || null;
}
