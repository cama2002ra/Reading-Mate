// Tap-to-select reading text, the replacement for Milestone 2's original
// tap-a-word / long-press-a-sentence split.
//
// Why the change: long-press is invisible until you find it by accident,
// and it only ever explains one whole sentence — there was no way to ask
// about a two-word phrase or a clause. This version makes selection an
// explicit, visible action instead: tap a word to select it, tap the
// arrows to grow the selection left/right one word at a time (or tap a
// further-away word to jump the selection straight to it), then tap
// Define/Explain in the toolbar that appears. Nothing happens until that
// button is tapped, and the toolbar is the same for every selection size —
// no gesture to discover, no ambiguity about what a tap did.
//
// Still no NLP library and no native text-selection API (React Native
// doesn't expose a clean "get selected text" range without a third-party
// dependency) — selection here is just "which word tokens are highlighted,"
// tracked as a start/end index into the word list.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

// Splits `text` into (word/whitespace) tokens, same approach as before.
// `wordTokenIndices` is every index into `tokens` that's an actual word
// (not whitespace) — used to step the selection forward/backward by whole
// words with the expand arrows.
function tokenize(text) {
  const tokens = text.split(/(\s+)/);
  const wordTokenIndices = [];
  tokens.forEach((token, i) => {
    if (token.trim() !== '') wordTokenIndices.push(i);
  });
  return { tokens, wordTokenIndices };
}

// Deliberately a single flat flex-wrap row of word tokens (matching
// Milestone 1's proven working pattern) rather than one wrap-view per
// sentence — nesting flexWrap views without fixed widths doesn't reliably
// wrap long sentences onto multiple lines in React Native.
//
// `speakingCharIndex` (optional) is the character offset expo-speech's
// onBoundary reports mid-utterance (see SessionScreen.js / ReadingPane.js)
// — when present, the token it falls inside is highlighted as "currently
// being read aloud," entirely independent of tap-selection above. The two
// can be visually active at once (a tapped word plus a moving read-aloud
// highlight elsewhere in the same text) without conflict, since they're
// tracked and styled separately.
export default function TappableText({ text, style, onExplain, speakingCharIndex }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { tokens, wordTokenIndices } = useMemo(() => tokenize(text), [text]);
  const [selStart, setSelStart] = useState(null);
  const [selEnd, setSelEnd] = useState(null);

  const hasSelection = selStart !== null && selEnd !== null;
  const isSingleWord = hasSelection && selStart === selEnd;

  // Maps a plain character offset into `text` (what onBoundary reports)
  // to which token in `tokens` contains it, so the read-aloud highlight
  // can move token-by-token in step with the audio.
  const speakingTokenIndex = useMemo(() => {
    if (speakingCharIndex == null) return null;
    let consumed = 0;
    for (let i = 0; i < tokens.length; i++) {
      consumed += tokens[i].length;
      if (speakingCharIndex < consumed) return i;
    }
    return null;
  }, [tokens, speakingCharIndex]);

  const clearSelection = () => {
    setSelStart(null);
    setSelEnd(null);
  };

  const handleWordTap = (tokenIndex) => {
    if (!hasSelection) {
      setSelStart(tokenIndex);
      setSelEnd(tokenIndex);
      return;
    }
    // Tapping the only selected word again deselects it — otherwise there'd
    // be no way to clear a single-word selection except the × button.
    if (isSingleWord && tokenIndex === selStart) {
      clearSelection();
      return;
    }
    // Tapping any other word grows the selection to also cover it — the
    // range always stays [min(selStart, selEnd, tapped), max(...)].
    setSelStart(Math.min(selStart, tokenIndex));
    setSelEnd(Math.max(selEnd, tokenIndex));
  };

  const expandLeft = () => {
    const candidates = wordTokenIndices.filter((i) => i < selStart);
    if (candidates.length) setSelStart(candidates[candidates.length - 1]);
  };

  const expandRight = () => {
    const next = wordTokenIndices.find((i) => i > selEnd);
    if (next !== undefined) setSelEnd(next);
  };

  const canExpandLeft = hasSelection && wordTokenIndices[0] < selStart;
  const canExpandRight = hasSelection && wordTokenIndices[wordTokenIndices.length - 1] > selEnd;

  const selectedText = hasSelection ? tokens.slice(selStart, selEnd + 1).join('') : '';

  return (
    <View>
      <View style={styles.wrap}>
        {tokens.map((token, i) => {
          if (token.trim() === '') {
            return (
              <Text key={i} style={style}>
                {token}
              </Text>
            );
          }
          const selected = hasSelection && i >= selStart && i <= selEnd;
          const speaking = speakingTokenIndex === i;
          return (
            <Pressable key={i} onPress={() => handleWordTap(i)} hitSlop={2}>
              <Text style={[style, selected && styles.selectedWord, speaking && styles.speakingWord]}>{token}</Text>
            </Pressable>
          );
        })}
      </View>

      {hasSelection && (
        <View style={styles.toolbar}>
          <Pressable
            onPress={expandLeft}
            disabled={!canExpandLeft}
            style={[styles.arrowBtn, !canExpandLeft && styles.arrowBtnDisabled]}
            hitSlop={6}
          >
            <Ionicons name="chevron-back" size={15} color={canExpandLeft ? colors.lamp : colors.textFaint} />
          </Pressable>

          <Pressable style={styles.explainBtn} onPress={() => onExplain?.(selectedText.trim(), isSingleWord)}>
            <Ionicons name="sparkles" size={12} color={colors.ink} />
            <Text style={styles.explainBtnText}>{isSingleWord ? 'Define' : 'Explain'}</Text>
          </Pressable>

          <Pressable
            onPress={expandRight}
            disabled={!canExpandRight}
            style={[styles.arrowBtn, !canExpandRight && styles.arrowBtnDisabled]}
            hitSlop={6}
          >
            <Ionicons name="chevron-forward" size={15} color={canExpandRight ? colors.lamp : colors.textFaint} />
          </Pressable>

          <Pressable onPress={clearSelection} style={styles.closeBtn} hitSlop={6}>
            <Ionicons name="close" size={15} color={colors.textFaint} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    wrap: { flexDirection: 'row', flexWrap: 'wrap' },
    selectedWord: {
      backgroundColor: colors.lampSoft,
      borderRadius: 3,
      overflow: 'hidden',
      color: colors.lamp,
    },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 4,
      paddingHorizontal: 4,
      marginTop: spacing.sm,
      ...shadow,
    },
    arrowBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
    arrowBtnDisabled: { opacity: 0.5 },
    explainBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.lamp,
      borderRadius: radius.pill,
      paddingVertical: 6,
      paddingHorizontal: 12,
      marginHorizontal: 2,
    },
    explainBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12.5,
      color: colors.ink,
      marginLeft: 5,
    },
    closeBtn: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 2,
    },
  });
}
