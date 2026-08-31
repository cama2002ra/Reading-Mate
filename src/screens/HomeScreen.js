import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import Button from '../components/Button';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToSessions } from '../services/firestore';
import { levelLabel } from '../constants/levels';

const FEATURES = [
  { icon: 'sparkles-outline', title: 'Simplify', body: 'Paste any text and get it rewritten at the right level.' },
  { icon: 'volume-high-outline', title: 'Read aloud', body: 'Listen to any passage, word by word.' },
  { icon: 'help-circle-outline', title: 'Quiz me', body: 'AI-made questions to check what stuck.' },
  { icon: 'camera-outline', title: 'Snap a page', body: 'Photograph a book page to read and simplify it.' },
];

// Same idea as passageExcerpt() in SessionsListScreen.js — kept as a
// separate small copy rather than a shared import; it's a five-line
// function, not worth a new shared module for.
function passageExcerpt(session) {
  const passage = (session.messages || []).find((m) => m.role === 'model' && m.type === 'text');
  if (!passage) return '';
  const firstLine = String(passage.content || '')
    .split('\n')
    .find((line) => line.trim());
  return (firstLine || '').trim();
}

export default function HomeScreen({ navigation }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { user } = useAuth();
  const [recentSession, setRecentSession] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    // subscribeToSessions already orders by updatedAt desc — the first
    // result is exactly "the actual most recent session."
    const unsubscribe = subscribeToSessions(user.uid, (sessions) => setRecentSession(sessions?.[0] || null));
    return unsubscribe;
  }, [user]);

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <View style={styles.glow} />
        <View style={styles.lampBadge}>
          <Ionicons name="book" size={30} color={colors.ink} />
        </View>
        <Text style={styles.title}>Reading Mate</Text>
        <Text style={styles.tagline}>Your AI reading companion — paste anything, understand everything.</Text>
        <Button
          title="Start reading"
          onPress={() =>
            // `initial: false` matters here: without it, React Navigation
            // makes NewSession the Read stack's *root* screen the first
            // time this fires (since the stack hasn't been visited yet),
            // with no SessionsList underneath it — so the back button
            // would exit the tab instead of returning to the list. This
            // keeps SessionsList as the root and pushes NewSession on top
            // of it, same as if the user had tapped the tab and then
            // "New reading session" themselves.
            navigation.navigate('Read', { screen: 'NewSession', initial: false })
          }
        />
      </View>

      {/* §2: opening the app should feel like picking a book back up, not
          browsing a feature list — this supplements the grid below rather
          than replacing it, since the grid still does useful explaining
          for a person who hasn't started a session yet. */}
      {recentSession && (
        <Pressable
          style={styles.continueCard}
          onPress={() =>
            navigation.navigate('Read', {
              screen: 'Session',
              params: { sessionId: recentSession.id },
              initial: false,
            })
          }
        >
          <View style={styles.continueIconWrap}>
            <Ionicons name="bookmark" size={17} color={colors.ink} />
          </View>
          <View style={styles.continueBody}>
            <Text style={styles.continueLabel}>Continue reading</Text>
            <Text style={styles.continueTitle} numberOfLines={1}>
              {recentSession.title || 'New reading session'}
            </Text>
            {!!passageExcerpt(recentSession) && (
              <Text style={styles.continueExcerpt} numberOfLines={2}>
                {passageExcerpt(recentSession)}
              </Text>
            )}
            <Text style={styles.continueLevel}>{levelLabel(recentSession.level)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      )}

      <Text style={styles.sectionLabel}>What it does</Text>
      <View style={styles.grid}>
        {FEATURES.map((f) => (
          <View key={f.title} style={styles.card}>
            <Ionicons name={f.icon} size={22} color={colors.lamp} />
            <Text style={styles.cardTitle}>{f.title}</Text>
            <Text style={styles.cardBody}>{f.body}</Text>
          </View>
        ))}
      </View>
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    hero: {
      alignItems: 'center',
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
    },
    glow: {
      position: 'absolute',
      top: -10,
      width: 180,
      height: 180,
      borderRadius: 90,
      backgroundColor: colors.lamp,
      opacity: 0.16,
    },
    lampBadge: {
      width: 64,
      height: 64,
      borderRadius: radius.lg,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.textPrimary,
      marginBottom: spacing.xs,
    },
    tagline: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 21,
      marginBottom: spacing.lg,
      paddingHorizontal: spacing.md,
    },
    sectionLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      letterSpacing: 0.5,
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: spacing.sm,
    },
    continueCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    continueIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    continueBody: { flex: 1 },
    continueLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 10.5,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: colors.lamp,
      marginBottom: 2,
    },
    continueTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: colors.textPrimary },
    continueExcerpt: { fontFamily: fonts.displayRegular, fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    continueLevel: { fontFamily: fonts.body, fontSize: 11, color: colors.textFaint, marginTop: 3 },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    card: {
      width: '48%',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    cardTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.textPrimary,
      marginTop: spacing.sm,
      marginBottom: 4,
    },
    cardBody: {
      fontFamily: fonts.body,
      fontSize: 12.5,
      color: colors.textMuted,
      lineHeight: 17,
    },
  });
}
