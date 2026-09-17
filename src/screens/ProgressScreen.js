import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import ScreenContainer from '../components/ScreenContainer';
import VocabReviewModal from '../components/VocabReviewModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToProgress, resetProgress, subscribeToBookmarks, removeBookmark } from '../services/firestore';
import { dueVocabWords } from '../services/spacedRepetition';
import { confirmDestructive } from '../utils/confirm';

export default function ProgressScreen({ navigation }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { user } = useAuth();
  const [progress, setProgress] = useState(null);
  const [bookmarks, setBookmarks] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToProgress(user.uid, setProgress);
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToBookmarks(user.uid, setBookmarks);
    return unsubscribe;
  }, [user]);

  const handleReset = () => {
    confirmDestructive({
      title: 'Reset progress?',
      message: 'This clears your streak, passage count, and learned words.',
      confirmText: 'Reset',
      onConfirm: () => resetProgress(user.uid),
    });
  };

  // §5 item 5: vocabulary spaced repetition. Recomputed on every render
  // (progress updates live via the subscription above) so the count shown
  // stays accurate, but the modal itself gets a one-time snapshot when
  // opened — see openReview() and VocabReviewModal's header comment on why.
  const due = progress ? dueVocabWords(progress.vocabSchedule) : [];

  const openReview = () => {
    setReviewQueue(due);
    setReviewOpen(true);
  };

  if (!progress) {
    return (
      <ScreenContainer>
        <Text style={styles.heading}>Progress</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.heading}>Progress</Text>
      <Text style={styles.subheading}>Stick with it — every passage adds up. Synced to your account.</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="flame" size={22} color={colors.lamp} />
          <Text style={styles.statNumber}>{progress.streak}</Text>
          <Text style={styles.statLabel}>day streak</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="book" size={22} color={colors.sage} />
          <Text style={styles.statNumber}>{progress.passagesRead}</Text>
          <Text style={styles.statLabel}>passages read</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="text" size={22} color={colors.textPrimary} />
          <Text style={styles.statNumber}>{progress.wordsLearned.length}</Text>
          <Text style={styles.statLabel}>words learned</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Words you've learned</Text>
      {progress.wordsLearned.length === 0 ? (
        <Text style={styles.empty}>
          None yet — tap a word in a reading session and hit "Got it!" to save it here.
        </Text>
      ) : (
        <View style={styles.wordGrid}>
          {progress.wordsLearned.map((w) => (
            <View key={w} style={styles.wordChip}>
              <Text style={styles.wordChipText}>{w}</Text>
            </View>
          ))}
        </View>
      )}

      {due.length > 0 && (
        <Pressable style={styles.reviewBanner} onPress={openReview}>
          <Ionicons name="repeat" size={16} color={colors.lamp} />
          <Text style={styles.reviewBannerText}>
            {due.length} word{due.length === 1 ? '' : 's'} due for review
          </Text>
          <Ionicons name="chevron-forward" size={15} color={colors.lamp} />
        </Pressable>
      )}

      <Text style={styles.sectionLabel}>Bookmarks</Text>
      {!bookmarks || bookmarks.length === 0 ? (
        <Text style={styles.empty}>None yet — tap the star on a passage or reply to save it here.</Text>
      ) : (
        <View style={styles.bookmarkList}>
          {bookmarks.map((b) => (
            <Pressable
              key={b.id}
              style={styles.bookmarkCard}
              onPress={() =>
                navigation.navigate('Read', {
                  screen: 'Session',
                  // §5 item 4: a page bookmark (reader-mode) jumps straight
                  // to that page on open — see SessionScreen.js's
                  // initialPageIndex handling. undefined for a message
                  // bookmark, which has no page to jump to.
                  params: { sessionId: b.sessionId, pageIndex: b.pageIndex },
                  initial: false,
                })
              }
            >
              <View style={styles.bookmarkBody}>
                <Text style={styles.bookmarkSession} numberOfLines={1}>
                  {b.sessionTitle}
                </Text>
                <Text style={styles.bookmarkText} numberOfLines={2}>
                  {typeof b.pageIndex === 'number' ? `Page ${b.pageIndex} — ${b.text}` : b.text}
                </Text>
              </View>
              <Pressable hitSlop={10} onPress={() => removeBookmark(user.uid, b.id)} style={styles.bookmarkRemove}>
                <Ionicons name="star" size={16} color={colors.lamp} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable onPress={handleReset} style={styles.resetLink}>
        <Text style={styles.resetText}>Reset progress</Text>
      </Pressable>

      <VocabReviewModal
        visible={reviewOpen}
        words={reviewQueue}
        uid={user?.uid}
        onClose={() => setReviewOpen(false)}
      />
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    heading: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.textPrimary },
    subheading: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },

    statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
    statCard: {
      flex: 1,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginHorizontal: 4,
    },
    statNumber: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.textPrimary, marginTop: 6 },
    statLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 2, textAlign: 'center' },

    sectionLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    empty: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textFaint, lineHeight: 19 },
    wordGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    wordChip: {
      backgroundColor: colors.lampSoft,
      borderRadius: radius.pill,
      paddingVertical: 6,
      paddingHorizontal: 12,
      marginRight: 8,
      marginBottom: 8,
    },
    wordChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.lamp },

    reviewBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.lampSoft,
      borderWidth: 1,
      borderColor: colors.lamp,
      borderRadius: radius.md,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginTop: spacing.sm,
    },
    reviewBannerText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.lamp, marginLeft: 8 },

    bookmarkList: {},
    bookmarkCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    bookmarkBody: { flex: 1, marginRight: spacing.sm },
    bookmarkSession: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.textPrimary, marginBottom: 2 },
    bookmarkText: { fontFamily: fonts.displayRegular, fontSize: 12.5, color: colors.textMuted, lineHeight: 17 },
    bookmarkRemove: { padding: 4 },

    resetLink: { marginTop: spacing.xl, alignSelf: 'center' },
    resetText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textFaint, textDecorationLine: 'underline' },
  });
}
