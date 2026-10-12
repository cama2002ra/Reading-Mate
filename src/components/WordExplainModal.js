// The tap-a-word definition popup from Milestone 1's ReadScreen, relocated
// here and extended with a `mode: 'sentence'` variant for TappableText's
// select-and-expand toolbar: 'word' when exactly one word is selected,
// 'sentence' for any longer selection. The "Got it!" word-tracking action
// only makes sense for single words, so it's hidden in sentence mode.

import React, { useMemo } from 'react';
import { View, Text, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import Button from './Button';
import { useTheme } from '../contexts/ThemeContext';

// popup shape: { mode: 'word' | 'sentence', term, loading, definition, error } | null
export default function WordExplainModal({ popup, onClose, onMarkLearned, onResume }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal visible={!!popup} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {popup && (
            <>
              <Text style={styles.term} numberOfLines={popup.mode === 'sentence' ? 6 : 1}>
                {popup.term}
              </Text>
              {popup.loading && <ActivityIndicator color={colors.lamp} />}
              {popup.error && <Text style={styles.error}>{popup.error}</Text>}
              {popup.definition && <Text style={styles.definition}>{popup.definition}</Text>}
              <View style={styles.actions}>
                <Button title="Close" variant="ghost" onPress={onClose} />
                {onResume && <Button title="Continue reading" onPress={onResume} />}
                {popup.mode === 'word' && popup.definition && (
                  <Button title="Got it!" onPress={onMarkLearned} />
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: spacing.lg },
    card: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
    term: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.lamp, marginBottom: spacing.sm },
    error: { fontFamily: fonts.body, color: colors.coral, fontSize: 13, marginBottom: spacing.sm },
    definition: { fontFamily: fonts.body, fontSize: 14.5, color: colors.textPrimary, lineHeight: 21, marginBottom: spacing.md },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  });
}
