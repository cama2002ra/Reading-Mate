import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Animated, Easing, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import TappableText from './TappableText';
import QuizInline from './QuizInline';
import ImageViewerModal from './ImageViewerModal';

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// PDF reader pivot (§6): a `type: 'selection'` user message is a request
// logged from the WebView reader's selection-action menu — see
// PdfReader.js / SessionScreen.js. Rendered as a compact chip (page
// number, action label, short quoted excerpt) rather than a plain text
// bubble, since the content is a structured object
// { selectionText, pageIndex, action, customInstruction }, not a string.
const SELECTION_ACTION_META = {
  define: { label: 'Defined', icon: 'bookmark-outline' },
  explain: { label: 'Explained', icon: 'bulb-outline' },
  simplify: { label: 'Simplified', icon: 'sparkles-outline' },
  quiz: { label: 'Quizzed on', icon: 'help-circle-outline' },
  custom: { label: 'Asked about', icon: 'chatbubble-ellipses-outline' },
};

function selectionActionMeta(action) {
  return SELECTION_ACTION_META[action] || { label: 'Selected', icon: 'text-outline' };
}

function truncateExcerpt(text, max = 90) {
  const trimmed = (text || '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trim()}…`;
}

// Three dots that bounce in sequence — the "Reading Mate is thinking"
// state, replacing a plain spinner so a pending reply reads as part of the
// conversation instead of a loading screen.
function TypingDots({ color }) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(dot, { toValue: 1, duration: 280, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, easing: Easing.ease, useNativeDriver: true }),
          Animated.delay((2 - i) * 140),
        ])
      )
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View style={dotStyles.typingRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            dotStyles.typingDot,
            { backgroundColor: color },
            {
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

// Pure layout, no colors — doesn't need to be regenerated per theme like
// createStyles() below, so this stays a plain module-level StyleSheet.
const dotStyles = StyleSheet.create({
  typingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 2 },
  typingDot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 2 },
});

