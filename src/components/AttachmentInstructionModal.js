// The "what should Reading Mate do with this?" prompt — shown right after
// a photo or PDF is picked (camera, library, or "Choose file"), before
// anything is uploaded or sent to Gemini.
//
// Before this existed, picking a photo/PDF committed straight to one fixed
// action — simplify it to the session's reading level — with no way to ask
// for anything else instead (translate it, just check the grammar, answer
// one specific question about it). That's the same shape of choice the PDF
// reader's own selection-action menu already gives a student for a text
// selection (Define/Explain/Simplify/Quiz/custom — see SessionScreen.js's
// customPrompt modal); this brings photo/PDF attachments up to the same
// standard rather than leaving them as the one place in the app that acts
// on an attachment without asking first.
//
// Deliberately still one tap for the common case: `defaultLabel`'s button
// fires immediately with no typing required, so a student who really does
// just want the usual simplify-to-my-level treatment isn't slowed down by
// this at all. The instruction field is there for the other times.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Modal, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from './Button';
import { useTheme } from '../contexts/ThemeContext';

// `kind` only changes copy and the preview shown, never behavior — that's
// entirely up to what onDefault/onCustom do. `previewUri` (photos) and
// `fileName` (PDFs) are each ignored for the other kind.
export default function AttachmentInstructionModal({
  visible,
  kind = 'photo', // 'photo' | 'pdf'
  previewUri,
  fileName,
  defaultLabel = 'Simplify to my level',
  onDefault,
  onCustom,
  onCancel,
}) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [instruction, setInstruction] = useState('');

  // Clears any typed instruction each time a *new* attachment opens this
  // modal, so leftover text from a previous photo can never accidentally
  // ride along with a different one.
  useEffect(() => {
    if (visible) setInstruction('');
  }, [visible]);

  const noun = kind === 'pdf' ? 'document' : 'photo';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>What should I do with this {noun}?</Text>

          {kind === 'photo' && !!previewUri && (
            <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
          )}
          {kind === 'pdf' && (
            <View style={styles.fileRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.lamp} />
              <Text style={styles.fileName} numberOfLines={1}>
                {fileName || 'Document'}
              </Text>
            </View>
          )}

          <Button title={defaultLabel} onPress={onDefault} />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or tell me what to do instead</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            value={instruction}
            onChangeText={setInstruction}
            style={styles.input}
            placeholder={`e.g. "translate this to Spanish" or "just check my grammar"`}
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={300}
          />

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.sendBtn, !instruction.trim() && styles.sendBtnDisabled]}
              onPress={() => onCustom(instruction.trim())}
              disabled={!instruction.trim()}
            >
              <Text style={styles.sendText}>Send instead</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    card: {
      width: '100%',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: { fontFamily: fonts.bodySemiBold, fontSize: 15.5, color: colors.textPrimary, marginBottom: spacing.md },

    preview: { width: '100%', height: 140, borderRadius: radius.md, marginBottom: spacing.md, backgroundColor: colors.ink },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    fileName: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.textPrimary, marginLeft: spacing.xs, flexShrink: 1 },

    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.md },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textFaint, marginHorizontal: spacing.sm },

    input: {
      minHeight: 64,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.sm,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      fontSize: 14,
      textAlignVertical: 'top',
      backgroundColor: colors.paper,
    },

    actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
    cancelBtn: { paddingVertical: 8, paddingHorizontal: 14 },
    cancelText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.textMuted },
    sendBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: colors.lamp, borderRadius: radius.md, marginLeft: spacing.xs },
    sendBtnDisabled: { opacity: 0.4 },
    sendText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  });
}
