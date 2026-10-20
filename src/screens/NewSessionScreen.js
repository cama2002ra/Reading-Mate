import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';

import ScreenContainer from '../components/ScreenContainer';
import Button from '../components/Button';
import AttachmentInstructionModal from '../components/AttachmentInstructionModal';
import { useTheme } from '../contexts/ThemeContext';
import {
  simplifyText,
  simplifyFromImage,
  analyzeImageWithInstruction,
  generateSessionTitle,
  GeminiError,
} from '../services/gemini';
import {
  createSession,
  newSessionId,
  appendMessages,
  recordPassageRead,
  subscribeToProgress,
  updateSessionTitle,
} from '../services/firestore';
import {
  uploadSessionPhoto,
  uploadSessionDocument,
  generateMessageId,
  friendlyUploadErrorMessage,
  MAX_UPLOAD_BYTES,
  readPickedFileAsText,
} from '../services/uploads';
import { useAuth } from '../contexts/AuthContext';
import { LEVELS, nextLevel } from '../constants/levels';

// Decides how a file picked via "Choose file" gets handled — the "if it
// can go straight into the reader, render it as-is; if not, the app
// extracts and rewrites it" split the file-upload feature is built around:
//   'pdf'         -> uploaded to Storage, opened straight into the reader-
//                     mode WebView (§3) — no Gemini call at all until the
//                     student selects something (§4.3)
//   'text'        -> already plain text; read locally and reused through
//                     the exact same paste-text pipeline as startFromText
//   'unsupported' -> nothing built yet can read it (e.g. .docx, .epub) —
//                     ask the person to convert it or paste the text instead
function classifyPickedFile(asset) {
  const ext = (asset.name || '').split('.').pop()?.toLowerCase();
  const mimeType = asset.mimeType || '';

  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType.startsWith('text/') || ['txt', 'md', 'markdown'].includes(ext)) return 'text';
  return 'unsupported';
}

// Reader-mode sessions (see startFromFile's 'pdf' branch below) skip
// generateSessionTitle() entirely — that's a Gemini call, and §4.3 is
// explicit that opening a reader-mode session should make zero of those
// until the student actually selects something. A real document's own
// filename is usually a perfectly good title anyway.
function titleFromFileName(name) {
  const withoutExtension = (name || 'Reading session').replace(/\.[^./]+$/, '');
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').trim();
  return cleaned || 'Reading session';
}

