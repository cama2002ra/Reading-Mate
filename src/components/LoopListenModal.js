// "Listen on loop": shown while a selected word/phrase is being read aloud
// again and again, so a student who didn't catch or understand it can hear
// it as many times as they need before moving on. The audio itself is driven
// by SessionScreen.js (it owns the narration state and the resume position);
// this is just the controls.
//
// loop shape: { text, count, slow } | null

import React, { useMemo } from 'react';
import { View, Text, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from './Button';
import { useTheme } from '../contexts/ThemeContext';

export default function LoopListenModal({ loop, onStop, onToggleSlow, onExplain, onContinue }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal visible={!!loop} transparent animationType="fade" onRequestClose={onStop}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {loop && (
            <>
              <View style={styles.header}>
                <Ionicons name="repeat" size={18} color={colors.lamp} />
                <Text style={styles.status}>Playing on loop · repeat {loop.count + 1}</Text>
              </View>
              <Text style={styles.term} numberOfLines={6}>
                {loop.text}
              </Text>
              <View style={styles.row}>
                <Button
                  title={loop.slow ? 'Slow: on' : 'Slow: off'}
                  variant="ghost"
                  onPress={onToggleSlow}
                />
                <Button title="Explain it" variant="ghost" onPress={onExplain} />
              </View>
              <View style={styles.actions}>
                <Button title="Stop" variant="ghost" onPress={onStop} />
                {onContinue && <Button title="Continue reading" onPress={onContinue} />}
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
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    status: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted, marginLeft: 6 },
    term: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.lamp, marginBottom: spacing.md },
    row: { flexDirection: 'row', justifyContent: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  });
}
