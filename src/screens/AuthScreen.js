import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, Animated, Easing } from 'react-native';
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

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const glowAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Subtle pulsing glow on the icon badge
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.7, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

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
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Decorative glowing orb */}
          <Animated.View style={[styles.glowOrb, { opacity: glowAnim }]} />

          <Animated.View style={[styles.lampBadge, { opacity: glowAnim }]}>
            <Ionicons name="book" size={30} color={colors.ink} />
          </Animated.View>
          <Text style={styles.title}>Reading Mate</Text>
          <Text style={styles.tagline}>AI-powered reading comprehension</Text>
          <Text style={styles.subtitle}>
            {isSignUp
              ? 'Create an account to sync your reading across devices.'
              : 'Sign in to pick up where you left off.'}
          </Text>

          <View style={styles.formCard}>
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
          </View>

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

          <View style={styles.featureRow}>
            <View style={styles.featureChip}>
              <Ionicons name="sparkles-outline" size={12} color={colors.textFaint} />
              <Text style={styles.featureChipText}>AI Explanations</Text>
            </View>
            <View style={styles.featureChip}>
              <Ionicons name="document-text-outline" size={12} color={colors.textFaint} />
              <Text style={styles.featureChipText}>PDF Reader</Text>
            </View>
            <View style={styles.featureChip}>
              <Ionicons name="school-outline" size={12} color={colors.textFaint} />
              <Text style={styles.featureChipText}>Vocabulary</Text>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.ink },
    flex: { flex: 1 },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: spacing.lg,
      maxWidth: 440,
      alignSelf: 'center',
      width: '100%',
    },
    glowOrb: {
      position: 'absolute',
      top: '20%',
      alignSelf: 'center',
      width: 220,
      height: 220,
      borderRadius: 110,
      backgroundColor: colors.lampSoft,
    },
    lampBadge: {
      width: 72,
      height: 72,
      borderRadius: radius.lg + 4,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
      alignSelf: 'center',
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 2,
      letterSpacing: -0.3,
    },
    tagline: {
      fontFamily: fonts.bodyMedium,
      fontSize: 13,
      color: colors.lamp,
      textAlign: 'center',
      marginBottom: spacing.sm,
      letterSpacing: 0.3,
    },
    subtitle: {
      fontFamily: fonts.body,
      fontSize: 13.5,
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: spacing.lg,
      lineHeight: 19,
      paddingHorizontal: spacing.md,
    },
    formCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
    },
    input: {
      backgroundColor: colors.paperRaised,
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
    featureRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.xl,
    },
    featureChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.paper,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    featureChipText: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.textFaint,
    },
  });
}

