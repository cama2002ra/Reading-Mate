import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import ScreenContainer from '../components/ScreenContainer';
import ChatBubble from '../components/ChatBubble';
import ReadingPane from '../components/ReadingPane';
import PdfReader from '../components/PdfReader';
import WordExplainModal from '../components/WordExplainModal';
import LoopListenModal from '../components/LoopListenModal';
import SelectionBar from '../components/SelectionBar';
import ImageViewerModal from '../components/ImageViewerModal';
import AttachmentInstructionModal from '../components/AttachmentInstructionModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToSession,
  appendMessages,
  recordWordLearned,
  recordQuizScore,
  updateSessionTitle,
  subscribeToBookmarks,
  addBookmark,
  removeBookmark,
  updateSessionSourceFilePageCount,
} from '../services/firestore';
import {
  continueConversation,
  continueConversationQuiz,
  explainWord,
  explainSentence,
  runSelectionAction,
  generateQuiz,
  generateSessionRecap,
  simplifyFromImage,
  simplifyFromDocument,
  analyzeImageWithInstruction,
  analyzeDocumentWithInstruction,
  GeminiError,
} from '../services/gemini';
import {
  uploadSessionPhoto,
  uploadSessionDocument,
  generateMessageId,
  friendlyUploadErrorMessage,
  MAX_UPLOAD_BYTES,
  readPickedFileAsBase64,
  readPickedFileAsText,
} from '../services/uploads';

// Mirrors classifyPickedFile() in NewSessionScreen.js — kept as a separate
// copy rather than a shared import since the two screens' surrounding flow
// (progress UI, error states) differs enough that a shared helper would
// mostly just be a single switch statement passed back and forth.
function classifyPickedFile(asset) {
  const ext = (asset.name || '').split('.').pop()?.toLowerCase();
  const mimeType = asset.mimeType || '';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType.startsWith('text/') || ['txt', 'md', 'markdown'].includes(ext)) return 'text';
  return 'unsupported';
}

