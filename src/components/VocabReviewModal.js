import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useTheme } from '../contexts/ThemeContext';
import { reviewVocabWord } from '../services/firestore';

export default function VocabReviewModal({ visible, words, uid, onClose }) {
  const theme = useTheme();
  const { colors, radius } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (visible) {
      setIndex(0);
      setRevealed(false);
    }
  }, [visible]);

  const current = words[index];
  const progressPercent = words.length > 0 ? ((index) / words.length) * 100 : 0;

  const speakCurrentWord = () => {
    if (!current?.word || speaking) return;
    setSpeaking(true);
    Speech.speak(current.word, {
      rate: theme.speechRate || 0.9,
      onDone: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const grade = async (g) => {
    if (!current || grading) return;
    setGrading(true);
    await reviewVocabWord(uid, current.word, g).catch(() => {});
    setGrading(false);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {!current ? (
            <View style={styles.doneContainer}>
              <View style={styles.doneIconWrap}>
                <Ionicons name="sparkles" size={32} color={colors.sage} />
              </View>
              <Text style={styles.doneTitle}>
                {words.length === 0 ? 'No words due right now' : 'Review Complete!'}
              </Text>
              <Text style={styles.doneText}>
                {words.length === 0
                  ? 'All your saved vocabulary is up to date. Keep reading to discover new words.'
                  : `You reviewed ${words.length} vocabulary words today. Spaced repetition keeps them sharp!`}
              </Text>
              <Pressable style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeBtnText}>Return to Progress</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Progress Bar */}
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
              </View>

              <View style={styles.cardHeader}>
                <Text style={styles.progressLabel}>
                  Word {index + 1} of {words.length}
                </Text>
                <Pressable hitSlop={8} onPress={onClose}>
                  <Ionicons name="close" size={20} color={colors.textFaint} />
                </Pressable>
              </View>

              {/* Flashcard Body */}
              <View style={styles.flashcard}>
                <View style={styles.wordRow}>
                  <Text style={styles.word}>{current.word}</Text>
                  <Pressable
                    style={styles.pronounceBtn}
                    onPress={speakCurrentWord}
                    accessibilityLabel="Pronounce word"
                    hitSlop={8}
                  >
                    <Ionicons
                      name={speaking ? 'volume-high' : 'volume-medium-outline'}
                      size={20}
                      color={colors.lamp}
                    />
                  </Pressable>
                </View>

                {revealed ? (
                  <View style={styles.definitionWrap}>
                    <Text style={styles.definitionLabel}>Explanation & Context</Text>
                    <Text style={styles.definition}>
                      {current.definition || "No saved definition for this word — look it up in a session."}
                    </Text>
                  </View>
                ) : (
                  <Pressable style={styles.revealBtn} onPress={() => setRevealed(true)}>
                    <Ionicons name="bulb-outline" size={16} color={colors.lamp} />
                    <Text style={styles.revealBtnText}>Reveal Meaning</Text>
                  </Pressable>
                )}
              </View>

              {/* Grading Buttons */}
              {revealed &&
                (grading ? (
                  <ActivityIndicator color={colors.lamp} style={{ marginTop: 18 }} />
                ) : (
                  <View style={styles.gradeSection}>
                    <Text style={styles.gradePrompt}>How well did you recall it?</Text>
                    <View style={styles.gradeRow}>
                      <Pressable style={[styles.gradeBtn, styles.gradeAgain]} onPress={() => grade('again')}>
                        <Text style={[styles.gradeBtnText, { color: colors.coral }]}>Forgot</Text>
                        <Text style={styles.gradeSubtext}>Review soon</Text>
                      </Pressable>
                      <Pressable style={[styles.gradeBtn, styles.gradeGood]} onPress={() => grade('good')}>
                        <Text style={[styles.gradeBtnText, { color: colors.lamp }]}>Remembered</Text>
                        <Text style={styles.gradeSubtext}>Good recall</Text>
                      </Pressable>
                      <Pressable style={[styles.gradeBtn, styles.gradeEasy]} onPress={() => grade('easy')}>
                        <Text style={[styles.gradeBtnText, { color: colors.sage }]}>Mastered</Text>
                        <Text style={styles.gradeSubtext}>Very easy</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}


function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 440,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      ...shadow,
    },
    progressBarBg: {
      height: 4,
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: colors.lamp,
      borderRadius: radius.pill,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    progressLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    flashcard: {
      backgroundColor: colors.paperRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      alignItems: 'center',
      marginVertical: spacing.sm,
    },
    wordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      marginBottom: spacing.md,
    },
    word: {
      fontFamily: fonts.displayBold,
      fontSize: 28,
      color: colors.textPrimary,
    },
    pronounceBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.lampSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    revealBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.lampSoft,
      borderWidth: 1,
      borderColor: colors.lamp,
      borderRadius: radius.pill,
      paddingVertical: 10,
      paddingHorizontal: 20,
      marginTop: spacing.sm,
    },
    revealBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13.5,
      color: colors.lamp,
    },
    definitionWrap: {
      width: '100%',
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    definitionLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 11,
      color: colors.textFaint,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
      textAlign: 'center',
    },
    definition: {
      fontFamily: fonts.body,
      fontSize: 14.5,
      color: colors.textPrimary,
      textAlign: 'center',
      lineHeight: 22,
    },
    gradeSection: {
      marginTop: spacing.md,
    },
    gradePrompt: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12.5,
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    gradeRow: {
      flexDirection: 'row',
      gap: 8,
    },
    gradeBtn: {
      flex: 1,
      borderRadius: radius.md,
      paddingVertical: 10,
      paddingHorizontal: 4,
      alignItems: 'center',
    },
    gradeAgain: {
      backgroundColor: colors.coralSoft,
      borderWidth: 1,
      borderColor: colors.coral,
    },
    gradeGood: {
      backgroundColor: colors.lampSoft,
      borderWidth: 1,
      borderColor: colors.lamp,
    },
    gradeEasy: {
      backgroundColor: colors.sageSoft,
      borderWidth: 1,
      borderColor: colors.sage,
    },
    gradeBtnText: {
      fontFamily: fonts.bodyBold,
      fontSize: 13,
      marginBottom: 2,
    },
    gradeSubtext: {
      fontFamily: fonts.body,
      fontSize: 10.5,
      color: colors.textMuted,
    },
    doneContainer: {
      alignItems: 'center',
      paddingVertical: spacing.lg,
    },
    doneIconWrap: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.sageSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    doneTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 22,
      color: colors.textPrimary,
      marginBottom: 6,
      textAlign: 'center',
    },
    doneText: {
      fontFamily: fonts.body,
      fontSize: 13.5,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing.lg,
      paddingHorizontal: spacing.sm,
    },
    closeBtn: {
      paddingVertical: 10,
      paddingHorizontal: 22,
      backgroundColor: colors.lamp,
      borderRadius: radius.pill,
    },
    closeBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14,
      color: colors.ink,
    },
  });
}

