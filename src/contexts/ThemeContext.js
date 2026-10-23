// Reading Mate's dark theme ("reading lamp at night") has been the whole
// visual identity since Milestone 1. This adds a light counterpart and a
// three-way preference — System / Light / Dark — synced the same way
// everything else in this app already is: instantly from AsyncStorage on
// this device, then reconciled with the signed-in user's Firestore
// profile, exactly like the Gemini key in AuthContext.js.
//
// Also exposes `readingFontSize` (small/medium/large — see §2's reading
// comfort controls in SessionScreen.js / ReadingPane.js), a separate
// preference synced the exact same way as themeMode, since it's the same
// kind of "how the app looks to me" account setting.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fonts, spacing, radius, palettes, getShadow, readingFontSizes, READING_FONT_SIZE_STEPS } from '../theme';
import { useAuth } from './AuthContext';
import { subscribeToUserProfile, updateThemePreference, updateReadingFontSizePreference } from '../services/firestore';

const STORAGE_KEY = 'readingMate.themeMode'; // 'system' | 'light' | 'dark'
const VALID_MODES = ['system', 'light', 'dark'];

const FONT_SIZE_STORAGE_KEY = 'readingMate.readingFontSize'; // 'small' | 'medium' | 'large'
const VALID_FONT_SIZES = READING_FONT_SIZE_STEPS;

const SPEECH_RATE_STORAGE_KEY = 'readingMate.speechRate';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [mode, setMode] = useState('system'); // the stored *preference*
  const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme() || 'dark');
  const [readingFontSize, setReadingFontSizeState] = useState('medium');
  const [speechRate, setSpeechRateState] = useState(0.9);
  const [ready, setReady] = useState(false);
  // Whether `mode` has already been reconciled with this signed-in user's
  // Firestore doc — guards against a later, unrelated profile write (e.g.
  // saving the Gemini key) re-triggering the sync effect and clobbering a
  // choice the person just made on this device back to an older synced value.
  const appliedRemote = useRef(false);
  const appliedRemoteFontSize = useRef(false);

  // Read the last-used preference immediately, before any network round
  // trip, so there's no flash of the wrong theme on launch.
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(FONT_SIZE_STORAGE_KEY),
      AsyncStorage.getItem(SPEECH_RATE_STORAGE_KEY),
    ])
      .then(([savedMode, savedFontSize, savedRate]) => {
        if (VALID_MODES.includes(savedMode)) setMode(savedMode);
        if (VALID_FONT_SIZES.includes(savedFontSize)) setReadingFontSizeState(savedFontSize);
        if (savedRate && !isNaN(Number(savedRate))) setSpeechRateState(Number(savedRate));
      })
      .finally(() => setReady(true));
  }, []);


  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme || 'dark');
    });
    return () => sub.remove();
  }, []);

  // Once signed in, the account's synced preference is the source of
  // truth for the first snapshot only — after that, this device's own
  // choices (via setThemeMode) take over, the same "last write wins,
  // but don't fight the user" approach the rest of the app takes.
  useEffect(() => {
    if (!user) {
      appliedRemote.current = false;
      appliedRemoteFontSize.current = false;
      return undefined;
    }
    const unsubscribe = subscribeToUserProfile(user.uid, (profile) => {
      if (!appliedRemote.current && profile?.themeMode && VALID_MODES.includes(profile.themeMode)) {
        appliedRemote.current = true;
        setMode(profile.themeMode);
        AsyncStorage.setItem(STORAGE_KEY, profile.themeMode).catch(() => {});
      }
      if (
        !appliedRemoteFontSize.current &&
        profile?.readingFontSize &&
        VALID_FONT_SIZES.includes(profile.readingFontSize)
      ) {
        appliedRemoteFontSize.current = true;
        setReadingFontSizeState(profile.readingFontSize);
        AsyncStorage.setItem(FONT_SIZE_STORAGE_KEY, profile.readingFontSize).catch(() => {});
      }
    });
    return unsubscribe;
  }, [user]);

  const setThemeMode = (nextMode) => {
    if (!VALID_MODES.includes(nextMode) || nextMode === mode) return;
    appliedRemote.current = true; // this device's choice now wins over any later profile snapshot
    setMode(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode).catch(() => {});
    if (user) updateThemePreference(user.uid, nextMode).catch(() => {});
  };

  const setReadingFontSize = (nextSize) => {
    if (!VALID_FONT_SIZES.includes(nextSize) || nextSize === readingFontSize) return;
    appliedRemoteFontSize.current = true;
    setReadingFontSizeState(nextSize);
    AsyncStorage.setItem(FONT_SIZE_STORAGE_KEY, nextSize).catch(() => {});
    if (user) updateReadingFontSizePreference(user.uid, nextSize).catch(() => {});
  };

  const setSpeechRate = (nextRate) => {
    const rateNum = Number(nextRate) || 0.9;
    setSpeechRateState(rateNum);
    AsyncStorage.setItem(SPEECH_RATE_STORAGE_KEY, String(rateNum)).catch(() => {});
  };

  const resolvedMode = mode === 'system' ? systemScheme : mode; // 'light' | 'dark' — what's actually shown
  const colors = palettes[resolvedMode] || palettes.dark;

  const value = useMemo(
    () => ({
      mode, // the user's stored preference: 'system' | 'light' | 'dark'
      resolvedMode, // what's actually on screen right now
      colors,
      fonts,
      spacing,
      radius,
      shadow: getShadow(resolvedMode),
      setThemeMode,
      readingFontSize, // 'small' | 'medium' | 'large'
      readingFontStyle: readingFontSizes[readingFontSize] || readingFontSizes.medium, // { fontSize, lineHeight }
      setReadingFontSize,
      speechRate,
      setSpeechRate,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, resolvedMode, colors, readingFontSize, speechRate]
  );


  // A few milliseconds of nothing while AsyncStorage resolves beats a
  // flash of the wrong theme followed by a swap.
  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
