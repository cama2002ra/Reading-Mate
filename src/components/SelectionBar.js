// The selection toolbar, pinned just above the message box so it is always
// on screen — the old inline toolbar sat under the whole paragraph, which on
// a long text was far off-screen and easy to miss. The word/phrase picking
// itself still lives in TappableText.js; it reports its state up and this
// bar just renders the controls.
//
// selection shape: { text, isSingleWord, canExpandLeft, canExpandRight,
//   expandLeft, expandRight, selectSentence, explain, loop?, clear } | null

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export default function SelectionBar({ selection }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!selection) return null;

  const arrow = (name, enabled, onPress, label) => (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      style={[styles.arrowBtn, !enabled && styles.disabled]}
      hitSlop={6}
      accessibilityLabel={label}
    >
      <Ionicons name={name} size={20} color={enabled ? colors.lamp : colors.textFaint} />
    </Pressable>
  );

  return (
    <View style={styles.bar}>
      <View style={styles.topRow}>
        <Text style={styles.selected} numberOfLines={2}>
          “{selection.text}”
        </Text>
        <Pressable onPress={selection.clear} style={styles.closeBtn} hitSlop={10} accessibilityLabel="Clear selection">
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        {arrow('chevron-back', selection.canExpandLeft, selection.expandLeft, 'Add the previous word')}
        {arrow('chevron-forward', selection.canExpandRight, selection.expandRight, 'Add the next word')}
        <Pressable onPress={selection.selectSentence} style={styles.ghostBtn} hitSlop={4}>
          <Text style={styles.ghostText}>Sentence</Text>
        </Pressable>
        {selection.loop && (
          <Pressable onPress={selection.loop} style={styles.ghostBtn} hitSlop={4}>
            <Ionicons name="repeat" size={16} color={colors.lamp} />
            <Text style={[styles.ghostText, { marginLeft: 4 }]}>Loop</Text>
          </Pressable>
        )}
        <Pressable onPress={selection.explain} style={styles.primaryBtn} hitSlop={4}>
          <Ionicons name="sparkles" size={14} color={colors.ink} />
          <Text style={styles.primaryText}>Re-read for me</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    bar: {
      backgroundColor: colors.paperRaised,
      borderTopWidth: 2,
      borderTopColor: colors.lamp,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
    selected: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.textPrimary },
    closeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
    actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    arrowBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    disabled: { opacity: 0.4 },
    ghostBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
    ghostText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.lamp },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.lamp,
      borderRadius: radius.pill,
      paddingVertical: 9,
      paddingHorizontal: 14,
      marginLeft: 'auto',
    },
    primaryText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginLeft: 6 },
  });
}
