// The review flow for the vocabulary spaced-repetition schedule (§5 item
// 5 of the PDF-Native Reader Pivot plan) — a simple three-button flashcard
// loop over whatever ProgressScreen.js's "Due for review" section hands
// it. See services/spacedRepetition.js for the actual scheduling math this
// drives, and firestore.js's reviewVocabWord() for the write.
//
// Deliberately self-contained (takes `uid` directly and writes reviews
// itself) rather than routing each grade back up through ProgressScreen —
// same shape as WordExplainModal.js, a self-contained popup that owns its
// own interaction loop.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { reviewVocabWord } from '../services/firestore';

export default function VocabReviewModal({ visible, words, uid, onClose }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);

  // Fresh run through the queue every time the modal opens — words is a
  // snapshot taken when "Review" was tapped (see ProgressScreen.js), not a
  // live-updating list, so restarting at 0 each open is correct rather
  // than picking up mid-queue from a previous session.
  useEffect(() => {
    if (visible) {
      setIndex(0);
      setRevealed(false);
    }
  }, [visible]);

  const current = words[index];

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
            <>
              <Ionicons name="checkmark-circle" size={30} color={colors.sage} />
              <Text style={styles.doneText}>
                {words.length === 0 ? "No words due right now — check back later." : "All caught up!"}
              </Text>
              <Pressable style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeBtnText}>Close</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.progressLabel}>
                {index + 1} of {words.length}
              </Text>
              <Text style={styles.word}>{current.word}</Text>

              {revealed ? (
                <Text style={styles.definition}>
                  {current.definition || "No saved definition for this word — you'll need to look it up again."}
                </Text>
              ) : (
                <Pressable style={styles.revealBtn} onPress={() => setRevealed(true)}>
                  <Text style={styles.revealBtnText}>Show definition</Text>
                </Pressable>
              )}

              {revealed &&
                (grading ? (
                  <ActivityIndicator color={colors.lamp} style={{ marginTop: 18 }} />
                ) : (
                  <View style={styles.gradeRow}>
                    <Pressable style={[styles.gradeBtn, styles.gradeAgain]} onPress={() => grade('again')}>
                      <Text style={styles.gradeBtnText}>Still learning</Text>
                    </Pressable>
                    <Pressable style={[styles.gradeBtn, styles.gradeGood]} onPress={() => grade('good')}>
                      <Text style={styles.gradeBtnText}>Got it</Text>
                    </Pressable>
                    <Pressable style={[styles.gradeBtn, styles.gradeEasy]} onPress={() => grade('easy')}>
                      <Text style={styles.gradeBtnText}>Easy</Text>
                    </Pressable>
                  </View>
                ))}

              <Pressable style={styles.skipLink} onPress={onClose}>
                <Text style={styles.skipLinkText}>Close</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(10,12,15,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    card: {
      width: '100%',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.lg,
      padding: spacing.lg,
      alignItems: 'center',
    },
    progressLabel: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textFaint, marginBottom: 10 },
    word: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.textPrimary, marginBottom: 16 },
    definition: {
      fontFamily: fonts.displayRegular,
      fontSize: 15,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 21,
      marginBottom: 6,
    },
    revealBtn: {
      borderWidth: 1,
      borderColor: colors.lamp,
      borderRadius: radius.pill,
      paddingVertical: 9,
      paddingHorizontal: 18,
    },
    revealBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.lamp },
    gradeRow: { flexDirection: 'row', marginTop: 18, width: '100%' },
    gradeBtn: { flex: 1, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', marginHorizontal: 4 },
    gradeAgain: { backgroundColor: colors.coralSoft, borderWidth: 1, borderColor: colors.coral },
    gradeGood: { backgroundColor: colors.lampSoft, borderWidth: 1, borderColor: colors.lamp },
    gradeEasy: { backgroundColor: colors.sageSoft, borderWidth: 1, borderColor: colors.sage },
    gradeBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.textPrimary, textAlign: 'center' },
    skipLink: { marginTop: 16 },
    skipLinkText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textFaint, textDecorationLine: 'underline' },
    doneText: { fontFamily: fonts.bodyMedium, fontSize: 14.5, color: colors.textPrimary, marginTop: 10, marginBottom: 18, textAlign: 'center' },
    closeBtn: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.lamp, borderRadius: radius.md },
    closeBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.ink },
  });
}