export default function NewSessionScreen({ route, navigation }) {
  const theme = useTheme();
  const { colors, spacing } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { user } = useAuth();
  const [level, setLevel] = useState(LEVELS[1].key);
  const [activeTab, setActiveTab] = useState(route?.params?.initialMode || 'pdf'); // 'pdf' | 'text' | 'photo'
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // 0-1, or null when not uploading
  const [error, setError] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  // A photo picked via "Snap a page"/"Choose photo" waits here, mid-air,
  // until AttachmentInstructionModal.js's prompt is answered — see its own
  // header comment for why a photo shouldn't commit straight to the
  // simplify default the instant it's picked. { asset, mimeType } | null.
  const [pendingPhoto, setPendingPhoto] = useState(null);

  useEffect(() => {
    if (route?.params?.initialMode) {
      setActiveTab(route.params.initialMode);
    }
  }, [route?.params?.initialMode]);

  // Adaptive level suggestion: if the last 3 quiz scores at the current
  // level average above 80%, nudge toward the next level up.
  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToProgress(user.uid, (progress) => {
      const upgrade = nextLevel(level);
      const scoresAtLevel = progress.recentQuizScores.filter((s) => s.level === level).slice(-3);
      if (upgrade && scoresAtLevel.length >= 3) {
        const average = scoresAtLevel.reduce((sum, s) => sum + s.score, 0) / scoresAtLevel.length;
        setSuggestion(average > 80 ? upgrade : null);
      } else {
        setSuggestion(null);
      }
    });
    return unsubscribe;
  }, [user, level]);

  const launchSession = async ({ sessionId, firstMessage, firstReply, titleSource }) => {
    const id = await createSession(user.uid, { sessionId, level, firstMessage });
    await appendMessages(user.uid, id, [
      { role: 'model', type: 'text', content: firstReply, timestamp: Date.now() },
    ]);
    await recordPassageRead(user.uid);

    setLoading(false);
    navigation.replace('Session', { sessionId: id });

    // Fire-and-forget: a slow or failed title just leaves "New reading
    // session" as the fallback, not worth blocking or erroring the
    // transition over.
    generateSessionTitle(titleSource)
      .then((title) => title && updateSessionTitle(user.uid, id, title))
      .catch(() => {});
  };

  const startFromText = async () => {
    if (!inputText.trim()) {
      setError('Paste or type a passage first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const passage = inputText.trim();
      const simplified = await simplifyText(passage, level);
      await launchSession({
        firstMessage: { role: 'user', type: 'text', content: passage, timestamp: Date.now() },
        firstReply: simplified,
        titleSource: passage,
      });
    } catch (err) {
      setError(err instanceof GeminiError ? err.message : 'Something went wrong. Try again.');
      setLoading(false);
    }
  };

  // Picks the photo and stops there — no upload, no Gemini call yet. What
  // happens to it is decided by AttachmentInstructionModal.js's prompt
  // (rendered below, driven by pendingPhoto), not baked in here.
  const startFromImage = async (fromCamera) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        fromCamera ? 'Camera access is needed to snap a page.' : 'Photo library access is needed to pick a page.'
      );
      return;
    }

    setError(null);
    try {
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setPendingPhoto({ asset, mimeType: asset.mimeType || 'image/jpeg' });
    } catch (err) {
      setError('Could not read that photo. Try again.');
    }
  };

  // Fires once the student answers the prompt — `customInstruction` is
  // null for the default "Simplify to my level" button, or the typed
  // instruction for "Send instead". Everything from here on (upload, the
  // actual Gemini call, launching the session) is identical either way
  // apart from which of those two the reply comes from.
  const confirmPendingPhoto = async (customInstruction) => {
    const pending = pendingPhoto;
    setPendingPhoto(null);
    if (!pending) return;
    const { asset, mimeType } = pending;

    setLoading(true);
    setUploadProgress(0);
    try {
      // The Storage path is users/{uid}/sessions/{sessionId}/{messageId}.jpg
      // (see services/uploads.js), which means the session's id has to be
      // known *before* either the upload or the session document itself
      // exist — newSessionId() just reserves one client-side, for free.
      const sessionId = newSessionId(user.uid);
      const messageId = generateMessageId();
      const uploaded = await uploadSessionPhoto({
        uid: user.uid,
        sessionId,
        messageId,
        base64: asset.base64,
        mimeType,
        onProgress: setUploadProgress,
      });

      const reply = customInstruction
        ? await analyzeImageWithInstruction(asset.base64, mimeType, customInstruction, level)
        : await simplifyFromImage(asset.base64, mimeType, level);

      await launchSession({
        sessionId,
        firstMessage: {
          role: 'user',
          type: 'image',
          content: customInstruction ? { ...uploaded, customInstruction } : uploaded,
          timestamp: Date.now(),
        },
        firstReply: reply,
        titleSource: reply,
      });
    } catch (err) {
      setError(
        err instanceof GeminiError
          ? err.message
          : err?.code
          ? friendlyUploadErrorMessage(err)
          : 'Could not read that photo. Try again.'
      );
      setLoading(false);
    } finally {
      setUploadProgress(null);
    }
  };

  const startFromFile = async () => {
    let result;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'text/markdown', 'text/*'],
        copyToCacheDirectory: true,
      });
    } catch (err) {
      setError('Could not open the file picker. Try again.');
      return;
    }
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setError(null);

    const kind = classifyPickedFile(asset);
    if (kind === 'unsupported') {
      const ext = (asset.name || 'that file').split('.').pop();
      setError(`Reading Mate can't read .${ext} files yet — try a PDF, a .txt file, or paste the text instead.`);
      return;
    }
    if ((asset.size ?? 0) > MAX_UPLOAD_BYTES) {
      setError(
        `That file is too big (${Math.round(asset.size / 1024)} KB) — Reading Mate handles files up to ` +
          `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB for now. Try a shorter document or paste the text instead.`
      );
      return;
    }

    setLoading(true);
    try {
      if (kind === 'pdf') {
        // §3's new primary path for a PDF: render it as-is instead of
        // rewriting it. Uploads the same way as before (Storage mechanics
        // unchanged — see services/uploads.js), but from here on this is
        // NOT launchSession()'s rewrite-then-chat flow: no
        // simplifyFromDocument() call, no firstMessage/firstReply pair, no
        // generateSessionTitle() call — §4.3 is explicit that opening a
        // reader-mode session should make zero Gemini calls until the
        // student actually selects something in the WebView reader.
        // No readPickedFileAsBase64() call here on purpose: this is the
        // exact spot the "Location ... isn't readable" crash came from
        // (reading a DocumentPicker cache URI via expo-file-system, which
        // Expo Go's Android build can flake on). Nothing downstream of an
        // opened reader-mode session needs base64 in JS — no Gemini call
        // happens until the student picks something in the WebView (see
        // the 'pdf' branch comment below) — so this hands the picked
        // file's own URI straight to uploadSessionDocument, which uploads
        // it via a FormData file part instead. That's a different code
        // path inside React Native's networking layer, one that reads the
        // file itself natively rather than calling back into
        // expo-file-system — see services/uploads.js's uploadSessionMedia
        // for the full explanation.
        const mimeType = asset.mimeType || 'application/pdf';
        setUploadProgress(0);

        const sessionId = newSessionId(user.uid);
        const messageId = generateMessageId();
        const uploaded = await uploadSessionDocument({
          uid: user.uid,
          sessionId,
          messageId,
          fileUri: asset.uri,
          fileName: asset.name,
          mimeType,
          extension: 'pdf',
          onProgress: setUploadProgress,
        });

        // pageCount isn't known yet — PdfReader backfills it via
        // updateSessionSourceFilePageCount() once the WebView has actually
        // opened the document (see SessionScreen.js's handleReaderDocLoaded).
        await createSession(user.uid, {
          sessionId,
          level,
          mode: 'reader',
          sourceFile: { ...uploaded, name: asset.name, pageCount: null },
        });
        await updateSessionTitle(user.uid, sessionId, titleFromFileName(asset.name));
        await recordPassageRead(user.uid);

        setLoading(false);
        navigation.replace('Session', { sessionId });
      } else {
        // Text files ARE the extraction case: a .txt/.md file is already
        // plain text, so the app reads it itself and feeds it through the
        // exact same pipeline as pasted text (no Storage upload at all —
        // there are no meaningful bytes here beyond the string itself).
        const passage = (await readPickedFileAsText(asset.uri)).trim();
        if (!passage) {
          setError('That file looks empty.');
          setLoading(false);
          return;
        }
        const simplified = await simplifyText(passage, level);
        await launchSession({
          firstMessage: { role: 'user', type: 'text', content: passage, timestamp: Date.now() },
          firstReply: simplified,
          titleSource: passage,
        });
      }
    } catch (err) {
      console.error('[startFromFile]', err?.code, err?.message, err);
      setError(
        err instanceof GeminiError
          ? err.message
          : err?.code
          ? friendlyUploadErrorMessage(err)
          : 'Could not read that file. Try again.'
      );
      setLoading(false);
    } finally {
      setUploadProgress(null);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.heading}>Start a Reading</Text>
      <Text style={styles.subheading}>
        Choose your material below — Reading Mate tailors everything to your level.
      </Text>

      {/* Target Reading Level Row */}
      <View style={styles.levelRow}>
        {LEVELS.map((l) => (
          <Pressable
            key={l.key}
            onPress={() => setLevel(l.key)}
            style={[styles.chip, level === l.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, level === l.key && styles.chipTextActive]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>

      {suggestion && !dismissedSuggestion && (
        <View style={styles.suggestionChip}>
          <Ionicons name="trending-up" size={14} color={colors.sage} />
          <Pressable
            style={styles.suggestionTextWrap}
            onPress={() => {
              setLevel(suggestion.key);
              setDismissedSuggestion(true);
            }}
          >
            <Text style={styles.suggestionText}>You're doing great — try {suggestion.label}?</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setDismissedSuggestion(true)}>
            <Ionicons name="close" size={14} color={colors.textFaint} />
          </Pressable>
        </View>
      )}

      {/* Studio Segmented Tabs */}
      <View style={styles.studioTabs}>
        <Pressable
          style={[styles.studioTab, activeTab === 'pdf' && styles.studioTabActive]}
          onPress={() => setActiveTab('pdf')}
        >
          <Ionicons
            name="document-text-outline"
            size={16}
            color={activeTab === 'pdf' ? colors.ink : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.studioTabText, activeTab === 'pdf' && styles.studioTabTextActive]}>
            Document / PDF
          </Text>
        </Pressable>

        <Pressable
          style={[styles.studioTab, activeTab === 'text' && styles.studioTabActive]}
          onPress={() => setActiveTab('text')}
        >
          <Ionicons
            name="create-outline"
            size={16}
            color={activeTab === 'text' ? colors.ink : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.studioTabText, activeTab === 'text' && styles.studioTabTextActive]}>
            Paste Text
          </Text>
        </Pressable>

        <Pressable
          style={[styles.studioTab, activeTab === 'photo' && styles.studioTabActive]}
          onPress={() => setActiveTab('photo')}
        >
          <Ionicons
            name="camera-outline"
            size={16}
            color={activeTab === 'photo' ? colors.ink : colors.textMuted}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.studioTabText, activeTab === 'photo' && styles.studioTabTextActive]}>
            Photo / Scan
          </Text>
        </Pressable>
      </View>

      {/* Tab 1: PDF Document */}
      {activeTab === 'pdf' && (
        <View style={styles.studioPanel}>
          <View style={styles.uploadBox}>
            <View style={styles.uploadIconWrap}>
              <Ionicons name="cloud-upload-outline" size={38} color={colors.lamp} />
            </View>
            <Text style={styles.uploadTitle}>Open an Interactive Document</Text>
            <Text style={styles.uploadDesc}>
              Upload textbooks, research articles, or lecture slides (PDF up to 15 MB).
              Opens in the interactive reader with instant on-page definitions, AI explanations & page quizzes.
            </Text>
            <View style={{ width: '100%', marginTop: spacing.md }}>
              <Button
                title="Choose PDF Document"
                onPress={startFromFile}
                loading={loading}
              />
            </View>
          </View>
        </View>
      )}

      {/* Tab 2: Paste Text */}
      {activeTab === 'text' && (
        <View style={styles.studioPanel}>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Paste an article, chapter, homework assignment, or challenging text…"
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.input}
            editable={!loading}
          />
          <View style={styles.textMetaRow}>
            <Text style={styles.textCharCount}>
              {inputText.length > 0 ? `${inputText.length} characters` : 'Ready to simplify'}
            </Text>
          </View>
          <Button title="Simplify & Start Reading" onPress={startFromText} loading={loading} />
        </View>
      )}

      {/* Tab 3: Photo / Scan */}
      {activeTab === 'photo' && (
        <View style={styles.studioPanel}>
          <View style={styles.photoOptionsGrid}>
            <Pressable
              style={styles.photoOptionCard}
              onPress={() => startFromImage(true)}
              disabled={loading}
            >
              <View style={[styles.photoOptionIcon, { backgroundColor: colors.coralSoft }]}>
                <Ionicons name="camera" size={26} color={colors.coral} />
              </View>
              <Text style={styles.photoOptionTitle}>Take Photo</Text>
              <Text style={styles.photoOptionDesc}>Snap a page from a physical book, worksheet, or handout</Text>
            </Pressable>

            <Pressable
              style={styles.photoOptionCard}
              onPress={() => startFromImage(false)}
              disabled={loading}
            >
              <View style={[styles.photoOptionIcon, { backgroundColor: colors.lampSoft }]}>
                <Ionicons name="images" size={26} color={colors.lamp} />
              </View>
              <Text style={styles.photoOptionTitle}>Photo Library</Text>
              <Text style={styles.photoOptionDesc}>Pick an existing image of text from your device photo gallery</Text>
            </Pressable>
          </View>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {loading && (
        <View style={{ alignItems: 'center', marginTop: spacing.md }}>
          <ActivityIndicator color={colors.lamp} />
          {uploadProgress !== null && (
            <Text style={styles.uploadProgressText}>
              {uploadProgress > 0 ? `Uploading… ${Math.round(uploadProgress * 100)}%` : 'Uploading document…'}
            </Text>
          )}
        </View>
      )}

      <AttachmentInstructionModal
        visible={!!pendingPhoto}
        kind="photo"
        previewUri={pendingPhoto?.asset?.uri}
        defaultLabel="Simplify to my level"
        onDefault={() => confirmPendingPhoto(null)}
        onCustom={(instruction) => confirmPendingPhoto(instruction)}
        onCancel={() => setPendingPhoto(null)}
      />
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    heading: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.textPrimary },
    subheading: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md },

    levelRow: { flexDirection: 'row', marginBottom: spacing.md, flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.paper,
    },
    chipActive: { backgroundColor: colors.lampSoft, borderColor: colors.lamp },
    chipText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.textMuted },
    chipTextActive: { color: colors.lamp, fontFamily: fonts.bodySemiBold },

    suggestionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.sageSoft,
      borderWidth: 1,
      borderColor: colors.sage,
      borderRadius: radius.pill,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: spacing.md,
    },
    suggestionTextWrap: { flex: 1 },
    suggestionText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.sage, marginLeft: 6, marginRight: 6 },

    // Studio Tabs
    studioTabs: {
      flexDirection: 'row',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      padding: 3,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    studioTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      borderRadius: radius.pill,
    },
    studioTabActive: {
      backgroundColor: colors.lamp,
    },
    studioTabText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12.5,
      color: colors.textMuted,
    },
    studioTabTextActive: {
      fontFamily: fonts.bodySemiBold,
      color: colors.ink,
    },

    studioPanel: {
      marginBottom: spacing.md,
    },

    // PDF Upload Box
    uploadBox: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderStyle: 'dashed',
      padding: spacing.xl,
      alignItems: 'center',
      textAlign: 'center',
    },
    uploadIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.lampSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    uploadTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: colors.textPrimary,
      marginBottom: 6,
      textAlign: 'center',
    },
    uploadDesc: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
      textAlign: 'center',
      marginBottom: spacing.md,
      maxWidth: 420,
    },

    // Text Input Panel
    input: {
      minHeight: 130,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      fontSize: 14.5,
      textAlignVertical: 'top',
      marginBottom: spacing.xs,
    },
    textMetaRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: spacing.md,
    },
    textCharCount: {
      fontFamily: fonts.body,
      fontSize: 11.5,
      color: colors.textFaint,
    },

    // Photo Options Grid
    photoOptionsGrid: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    photoOptionCard: {
      flex: 1,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      alignItems: 'center',
    },
    photoOptionIcon: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    photoOptionTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 4,
      textAlign: 'center',
    },
    photoOptionDesc: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 16,
    },

    error: { fontFamily: fonts.body, color: colors.coral, fontSize: 13, marginTop: spacing.xs, marginBottom: spacing.sm },
    uploadProgressText: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 6 },
  });
}
