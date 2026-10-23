import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToSessions,
  createSession,
  newSessionId,
  updateSessionTitle,
  subscribeToProgress,
  recordWordLearned,
} from '../services/firestore';
import { levelLabel } from '../constants/levels';

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { text: 'Good morning', icon: 'sunny-outline', color: '#E8A33D' };
  if (hour < 18) return { text: 'Good afternoon', icon: 'partly-sunny-outline', color: '#E8A33D' };
  return { text: 'Good evening', icon: 'moon-outline', color: '#6FCF97' };
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function passageExcerpt(session) {
  const messages = session.messages || [];
  const passage = messages.find((m) => m.role === 'model' && m.type === 'text');
  if (passage) {
    const firstLine = String(passage.content || '')
      .split('\n')
      .find((line) => line.trim());
    if (firstLine?.trim()) return firstLine.trim();
  }
  if (session.mode === 'reader' && session.sourceFile?.name) {
    return session.sourceFile.name;
  }
  return 'Ready to read';
}

const WORD_OF_THE_DAY_LIST = [
  {
    word: 'Resilience',
    phonetic: '/rɪˈzɪl.jəns/',
    definition: 'The ability to bounce back, recover, and grow stronger after facing difficult challenges or setbacks.',
    example: 'Her resilience helped her sound out every difficult paragraph and master the text.',
  },
  {
    word: 'Curiosity',
    phonetic: '/ˌkjʊə.riˈɒs.ə.ti/',
    definition: 'A strong, eager desire to learn, understand, and explore new ideas or information.',
    example: 'His curiosity sparked when he discovered a fascinating science chapter in the library.',
  },
  {
    word: 'Perspective',
    phonetic: '/pəˈspek.tɪv/',
    definition: 'A particular attitude toward or way of regarding and understanding something.',
    example: 'Reading stories from different cultures gave her a whole new perspective on the world.',
  },
  {
    word: 'Luminous',
    phonetic: '/ˈluː.mɪ.nəs/',
    definition: 'Full of or shedding light; bright, inspiring, or brilliantly clear to understand.',
    example: 'The author wrote with a luminous clarity that made difficult concepts easy to grasp.',
  },
  {
    word: 'Tenacious',
    phonetic: '/təˈneɪ.ʃəs/',
    definition: 'Holding firm to a purpose; persistent and determined to keep going.',
    example: 'The tenacious reader sounded out every new word until the meaning became clear.',
  },
  {
    word: 'Eloquent',
    phonetic: '/ˈel.ə.kwənt/',
    definition: 'Fluent, persuasive, and beautifully expressive in speech or writing.',
    example: 'The author delivered an eloquent explanation that captivated every reader.',
  },
  {
    word: 'Empathy',
    phonetic: '/ˈem.pə.θi/',
    definition: 'The ability to understand and share the feelings and experiences of another person.',
    example: 'Good books cultivate empathy by letting us walk in other people’s shoes.',
  },
];

const READING_TIPS = [
  { icon: 'bulb-outline', text: 'Tap any word while reading to get an instant definition and pronunciation.' },
  { icon: 'bookmark-outline', text: 'Bookmark your favourite passages and revisit them from the Progress tab.' },
  { icon: 'repeat-outline', text: 'Words you save come back as flashcards — spaced repetition keeps them sharp.' },
  { icon: 'sparkles-outline', text: 'Use "Quiz me" after reading a passage to test your comprehension.' },
  { icon: 'camera-outline', text: 'Snap a photo of a textbook page and Reading Mate will simplify it for you.' },
  { icon: 'document-text-outline', text: 'Upload a PDF and get AI-powered explanations, definitions, and quizzes inline.' },
];

