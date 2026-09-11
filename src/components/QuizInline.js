// The interactive multiple-choice quiz, relocated from Milestone 1's
// ReadScreen (not rewritten) so it can render inline as a chat message.
// The only real change is reporting a final score back up via onComplete,
// since progress tracking now lives in Firestore instead of being handled
// by the screen directly.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';

export default function QuizInline({ questions, onComplete }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [answers, setAnswers] = useState({});
  const [reported, setReported] = useState(false);

  const selectAnswer = (qIndex, optIndex) => {
    if (answers[qIndex] !== undefined) return; // already answered
    const next = { ...answers, [qIndex]: optIndex };
    setAnswers(next);

    // §7 backlog: a small nudge of feedback right as the choice lands,
    // matching how the answer is about to be marked correct/incorrect
    // below — separate from onComplete's score, which only fires once
    // every question has been answered.
    const isCorrect = optIndex === questions[qIndex].correctIndex;
    Haptics.notificationAsync(
      isCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
    ).catch(() => {}); // no haptics hardware (e.g. some Android devices, web) — fine to just skip

    const allAnswered = questions.every((_, i) => next[i] !== undefined);
    if (allAnswered && !reported) {
      setReported(true);
      const correctCount = questions.filter((q, i) => next[i] === q.correctIndex).length;
      const scorePercent = Math.round((correctCount / questions.length) * 100);
      onComplete?.(scorePercent);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Comprehension check</Text>
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
                  <Text style={styles.optionText}>{opt}</Text>
                </Pressable>
              );
            })}
            {chosen !== undefined && <Text style={styles.explanation}>{q.explanation}</Text>}
          </View>
        );
      })}
    </View>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    wrap: { minWidth: 230 },
    label: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    card: { marginBottom: spacing.sm },
    question: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
    option: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      padding: 10,
      marginBottom: 8,
      backgroundColor: colors.paperRaised,
    },
    optionCorrect: { borderColor: colors.sage, backgroundColor: colors.sageSoft },
    optionWrong: { borderColor: colors.coral, backgroundColor: colors.coralSoft },
    optionText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textPrimary },
    explanation: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, marginTop: 2, fontStyle: 'italic' },
  });
}
