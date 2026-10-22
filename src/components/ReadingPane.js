// The reading pane — where the actual passage lives, as distinct from the
// conversational chat bubbles around it (see ChatBubble.js). This is the
// single biggest piece of §2 of the M2 continuation brief: before this,
// the passage rendered through the exact same avatar-and-bubble treatment
// as every other message, which is why the app could start to feel like a
// thin skin over a chatbot instead of something built specifically for
// reading. This is deliberately plain and page-like instead: near-full
// width, serif type, no avatar, no bubble tail, no timestamp.
//
// Used for exactly two things in a session (see SessionScreen.js): the
// model's first reply (the original simplified passage), and the
// simplified text that follows any photo attached mid-session — never for
// ordinary conversational replies, which stay as ChatBubble.

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import TappableText from './TappableText';
import { READING_FONT_SIZE_STEPS } from '../theme';

export default function ReadingPane({
  text,
  sourceType, // 'image' | 'file' | null — what this passage was simplified from, if anything
  onViewSource,
  onExplain,
  onLoop,
  onSelectionChange,
  speaking,
  onToggleSpeak,
  speakingCharIndex,
  onBookmark,
  bookmarked,
}) {
  const theme = useTheme();
  const { colors, readingFontSize, readingFontStyle, setReadingFontSize } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.pane}>
      <View style={styles.toolbar}>
        {sourceType ? (
          <Pressable style={styles.photoChip} onPress={onViewSource} hitSlop={8}>
            <Ionicons name={sourceType === 'file' ? 'document-text-outline' : 'image-outline'} size={14} color={colors.textMuted} />
            <Text style={styles.photoChipText}>{sourceType === 'file' ? 'Document' : 'Photo'}</Text>
          </Pressable>
        ) : (
          <View style={styles.photoChipSpacer} />
        )}

        <View style={styles.fontSizeRow}>
          {READING_FONT_SIZE_STEPS.map((step, i) => (
            <Pressable
              key={step}
              onPress={() => setReadingFontSize(step)}
              hitSlop={6}
              style={styles.fontSizeBtn}
              accessibilityLabel={`${step} reading text size`}
            >
              <Text
                style={[
                  styles.fontSizeBtnText,
                  { fontSize: 11 + i * 3 },
                  readingFontSize === step && styles.fontSizeBtnTextActive,
                ]}
              >
                A
              </Text>
            </Pressable>
          ))}
        </View>

        {onBookmark && (
          <Pressable style={styles.speakBtn} onPress={onBookmark} hitSlop={8}>
            <Ionicons name={bookmarked ? 'star' : 'star-outline'} size={19} color={bookmarked ? colors.lamp : colors.textMuted} />
          </Pressable>
        )}

        <Pressable style={styles.speakBtn} onPress={onToggleSpeak} hitSlop={8}>
          <Ionicons
            name={speaking ? 'stop-circle' : 'volume-medium-outline'}
            size={20}
            color={speaking ? colors.lamp : colors.textMuted}
          />
        </Pressable>
      </View>

      <TappableText
        text={text}
        style={[styles.passageText, { fontSize: readingFontStyle.fontSize, lineHeight: readingFontStyle.lineHeight }]}
        onExplain={onExplain}
        onLoop={onLoop}
        onSelectionChange={onSelectionChange}
        speakingCharIndex={speaking ? speakingCharIndex : null}
      />
    </View>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    pane: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.lg,
      marginTop: spacing.xs,
      ...shadow,
    },
    toolbar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    photoChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      paddingVertical: 4,
      paddingHorizontal: 9,
      marginRight: 'auto',
    },
    photoChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.textMuted, marginLeft: 4 },
    photoChipSpacer: { marginRight: 'auto' },
    fontSizeRow: { flexDirection: 'row', alignItems: 'flex-end', marginRight: spacing.md },
    fontSizeBtn: { paddingHorizontal: 4, paddingVertical: 2 },
    fontSizeBtnText: { fontFamily: fonts.bodySemiBold, color: colors.textFaint },
    fontSizeBtnTextActive: { color: colors.lamp },
    speakBtn: { padding: 2 },
    passageText: { fontFamily: fonts.displayRegular, color: colors.textPrimary },
  });
}
