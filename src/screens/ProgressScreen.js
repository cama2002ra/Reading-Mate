import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import ScreenContainer from '../components/ScreenContainer';
import VocabReviewModal from '../components/VocabReviewModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToProgress, resetProgress, subscribeToBookmarks, removeBookmark } from '../services/firestore';
import { dueVocabWords } from '../services/spacedRepetition';
import { confirmDestructive } from '../utils/confirm';
import { levelLabel } from '../constants/levels';

function averageQuizScore(scores) {
  if (!scores || scores.length === 0) return null;
  const recent = scores.slice(-10); // last 10 scores
  const sum = recent.reduce((a, s) => a + (s.score || 0), 0);
  return Math.round(sum / recent.length);
}

function latestLevel(scores) {
  if (!scores || scores.length === 0) return null;
  return scores[scores.length - 1]?.level || null;
}

const MILESTONES = [
  {
    id: 'first_read',
    title: 'First Flight',
    desc: 'Read 1st passage',
    icon: 'airplane-outline',
    color: '#8082ED',
    check: (p) => (p.passagesRead || 0) >= 1,
    progress: (p) => Math.min(1, (p.passagesRead || 0) / 1),
    label: (p) => `${Math.min(1, p.passagesRead || 0)}/1`,
  },
  {
    id: 'streak_3',
    title: 'On Fire',
    desc: '3-day reading streak',
    icon: 'flame',
    color: '#E8A33D',
    check: (p) => (p.streak || 0) >= 3,
    progress: (p) => Math.min(1, (p.streak || 0) / 3),
    label: (p) => `${Math.min(3, p.streak || 0)}/3d`,
  },
  {
    id: 'vocab_5',
    title: 'Word Collector',
    desc: '5+ words saved',
    icon: 'bookmarks-outline',
    color: '#6FCF97',
    check: (p) => (p.wordsLearned?.length || 0) >= 5,
    progress: (p) => Math.min(1, (p.wordsLearned?.length || 0) / 5),
    label: (p) => `${Math.min(5, p.wordsLearned?.length || 0)}/5w`,
  },
  {
    id: 'quiz_ace',
    title: 'Comprehension Ace',
    desc: '80%+ on any quiz',
    icon: 'trophy-outline',
    color: '#E8A33D',
    check: (p) => (p.recentQuizScores || []).some((s) => (s.score || 0) >= 80),
    progress: (p) => ((p.recentQuizScores || []).some((s) => (s.score || 0) >= 80) ? 1 : 0),
    label: (p) => ((p.recentQuizScores || []).some((s) => (s.score || 0) >= 80) ? 'Done!' : 'Pending'),
  },
  {
    id: 'passages_5',
    title: 'Avid Scholar',
    desc: '5+ passages read',
    icon: 'school-outline',
    color: '#2F8F5B',
    check: (p) => (p.passagesRead || 0) >= 5,
    progress: (p) => Math.min(1, (p.passagesRead || 0) / 5),
    label: (p) => `${Math.min(5, p.passagesRead || 0)}/5`,
  },
  {
    id: 'vocab_15',
    title: 'Lexicon Master',
    desc: '15+ words saved',
    icon: 'diamond-outline',
    color: '#8082ED',
    check: (p) => (p.wordsLearned?.length || 0) >= 15,
    progress: (p) => Math.min(1, (p.wordsLearned?.length || 0) / 15),
    label: (p) => `${Math.min(15, p.wordsLearned?.length || 0)}/15`,
  },
];