// message: { role: 'user' | 'model', type: 'text' | 'quiz' | 'image' | 'file', content, timestamp }
// A message with `pending: true` renders the typing-dots bubble instead
// (used while waiting on a Gemini reply).
//
// Since §2's design pass, this is only used for genuinely conversational
// turns — follow-up questions, the AI's short answers, and the quiz.
// The passage itself (the model's first reply, and any re-simplified text
// from a mid-session photo or document) renders through ReadingPane.js
// instead; see SessionScreen.js for which messages get routed where.
//
// image content is { url, storagePath, mimeType } for anything uploaded
// since the Firebase Storage migration, or the older inline
// { base64, mimeType } for anything recorded before it — both render fine.
// file content is { url, storagePath, mimeType, name } — an uploaded PDF,
// opened in whatever the device already handles PDFs with (no embedded
// viewer here).
//
// `speaking` / `onToggleSpeak` wire up the read-aloud button on text
// replies — the session screen owns the "which message is currently being
// read" state (only one utterance plays at a time), this component just
// reflects and triggers it. `onBookmark` / `bookmarked` do the same for
// the bookmark star (§7 backlog).
export default function ChatBubble({ message, onExplain, onQuizComplete, speaking, onToggleSpeak, onBookmark, bookmarked }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const isUser = message.role === 'user';
  const [viewerOpen, setViewerOpen] = useState(false);

  if (message.pending) {
    return (
      <View style={[styles.row, styles.rowAssistant]}>
        <View style={styles.avatar}>
          <Ionicons name="book" size={13} color={colors.ink} />
        </View>
        <View style={[styles.bubble, styles.assistantBubble]}>
          <TypingDots color={colors.lamp} />
        </View>
      </View>
    );
  }

  const isImage = message.type === 'image';
  const isFile = message.type === 'file';
  const isQuiz = message.type === 'quiz';
  const isSelection = message.type === 'selection';
  const isReadable = !isUser && !isImage && !isFile && !isQuiz;
  // Supports both image shapes: the pre-Storage inline { base64, mimeType }
  // some older recorded sessions may still have, and the current
  // { url, storagePath, mimeType } shape every new upload uses (see
  // services/uploads.js and the README's Firebase Storage section).
  const imageUri = isImage ? message.content.url || `data:${message.content.mimeType};base64,${message.content.base64}` : null;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Ionicons name="book" size={13} color={colors.ink} />
        </View>
      )}

      <View style={styles.column}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.assistantBubble,
            isImage && styles.imageBubble,
            isSelection && styles.selectionBubble,
          ]}
        >
          {isImage ? (
            <View>
              <Pressable onPress={() => setViewerOpen(true)} style={styles.imageWrap}>
                <Image source={{ uri: imageUri }} style={styles.thumbnail} resizeMode="contain" />
                <View style={styles.expandBadge}>
                  <Ionicons name="expand-outline" size={13} color={colors.textPrimary} />
                </View>
              </Pressable>
              {/* Only present on a photo sent via AttachmentInstructionModal's
                  "send instead" path — shows what was actually asked for,
                  same idea as the selection chip's customInstruction line
                  below, so the reply underneath doesn't read as unexplained
                  when it isn't the usual simplified rewrite. */}
              {!!message.content?.customInstruction && (
                <Text style={styles.attachmentInstruction} numberOfLines={2}>
                  {message.content.customInstruction}
                </Text>
              )}
            </View>
          ) : isFile ? (
            // No PDF viewer embedded in this app — this hands off to
            // whatever the device already opens PDFs with, the same way
            // tapping a PDF link in a browser would.
            <View>
              <Pressable
                style={styles.fileChip}
                onPress={() => message.content.url && Linking.openURL(message.content.url)}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.lamp} />
                <Text style={styles.fileChipText} numberOfLines={1}>
                  {message.content.name || 'Document'}
                </Text>
              </Pressable>
              {!!message.content?.customInstruction && (
                <Text style={styles.attachmentInstruction} numberOfLines={2}>
                  {message.content.customInstruction}
                </Text>
              )}
            </View>
          ) : isQuiz ? (
            <QuizInline questions={message.content} onComplete={onQuizComplete} />
          ) : isSelection ? (
            <View style={styles.selectionChip}>
              <Ionicons name={selectionActionMeta(message.content?.action).icon} size={15} color={colors.lamp} />
              <View style={styles.selectionChipTextWrap}>
                <Text style={styles.selectionChipLabel}>
                  {selectionActionMeta(message.content?.action).label}
                  {message.content?.pageIndex ? ` · Page ${message.content.pageIndex}` : ''}
                </Text>
                <Text style={styles.selectionChipExcerpt} numberOfLines={2}>
                  “{truncateExcerpt(message.content?.selectionText)}”
                </Text>
                {message.content?.action === 'custom' && !!message.content?.customInstruction && (
                  <Text style={styles.selectionChipInstruction} numberOfLines={1}>
                    {message.content.customInstruction}
                  </Text>
                )}
              </View>
            </View>
          ) : isUser ? (
            <Text style={styles.userText}>{message.content}</Text>
          ) : (
            <TappableText text={message.content} style={styles.assistantText} onExplain={onExplain} />
          )}
        </View>

        <View style={[styles.metaRow, isUser ? styles.metaRowUser : styles.metaRowAssistant]}>
          {isReadable && (
            <Pressable hitSlop={8} onPress={onToggleSpeak} style={styles.speakBtn}>
              <Ionicons
                name={speaking ? 'stop-circle' : 'volume-medium-outline'}
                size={14}
                color={speaking ? colors.lamp : colors.textFaint}
              />
            </Pressable>
          )}
          {isReadable && onBookmark && (
            <Pressable hitSlop={8} onPress={onBookmark} style={styles.speakBtn}>
              <Ionicons
                name={bookmarked ? 'star' : 'star-outline'}
                size={14}
                color={bookmarked ? colors.lamp : colors.textFaint}
              />
            </Pressable>
          )}
          {!!message.timestamp && <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>}
        </View>
      </View>

      {isImage && <ImageViewerModal visible={viewerOpen} uri={imageUri} onClose={() => setViewerOpen(false)} />}
    </View>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    row: { marginBottom: spacing.md, flexDirection: 'row', alignItems: 'flex-start' },
    rowUser: { justifyContent: 'flex-end' },
    rowAssistant: { justifyContent: 'flex-start' },

    avatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.xs,
      marginTop: 2,
    },

    column: { maxWidth: '82%' },

    bubble: {
      borderRadius: radius.md,
      padding: spacing.md,
      ...shadow,
    },
    imageBubble: { padding: 6 },
    selectionBubble: { paddingVertical: 8, paddingHorizontal: 10 },
    userBubble: {
      backgroundColor: colors.lampSoft,
      borderWidth: 1,
      borderColor: colors.lamp,
      borderBottomRightRadius: 4,
      alignSelf: 'flex-end',
    },
    assistantBubble: {
      // paperRaised, not paper — `paper` now specifically means "the
      // reading pane" (see ReadingPane.js) so conversational bubbles read
      // as a visually distinct, secondary surface, not the same page.
      backgroundColor: colors.paperRaised,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 4,
    },
    userText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.textPrimary, lineHeight: 21 },
    assistantText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.textPrimary, lineHeight: 22 },

    fileChip: { flexDirection: 'row', alignItems: 'center', maxWidth: 220 },
    fileChipText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.textPrimary, marginLeft: 7, flexShrink: 1 },

    selectionChip: { flexDirection: 'row', alignItems: 'flex-start', maxWidth: 260 },
    selectionChipTextWrap: { flex: 1, marginLeft: 7 },
    selectionChipLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: colors.lamp, marginBottom: 2 },
    selectionChipExcerpt: { fontFamily: fonts.body, fontStyle: 'italic', fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
    selectionChipInstruction: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textMuted, marginTop: 3 },
    attachmentInstruction: { fontFamily: fonts.body, fontSize: 11.5, fontStyle: 'italic', color: colors.textMuted, marginTop: 4, paddingHorizontal: 2 },

    imageWrap: { position: 'relative' },
    thumbnail: { width: 230, height: 230, borderRadius: radius.sm, backgroundColor: colors.ink },
    expandBadge: {
      position: 'absolute',
      bottom: 8,
      right: 8,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: 'rgba(20,24,29,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingHorizontal: 2 },
    metaRowUser: { justifyContent: 'flex-end' },
    metaRowAssistant: { justifyContent: 'flex-start' },
    timestamp: { fontFamily: fonts.body, fontSize: 10.5, color: colors.textFaint },
    speakBtn: { marginRight: 6 },
  });
}
