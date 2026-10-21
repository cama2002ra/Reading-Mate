import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export default function QuizInline({ questions, onComplete }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [answers, setAnswers] = useState({});
  const [reported, setReported] = useState(false);

  const selectAnswer = (qIndex, optIndex) => {
    if (answers[qIndex] !== undefined) return;
    const next = { ...answers, [qIndex]: optIndex };
    setAnswers(next);

    const isCorrect = optIndex === questions[qIndex].correctIndex;
    Haptics.notificationAsync(
      isCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
    ).catch(() => {});

    const allAnswered = questions.every((_, i) => next[i] !== undefined);
    if (allAnswered && !reported) {
      setReported(true);
      const correctCount = questions.filter((q, i) => next[i] === q.correctIndex).length;
      const scorePercent = Math.round((correctCount / questions.length) * 100);
      onComplete?.(scorePercent);
    }
  };

  const answeredCount = Object.keys(answers).length;
  const isAllAnswered = questions.length > 0 && answeredCount === questions.length;
  const correctCount = questions.filter((q, i) => answers[i] === q.correctIndex).length;
  const scorePercent = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="help-circle" size={16} color={colors.lamp} />
        <Text style={styles.label}>Comprehension Check</Text>
        <Text style={styles.progressCounter}>
          {answeredCount}/{questions.length}
        </Text>
      </View>

      {questions.map((q, qi) => {
        const chosen = answers[qi];
        return (
          <View key={qi} style={styles.card}>
            <Text style={styles.question}>
              {qi + 1}. {q.question}
            </Text>
            {q.options.map((opt, oi) => {
              const isChosen = chosen === oi;
              const isCorrect = oi === q.correctIndex;
              const showState = chosen !== undefined;
              const letter = OPTION_LETTERS[oi] || `${oi + 1}`;
              return (
                <Pressable
                  key={oi}
                  onPress={() => selectAnswer(qi, oi)}
                  style={[
                    styles.option,
                    showState && isCorrect && styles.optionCorrect,
                    showState && isChosen && !isCorrect && styles.optionWrong,
                  ]}
                >
                  <View
                    style={[
                      styles.letterBadge,
                      showState && isCorrect && styles.letterBadgeCorrect,
                      showState && isChosen && !isCorrect && styles.letterBadgeWrong,
                    ]}
                  >
                    <Text
                      style={[
                        styles.letterText,
                        showState && isCorrect && styles.letterTextCorrect,
                        showState && isChosen && !isCorrect && styles.letterTextWrong,
                      ]}
                    >
                      {letter}
                    </Text>
                  </View>
                  <Text style={styles.optionText}>{opt}</Text>
                  {showState && isCorrect && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.sage} style={styles.stateIcon} />
                  )}
                  {showState && isChosen && !isCorrect && (
                    <Ionicons name="close-circle" size={18} color={colors.coral} style={styles.stateIcon} />
                  )}
                </Pressable>
              );
            })}
            {chosen !== undefined && (
              <View style={styles.explanationBox}>
                <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
                <Text style={styles.explanation}>{q.explanation}</Text>
              </View>
            )}
          </View>
        );
      })}

      {/* Final Score Celebration Card */}
      {isAllAnswered && (
        <View
          style={[
            styles.scoreBanner,
            scorePercent >= 80 ? styles.scoreBannerHigh : styles.scoreBannerMed,
          ]}
        >
          <View style={styles.scoreIconWrap}>
            <Ionicons
              name={scorePercent === 100 ? 'trophy' : scorePercent >= 70 ? 'ribbon' : 'sparkles'}
              size={22}
              color={scorePercent >= 80 ? colors.sage : colors.lamp}
            />
          </View>
          <View style={styles.scoreBody}>
            <Text style={styles.scoreTitle}>
              {scorePercent === 100
                ? 'Flawless Comprehension!'
                : scorePercent >= 70
                ? 'Great Reading & Recall!'
                : 'Keep Practicing!'}
            </Text>
            <Text style={styles.scoreSubtitle}>
              You scored {correctCount} of {questions.length} ({scorePercent}%) recorded to your progress.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    wrap: { minWidth: 260 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: spacing.sm,
    },
    label: {
      flex: 1,
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    progressCounter: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.lamp,
    },
    card: {
      marginBottom: spacing.md,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    question: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14.5,
      color: colors.textPrimary,
      marginBottom: spacing.sm,
      lineHeight: 20,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingVertical: 9,
      paddingHorizontal: 10,
      marginBottom: 8,
      backgroundColor: colors.paperRaised,
    },
    letterBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.paper,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    letterBadgeCorrect: {
      backgroundColor: colors.sage,
      borderColor: colors.sage,
    },
    letterBadgeWrong: {
      backgroundColor: colors.coral,
      borderColor: colors.coral,
    },
    letterText: {
      fontFamily: fonts.bodyBold,
      fontSize: 11,
      color: colors.textMuted,
    },
    letterTextCorrect: {
      color: colors.ink,
    },
    letterTextWrong: {
      color: '#fff',
    },
    optionCorrect: {
      borderColor: colors.sage,
      backgroundColor: colors.sageSoft,
    },
    optionWrong: {
      borderColor: colors.coral,
      backgroundColor: colors.coralSoft,
    },
    optionText: {
      flex: 1,
      fontFamily: fonts.body,
      fontSize: 13.5,
      color: colors.textPrimary,
      lineHeight: 18,
    },
    stateIcon: {
      marginLeft: 6,
    },
    explanationBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      backgroundColor: colors.paperRaised,
      padding: 8,
      borderRadius: radius.sm,
      marginTop: 4,
    },
    explanation: {
      flex: 1,
      fontFamily: fonts.body,
      fontSize: 12.5,
      color: colors.textMuted,
      lineHeight: 17,
      fontStyle: 'italic',
    },
    scoreBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      marginTop: spacing.xs,
    },
    scoreBannerHigh: {
      backgroundColor: colors.sageSoft,
      borderColor: colors.sage,
    },
    scoreBannerMed: {
      backgroundColor: colors.lampSoft,
      borderColor: colors.lamp,
    },
    scoreIconWrap: {
      marginRight: spacing.sm,
    },
    scoreBody: {
      flex: 1,
    },
    scoreTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    scoreSubtitle: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 16,
    },
  });
}

