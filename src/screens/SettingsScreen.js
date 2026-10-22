import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Linking, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { signOut } from 'firebase/auth';

import ScreenContainer from '../components/ScreenContainer';
import Button from '../components/Button';
import AppearancePicker from '../components/AppearancePicker';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../services/firebase';
import { updateApiKey } from '../services/firestore';
import { verifyApiKey } from '../services/gemini';
import { confirmDestructive } from '../utils/confirm';

const KEY_URL = 'https://aistudio.google.com/apikey';

const SPEECH_RATES = [
  { rate: 0.75, label: '0.75x Slow' },
  { rate: 0.9, label: '0.9x Normal' },
  { rate: 1.1, label: '1.1x Fast' },
];

const FONT_SIZE_OPTIONS = [
  { key: 'small', label: 'Small (16pt)' },
  { key: 'medium', label: 'Medium (19pt)' },
  { key: 'large', label: 'Large (23pt)' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { colors, fonts, radius, readingFontSize, setReadingFontSize } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { user, geminiApiKey } = useAuth();
  const [input, setInput] = useState(geminiApiKey || '');
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.9);
  const [testingSpeech, setTestingSpeech] = useState(false);

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  // Keep the field in sync if the key changes from elsewhere
  useEffect(() => {
    setInput(geminiApiKey || '');
  }, [geminiApiKey]);

  const hasSavedKey = !!geminiApiKey;
  const hasEnvKey = !!process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  const aiReady = hasSavedKey || hasEnvKey;

  const handleSave = async () => {
    if (!input.trim()) {
      setStatus({ type: 'error', text: 'Paste a key first.' });
      return;
    }
    await updateApiKey(user.uid, input.trim());
    setStatus({ type: 'success', text: 'Saved to your account — synced to every device.' });
  };

  const handleTestKey = async () => {
    const keyToTest = input.trim() || geminiApiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!keyToTest) {
      setStatus({ type: 'error', text: 'Enter a key to test.' });
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      await verifyApiKey(keyToTest);
      setStatus({ type: 'success', text: 'Connection successful! Gemini API is responding.' });
    } catch (err) {
      setStatus({ type: 'error', text: err?.message || 'Could not verify API key.' });
    } finally {
      setTesting(false);
    }
  };

  const handleTestSpeech = (rateToTest = speechRate) => {
    if (testingSpeech) return;
    setTestingSpeech(true);
    Speech.speak('Reading Mate makes learning engaging and accessible.', {
      rate: rateToTest,
      onDone: () => setTestingSpeech(false),
      onError: () => setTestingSpeech(false),
    });
  };

  const handleClear = async () => {
    await updateApiKey(user.uid, '');
    setStatus({ type: 'success', text: 'Key removed.' });
  };

  const handleLogOut = () => {
    confirmDestructive({
      title: 'Log out?',
      confirmText: 'Log out',
      onConfirm: () => signOut(auth),
    });
  };

  return (
    <ScreenContainer>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={styles.heading}>Settings</Text>
        <Text style={styles.subheading}>Reading Mate personalizes your reading experience across all devices.</Text>

        {/* Appearance Preference */}
        <Text style={styles.label}>Appearance</Text>
        <AppearancePicker />
        <Text style={styles.appearanceHint}>Follows you to your other devices too.</Text>

        {/* Reading Passage Font Size */}
        <Text style={styles.label}>Reading Text Size</Text>
        <View style={styles.segmentTrack}>
          {FONT_SIZE_OPTIONS.map((opt) => {
            const active = readingFontSize === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setReadingFontSize(opt.key)}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.appearanceHint}>Controls text size in reading sessions and passage views.</Text>

        {/* Speech Read-Aloud Rate */}
        <Text style={styles.label}>Read-Aloud Voice Speed</Text>
        <View style={styles.speechRow}>
          <View style={[styles.segmentTrack, { flex: 1 }]}>
            {SPEECH_RATES.map((opt) => {
              const active = speechRate === opt.rate;
              return (
                <Pressable
                  key={opt.rate}
                  onPress={() => {
                    setSpeechRate(opt.rate);
                    handleTestSpeech(opt.rate);
                  }}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={styles.previewSpeechBtn}
            onPress={() => handleTestSpeech()}
            disabled={testingSpeech}
          >
            <Ionicons name={testingSpeech ? 'volume-high' : 'volume-medium-outline'} size={16} color={colors.lamp} />
            <Text style={styles.previewSpeechText}>{testingSpeech ? 'Playing…' : 'Preview'}</Text>
          </Pressable>
        </View>
        <Text style={styles.appearanceHint}>Audio pace when reading passages and pronunciation aloud.</Text>

        {/* Gemini API Key */}
        <Text style={styles.label}>AI Engine & API Key</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons
              name={aiReady ? 'checkmark-circle' : 'alert-circle-outline'}
              size={18}
              color={aiReady ? colors.sage : colors.textMuted}
            />
            <Text style={styles.rowText}>
              {aiReady
                ? hasSavedKey
                  ? 'AI features are active (saved key)'
                  : 'AI features are active (environment key)'
                : 'AI features are off — add a key below'}
            </Text>
          </View>

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Paste your Gemini API key here"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          {status && <Text style={[styles.status, status.type === 'error' && styles.statusError]}>{status.text}</Text>}

          <View style={styles.buttonRow}>
            <Button title="Save key" onPress={handleSave} />
            <Button
              title={testing ? 'Testing...' : 'Test connection'}
              variant="ghost"
              onPress={handleTestKey}
              loading={testing}
            />
            {hasSavedKey && <Button title="Remove" variant="ghost" onPress={handleClear} />}
          </View>
        </View>

        <Pressable style={styles.linkRow} onPress={() => Linking.openURL(KEY_URL)}>
          <Ionicons name="open-outline" size={16} color={colors.lamp} />
          <Text style={styles.linkText}>Get a free key at Google AI Studio</Text>
        </Pressable>

        {/* Account Info */}
        <View style={styles.accountCard}>
          <View style={styles.accountInfo}>
            <View style={styles.avatarWrap}>
              <Ionicons name="person" size={18} color={colors.lamp} />
            </View>
            <View>
              <Text style={styles.accountEmail}>{user?.email}</Text>
              <Text style={styles.accountSubtext}>Cloud sync active</Text>
            </View>
          </View>
          <Pressable onPress={handleLogOut} style={styles.logOutBtn}>
            <Ionicons name="log-out-outline" size={16} color={colors.coral} />
            <Text style={styles.logOutText}>Log out</Text>
          </Pressable>
        </View>

        {/* Footer Note */}
        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Privacy & Storage</Text>
          <Text style={styles.noteBody}>
            Your key, bookmarks, and vocabulary are stored directly in your private Firestore
            account, scoped securely so only you can read or write them. No proxy servers in between.
          </Text>
          <Text style={styles.appVersion}>Reading Mate • v1.0.0</Text>
        </View>
      </Animated.View>
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    heading: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.textPrimary },
    subheading: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg, lineHeight: 19 },

    appearanceHint: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textFaint, marginTop: 4, marginBottom: spacing.md },

    segmentTrack: {
      flexDirection: 'row',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 3,
    },
    segmentBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      borderRadius: radius.pill,
    },
    segmentBtnActive: {
      backgroundColor: colors.lamp,
      ...shadow,
    },
    segmentBtnText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.textMuted,
    },
    segmentBtnTextActive: {
      fontFamily: fonts.bodySemiBold,
      color: colors.ink,
    },

    speechRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    previewSpeechBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.lampSoft,
      borderWidth: 1,
      borderColor: colors.lamp,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
    },
    previewSpeechText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.lamp,
    },

    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    rowText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textPrimary, marginLeft: 8 },

    label: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: {
      backgroundColor: colors.paperRaised,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      fontSize: 14,
      marginBottom: spacing.sm,
    },
    status: { fontFamily: fonts.body, fontSize: 12.5, color: colors.sage, marginBottom: spacing.sm },
    statusError: { color: colors.coral },
    buttonRow: { flexDirection: 'row', gap: spacing.sm },

    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
    linkText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.lamp, marginLeft: 6 },

    accountCard: {
      marginTop: spacing.lg,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    accountInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    avatarWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.lampSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountEmail: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.textPrimary },
    accountSubtext: { fontFamily: fonts.body, fontSize: 11, color: colors.textFaint },
    logOutBtn: { flexDirection: 'row', alignItems: 'center' },
    logOutText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.coral, marginLeft: 4 },

    noteCard: { marginTop: spacing.lg, padding: spacing.sm, alignItems: 'center' },
    noteTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
    noteBody: { fontFamily: fonts.body, fontSize: 12, color: colors.textFaint, lineHeight: 17, textAlign: 'center' },
    appVersion: { fontFamily: fonts.body, fontSize: 11, color: colors.textFaint, marginTop: spacing.sm },
  });
}