export default function ProgressScreen({ navigation }) {

  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { user } = useAuth();
  const [progress, setProgress] = useState(null);
  const [bookmarks, setBookmarks] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

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

  const avgScore = progress ? averageQuizScore(progress.recentQuizScores) : null;
  const currentLevel = progress ? latestLevel(progress.recentQuizScores) : null;
  const totalQuizzes = progress?.recentQuizScores?.length || 0;
  const unlockedCount = progress ? MILESTONES.filter((m) => m.check(progress)).length : 0;

  if (!progress) {
    return (
      <ScreenContainer>
        <Text style={styles.heading}>Progress</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={styles.heading}>Progress</Text>
        <Text style={styles.subheading}>Stick with it — every passage adds up. Synced to your account.</Text>

        {/* Main Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.lampSoft }]}>
              <Ionicons name="flame" size={20} color={colors.lamp} />
            </View>
            <Text style={styles.statNumber}>{progress.streak}</Text>
            <Text style={styles.statLabel}>day streak</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.sageSoft }]}>
              <Ionicons name="book" size={20} color={colors.sage} />
            </View>
            <Text style={styles.statNumber}>{progress.passagesRead}</Text>
            <Text style={styles.statLabel}>passages read</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.lampSoft }]}>
              <Ionicons name="text" size={20} color={colors.lamp} />
            </View>
            <Text style={styles.statNumber}>{progress.wordsLearned.length}</Text>
            <Text style={styles.statLabel}>words saved</Text>
          </View>
        </View>

        {/* Quiz Performance Card */}
        {totalQuizzes > 0 && (
          <View style={styles.quizCard}>
            <View style={styles.quizCardHeader}>
              <Ionicons name="school-outline" size={16} color={colors.lamp} />
              <Text style={styles.quizCardTitle}>Quiz Performance</Text>
            </View>
            <View style={styles.quizMetricsRow}>
              <View style={styles.quizMetric}>
                <Text style={styles.quizMetricValue}>
                  {avgScore !== null ? `${avgScore}%` : '—'}
                </Text>
                <Text style={styles.quizMetricLabel}>avg score</Text>
              </View>
              <View style={styles.quizMetricDivider} />
              <View style={styles.quizMetric}>
                <Text style={styles.quizMetricValue}>{totalQuizzes}</Text>
                <Text style={styles.quizMetricLabel}>quizzes taken</Text>
              </View>
              {currentLevel && (
                <>
                  <View style={styles.quizMetricDivider} />
                  <View style={styles.quizMetric}>
                    <Text style={styles.quizMetricValue}>{levelLabel(currentLevel)}</Text>
                    <Text style={styles.quizMetricLabel}>current level</Text>
                  </View>
                </>
              )}
            </View>
            {avgScore !== null && (
              <View style={styles.scoreBarBg}>
                <View style={[styles.scoreBarFill, { width: `${avgScore}%`, backgroundColor: avgScore >= 70 ? colors.sage : colors.lamp }]} />
              </View>
            )}
          </View>
        )}

        {/* Reading Milestones & Badges */}
        <View style={styles.milestonesSection}>
          <View style={styles.milestonesHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ribbon-outline" size={16} color={colors.lamp} />
              <Text style={styles.sectionLabelNoMargin}>Reading Milestones</Text>
            </View>
            <View style={styles.milestonesBadge}>
              <Text style={styles.milestonesBadgeText}>{unlockedCount}/{MILESTONES.length} Unlocked</Text>
            </View>
          </View>
          <View style={styles.milestonesGrid}>
            {MILESTONES.map((m) => {
              const unlocked = m.check(progress);
              const prog = m.progress(progress);
              return (
                <View key={m.id} style={[styles.milestoneCard, unlocked && styles.milestoneCardUnlocked]}>
                  <View style={styles.milestoneTop}>
                    <View style={[styles.milestoneIconWrap, { backgroundColor: unlocked ? m.color + '22' : colors.paperRaised }]}>
                      <Ionicons name={m.icon} size={16} color={unlocked ? m.color : colors.textFaint} />
                    </View>
                    {unlocked ? (
                      <View style={[styles.milestoneStatusBadge, { backgroundColor: colors.sageSoft }]}>
                        <Ionicons name="checkmark" size={11} color={colors.sage} />
                      </View>
                    ) : (
                      <Text style={styles.milestoneProgressLabel}>{m.label(progress)}</Text>
                    )}
                  </View>
                  <Text style={[styles.milestoneTitle, unlocked && styles.milestoneTitleUnlocked]} numberOfLines={1}>
                    {m.title}
                  </Text>
                  <Text style={styles.milestoneDesc} numberOfLines={1}>{m.desc}</Text>
                  {!unlocked && (
                    <View style={styles.milestoneBarBg}>
                      <View style={[styles.milestoneBarFill, { width: `${Math.round(prog * 100)}%`, backgroundColor: m.color }]} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Vocab Review Banner */}
        {due.length > 0 && (
          <Pressable style={styles.reviewBanner} onPress={openReview}>
            <View style={styles.reviewBannerIconWrap}>
              <Ionicons name="repeat" size={18} color={colors.lamp} />
            </View>
            <View style={styles.reviewBannerBody}>
              <Text style={styles.reviewBannerTitle}>
                {due.length} word{due.length === 1 ? '' : 's'} due for review
              </Text>
              <Text style={styles.reviewBannerSubtext}>Spaced repetition keeps vocabulary sharp</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.lamp} />
          </Pressable>
        )}

        {/* Words Learned */}
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

        {/* Bookmarks */}
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
      </Animated.View>

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
    statIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    statNumber: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.textPrimary, marginTop: 2 },
    statLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 2, textAlign: 'center' },

    // Quiz performance card
    quizCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    quizCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: spacing.sm,
    },
    quizCardTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12.5,
      color: colors.lamp,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    quizMetricsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    quizMetric: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 4,
    },
    quizMetricValue: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      color: colors.textPrimary,
    },
    quizMetricLabel: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    quizMetricDivider: {
      width: 1,
      height: 30,
      backgroundColor: colors.border,
    },
    scoreBarBg: {
      height: 5,
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      marginTop: spacing.sm,
      overflow: 'hidden',
    },
    scoreBarFill: {
      height: '100%',
      borderRadius: radius.pill,
    },

    // Milestones
    milestonesSection: {
      marginBottom: spacing.lg,
    },
    milestonesHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    sectionLabelNoMargin: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    milestonesBadge: {
      backgroundColor: colors.paperRaised,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    milestonesBadgeText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      color: colors.lamp,
    },
    milestonesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    milestoneCard: {
      width: '48.5%',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm + 2,
    },
    milestoneCardUnlocked: {
      borderColor: colors.border,
      backgroundColor: colors.paper,
    },
    milestoneTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    milestoneIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    milestoneStatusBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    milestoneProgressLabel: {
      fontFamily: fonts.body,
      fontSize: 10.5,
      color: colors.textFaint,
    },
    milestoneTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12.5,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    milestoneTitleUnlocked: {
      color: colors.textPrimary,
    },
    milestoneDesc: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.textMuted,
      lineHeight: 14,
      marginBottom: 4,
    },
    milestoneBarBg: {
      height: 3,
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      marginTop: 2,
      overflow: 'hidden',
    },
    milestoneBarFill: {
      height: '100%',
      borderRadius: radius.pill,
    },

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
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: spacing.sm,
    },
    reviewBannerIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    reviewBannerBody: { flex: 1, marginRight: spacing.sm },
    reviewBannerTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.textPrimary,
      marginBottom: 1,
    },
    reviewBannerSubtext: {
      fontFamily: fonts.body,
      fontSize: 11.5,
      color: colors.textMuted,
    },

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