// A model 'text' message is "the passage" (renders via ReadingPane) rather
// than an ordinary conversational reply (ChatBubble) if it's the very
// first model reply in the session, or if it immediately follows a
// mid-session photo/file upload — see §2 of the M2 continuation brief.
function isPassageMessage(messages, index) {
  const message = messages[index];
  if (!message || message.role !== 'model' || message.type !== 'text') return false;
  const earlierModelReply = messages.slice(0, index).some((m) => m.role === 'model');
  if (!earlierModelReply) return true;
  const prev = messages[index - 1];
  return !!prev && prev.role === 'user' && (prev.type === 'image' || prev.type === 'file');
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const QUICK_ACTIONS = [
  { key: 'explain', label: 'Explain this part', icon: 'bulb-outline', prompt: 'Can you explain this part in a different way?' },
  { key: 'example', label: 'Give an example', icon: 'flask-outline', prompt: 'Can you give me an example of this?' },
  { key: 'recap', label: 'Recap so far', icon: 'time-outline', prompt: "Can you recap what we've covered so far?" },
];

// Day-divider label for reopening a session days or weeks later — "Today"
// close by, an actual date further out, matching the familiar
// messaging-app pattern.
function formatDayLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function isSameDay(tsA, tsB) {
  if (!tsA || !tsB) return false;
  return new Date(tsA).toDateString() === new Date(tsB).toDateString();
}

export default function SessionScreen({ route, navigation }) {
  const { sessionId, pageIndex: initialPageIndex } = route.params;
  const theme = useTheme();
  const { colors, fonts, radius, speechRate } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 768;
  const [workspaceMode, setWorkspaceMode] = useState('split'); // 'split' | 'doc' | 'chat'

  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [popup, setPopup] = useState(null); // { mode, term, loading, definition, error } | null
  const [speakingIndex, setSpeakingIndex] = useState(null); // message index currently being read aloud, or null
  const [speakingCharIndex, setSpeakingCharIndex] = useState(null); // for read-aloud word highlighting
  const [speakingDraft, setSpeakingDraft] = useState(false); // whether current input draft is being read aloud
  const [uploadProgress, setUploadProgress] = useState(null); // 0-1, or null when not uploading
  // A photo/PDF picked via attachPhoto/attachFile waits here until
  // AttachmentInstructionModal.js's prompt is answered, same idea as
  // NewSessionScreen.js's pendingPhoto — see that modal's header comment.
  // { kind: 'photo', asset, mimeType } | { kind: 'pdf', asset } | null.
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [viewerUri, setViewerUri] = useState(null); // source photo shown full-screen from a reading pane's chip
  const [recap, setRecap] = useState(null); // one-line "last time..." string, or null
  const [bookmarkMap, setBookmarkMap] = useState(new Map()); // messageIndex -> bookmarkId
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameText, setRenameText] = useState('');
  // ---------- PDF reader pivot (§3-§5): reader-mode-only state ----------
  const [readerNumPages, setReaderNumPages] = useState(0);
  const [readerPageIndex, setReaderPageIndex] = useState(1);
  const [readerPageText, setReaderPageText] = useState(''); // current page's plain text — read-aloud source, quiz/explain context
  const [readerPageScanned, setReaderPageScanned] = useState(false);
  const [readerSpeaking, setReaderSpeaking] = useState(false);
  const [extractingForQuiz, setExtractingForQuiz] = useState(false); // walking the whole doc's text for "Quiz document"
  const [customPrompt, setCustomPrompt] = useState(null); // { selectionText, pageIndex, pageContext } | null — drives the custom-instruction modal
  const [customPromptText, setCustomPromptText] = useState('');
  const [pageBookmarkMap, setPageBookmarkMap] = useState(new Map()); // pageIndex -> bookmarkId (separate from messageIndex bookmarks)
  const pdfReaderRef = useRef(null);
  const pageCountSavedRef = useRef(false); // only ever backfill sourceFile.pageCount once per screen visit
  const initialPageJumpRef = useRef(false); // only ever act on the incoming pageIndex nav param once
  const listRef = useRef(null);
  const hadSessionRef = useRef(false); // did this screen ever see real session data?
  const recapCheckedRef = useRef(false); // only ever compute the recap once per visit

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToSession(user.uid, sessionId, setSession);
    return unsubscribe;
  }, [user, sessionId]);

  // §3: if the session gets deleted (e.g. from the list) while this screen
  // is still open on it, subscribeToSession's snapshot goes to null. Once
  // we've actually seen real data, a null after that means "gone," not
  // "still loading" — head back to the list instead of sitting on a
  // spinner forever.
  useEffect(() => {
    if (session) {
      hadSessionRef.current = true;
    } else if (hadSessionRef.current) {
      navigation.replace('SessionsList');
    }
  }, [session, navigation]);

  const isReaderMode = session?.mode === 'reader';

  useLayoutEffect(() => {
    navigation.setOptions({
      title: session?.title || 'Reading session',
      headerRight: () =>
        session ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {isReaderMode && (
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: colors.paperRaised,
                  borderRadius: radius.pill,
                  padding: 2,
                  marginRight: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Pressable
                  onPress={() => setWorkspaceMode('doc')}
                  hitSlop={4}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: isDesktop ? 8 : 6,
                    paddingVertical: 3,
                    borderRadius: radius.pill,
                    backgroundColor: workspaceMode === 'doc' ? colors.lamp : 'transparent',
                  }}
                  accessibilityLabel="Document focus"
                >
                  <Ionicons
                    name="document-text"
                    size={14}
                    color={workspaceMode === 'doc' ? colors.ink : colors.textMuted}
                  />
                  {isDesktop && (
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: fonts.bodyMedium,
                        marginLeft: 4,
                        color: workspaceMode === 'doc' ? colors.ink : colors.textMuted,
                      }}
                    >
                      Doc
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setWorkspaceMode('split')}
                  hitSlop={4}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: isDesktop ? 8 : 6,
                    paddingVertical: 3,
                    borderRadius: radius.pill,
                    backgroundColor: workspaceMode === 'split' ? colors.lamp : 'transparent',
                  }}
                  accessibilityLabel="Split view"
                >
                  <Ionicons
                    name="grid-outline"
                    size={14}
                    color={workspaceMode === 'split' ? colors.ink : colors.textMuted}
                  />
                  {isDesktop && (
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: fonts.bodyMedium,
                        marginLeft: 4,
                        color: workspaceMode === 'split' ? colors.ink : colors.textMuted,
                      }}
                    >
                      Split
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setWorkspaceMode('chat')}
                  hitSlop={4}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: isDesktop ? 8 : 6,
                    paddingVertical: 3,
                    borderRadius: radius.pill,
                    backgroundColor: workspaceMode === 'chat' ? colors.lamp : 'transparent',
                  }}
                  accessibilityLabel="AI Chat focus"
                >
                  <Ionicons
                    name="chatbubbles-outline"
                    size={14}
                    color={workspaceMode === 'chat' ? colors.ink : colors.textMuted}
                  />
                  {isDesktop && (
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: fonts.bodyMedium,
                        marginLeft: 4,
                        color: workspaceMode === 'chat' ? colors.ink : colors.textMuted,
                      }}
                    >
                      Chat
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
            <Pressable
              hitSlop={10}
              style={{ marginRight: 12 }}
              onPress={() => {
                setRenameText(session.title || '');
                setRenameVisible(true);
              }}
            >
              <Ionicons name="pencil-outline" size={18} color={colors.textMuted} />
            </Pressable>
            <Pressable hitSlop={10} onPress={() => navigation.navigate('SessionsList')}>
              <Ionicons name="list-outline" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null,
    });
  }, [navigation, session, colors, fonts, radius, isReaderMode, workspaceMode, isDesktop]);

  // Stop any in-flight read-aloud when leaving this session (navigating
  // away, or the sessionId prop changing under a reused screen instance) —
  // otherwise a reply could keep narrating over whatever's on screen next.
  useEffect(() => {
    return () => {
      loopRef.current.active = false;
      clearTimeout(loopRef.current.timer);
      Speech.stop();
    };
  }, [sessionId]);

  const messages = session?.messages || [];

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (messages.length) scrollToEnd();
  }, [messages.length, sending, scrollToEnd]);

  // §2: a brief recap when reopening a session after a day or more away —
  // a bookmark, not an "unread messages" cue, so this only ever computes
  // once per visit to this screen (not on every message added live).
  //
  // Reader-mode sessions opt out: isPassageMessage()'s "first model reply,
  // with no earlier one" rule is specifically about the rewrite-then-chat
  // flow's first turn, and would otherwise misidentify a reader-mode
  // session's first selection-action reply as if it were that passage. A
  // reader-mode recap would need different source material anyway (the
  // PDF itself, not a message) — left as a known gap rather than shipping
  // a recap that quietly summarizes the wrong thing.
  useEffect(() => {
    if (!session || recapCheckedRef.current || !messages.length || isReaderMode) return;
    recapCheckedRef.current = true;

    const last = messages[messages.length - 1];
    const lastTimestamp = typeof last.timestamp === 'number' ? last.timestamp : null;
    if (!lastTimestamp || Date.now() - lastTimestamp < ONE_DAY_MS) return;

    let lastPassageText = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isPassageMessage(messages, i)) {
        lastPassageText = messages[i].content;
        break;
      }
    }
    if (!lastPassageText) return;

    generateSessionRecap(lastPassageText)
      .then(setRecap)
      .catch(() => {}); // a missing recap just means no banner — not worth an error state
  }, [session, messages, isReaderMode]);

  // §7 backlog: bookmarks live in their own Firestore subcollection (see
  // firestore.js), not on the message itself, so this screen needs to know
  // which of *this* session's messages already have one. A one-time read
  // (unsubscribing after the first snapshot) rather than a live
  // subscription — bookmark state doesn't need to stay synced in
  // real time while someone is just reading.
  //
  // §5 item 4 ("bookmarks parity"): the same snapshot also builds
  // pageBookmarkMap for reader-mode PDF-page bookmarks — one subscription,
  // two derived maps, since both live in the same bookmarks subcollection
  // (see firestore.js's addBookmark, which writes exactly one of
  // messageIndex/pageIndex per bookmark).
  useEffect(() => {
    if (!user || !session?.id) return undefined;
    let unsubscribe;
    unsubscribe = subscribeToBookmarks(user.uid, (all) => {
      const messageMap = new Map();
      const pageMap = new Map();
      all.forEach((b) => {
        if (b.sessionId !== session.id) return;
        if (typeof b.messageIndex === 'number') messageMap.set(b.messageIndex, b.id);
        else if (typeof b.pageIndex === 'number') pageMap.set(b.pageIndex, b.id);
      });
      setBookmarkMap(messageMap);
      setPageBookmarkMap(pageMap);
      unsubscribe?.();
    });
    return () => unsubscribe?.();
  }, [user, session?.id]);

  const sendFollowUp = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || !session || sending) return;

    if (speakingDraft) {
      Speech.stop();
      setSpeakingDraft(false);
    }
    setError(null);
    setInputText('');
    setSending(true);

    const priorMessages = messages; // conversation as it stood before this turn
    const userMessage = { role: 'user', type: 'text', content: trimmed, timestamp: Date.now() };

    try {
      await appendMessages(user.uid, sessionId, [userMessage]);
      const reply = await continueConversation(session, priorMessages, trimmed);
      await appendMessages(user.uid, sessionId, [
        { role: 'model', type: 'text', content: reply, timestamp: Date.now() },
      ]);
    } catch (err) {
      setError(err instanceof GeminiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSending(false);
    }
  };

  const handleQuizMe = async () => {
    if (!session || sending) return;
    setError(null);
    setSending(true);

    const priorMessages = messages;
    const userMessage = { role: 'user', type: 'text', content: 'Quiz me on this', timestamp: Date.now() };

    try {
      await appendMessages(user.uid, sessionId, [userMessage]);
      const questions = await continueConversationQuiz(session, priorMessages, 3);
      await appendMessages(user.uid, sessionId, [
        { role: 'model', type: 'quiz', content: questions, timestamp: Date.now() },
      ]);
    } catch (err) {
      setError(err instanceof GeminiError ? err.message : 'Could not build a quiz right now.');
    } finally {
      setSending(false);
    }
  };

  const handleQuizComplete = (scorePercent) => {
    if (!session) return;
    recordQuizScore(user.uid, session.level, scorePercent).catch(() => {});
  };

  // §2's quick-action chips ("Explain this part", "Give an example",
  // "Recap so far") are just canned follow-up text — same pipeline as
  // typing something and hitting send, so the guided chips and free-text
  // input never diverge in behavior.
  const handleQuickAction = (prompt) => sendFollowUp(prompt);

  // §7 backlog: bookmark a passage or reply for quick reference later.
  const toggleBookmark = async (index, text) => {
    if (!user || !session) return;
    const existingId = bookmarkMap.get(index);
    if (existingId) {
      setBookmarkMap((prev) => {
        const next = new Map(prev);
        next.delete(index);
        return next;
      });
      await removeBookmark(user.uid, existingId).catch(() => {});
    } else {
      const id = await addBookmark(user.uid, {
        sessionId: session.id,
        sessionTitle: session.title,
        messageIndex: index,
        text,
      }).catch(() => null);
      if (id) setBookmarkMap((prev) => new Map(prev).set(index, id));
    }
  };

  const handleRename = async () => {
    const trimmed = renameText.trim();
    setRenameVisible(false);
    if (!trimmed || trimmed === session?.title) return;
    await updateSessionTitle(user.uid, sessionId, trimmed).catch(() => {});
  };

  // Single entry point for TappableText's selection toolbar — `isSingleWord`
  // picks which popup mode (and which Gemini call) applies. Replaces the
  // old separate handleWordPress/handleSentencePress pair now that both
  // come from the same "Explain" button instead of two different gestures.
  const handleExplainSelection = useCallback(async (selectedText, isSingleWord, contextText, onResult) => {
    const trimmed = (selectedText || '').trim();
    if (!trimmed) return;

    if (isSingleWord) {
      const word = trimmed.replace(/[^a-zA-Z'-]/g, '');
      if (!word) return;
      setPopup({ mode: 'word', term: word, loading: true, definition: null, error: null });
      try {
        const definition = await explainWord(word, contextText);
        setPopup({ mode: 'word', term: word, loading: false, definition, error: null });
        onResult?.(definition);
      } catch (err) {
        setPopup({
          mode: 'word',
          term: word,
          loading: false,
          definition: null,
          error: err instanceof GeminiError ? err.message : 'Could not look that up.',
        });
      }
      return;
    }

    setPopup({ mode: 'sentence', term: trimmed, loading: true, definition: null, error: null });
    try {
      const definition = await explainSentence(trimmed, contextText);
      setPopup({ mode: 'sentence', term: trimmed, loading: false, definition, error: null });
      onResult?.(definition);
    } catch (err) {
      setPopup({
        mode: 'sentence',
        term: trimmed,
        loading: false,
        definition: null,
        error: err instanceof GeminiError ? err.message : 'Could not explain that.',
      });
    }
  }, []);

  const markWordLearned = async () => {
    if (popup?.mode === 'word' && popup.term) {
      await recordWordLearned(user.uid, popup.term, popup.definition || '').catch(() => {});
    }
    setPopup(null);
  };

  // Only one reply can be read aloud at a time. Tapping the button on the
  // message that's already speaking stops it; tapping a different one
  // interrupts and starts the new one. `onBoundary`'s charIndex drives the
  // live word-highlight in the reading pane (see ReadingPane.js /
  // TappableText.js) — the single change most likely to make this feel
  // like a reading experience rather than "play this message aloud."
  // Remembers where the read-aloud stopped so "Re-read for me" can pause
  // the narration, deal with the confusing part, and then pick the reading
  // back up. { kind: 'chat' | 'reader', index, text, charIndex } | null.
  const resumeRef = useRef(null);
  const [canResume, setCanResume] = useState(false);

  // The one place read-aloud starts, for both modes. `offset` lets a
  // resumed reading start part-way through `text`; boundary indexes are
  // shifted back by it so the live highlight still lines up with `text`.
  const startSpeech = useCallback((kind, index, text, offset = 0) => {
    Speech.stop();
    if (speakingDraft) setSpeakingDraft(false);
    resumeRef.current = { kind, index, text, charIndex: offset };
    if (kind === 'chat') {
      setSpeakingIndex(index);
      setSpeakingCharIndex(offset);
    } else {
      setReaderSpeaking(true);
    }
    const clear = () => {
      if (kind === 'chat') {
        setSpeakingIndex(null);
        setSpeakingCharIndex(null);
      } else {
        setReaderSpeaking(false);
        pdfReaderRef.current?.highlightAtChar(null);
      }
    };
    Speech.speak(text.slice(offset), {
      rate: speechRate || 0.9,
      onBoundary: (event) => {
        const abs = offset + event.charIndex;
        if (resumeRef.current) resumeRef.current.charIndex = abs;
        if (kind === 'chat') setSpeakingCharIndex(abs);
        else pdfReaderRef.current?.highlightAtChar(abs);
      },
      onDone: () => {
        resumeRef.current = null;
        clear();
      },
      onStopped: clear, // keeps resumeRef — a stop may be "pause to re-read"
      onError: clear,
    });
  }, [speechRate, speakingDraft]);

  // Only one reply can be read aloud at a time. Tapping the button on the
  // message that's already speaking stops it; tapping a different one
  // interrupts and starts the new one.
  const toggleSpeak = useCallback(
    (index, content) => {
      let textToSpeak = '';
      if (typeof content === 'string') {
        textToSpeak = content;
      } else if (content && typeof content === 'object') {
        textToSpeak = content.selectionText || content.customInstruction || '';
      }
      if (!textToSpeak.trim()) return;

      if (speakingIndex === index) {
        Speech.stop();
        resumeRef.current = null;
        setSpeakingIndex(null);
        setSpeakingCharIndex(null);
        return;
      }
      startSpeech('chat', index, textToSpeak, 0);
    },
    [speakingIndex, startSpeech]
  );

  const toggleSpeakDraft = useCallback(() => {
    if (speakingDraft) {
      Speech.stop();
      setSpeakingDraft(false);
      return;
    }
    const text = inputText.trim();
    if (!text) return;
    Speech.stop();
    resumeRef.current = null;
    setSpeakingIndex(null);
    setSpeakingCharIndex(null);
    setSpeakingDraft(true);
    Speech.speak(text, {
      rate: speechRate || 0.9,
      onDone: () => setSpeakingDraft(false),
      onStopped: () => setSpeakingDraft(false),
      onError: () => setSpeakingDraft(false),
    });
  }, [speakingDraft, inputText, speechRate]);

  // "Re-read for me": the student selected something they didn't follow
  // while the text was being read (or just while reading). The narration
  // pauses, the selection is re-read slowly, then a plain-language
  // explanation (grounded in the text around it) is shown AND read out.
  // "Continue reading" resumes from the start of the sentence that was
  // interrupted.
  const rereadSelection = useCallback(
    (selectedText, isSingleWord, contextText) => {
      const trimmed = (selectedText || '').trim();
      if (!trimmed) return;
      Speech.stop(); // pauses the narration; resumeRef keeps the position
      setCanResume(!!resumeRef.current);

      let selectionDone = false;
      let explanation = null;
      const speakExplanation = () => Speech.speak(explanation, { rate: speechRate || 0.95 });

      Speech.speak(trimmed, {
        rate: Math.max(0.6, (speechRate || 0.9) - 0.1),
        onDone: () => {
          selectionDone = true;
          if (explanation) speakExplanation();
        },
      });
      handleExplainSelection(trimmed, isSingleWord, contextText, (definition) => {
        explanation = definition;
        if (selectionDone) speakExplanation();
      });
    },
    [handleExplainSelection, speechRate]
  );

  const closePopup = useCallback(() => {
    Speech.stop();
    resumeRef.current = null;
    setCanResume(false);
    setPopup(null);
  }, []);

  const resumeReading = useCallback(() => {
    const r = resumeRef.current;
    setPopup(null);
    setCanResume(false);
    Speech.stop();
    if (!r) return;
    // Back up to the start of the interrupted sentence so it's heard whole.
    const before = r.text.slice(0, r.charIndex);
    const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n'));
    startSpeech(r.kind, r.index, r.text, cut === -1 ? 0 : cut + 2);
  }, [startSpeech]);

  // The current word/phrase selection, reported by whichever TappableText
  // holds it and shown in the always-visible SelectionBar above the input.
  // Only one selection is active at a time: picking in a new passage clears
  // the previous one.
  const selOwnerRef = useRef(null);
  const [selectionBar, setSelectionBar] = useState(null);
  const handleSelectionChange = useCallback((info) => {
    if (info.text) {
      const prev = selOwnerRef.current;
      if (prev && prev.id !== info.id) prev.clear();
      selOwnerRef.current = info;
      setSelectionBar(info);
    } else if (selOwnerRef.current && selOwnerRef.current.id === info.id) {
      selOwnerRef.current = null;
      setSelectionBar(null);
    }
  }, []);

  // ---------- "Listen on loop": hear a selection again and again ----------
  // For a word or phrase the student couldn't catch or follow: the narration
  // pauses (resumeRef keeps its place), the selection repeats with a short
  // pause between plays until they stop it, and "Continue reading" picks the
  // narration back up from the start of the interrupted sentence.
  const loopRef = useRef({ active: false, timer: null, slow: false, count: 0, text: '', context: '' });
  const [loop, setLoop] = useState(null); // { text, count, slow } | null

  const stopLoopAudio = useCallback(() => {
    const L = loopRef.current;
    L.active = false;
    clearTimeout(L.timer);
    Speech.stop();
  }, []);

  const speakLoopOnce = useCallback(() => {
    const L = loopRef.current;
    if (!L.active) return;
    Speech.speak(L.text, {
      rate: L.slow ? 0.6 : 1.0,
      onDone: () => {
        if (!L.active) return;
        L.count += 1;
        setLoop((cur) => (cur ? { ...cur, count: L.count } : cur));
        L.timer = setTimeout(speakLoopOnce, 700); // a beat between repeats
      },
      onError: () => {
        L.active = false;
      },
    });
  }, []);

  const startLoop = useCallback(
    (selectedText, contextText) => {
      const trimmed = (selectedText || '').trim();
      if (!trimmed) return;
      const L = loopRef.current;
      clearTimeout(L.timer);
      Speech.stop(); // pauses the narration; resumeRef keeps the position
      setPopup(null);
      setCanResume(!!resumeRef.current);
      Object.assign(L, { active: true, slow: false, count: 0, text: trimmed, context: contextText || '' });
      setLoop({ text: trimmed, count: 0, slow: false });
      L.timer = setTimeout(speakLoopOnce, 150); // let the stop above settle
    },
    [speakLoopOnce]
  );

  const toggleLoopSlow = useCallback(() => {
    const L = loopRef.current;
    L.slow = !L.slow; // takes effect from the next repeat
    setLoop((cur) => (cur ? { ...cur, slow: L.slow } : cur));
  }, []);

  const stopLoop = useCallback(() => {
    stopLoopAudio();
    resumeRef.current = null;
    setCanResume(false);
    setLoop(null);
  }, [stopLoopAudio]);

  const explainLoopSelection = useCallback(() => {
    const { text, context } = loopRef.current;
    stopLoopAudio();
    setLoop(null);
    rereadSelection(text, !/\s/.test(text), context);
  }, [stopLoopAudio, rereadSelection]);

  const continueAfterLoop = useCallback(() => {
    stopLoopAudio();
    setLoop(null);
    resumeReading();
  }, [stopLoopAudio, resumeReading]);

  // ---------- PDF reader pivot: reader-mode handlers (§4, §5) ----------

  // §4.3: backfill sourceFile.pageCount the first time the WebView reports
  // it — session creation itself doesn't know page count yet (see
  // NewSessionScreen.js).
  const handleReaderDocLoaded = useCallback(
    (numPages) => {
      setReaderNumPages(numPages);
      if (!pageCountSavedRef.current && session?.id && user) {
        pageCountSavedRef.current = true;
        updateSessionSourceFilePageCount(user.uid, session.id, numPages).catch(() => {});
      }
      // §5 item 4 ("bookmarks parity"): opening a session from a page
      // bookmark (see ProgressScreen.js) jumps straight there instead of
      // always landing on page 1. showPage(1) is already mid-flight inside
      // the WebView by the time this fires (see pdfReaderHtml.js's boot
      // sequence) — this just redirects it, at the cost of one wasted
      // page-1 render, which is cheap enough not to be worth a more
      // elaborate "defer the first render" mechanism.
      if (!initialPageJumpRef.current && initialPageIndex) {
        initialPageJumpRef.current = true;
        pdfReaderRef.current?.jumpToPage(initialPageIndex);
      }
    },
    [session?.id, user, initialPageIndex]
  );

  // Fires on every page change (including the first). Keeps the page
  // text/scanned-flag this screen needs for read-aloud, the scanned-page
  // banner, and selection grounding in sync with whatever's actually on
  // screen in the WebView.
  const handleReaderPageChanged = useCallback(
    ({ pageIndex, numPages, pageText, isScanned }) => {
      setReaderPageIndex(pageIndex);
      setReaderNumPages(numPages);
      setReaderPageText(pageText || '');
      setReaderPageScanned(!!isScanned);
      // Turning the page mid-narration would otherwise keep reading a page
      // that's no longer on screen, highlighting words in a text layer
      // that just got swapped out from under it.
      setReaderSpeaking((wasSpeaking) => {
        if (wasSpeaking) Speech.stop();
        return false;
      });
    },
    []
  );

  // §4.4's runSelectionAction(), called for explain/simplify/quiz/custom —
  // logs the request + reply pair the same way sendFollowUp/handleQuizMe
  // already do. NOT used for 'define' (see handleReaderSelectionAction
  // below, which routes that to the existing ephemeral word-popup path
  // instead).
  const runReaderSelectionAction = useCallback(
    async ({ selectionText, pageIndex, pageContext, action, customInstruction }) => {
      if (!session || sending) return;
      setError(null);
      setSending(true);
      const priorMessages = messages;
      const userMessage = {
        role: 'user',
        type: 'selection',
        content: { selectionText, pageIndex, action, customInstruction: customInstruction || null },
        timestamp: Date.now(),
      };
      try {
        await appendMessages(user.uid, sessionId, [userMessage]);
        const reply = await runSelectionAction(session, priorMessages, {
          selectionText,
          pageIndex,
          pageContext,
          action,
          customInstruction,
        });
        await appendMessages(user.uid, sessionId, [
          { role: 'model', type: 'text', content: reply, timestamp: Date.now() },
        ]);
      } catch (err) {
        setError(err instanceof GeminiError ? err.message : 'Something went wrong. Try again.');
      } finally {
        setSending(false);
      }
    },
    [session, sending, messages, user, sessionId]
  );

  // Single entry point for PdfReader's selection-action toolbar (§4.1). A
  // 'define' tap only ever fires for a single-word selection (the WebView
  // only shows that button then — see pdfReaderHtml.js), so it can reuse
  // handleExplainSelection's existing ephemeral-popup path unchanged
  // rather than being logged to the session (§4.4's "split by weight").
  const handleReaderSelectionAction = useCallback(
    ({ action, selectionText, pageIndex, pageContext }) => {
      if (action === 'speak') {
        Speech.stop();
        Speech.speak(selectionText, { rate: speechRate || 0.9 });
        return;
      }
      if (action === 'define') {
        handleExplainSelection(selectionText, true, pageContext);
        return;
      }
      if (action === 'loop') {
        startLoop(selectionText, pageContext);
        return;
      }
      if (action === 'explain') {
        rereadSelection(selectionText, !/\s/.test(selectionText.trim()), pageContext);
        return;
      }
      if (action === 'custom') {
        setCustomPrompt({ selectionText, pageIndex, pageContext });
        return;
      }
      runReaderSelectionAction({ selectionText, pageIndex, pageContext, action });
    },
    [handleExplainSelection, rereadSelection, startLoop, runReaderSelectionAction, speechRate]
  );

  const submitCustomPrompt = () => {
    const instruction = customPromptText.trim();
    const prompt = customPrompt;
    setCustomPrompt(null);
    setCustomPromptText('');
    if (!instruction || !prompt) return;
    runReaderSelectionAction({ ...prompt, action: 'custom', customInstruction: instruction });
  };

  // §4.2: a scanned/image-only page's canvas, sent through the existing
  // simplifyFromImage() path — logged as a plain text follow-up pair
  // (not a 'selection' message; there's no text selection to speak of on
  // a page PDF.js couldn't find any text on).
  const handleReaderScannedPage = useCallback(
    async ({ pageIndex, base64, mimeType }) => {
      if (!session || sending) return;
      setError(null);
      setSending(true);
      const priorMessages = messages;
      const userMessage = {
        role: 'user',
        type: 'text',
        content: `Read this scanned page (page ${pageIndex})`,
        timestamp: Date.now(),
      };
      try {
        await appendMessages(user.uid, sessionId, [userMessage]);
        const simplified = await simplifyFromImage(base64, mimeType, session.level);
        await appendMessages(user.uid, sessionId, [
          { role: 'model', type: 'text', content: simplified, timestamp: Date.now() },
        ]);
      } catch (err) {
        setError(err instanceof GeminiError ? err.message : 'Could not read that page. Try again.');
      } finally {
        setSending(false);
      }
    },
    [session, sending, messages, user, sessionId]
  );

  // §4.4's "Quiz me on the whole document": kicks off PdfReader's local,
  // all-on-device text walk (no Gemini call yet) — the reply arrives async
  // via handleFullTextExtracted below, which is the one that actually
  // calls generateQuiz().
  const handleQuizDocument = useCallback(() => {
    if (!pdfReaderRef.current || sending || extractingForQuiz) return;
    setExtractingForQuiz(true);
    pdfReaderRef.current.extractFullText();
  }, [sending, extractingForQuiz]);

  const handleFullTextExtracted = useCallback(
    async (text) => {
      setExtractingForQuiz(false);
      if (!session) return;
      if (!text || !text.trim()) {
        setError('Could not read enough of this document to build a quiz.');
        return;
      }
      setError(null);
      setSending(true);
      const userMessage = {
        role: 'user',
        type: 'text',
        content: 'Quiz me on the whole document',
        timestamp: Date.now(),
      };
      try {
        await appendMessages(user.uid, sessionId, [userMessage]);
        const questions = await generateQuiz(text, 3);
        await appendMessages(user.uid, sessionId, [
          { role: 'model', type: 'quiz', content: questions, timestamp: Date.now() },
        ]);
      } catch (err) {
        setError(err instanceof GeminiError ? err.message : 'Could not build a quiz right now.');
      } finally {
        setSending(false);
      }
    },
    [session, user, sessionId]
  );

  // §4.5: read-aloud on the PDF text layer. expo-speech only runs on the
  // RN side (it's a native module — a WebView's own JS can't call it),
  // which is why the trigger lives here rather than as a button inside
  // the WebView's own HTML; the highlight itself still happens inside the
  // WebView, via PdfReader's highlightAtChar ref method
  // (injectJavaScript'ing into window.__highlightAtChar — see
  // pdfReaderHtml.js). Mirrors toggleSpeak() above almost exactly; kept as
  // a separate function rather than a shared one since it drives a ref
  // method instead of a speakingCharIndex prop, and reads from
  // readerPageText/readerSpeaking state instead of a message index.
  const toggleSpeakReader = useCallback(() => {
    if (readerSpeaking) {
      Speech.stop();
      resumeRef.current = null;
      setReaderSpeaking(false);
      pdfReaderRef.current?.highlightAtChar(null);
      return;
    }
    if (!readerPageText) return;
    startSpeech('reader', null, readerPageText, 0);
  }, [readerSpeaking, readerPageText, startSpeech]);

  // §5 item 4 ("bookmarks parity"): bookmarking a PDF page itself, using
  // the exact same addBookmark()/removeBookmark() functions the message-
  // level bookmark star already uses — just keyed by pageIndex instead of
  // messageIndex (see firestore.js).
  const togglePageBookmark = async () => {
    if (!user || !session) return;
    const existingId = pageBookmarkMap.get(readerPageIndex);
    if (existingId) {
      setPageBookmarkMap((prev) => {
        const next = new Map(prev);
        next.delete(readerPageIndex);
        return next;
      });
      await removeBookmark(user.uid, existingId).catch(() => {});
    } else {
      const id = await addBookmark(user.uid, {
        sessionId: session.id,
        sessionTitle: session.title,
        pageIndex: readerPageIndex,
        text: readerPageText ? readerPageText.slice(0, 200) : `Page ${readerPageIndex}`,
      }).catch(() => null);
      if (id) setPageBookmarkMap((prev) => new Map(prev).set(readerPageIndex, id));
    }
  };

  // §4: attach a photo from inside an already-open session — same
  // Storage-upload mechanics as NewSessionScreen's initial upload (see
  // services/uploads.js), just appended to an existing session instead of
  // starting a new one.
  //
  // Only picks the photo and opens AttachmentInstructionModal.js's prompt
  // (rendered below, driven by pendingAttachment) — nothing uploads or
  // gets sent to Gemini until that's answered. See the modal's own header
  // comment for why: this used to jump straight to simplifying every photo
  // to the session's reading level, with no way to ask for anything else.
  const attachPhoto = async (fromCamera) => {
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
      setPendingAttachment({ kind: 'photo', asset, mimeType: asset.mimeType || 'image/jpeg' });
    } catch (err) {
      setError('Could not read that photo. Try again.');
    }
  };

  const attachFile = async () => {
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
          `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB for now.`
      );
      return;
    }

    // A PDF gets the same "what should I do with this?" prompt a photo
    // does — see attachPhoto just above. A .txt/.md file doesn't: pasting
    // it in has only one sensible reading (another passage to talk about,
    // same as typing it into the input box below), not several competing
    // ones the way a photo or a whole PDF can have, so it goes straight
    // through unchanged.
    if (kind === 'pdf') {
      setPendingAttachment({ kind: 'pdf', asset });
      return;
    }

    setSending(true);
    try {
      const passage = (await readPickedFileAsText(asset.uri)).trim();
      if (!passage) {
        setError('That file looks empty.');
        return;
      }
      await appendMessages(user.uid, sessionId, [
        { role: 'user', type: 'text', content: passage, timestamp: Date.now() },
      ]);
      const reply = await continueConversation(session, messages, `Here's another passage: ${passage}`);
      await appendMessages(user.uid, sessionId, [
        { role: 'model', type: 'text', content: reply, timestamp: Date.now() },
      ]);
    } catch (err) {
      console.error('[attachFile]', err?.code, err?.message, err);
      setError(
        err instanceof GeminiError
          ? err.message
          : err?.code
          ? friendlyUploadErrorMessage(err)
          : 'Could not read that file. Try again.'
      );
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  // Fires once the student answers AttachmentInstructionModal.js's prompt
  // for a pending photo or PDF — `customInstruction` is null for the
  // default "Simplify to my level" button, or the typed instruction for
  // "Send instead". Handles both attachment kinds since they're otherwise
  // identical shape (upload, log the attachment message, get a reply, log
  // that too) apart from which upload/Gemini functions each one calls.
  const confirmPendingAttachment = async (customInstruction) => {
    const pending = pendingAttachment;
    setPendingAttachment(null);
    if (!pending) return;

    setError(null);
    setSending(true);
    setUploadProgress(0);
    try {
      if (pending.kind === 'photo') {
        const { asset, mimeType } = pending;
        const messageId = generateMessageId();
        const uploaded = await uploadSessionPhoto({
          uid: user.uid,
          sessionId,
          messageId,
          base64: asset.base64,
          mimeType,
          onProgress: setUploadProgress,
        });

        await appendMessages(user.uid, sessionId, [
          {
            role: 'user',
            type: 'image',
            content: customInstruction ? { ...uploaded, customInstruction } : uploaded,
            timestamp: Date.now(),
          },
        ]);
        const reply = customInstruction
          ? await analyzeImageWithInstruction(asset.base64, mimeType, customInstruction, session.level)
          : await simplifyFromImage(asset.base64, mimeType, session.level);
        await appendMessages(user.uid, sessionId, [
          { role: 'model', type: 'text', content: reply, timestamp: Date.now() },
        ]);
      } else {
        const { asset } = pending;
        const base64 = await readPickedFileAsBase64(asset.uri);
        const mimeType = asset.mimeType || 'application/pdf';
        const messageId = generateMessageId();
        const uploaded = await uploadSessionDocument({
          uid: user.uid,
          sessionId,
          messageId,
          base64,
          mimeType,
          extension: 'pdf',
          onProgress: setUploadProgress,
        });

        await appendMessages(user.uid, sessionId, [
          {
            role: 'user',
            type: 'file',
            content: customInstruction ? { ...uploaded, name: asset.name, customInstruction } : { ...uploaded, name: asset.name },
            timestamp: Date.now(),
          },
        ]);
        const reply = customInstruction
          ? await analyzeDocumentWithInstruction(base64, mimeType, customInstruction, session.level)
          : await simplifyFromDocument(base64, mimeType, session.level);
        await appendMessages(user.uid, sessionId, [
          { role: 'model', type: 'text', content: reply, timestamp: Date.now() },
        ]);
      }
    } catch (err) {
      console.error('[confirmPendingAttachment]', err?.code, err?.message, err);
      setError(
        err instanceof GeminiError
          ? err.message
          : err?.code
          ? friendlyUploadErrorMessage(err)
          : 'Could not process that. Try again.'
      );
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  if (!session) {
    return (
      <ScreenContainer scroll={false}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.lamp} />
        </View>
      </ScreenContainer>
    );
  }

  // Shared between both modes (§3: "reusing everything below it") — the
  // error/upload text, quick-action chips, and input bar are identical in
  // shape for both, just with reader-mode's extra "Quiz whole document"
  // chip and without the attach buttons (reader-mode sessions have one
  // primary document already — see §3's "don't build multi-document
  // switching").
  const bottomBar = (
    <>
      {error && <Text style={styles.error}>{error}</Text>}
      {uploadProgress !== null && (
        <Text style={styles.uploadProgressText}>
          {uploadProgress > 0 ? `Uploading… ${Math.round(uploadProgress * 100)}%` : 'Uploading…'}
        </Text>
      )}

      <SelectionBar selection={selectionBar} />

      <View style={styles.quickActionsRow}>
        <Pressable style={styles.quizChip} onPress={handleQuizMe} disabled={sending}>
          <Ionicons name="help-circle-outline" size={18} color={colors.lamp} />
          <Text style={styles.quizChipText}>Quiz me</Text>
        </Pressable>
        {isReaderMode && (
          <Pressable style={styles.quizChip} onPress={handleQuizDocument} disabled={sending || extractingForQuiz}>
            <Ionicons name="library-outline" size={18} color={colors.lamp} />
            <Text style={styles.quizChipText}>
              {extractingForQuiz ? 'Reading document…' : 'Quiz whole document'}
            </Text>
          </Pressable>
        )}
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            style={styles.actionChip}
            onPress={() => handleQuickAction(action.prompt)}
            disabled={sending}
          >
            <Ionicons name={action.icon} size={17} color={colors.textPrimary} />
            <Text style={styles.actionChipText}>{action.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.inputBar}>
        {!isReaderMode && (
          <>
            <Pressable style={styles.attachBtn} onPress={() => attachPhoto(false)} disabled={sending} hitSlop={6}>
              <Ionicons name="camera-outline" size={20} color={colors.textMuted} />
            </Pressable>
            <Pressable style={styles.attachBtn} onPress={attachFile} disabled={sending} hitSlop={6}>
              <Ionicons name="document-attach-outline" size={19} color={colors.textMuted} />
            </Pressable>
          </>
        )}
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder={isReaderMode ? 'Ask about the document…' : 'Ask a follow-up…'}
          placeholderTextColor={colors.textFaint}
          style={styles.textInput}
          multiline
          editable={!sending}
        />
        {!!inputText.trim() && (
          <Pressable
            style={[styles.attachBtn, { marginRight: 4 }]}
            onPress={toggleSpeakDraft}
            hitSlop={6}
            accessibilityLabel={speakingDraft ? 'Stop playback' : 'Listen to drafted follow-up'}
          >
            <Ionicons
              name={speakingDraft ? 'stop-circle' : 'volume-medium-outline'}
              size={20}
              color={speakingDraft ? colors.lamp : colors.textMuted}
            />
          </Pressable>
        )}
        <Pressable
          style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
          onPress={() => sendFollowUp(inputText)}
          disabled={!inputText.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : (
            <Ionicons name="arrow-up" size={18} color={colors.ink} />
          )}
        </Pressable>
      </View>
    </>
  );

  // The selection-log FlatList reader-mode uses below the WebView — every
  // message here is either a 'selection' request/reply pair or a plain
  // follow-up/quiz turn (never a passage — see the recap effect's comment
  // above on why isPassageMessage()/ReadingPane don't apply in this mode),
  // so unlike chat-mode's renderItem below, this one never branches into
  // ReadingPane at all.
  const readerMessageList = (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(_, i) => String(i)}
      style={styles.readerMessageList}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <Text style={styles.readerEmptyHint}>
          Select any text in the document above to explain, simplify, define, or ask about it.
        </Text>
      }
      renderItem={({ item, index }) => {
        const prev = messages[index - 1];
        const showDivider = !!item.timestamp && (!prev || !isSameDay(prev.timestamp, item.timestamp));
        const divider = showDivider && (
          <View style={styles.dateDivider}>
            <View style={styles.dateDividerLine} />
            <Text style={styles.dateDividerText}>{formatDayLabel(item.timestamp)}</Text>
            <View style={styles.dateDividerLine} />
          </View>
        );
        return (
          <View>
            {divider}
            <ChatBubble
              message={item}
              onExplain={
                item.role === 'model' && item.type === 'text'
                  ? (text, isSingleWord) => rereadSelection(text, isSingleWord, item.content)
                  : undefined
              }
              onLoop={item.role === 'model' && item.type === 'text' ? (text) => startLoop(text, item.content) : undefined}
              onSelectionChange={item.role === 'model' && item.type === 'text' ? handleSelectionChange : undefined}
              onQuizComplete={handleQuizComplete}
              speaking={speakingIndex === index}
              onToggleSpeak={() => toggleSpeak(index, item.content)}
              onBookmark={
                item.role === 'model' && item.type === 'text' ? () => toggleBookmark(index, item.content) : undefined
              }
              bookmarked={bookmarkMap.has(index)}
            />
          </View>
        );
      }}
      ListFooterComponent={sending ? <ChatBubble message={{ role: 'model', pending: true }} /> : null}
    />
  );

  return (
    <ScreenContainer scroll={false}>
      {isReaderMode ? (
        <View
          style={[
            styles.readerScreen,
            isDesktop && styles.readerScreenDesktop,
            workspaceMode === 'split' && isDesktop && { flexDirection: 'row' },
          ]}
        >
          {(workspaceMode === 'doc' || workspaceMode === 'split') && (
            <View
              style={[
                styles.readerPanel,
                workspaceMode === 'doc' && styles.panelFull,
                workspaceMode === 'split' && isDesktop && styles.panelDesktopSplitLeft,
                workspaceMode === 'split' && !isDesktop && styles.panelMobileSplitTop,
              ]}
            >
              <PdfReader
                ref={pdfReaderRef}
                fileUrl={session.sourceFile?.url}
                onDocLoaded={handleReaderDocLoaded}
                onDocError={(msg) => setError(msg)}
                onPageChanged={handleReaderPageChanged}
                onSelectionAction={handleReaderSelectionAction}
                onScannedPage={handleReaderScannedPage}
                onFullTextExtracted={handleFullTextExtracted}
              />
              <View style={styles.readerToolbar}>
                <Text style={styles.readerToolbarHint} numberOfLines={1}>
                  {readerPageScanned
                    ? 'This page looks scanned — use "Read it" above.'
                    : session.sourceFile?.name || 'Document'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable
                    hitSlop={8}
                    onPress={toggleSpeakReader}
                    disabled={!readerPageText}
                    style={styles.readerToolbarBtn}
                  >
                    <Ionicons
                      name={readerSpeaking ? 'stop-circle' : 'volume-medium-outline'}
                      size={17}
                      color={readerSpeaking ? colors.lamp : colors.textFaint}
                    />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={togglePageBookmark} style={styles.readerToolbarBtn}>
                    <Ionicons
                      name={pageBookmarkMap.has(readerPageIndex) ? 'star' : 'star-outline'}
                      size={17}
                      color={pageBookmarkMap.has(readerPageIndex) ? colors.lamp : colors.textFaint}
                    />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => setWorkspaceMode(workspaceMode === 'doc' ? 'split' : 'doc')}
                    style={styles.readerToolbarBtn}
                    accessibilityLabel={workspaceMode === 'doc' ? 'Exit full screen' : 'Expand full screen document'}
                  >
                    <Ionicons
                      name={workspaceMode === 'doc' ? 'contract-outline' : 'expand-outline'}
                      size={17}
                      color={colors.lamp}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Floating Pill when in Document Focus mode */}
              {workspaceMode === 'doc' && (
                <Pressable
                  style={styles.floatingChatPill}
                  onPress={() => setWorkspaceMode('chat')}
                >
                  <Ionicons name="chatbubbles" size={16} color={colors.ink} />
                  <Text style={styles.floatingChatPillText}>
                    AI Discussion {messages.length > 0 ? `(${messages.length})` : ''}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {(workspaceMode === 'chat' || workspaceMode === 'split') && (
            <View
              style={[
                styles.chatPanel,
                workspaceMode === 'chat' && styles.panelFull,
                workspaceMode === 'split' && isDesktop && styles.panelDesktopSplitRight,
                workspaceMode === 'split' && !isDesktop && styles.panelMobileSplitBottom,
              ]}
            >
              {workspaceMode === 'chat' && (
                <View style={styles.backToDocBar}>
                  <Pressable
                    style={styles.backToDocBtn}
                    onPress={() => setWorkspaceMode('doc')}
                  >
                    <Ionicons name="arrow-back" size={15} color={colors.lamp} />
                    <Text style={styles.backToDocText}>Back to Document (Page {readerPageIndex})</Text>
                  </Pressable>
                  <Pressable
                    style={styles.splitDocBtn}
                    onPress={() => setWorkspaceMode('split')}
                  >
                    <Ionicons name="grid-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.splitDocText}>Split View</Text>
                  </Pressable>
                </View>
              )}
              {readerMessageList}
              {bottomBar}
            </View>
          )}
        </View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              recap ? (
                <View style={styles.recapBanner}>
                  <Ionicons name="bookmark-outline" size={14} color={colors.lamp} />
                  <Text style={styles.recapText}>{recap}</Text>
                  <Pressable onPress={() => setRecap(null)} hitSlop={8}>
                    <Ionicons name="close" size={15} color={colors.textFaint} />
                  </Pressable>
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const prev = messages[index - 1];
              const showDivider = !!item.timestamp && (!prev || !isSameDay(prev.timestamp, item.timestamp));
              const divider = showDivider && (
                <View style={styles.dateDivider}>
                  <View style={styles.dateDividerLine} />
                  <Text style={styles.dateDividerText}>{formatDayLabel(item.timestamp)}</Text>
                  <View style={styles.dateDividerLine} />
                </View>
              );

              // §2: the passage itself renders in the reading pane — near
              // full-width serif "page," not a chat bubble. Everything else
              // (follow-ups, answers, quiz) stays as ChatBubble.
              if (isPassageMessage(messages, index)) {
                const sourceMessage = prev && (prev.type === 'image' || prev.type === 'file') ? prev : null;
                return (
                  <View>
                    {divider}
                    <ReadingPane
                      text={item.content}
                      sourceType={sourceMessage?.type || null}
                      onViewSource={() => {
                        if (!sourceMessage) return;
                        if (sourceMessage.type === 'image') setViewerUri(sourceMessage.content.url);
                        else if (sourceMessage.content.url) Linking.openURL(sourceMessage.content.url);
                      }}
                      onExplain={(text, isSingleWord) => rereadSelection(text, isSingleWord, item.content)}
                      onLoop={(text) => startLoop(text, item.content)}
                      onSelectionChange={handleSelectionChange}
                      speaking={speakingIndex === index}
                      onToggleSpeak={() => toggleSpeak(index, item.content)}
                      speakingCharIndex={speakingCharIndex}
                      onBookmark={() => toggleBookmark(index, item.content)}
                      bookmarked={bookmarkMap.has(index)}
                    />
                  </View>
                );
              }

              return (
                <View>
                  {divider}
                  <ChatBubble
                    message={item}
                    onExplain={
                      item.role === 'model' && item.type === 'text'
                        ? (text, isSingleWord) => rereadSelection(text, isSingleWord, item.content)
                        : undefined
                    }
                    onLoop={item.role === 'model' && item.type === 'text' ? (text) => startLoop(text, item.content) : undefined}
                    onSelectionChange={item.role === 'model' && item.type === 'text' ? handleSelectionChange : undefined}
                    onQuizComplete={handleQuizComplete}
                    speaking={speakingIndex === index}
                    onToggleSpeak={() => toggleSpeak(index, item.content)}
                    onBookmark={
                      item.role === 'model' && item.type === 'text' ? () => toggleBookmark(index, item.content) : undefined
                    }
                    bookmarked={bookmarkMap.has(index)}
                  />
                </View>
              );
            }}
            ListFooterComponent={sending ? <ChatBubble message={{ role: 'model', pending: true }} /> : null}
          />
          {bottomBar}
        </>
      )}

      <WordExplainModal
        popup={popup}
        onClose={closePopup}
        onMarkLearned={markWordLearned}
        onResume={canResume ? resumeReading : undefined}
      />
      <LoopListenModal
        loop={loop}
        onStop={stopLoop}
        onToggleSlow={toggleLoopSlow}
        onExplain={explainLoopSelection}
        onContinue={canResume ? continueAfterLoop : undefined}
      />
      <ImageViewerModal visible={!!viewerUri} uri={viewerUri} onClose={() => setViewerUri(null)} />

      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <View style={styles.renameOverlay}>
          <View style={styles.renameCard}>
            <Text style={styles.renameLabel}>Rename reading session</Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              style={styles.renameInput}
              placeholder="Reading session title"
              placeholderTextColor={colors.textFaint}
              autoFocus
              maxLength={80}
            />
            <View style={styles.renameActions}>
              <Pressable style={styles.renameCancelBtn} onPress={() => setRenameVisible(false)}>
                <Text style={styles.renameCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.renameSaveBtn} onPress={handleRename}>
                <Text style={styles.renameSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AttachmentInstructionModal
        visible={!!pendingAttachment}
        kind={pendingAttachment?.kind === 'pdf' ? 'pdf' : 'photo'}
        previewUri={pendingAttachment?.kind === 'photo' ? pendingAttachment.asset.uri : null}
        fileName={pendingAttachment?.kind === 'pdf' ? pendingAttachment.asset.name : null}
        defaultLabel="Simplify to my level"
        onDefault={() => confirmPendingAttachment(null)}
        onCustom={(instruction) => confirmPendingAttachment(instruction)}
        onCancel={() => setPendingAttachment(null)}
      />

      {/* §3's "custom-instruction field" — the one selection action that
          needs typed input, collected natively rather than inside the
          WebView (see PdfReader.js's header comment on why the trigger
          for anything needing a native control lives in RN, not HTML). */}
      <Modal
        visible={!!customPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setCustomPrompt(null);
          setCustomPromptText('');
        }}
      >
        <View style={styles.renameOverlay}>
          <View style={styles.renameCard}>
            <Text style={styles.renameLabel}>Ask about this selection</Text>
            {!!customPrompt?.selectionText && (
              <Text style={styles.customPromptExcerpt} numberOfLines={3}>
                “{customPrompt.selectionText}”
              </Text>
            )}
            <TextInput
              value={customPromptText}
              onChangeText={setCustomPromptText}
              style={[styles.renameInput, styles.customPromptInput]}
              placeholder="e.g. How does this connect to page 2?"
              placeholderTextColor={colors.textFaint}
              autoFocus
              multiline
              maxLength={300}
            />
            <View style={styles.renameActions}>
              <Pressable
                style={styles.renameCancelBtn}
                onPress={() => {
                  setCustomPrompt(null);
                  setCustomPromptText('');
                }}
              >
                <Text style={styles.renameCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.renameSaveBtn, !customPromptText.trim() && styles.sendBtnDisabled]}
                onPress={submitCustomPrompt}
                disabled={!customPromptText.trim()}
              >
                <Text style={styles.renameSaveText}>Ask</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius }) {
  return StyleSheet.create({
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: spacing.md, paddingBottom: spacing.md },

    // ---------- PDF reader pivot: reader-mode layout ----------
    // Explicit flex ratios rather than relying on FlatList's implicit
    // sizing — with a large fixed-content sibling (the WebView panel)
    // above it, an unsized FlatList would just grow to its content height
    // instead of scrolling within the remaining space.
    readerScreen: { flex: 1, backgroundColor: colors.ink },
    readerScreenDesktop: { flex: 1, flexDirection: 'row' },
    readerPanel: {
      position: 'relative',
      backgroundColor: colors.ink,
      display: 'flex',
      flexDirection: 'column',
    },
    panelFull: {
      flex: 1,
      width: '100%',
      height: '100%',
    },
    panelDesktopSplitLeft: {
      flex: 3,
      height: '100%',
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    panelDesktopSplitRight: {
      flex: 2,
      height: '100%',
      backgroundColor: colors.paper,
    },
    panelMobileSplitTop: {
      flex: 5,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    panelMobileSplitBottom: {
      flex: 4,
    },
    chatPanel: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: colors.paper,
    },
    floatingChatPill: {
      position: 'absolute',
      bottom: 24,
      right: 20,
      zIndex: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.lamp,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 6,
    },
    floatingChatPillText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.ink,
    },
    backToDocBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.paperRaised,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backToDocBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    backToDocText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12.5,
      color: colors.lamp,
    },
    splitDocBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.border,
    },
    splitDocText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      color: colors.textMuted,
    },
    readerToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      backgroundColor: colors.paperRaised,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    readerToolbarHint: { flex: 1, fontFamily: fonts.body, fontSize: 11.5, color: colors.textFaint, marginRight: spacing.sm },
    readerToolbarBtn: { marginLeft: 14 },
    readerMessageList: { flex: 1 },
    readerEmptyHint: {
      fontFamily: fonts.body,
      fontStyle: 'italic',
      fontSize: 13,
      color: colors.textFaint,
      textAlign: 'center',
      padding: spacing.lg,
    },
    customPromptExcerpt: {
      fontFamily: fonts.body,
      fontStyle: 'italic',
      fontSize: 13,
      color: colors.textMuted,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      padding: 10,
      marginBottom: spacing.sm,
    },
    customPromptInput: { minHeight: 70, textAlignVertical: 'top' },

    dateDivider: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, marginTop: spacing.xs },
    dateDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    dateDividerText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      color: colors.textFaint,
      marginHorizontal: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    // §2: "a bookmark, not an unread-messages cue" — deliberately quiet:
    // no bold color, no badge, just a thin ribbon above the conversation.
    recapBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 8,
      paddingHorizontal: 10,
      marginBottom: spacing.md,
    },
    recapText: { flex: 1, fontFamily: fonts.body, fontStyle: 'italic', fontSize: 12.5, color: colors.textMuted, marginHorizontal: 8 },
    error: { fontFamily: fonts.body, color: colors.coral, fontSize: 12.5, paddingHorizontal: spacing.md, paddingBottom: 4 },
    uploadProgressText: {
      fontFamily: fonts.body,
      fontSize: 11.5,
      color: colors.textMuted,
      paddingHorizontal: spacing.md,
      paddingBottom: 4,
    },
    // Wraps onto a second line instead of scrolling sideways, so every
    // action is visible without hunting for it.
    quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.sm, paddingBottom: spacing.xs, alignItems: 'center' },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      padding: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      // paperRaised, not paper — paper now specifically means "the
      // reading pane" (see ReadingPane.js), so this bottom toolbar reads
      // as UI chrome, not another sheet of the page.
      backgroundColor: colors.paperRaised,
    },
    attachBtn: { padding: 8, marginRight: 2 },
    quizChip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: colors.lamp,
      borderRadius: radius.pill,
      paddingVertical: 9,
      paddingHorizontal: 14,
      marginRight: spacing.xs,
      marginBottom: spacing.xs,
    },
    quizChipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.lamp, marginLeft: 6 },
    // §2: quick reading-shaped actions alongside "Quiz me" — most
    // interactions guided rather than "type anything to the bot," while
    // free text (below) stays available for anything these don't cover.
    actionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderWidth: 1.5,
      borderColor: colors.textFaint,
      borderRadius: radius.pill,
      paddingVertical: 9,
      paddingHorizontal: 14,
      marginRight: spacing.xs,
      marginBottom: spacing.xs,
    },
    actionChipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.textPrimary, marginLeft: 6 },
    textInput: {
      flex: 1,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      fontSize: 14,
      maxHeight: 100,
      marginRight: spacing.xs,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: { opacity: 0.4 },

    // §7 backlog: manual rename modal.
    renameOverlay: { flex: 1, backgroundColor: 'rgba(10,12,15,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    renameCard: { width: '100%', backgroundColor: colors.paperRaised, borderRadius: radius.lg, padding: spacing.lg },
    renameLabel: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm },
    renameInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.paper,
    },
    renameActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
    renameCancelBtn: { paddingVertical: 8, paddingHorizontal: 14 },
    renameCancelText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.textMuted },
    renameSaveBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: colors.lamp, borderRadius: radius.md, marginLeft: spacing.xs },
    renameSaveText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  });
}
