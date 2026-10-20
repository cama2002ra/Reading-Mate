// Firebase JS SDK (modular, v12+) — the pure-JS `firebase` npm package, NOT
// `@react-native-firebase/*`. React Native Firebase wraps native iOS/Android
// SDKs and requires a custom dev client (`expo prebuild`); it cannot run
// inside plain Expo Go. The JS SDK is pure JavaScript, so it works in Expo
// Go and the web preview with zero native config. See:
// https://docs.expo.dev/guides/using-firebase/ (confirms `firebase@12.0.0+`
// is the version Expo SDK 57 supports — older majors hit ES module
// resolution errors).
//
// ---------------------------------------------------------------------------
// SETUP (one-time, needs your own Google account — this is the one step an
// AI agent can't do on your behalf):
//
//   1. Go to https://console.firebase.google.com -> "Add project" (the free
//      Spark plan is all this app needs).
//   2. Build > Authentication > Get started > enable the "Email/Password"
//      sign-in provider (leave email link/verification off).
//   3. Build > Firestore Database > Create database (any region is fine;
//      start in "production mode" — the rules in firestore.rules at the
//      project root lock it down to each signed-in user).
//   4. In the Firestore console, open the Rules tab, paste in the contents
//      of firestore.rules, and click Publish.
//   5. Project settings (gear icon, top left) > General > "Your apps" >
//      Add app > Web (the </> icon). Register it (nickname doesn't matter,
//      skip Firebase Hosting). Firebase will show you a `firebaseConfig`
//      object — copy it and paste it in below, replacing the placeholder.
// ---------------------------------------------------------------------------

import { Platform } from 'react-native';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Filled in with the "test-94684" Firebase project's config (from Project
// settings > General > Your apps > web app).
//
// Deliberately missing `measurementId`, and `firebase/analytics` is never
// imported here, even though the Firebase console's copy-paste snippet
// includes both: `getAnalytics()` reaches for browser-only globals
// (`window`, IndexedDB) to talk to Google Analytics, which don't exist in
// Expo Go or the React Native runtime — importing it would crash the app
// on first launch on a phone. It's fine (and unused) on the web preview,
// but not worth a platform-specific code path for a feature this project
// doesn't otherwise use.
const firebaseConfig = {
  apiKey: 'AIzaSyCqi_ILtEMEabwb295DpA0vrN5lbW465L8',
  authDomain: 'test-94684.firebaseapp.com',
  projectId: 'test-94684',
  storageBucket: 'test-94684.firebasestorage.app',
  messagingSenderId: '982669307877',
  appId: '1:982669307877:web:543ca5d3f9d582cbdd490c',
};

// getApps()/getApp() guard against "Firebase app already initialized"
// errors when Fast Refresh re-runs this module during development.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Auth persistence: on native (Expo Go), wire up AsyncStorage so a signed-in
// session survives an app restart — this is the exact import path Firebase
// currently documents (it has moved across SDK versions before, so this was
// double-checked against the current Firebase JS SDK release notes rather
// than assumed). On web, getReactNativePersistence isn't the right
// persistence layer, so plain getAuth() (browser persistence) is used
// there instead.
//
// The try/catch guards the same Fast Refresh re-initialization issue as
// above — initializeAuth() throws if called twice for the same app.
export let auth;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch (err) {
    auth = getAuth(app);
  }
}

// Firestore's default network transport (a streaming WebChannel connection)
// doesn't always play well with React Native's networking stack on every
// device/carrier — a known long-running rough edge, not specific to this
// app. experimentalAutoDetectLongPolling makes the SDK fall back to
// long-polling automatically only where streaming actually fails, instead
// of forcing the slower transport everywhere.
//
// The try/catch guards Fast Refresh re-initialization during development,
// falling back to getFirestore() if already started.
export let db;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch (err) {
  db = getFirestore(app);
}

export default app;

