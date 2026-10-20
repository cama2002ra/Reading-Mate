import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToSessions, createSession, newSessionId, updateSessionTitle } from '../services/firestore';
import { levelLabel } from '../constants/levels';

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
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

export default function HomeScreen({ navigation }) {
  const theme = useTheme();
  const { colors, fonts, spacing, radius } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { user } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToSessions(user.uid, (list) => setSessions(list || []));
    return unsubscribe;
  }, [user]);

  const recentSession = sessions && sessions.length > 0 ? sessions[0] : null;
  const greeting = getTimeGreeting();

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
          <Text style={styles.greetingTitle}>
            {greeting}, {user?.displayName ? user.displayName.split(' ')[0] : 'Reader'}
          </Text>
          <Text style={styles.greetingSubtitle}>
            What would you like to read today?
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
  });
}
