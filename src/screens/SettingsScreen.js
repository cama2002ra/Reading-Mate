import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signOut } from 'firebase/auth';

import ScreenContainer from '../components/ScreenContainer';
import Button from '../components/Button';
import AppearancePicker from '../components/AppearancePicker';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../services/firebase';
import { updateApiKey } from '../services/firestore';
import { confirmDestructive } from '../utils/confirm';

const KEY_URL = 'https://aistudio.google.com/apikey';

export default function SettingsScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { user, geminiApiKey } = useAuth();
  const [input, setInput] = useState(geminiApiKey || '');
  const [status, setStatus] = useState(null);

  // Keep the field in sync if the key changes from elsewhere (e.g. saved on
  // a different device) while this screen is open.
  useEffect(() => {
    setInput(geminiApiKey || '');
  }, [geminiApiKey]);

  const hasSavedKey = !!geminiApiKey;

  const handleSave = async () => {
    if (!input.trim()) {
      setStatus({ type: 'error', text: 'Paste a key first.' });
      return;
    }
    await updateApiKey(user.uid, input.trim());
    setStatus({ type: 'success', text: 'Saved to your account — synced to every device.' });
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
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.subheading}>Reading Mate needs a free Gemini API key to power its AI features.</Text>

      <Text style={styles.label}>Appearance</Text>
      <AppearancePicker />
      <Text style={styles.appearanceHint}>Synced to your account — follows you to your other devices too.</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons
            name={hasSavedKey ? 'checkmark-circle' : 'alert-circle-outline'}
            size={18}
            color={hasSavedKey ? colors.sage : colors.textMuted}
          />
          <Text style={styles.rowText}>{hasSavedKey ? 'AI features are on' : 'AI features are off — add a key below'}</Text>
        </View>

        <Text style={styles.label}>Gemini API key</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Paste your key here"
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        {status && <Text style={[styles.status, status.type === 'error' && styles.statusError]}>{status.text}</Text>}

        <View style={styles.buttonRow}>
          <Button title="Save key" onPress={handleSave} />
          {hasSavedKey && <Button title="Remove" variant="ghost" onPress={handleClear} />}
        </View>
      </View>

      <Pressable style={styles.linkRow} onPress={() => Linking.openURL(KEY_URL)}>
        <Ionicons name="open-outline" size={16} color={colors.lamp} />
        <Text style={styles.linkText}>Get a free key at Google AI Studio</Text>
      </Pressable>

      <View style={styles.accountCard}>
        <Text style={styles.rowText}>{user?.email}</Text>
        <Pressable onPress={handleLogOut} style={styles.logOutBtn}>
          <Ionicons name="log-out-outline" size={16} color={colors.coral} />
          <Text style={styles.logOutText}>Log out</Text>
        </Pressable>
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>How this works</Text>
        <Text style={styles.noteBody}>
          Your key and reading data are stored in your account (Firebase), scoped so only you can
          read or write them — there's still no backend server in between, and Reading Mate calls
          Gemini directly. Google's free tier needs no credit card; it's meant for exactly this
          kind of project.
        </Text>
      </View>
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    heading: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.textPrimary },
    subheading: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg, lineHeight: 19 },

    appearanceHint: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textFaint, marginTop: 6, marginBottom: spacing.lg },

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

    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
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
    logOutBtn: { flexDirection: 'row', alignItems: 'center' },
    logOutText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.coral, marginLeft: 4 },

    noteCard: { marginTop: spacing.xl, padding: spacing.md },
    noteTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    noteBody: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textFaint, lineHeight: 18 },
  });
}