export default function HomeScreen({ navigation }) {
  const theme = useTheme();
  const { colors, fonts, spacing, radius } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { user } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [progress, setProgress] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [speakingWord, setSpeakingWord] = useState(false);
  const [wordSaved, setWordSaved] = useState(false);
  const [wordExpanded, setWordExpanded] = useState(false);

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribeSessions = subscribeToSessions(user.uid, (list) => setSessions(list || []));
    const unsubscribeProgress = subscribeToProgress(user.uid, setProgress);
    return () => {
      unsubscribeSessions();
      unsubscribeProgress();
    };
  }, [user]);

  const recentSession = sessions && sessions.length > 0 ? sessions[0] : null;
  const greeting = getTimeGreeting();

  // Pick deterministic word based on calendar day
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % WORD_OF_THE_DAY_LIST.length;
  const todayWord = WORD_OF_THE_DAY_LIST[dayIndex];

  const handleSpeakWord = () => {
    if (speakingWord || !todayWord) return;
    setSpeakingWord(true);
    Speech.speak(todayWord.word, {
      rate: theme.speechRate || 0.85,
      onDone: () => setSpeakingWord(false),
      onError: () => setSpeakingWord(false),
    });
  };

  const handleSaveDailyWord = async () => {
    if (!user || wordSaved || !todayWord) return;
    try {
      await recordWordLearned(user.uid, todayWord.word, todayWord.definition);
      setWordSaved(true);
    } catch (e) {
      console.warn('[handleSaveDailyWord] error:', e);
    }
  };

  const handleLaunchSamplePdf = async () => {
    if (!user || demoLoading) return;
    setDemoLoading(true);
    try {
      const sessionId = newSessionId(user.uid);
      await createSession(user.uid, {
        sessionId,
        level: 'middle',
        mode: 'reader',
        sourceFile: {
          url: 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/examples/learning/helloworld.pdf',
          name: 'Sample PDF Document',
          pageCount: 1,
        },
      });
      await updateSessionTitle(user.uid, sessionId, 'Sample: Hello World PDF');
      navigation.navigate('Read', {
        screen: 'Session',
        params: { sessionId },
        initial: false,
      });
    } catch (err) {
      console.error('[handleLaunchSamplePdf] error:', err);
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <ScreenContainer>
      {/* Welcome Header */}
      <View style={styles.header}>
        <View style={styles.greetingWrap}>
          <View style={styles.greetingTitleRow}>
            <Ionicons name={greeting.icon} size={20} color={greeting.color} style={{ marginRight: 6 }} />
            <Text style={styles.greetingTitle}>
              {greeting.text}, {user?.displayName ? user.displayName.split(' ')[0] : 'Reader'}
            </Text>
          </View>
          <Text style={styles.greetingSubtitle}>
            What would you like to explore today?
          </Text>
        </View>
        <Pressable
          style={styles.settingsBadge}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Settings"
        >
          <Ionicons name="sparkles" size={15} color={colors.lamp} />
          <Text style={styles.settingsBadgeText}>Reading Mate</Text>
        </Pressable>
      </View>

      {/* Quick Habit Stats Bar */}
      <View style={styles.quickStatsRow}>
        <View style={styles.statPill}>
          <Ionicons name="flame" size={16} color={colors.lamp} />
          <Text style={styles.statPillNum}>{progress?.streak || 0}</Text>
          <Text style={styles.statPillLabel}>day streak</Text>
        </View>
        <View style={styles.statPill}>
          <Ionicons name="book" size={16} color={colors.sage} />
          <Text style={styles.statPillNum}>{progress?.passagesRead || 0}</Text>
          <Text style={styles.statPillLabel}>read</Text>
        </View>
        <View style={styles.statPill}>
          <Ionicons name="school" size={16} color={colors.textPrimary} />
          <Text style={styles.statPillNum}>{progress?.wordsLearned?.length || 0}</Text>
          <Text style={styles.statPillLabel}>vocab</Text>
        </View>
      </View>

      {/* Word of the Day */}
      <View style={styles.section}>
        <Pressable
          style={styles.wordCard}
          onPress={() => setWordExpanded((v) => !v)}
        >
          <View style={styles.wordCardHeader}>
            <View style={styles.wordCardBadge}>
              <Ionicons name="sparkles" size={13} color={colors.lamp} />
              <Text style={styles.wordCardBadgeText}>Word of the Day</Text>
            </View>
            <Ionicons
              name={wordExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textFaint}
            />
          </View>
          <View style={styles.wordCardBody}>
            <Text style={styles.wordCardWord}>{todayWord.word}</Text>
            <Text style={styles.wordCardPhonetic}>{todayWord.phonetic}</Text>
          </View>
          {wordExpanded && (
            <View style={styles.wordCardExpanded}>
              <Text style={styles.wordCardDefinition}>{todayWord.definition}</Text>
              <View style={styles.wordCardExampleBox}>
                <Ionicons name="chatbubble-outline" size={13} color={colors.textFaint} style={{ marginTop: 1 }} />
                <Text style={styles.wordCardExample}>"{todayWord.example}"</Text>
              </View>
              <View style={styles.wordCardActions}>
                <Pressable style={styles.wordCardSpeakBtn} onPress={handleSpeakWord}>
                  <Ionicons
                    name={speakingWord ? 'volume-high' : 'volume-medium-outline'}
                    size={16}
                    color={colors.lamp}
                  />
                  <Text style={styles.wordCardSpeakText}>{speakingWord ? 'Playing…' : 'Pronounce'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.wordCardSaveBtn, wordSaved && styles.wordCardSaveBtnDone]}
                  onPress={handleSaveDailyWord}
                  disabled={wordSaved}
                >
                  <Ionicons
                    name={wordSaved ? 'checkmark-circle' : 'add-circle-outline'}
                    size={15}
                    color={wordSaved ? colors.sage : colors.lamp}
                  />
                  <Text style={[styles.wordCardSaveText, wordSaved && { color: colors.sage }]}>
                    {wordSaved ? 'Saved!' : 'Save to Vocab'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </View>

      {/* Continue Reading Hero (if user has active readings) */}
      {recentSession && (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Continue Reading</Text>
          <Pressable
            style={styles.continueCard}
            onPress={() =>
              navigation.navigate('Read', {
                screen: 'Session',
                params: { sessionId: recentSession.id },
                initial: false,
              })
            }
          >
            <View
              style={[
                styles.continueIconBox,
                recentSession.mode === 'reader' ? styles.continueIconBoxPdf : styles.continueIconBoxText,
              ]}
            >
              <Ionicons
                name={recentSession.mode === 'reader' ? 'document-text' : 'book'}
                size={24}
                color={recentSession.mode === 'reader' ? colors.lamp : colors.sage}
              />
            </View>
            <View style={styles.continueBody}>
              <View style={styles.continueBadgeRow}>
                <View
                  style={[
                    styles.tag,
                    recentSession.mode === 'reader' ? styles.tagPdf : styles.tagText,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagTextLabel,
                      recentSession.mode === 'reader' ? styles.tagTextPdf : styles.tagTextPassage,
                    ]}
                  >
                    {recentSession.mode === 'reader' ? 'PDF Document' : 'Passage'}
                  </Text>
                </View>
                <Text style={styles.continueMeta}>{formatDate(recentSession.updatedAt)}</Text>
              </View>
              <Text style={styles.continueTitle} numberOfLines={1}>
                {recentSession.title || 'Reading session'}
              </Text>
              <Text style={styles.continueExcerpt} numberOfLines={2}>
                {passageExcerpt(recentSession)}
              </Text>
              <View style={styles.resumeActionRow}>
                <Text style={styles.continueLevel}>{levelLabel(recentSession.level)}</Text>
                <View style={styles.resumeBtn}>
                  <Text style={styles.resumeBtnText}>Resume</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.ink} />
                </View>
              </View>
            </View>
          </Pressable>
        </View>
      )}

      {/* Primary Action Pathways */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Start a New Reading</Text>
        <View style={styles.pathwayGrid}>
          {/* Card 1: Open PDF */}
          <Pressable
            style={styles.pathwayCard}
            onPress={() =>
              navigation.navigate('Read', {
                screen: 'NewSession',
                params: { initialMode: 'pdf' },
                initial: false,
              })
            }
          >
            <View style={[styles.pathwayIconWrap, { backgroundColor: colors.lampSoft }]}>
              <Ionicons name="document-text-outline" size={24} color={colors.lamp} />
            </View>
            <Text style={styles.pathwayTitle}>Open PDF / Document</Text>
            <Text style={styles.pathwayDesc}>
              Upload a PDF or slides. Read with on-page definitions, AI explanations & quizzes.
            </Text>
            <View style={styles.pathwayFooter}>
              <Text style={[styles.pathwayActionText, { color: colors.lamp }]}>Choose file →</Text>
            </View>
          </Pressable>

          {/* Card 2: Paste & Simplify */}
          <Pressable
            style={styles.pathwayCard}
            onPress={() =>
              navigation.navigate('Read', {
                screen: 'NewSession',
                params: { initialMode: 'text' },
                initial: false,
              })
            }
          >
            <View style={[styles.pathwayIconWrap, { backgroundColor: colors.sageSoft }]}>
              <Ionicons name="create-outline" size={24} color={colors.sage} />
            </View>
            <Text style={styles.pathwayTitle}>Paste & Simplify</Text>
            <Text style={styles.pathwayDesc}>
              Paste any article, homework, or difficult passage to rewrite at your reading level.
            </Text>
            <View style={styles.pathwayFooter}>
              <Text style={[styles.pathwayActionText, { color: colors.sage }]}>Paste text →</Text>
            </View>
          </Pressable>

          {/* Card 3: Snap a Page */}
          <Pressable
            style={styles.pathwayCard}
            onPress={() =>
              navigation.navigate('Read', {
                screen: 'NewSession',
                params: { initialMode: 'photo' },
                initial: false,
              })
            }
          >
            <View style={[styles.pathwayIconWrap, { backgroundColor: colors.coralSoft }]}>
              <Ionicons name="camera-outline" size={24} color={colors.coral} />
            </View>
            <Text style={styles.pathwayTitle}>Snap a Book Page</Text>
            <Text style={styles.pathwayDesc}>
              Photograph a physical textbook page or worksheet to read aloud and explain.
            </Text>
            <View style={styles.pathwayFooter}>
              <Text style={[styles.pathwayActionText, { color: colors.coral }]}>Take photo →</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* 1-Click Interactive Demo */}
      <View style={styles.section}>
        <Pressable
          style={styles.demoCard}
          onPress={handleLaunchSamplePdf}
          disabled={demoLoading}
        >
          <View style={styles.demoGlow} />
          <View style={styles.demoContent}>
            <View style={styles.demoBadge}>
              <Ionicons name="play-circle" size={16} color={colors.lamp} />
              <Text style={styles.demoBadgeText}>Instant Demo</Text>
            </View>
            <Text style={styles.demoTitle}>Try Interactive PDF Reader Demo</Text>
            <Text style={styles.demoSubtitle}>
              Test text selection, word definitions, and AI explanations with a 1-click sample document.
            </Text>
          </View>
          <View style={styles.demoBtn}>
            {demoLoading ? (
              <ActivityIndicator size="small" color={colors.ink} />
            ) : (
              <Ionicons name="arrow-forward" size={18} color={colors.ink} />
            )}
          </View>
        </Pressable>
      </View>

      {/* Recent Bookshelf */}
      {sessions && sessions.length > 1 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>Recent in Library</Text>
            <Pressable
              onPress={() => navigation.navigate('Read', { screen: 'SessionsList', initial: false })}
            >
              <Text style={styles.viewAllText}>View all ({sessions.length}) →</Text>
            </Pressable>
          </View>
          {sessions.slice(0, 3).map((item) => (
            <Pressable
              key={item.id}
              style={styles.recentItem}
              onPress={() =>
                navigation.navigate('Read', {
                  screen: 'Session',
                  params: { sessionId: item.id },
                  initial: false,
                })
              }
            >
              <View
                style={[
                  styles.recentIcon,
                  item.mode === 'reader' ? styles.tagPdf : styles.tagText,
                ]}
              >
                <Ionicons
                  name={item.mode === 'reader' ? 'document-text' : 'book'}
                  size={16}
                  color={item.mode === 'reader' ? colors.lamp : colors.sage}
                />
              </View>
              <View style={styles.recentBody}>
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {item.title || 'Reading session'}
                </Text>
                <Text style={styles.recentExcerpt} numberOfLines={1}>
                  {passageExcerpt(item)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Reading Tip */}
      <View style={styles.section}>
        <View style={styles.tipCard}>
          <Ionicons name={READING_TIPS[dayIndex % READING_TIPS.length].icon} size={18} color={colors.sage} style={{ marginTop: 1 }} />
          <View style={styles.tipBody}>
            <Text style={styles.tipLabel}>Reading Tip</Text>
            <Text style={styles.tipText}>{READING_TIPS[dayIndex % READING_TIPS.length].text}</Text>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
      marginTop: spacing.sm,
    },
    greetingWrap: { flex: 1, marginRight: spacing.sm },
    greetingTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 2,
    },
    greetingTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 26,
      color: colors.textPrimary,
      letterSpacing: -0.3,
    },
    greetingSubtitle: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.textMuted,
      marginTop: 4,
    },
    settingsBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.paperRaised,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    settingsBadgeText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 11.5,
      color: colors.textPrimary,
    },
    section: {
      marginBottom: spacing.xl,
    },
    sectionHeading: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12.5,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textFaint,
      marginBottom: spacing.sm,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    quickStatsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    statPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 10,
      marginHorizontal: 3,
      gap: 5,
    },
    statPillNum: {
      fontFamily: fonts.bodyBold,
      fontSize: 15,
      color: colors.textPrimary,
    },
    statPillLabel: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.textMuted,
    },
    viewAllText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12.5,
      color: colors.lamp,
    },

    // Continue Card
    continueCard: {
      flexDirection: 'row',
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      ...shadow,
    },
    continueIconBox: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
    continueIconBoxPdf: { backgroundColor: colors.lampSoft },
    continueIconBoxText: { backgroundColor: colors.sageSoft },
    continueBody: { flex: 1 },
    continueBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    continueMeta: {
      fontFamily: fonts.body,
      fontSize: 11.5,
      color: colors.textFaint,
    },
    continueTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 16,
      color: colors.textPrimary,
      marginBottom: 3,
    },
    continueExcerpt: {
      fontFamily: fonts.displayRegular,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
      marginBottom: spacing.sm,
    },
    resumeActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    continueLevel: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.textFaint,
    },
    resumeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.lamp,
      paddingVertical: 5,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
    },
    resumeBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
      color: colors.ink,
    },

    // Pathways Grid
    pathwayGrid: {
      flexDirection: 'column',
      gap: spacing.sm,
    },
    pathwayCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      ...shadow,
    },
    pathwayIconWrap: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    pathwayTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 3,
    },
    pathwayDesc: {
      fontFamily: fonts.body,
      fontSize: 12.5,
      color: colors.textMuted,
      lineHeight: 17,
      marginBottom: spacing.xs,
    },
    pathwayFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 4,
    },
    pathwayActionText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 12,
    },

    // Demo Card
    demoCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lamp,
      padding: spacing.md,
      position: 'relative',
      overflow: 'hidden',
    },
    demoGlow: {
      position: 'absolute',
      right: -20,
      top: -20,
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.lampSoft,
    },
    demoContent: { flex: 1, marginRight: spacing.sm },
    demoBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 4,
    },
    demoBadgeText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 11,
      color: colors.lamp,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    demoTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 14.5,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    demoSubtitle: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 16,
    },
    demoBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.lamp,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Recent Library Item
    recentItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm + 2,
      marginBottom: spacing.xs,
    },
    recentIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    recentBody: { flex: 1, marginRight: spacing.sm },
    recentTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13.5,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    recentExcerpt: {
      fontFamily: fonts.body,
      fontSize: 11.5,
      color: colors.textFaint,
    },

    // Tags
    tag: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    tagPdf: { backgroundColor: colors.lampSoft },
    tagText: { backgroundColor: colors.sageSoft },
    tagTextLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10 },
    tagTextPdf: { color: colors.lamp },
    tagTextPassage: { color: colors.sage },

    // Word of the Day
    wordCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      ...shadow,
    },
    wordCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    wordCardBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    wordCardBadgeText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 11,
      color: colors.lamp,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    wordCardBody: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 10,
      marginBottom: 4,
    },
    wordCardWord: {
      fontFamily: fonts.displayBold,
      fontSize: 24,
      color: colors.textPrimary,
    },
    wordCardPhonetic: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.textFaint,
      fontStyle: 'italic',
    },
    wordCardExpanded: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    wordCardDefinition: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 21,
      marginBottom: spacing.sm,
    },
    wordCardExampleBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 7,
      backgroundColor: colors.paperRaised,
      borderRadius: radius.sm,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    wordCardExample: {
      flex: 1,
      fontFamily: fonts.displayRegular,
      fontSize: 13,
      color: colors.textMuted,
      fontStyle: 'italic',
      lineHeight: 19,
    },
    wordCardActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    wordCardSpeakBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.lampSoft,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.lamp,
    },
    wordCardSpeakText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.lamp,
    },
    wordCardSaveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.paperRaised,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    wordCardSaveBtnDone: {
      borderColor: colors.sage,
      backgroundColor: colors.sageSoft,
    },
    wordCardSaveText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.lamp,
    },

    // Reading tip
    tipCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.sageSoft,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.sage,
      padding: spacing.md,
      gap: spacing.sm,
    },
    tipBody: { flex: 1 },
    tipLabel: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 11,
      color: colors.sage,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 3,
    },
    tipText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.textPrimary,
      lineHeight: 18,
    },
  });
}
