import React, { useMemo, useState } from 'react';
import { View, Text, Modal, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import Button from './Button';
import { useTheme } from '../contexts/ThemeContext';

// popup shape: { mode: 'word' | 'sentence', term, loading, definition, error } | null
export default function WordExplainModal({ popup, onClose, onMarkLearned, onResume }) {
  const theme = useTheme();
  const { colors, radius } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [speaking, setSpeaking] = useState(false);

  const speakTerm = () => {
    if (!popup?.term || speaking) return;
    setSpeaking(true);
    Speech.speak(popup.term, {
      rate: 0.9,
      onDone: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  return (
    <Modal visible={!!popup} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {popup && (
            <>
              <View style={styles.headerRow}>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{popup.mode === 'word' ? 'Vocabulary Word' : 'Selected Passage'}</Text>
                </View>
                {popup.mode === 'word' && (
                  <Pressable
                    style={styles.speakBtn}
                    onPress={speakTerm}
                    accessibilityLabel="Pronounce word"
                    hitSlop={8}
                  >
                    <Ionicons
                      name={speaking ? 'volume-high' : 'volume-medium-outline'}
                      size={18}
                      color={colors.lamp}
                    />
                    <Text style={styles.speakBtnText}>{speaking ? 'Playing…' : 'Pronounce'}</Text>
                  </Pressable>
                )}
              </View>

              <Text style={styles.term} numberOfLines={popup.mode === 'sentence' ? 5 : 2}>
                {popup.term}
              </Text>

              {popup.loading && (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={colors.lamp} />
                  <Text style={styles.loadingText}>Reading Mate is explaining…</Text>
                </View>
              )}
              {popup.error && <Text style={styles.error}>{popup.error}</Text>}
              {popup.definition && (
                <View style={styles.definitionBox}>
                  <Text style={styles.definition}>{popup.definition}</Text>
                </View>
              )}

              <View style={styles.actions}>
                <Button title="Close" variant="ghost" onPress={onClose} />
                {onResume && <Button title="Continue reading" onPress={onResume} />}
                {popup.mode === 'word' && popup.definition && (
                  <Button title="Save to Vocabulary" onPress={onMarkLearned} />
                )}
              </View>
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
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    tag: {
      backgroundColor: colors.lampSoft,
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: radius.pill,
    },
    tagText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 11,
      color: colors.lamp,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    speakBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    speakBtnText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.lamp,
    },
    term: {
      fontFamily: fonts.displayBold,
      fontSize: 22,
      color: colors.textPrimary,
      marginBottom: spacing.md,
      lineHeight: 28,
    },
    loadingWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      gap: 10,
    },
    loadingText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.textMuted,
    },
    error: {
      fontFamily: fonts.body,
      color: colors.coral,
      fontSize: 13,
      marginBottom: spacing.sm,
    },
    definitionBox: {
      backgroundColor: colors.paperRaised,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.lg,
    },
    definition: {
      fontFamily: fonts.body,
      fontSize: 14.5,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
  });
}

