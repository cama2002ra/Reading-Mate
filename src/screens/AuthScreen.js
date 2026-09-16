import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';

import Button from '../components/Button';
import { useTheme } from '../contexts/ThemeContext';
import { auth } from '../services/firebase';
import { initializeUserData } from '../services/firestore';

function friendlyAuthError(err) {
  switch (err?.code) {
    case 'auth/invalid-email':
      return "That email address doesn't look right.";
    case 'auth/email-already-in-use':
      return 'An account already exists for that email — try signing in instead.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for your password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return "Email or password didn't match. Try again.";
    case 'auth/network-request-failed':
      return 'Could not reach Firebase — check your internet connection.';
    default:
      return 'Something went wrong. Check your connection and try again.';
  }
}

export default function AuthScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resetStatus, setResetStatus] = useState(null); // null | 'sent' | an error message

  const isSignUp = mode === 'signup';

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Enter an email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (isSignUp) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await initializeUserData(credential.user.uid);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      // No navigation call needed — AuthContext's onAuthStateChanged
      // listener picks this up, and App.js swaps to the main tabs.
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // §7 backlog: standard Firebase Auth password reset flow.
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setResetStatus('Enter your email above first, then tap this again.');
      return;
    }
    setResetStatus(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetStatus('sent');
    } catch (err) {
      setResetStatus(friendlyAuthError(err));
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <View style={styles.lampBadge}>
            <Ionicons name="book" size={30} color={colors.ink} />
          </View>
          <Text style={styles.title}>Reading Mate</Text>
          <Text style={styles.subtitle}>
            {isSignUp
              ? 'Create an account to sync your reading across devices.'
              : 'Sign in to pick up where you left off.'}
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Button title={isSignUp ? 'Create account' : 'Sign in'} onPress={handleSubmit} loading={loading} />

          {!isSignUp && (
            <Pressable style={styles.forgotRow} onPress={handleForgotPassword} hitSlop={8}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          )}
          {resetStatus === 'sent' ? (
            <Text style={styles.resetSent}>Check your email for a reset link.</Text>
          ) : (
            resetStatus && <Text style={styles.error}>{resetStatus}</Text>
          )}

          <Pressable
            style={styles.switchRow}
            onPress={() => {
              setMode(isSignUp ? 'signin' : 'signup');
              setError(null);
              setResetStatus(null);
            }}
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              <Text style={styles.switchLink}>{isSignUp ? 'Sign in' : 'Sign up'}</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.ink },
    flex: { flex: 1 },
    content: { flex: 1, justifyContent: 'center', padding: spacing.lg },
    lampBadge: {
      width: 64,
      height: 64,
      borderRadius: radius.lg,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
      alignSelf: 'center',
    },
    title: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
    subtitle: {
      fontFamily: fonts.body,
      fontSize: 13.5,
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: spacing.xl,
      lineHeight: 19,
      paddingHorizontal: spacing.md,
    },
    input: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      fontSize: 14.5,
      marginBottom: spacing.sm,
    },
    error: { fontFamily: fonts.body, color: colors.coral, fontSize: 13, marginBottom: spacing.sm },
    forgotRow: { marginTop: spacing.sm, alignItems: 'center' },
    forgotText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.lamp },
    resetSent: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
    switchRow: { marginTop: spacing.lg, alignItems: 'center' },
    switchText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted },
    switchLink: { color: colors.lamp, fontFamily: fonts.bodySemiBold },
  });
}
