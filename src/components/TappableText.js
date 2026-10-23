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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
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
// Each word is its own memoized component, so tapping one word re-renders
// only the words whose state actually changed (the old and new selection)
// instead of every token in the passage — on a long text the old approach
// took about a second per tap.
const Space = React.memo(function Space({ token, style }) {
  return <Text style={style}>{token}</Text>;
});

const Word = React.memo(function Word({ index, token, style, selected, speaking, selectedStyle, speakingStyle, onTap }) {
  return (
    <Pressable onPress={() => onTap(index)} hitSlop={2}>
      <Text style={[style, selected && selectedStyle, speaking && speakingStyle]}>{token}</Text>
    </Pressable>
  );
});

export default function TappableText({ text, style, onExplain, onLoop, onSelectionChange, speakingCharIndex }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { tokens, wordTokenIndices } = useMemo(() => tokenize(text), [text]);
  const [selStart, setSelStart] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const [speakingSelection, setSpeakingSelection] = useState(false);

  const hasSelection = selStart !== null && selEnd !== null;
  const isSingleWord = hasSelection && selStart === selEnd;

  // Latest selection, readable from the stable tap handler below.
  const selRef = useRef({ selStart, selEnd });
  selRef.current = { selStart, selEnd };

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
    if (speakingSelection) {
      Speech.stop();
      setSpeakingSelection(false);
    }
    setSelStart(null);
    setSelEnd(null);
  };

  // One tap = one word, always. A tap NEVER silently stretches the
  // selection over everything in between (that was what made a whole
  // paragraph light up by accident). To select more, use the arrows
  // (one word at a time) or the "Sentence" button — both deliberate.
  //   - nothing selected      -> select the tapped word
  //   - tap inside selection  -> deselect (the easy way to cancel)
  //   - tap anywhere else     -> start over with just that word
  const handleWordTap = useCallback((tokenIndex) => {
    const { selStart: a, selEnd: b } = selRef.current;
    if (a !== null && b !== null && tokenIndex >= a && tokenIndex <= b) {
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    setSelStart(tokenIndex);
    setSelEnd(tokenIndex);
  }, []);

  // Selects the whole sentence around the current selection, on request.
  const selectSentence = () => {
    if (!hasSelection) return;
    const endsSentence = (i) => /[.!?]["')\]]*$/.test(tokens[i]);
    let start = selStart;
    for (let k = wordTokenIndices.indexOf(selStart) - 1; k >= 0; k--) {
      if (endsSentence(wordTokenIndices[k])) break;
      start = wordTokenIndices[k];
    }
    let end = selEnd;
    for (let k = wordTokenIndices.indexOf(selEnd); k < wordTokenIndices.length; k++) {
      end = wordTokenIndices[k];
      if (endsSentence(end)) break;
    }
    setSelStart(start);
    setSelEnd(end);
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

  // When a parent supplies onSelectionChange, the controls live in the
  // always-visible SelectionBar (see SelectionBar.js) instead of an inline
  // toolbar under the paragraph. Reports on every selection change, and
  // clears itself on unmount.
  const ownerId = useRef(Math.random().toString(36).slice(2)).current;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    const report = onSelectionChangeRef.current;
    if (!report) return undefined;
    if (!hasSelection) {
      report({ id: ownerId, text: null });
    } else {
      const picked = selectedText.trim();
      const single = isSingleWord;
      report({
        id: ownerId,
        text: picked,
        isSingleWord: single,
        canExpandLeft,
        canExpandRight,
        expandLeft,
        expandRight,
        selectSentence,
        clear: clearSelection,
        explain: () => {
          clearSelection();
          onExplain?.(picked, single);
        },
        loop: onLoop
          ? () => {
              clearSelection();
              onLoop(picked);
            }
          : null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd]);
  useEffect(
    () => () => onSelectionChangeRef.current?.({ id: ownerId, text: null }),
    [ownerId]
  );

  return (
    <View>
      <View style={styles.wrap}>
        {tokens.map((token, i) =>
          token.trim() === '' ? (
            <Space key={i} token={token} style={style} />
          ) : (
            <Word
              key={i}
              index={i}
              token={token}
              style={style}
              selected={hasSelection && i >= selStart && i <= selEnd}
              speaking={speakingTokenIndex === i}
              selectedStyle={styles.selectedWord}
              speakingStyle={styles.speakingWord}
              onTap={handleWordTap}
            />
          )
        )}
      </View>

      {hasSelection && !onSelectionChange && (
        <View style={styles.toolbar}>
          <Pressable
            onPress={expandLeft}
            disabled={!canExpandLeft}
            style={[styles.arrowBtn, !canExpandLeft && styles.arrowBtnDisabled]}
            hitSlop={6}
          >
            <Ionicons name="chevron-back" size={15} color={canExpandLeft ? colors.lamp : colors.textFaint} />
          </Pressable>

          <Pressable
            style={[styles.arrowBtn, { marginHorizontal: 2 }]}
            onPress={() => {
              if (speakingSelection) {
                Speech.stop();
                setSpeakingSelection(false);
                return;
              }
              const toSpeak = selectedText.trim();
              if (!toSpeak) return;
              Speech.stop();
              setSpeakingSelection(true);
              Speech.speak(toSpeak, {
                rate: theme.speechRate || 0.9,
                onDone: () => setSpeakingSelection(false),
                onStopped: () => setSpeakingSelection(false),
                onError: () => setSpeakingSelection(false),
              });
            }}
            hitSlop={6}
            accessibilityLabel={speakingSelection ? 'Stop audio' : 'Listen to selection'}
          >
            <Ionicons
              name={speakingSelection ? 'stop-circle' : 'volume-medium-outline'}
              size={16}
              color={speakingSelection ? colors.lamp : colors.textPrimary}
            />
          </Pressable>

          <Pressable
            style={styles.explainBtn}
            onPress={() => {
              const text = selectedText.trim();
              const single = isSingleWord;
              clearSelection(); // the highlight never gets stuck after asking
              onExplain?.(text, single);
            }}
          >
            <Ionicons name="sparkles" size={12} color={colors.ink} />
            <Text style={styles.explainBtnText}>Re-read for me</Text>
          </Pressable>

          <Pressable
            onPress={expandRight}
            disabled={!canExpandRight}
            style={[styles.arrowBtn, !canExpandRight && styles.arrowBtnDisabled]}
            hitSlop={6}
          >
            <Ionicons name="chevron-forward" size={15} color={canExpandRight ? colors.lamp : colors.textFaint} />
          </Pressable>

          {onLoop && (
            <Pressable
              onPress={() => {
                const text = selectedText.trim();
                clearSelection();
                onLoop(text);
              }}
              style={styles.loopBtn}
              hitSlop={6}
              accessibilityLabel="Listen to the selection on loop"
            >
              <Ionicons name="repeat" size={14} color={colors.lamp} />
              <Text style={styles.sentenceBtnText}>Loop</Text>
            </Pressable>
          )}

          <Pressable onPress={selectSentence} style={styles.sentenceBtn} hitSlop={6}>
            <Text style={styles.sentenceBtnText}>Sentence</Text>
          </Pressable>

          <Pressable onPress={clearSelection} style={styles.closeBtn} hitSlop={10}>
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
    // The word currently being read aloud: underlined, so it stays visible
    // even when it is also selected (selection uses a background instead).
    speakingWord: {
      textDecorationLine: 'underline',
      textDecorationColor: colors.lamp,
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
    sentenceBtn: { paddingHorizontal: 8, paddingVertical: 4 },
    loopBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
    sentenceBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.lamp },
    closeBtn: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 2,
    },
  });
}
