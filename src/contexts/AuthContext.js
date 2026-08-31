// Wraps Firebase Auth's onAuthStateChanged so any screen can read the
// signed-in user with `useAuth()`, instead of every screen subscribing
// separately. Also bridges the signed-in user's Firestore profile doc into
// services/storage.js's tiny apiKey cache, so services/gemini.js (unchanged
// from Milestone 1) keeps working without knowing accounts exist.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import { subscribeToUserProfile } from '../services/firestore';
import { setApiKeyCache } from '../services/storage';

const AuthContext = createContext({ user: null, initializing: true, geminiApiKey: null });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [geminiApiKey, setGeminiApiKey] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setInitializing(false);
      if (!firebaseUser) {
        setGeminiApiKey(null);
        setApiKeyCache(null);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToUserProfile(user.uid, (profile) => {
      const key = profile?.geminiApiKey || null;
      setGeminiApiKey(key);
      setApiKeyCache(key);
    });
    return unsubscribe;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, initializing, geminiApiKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
