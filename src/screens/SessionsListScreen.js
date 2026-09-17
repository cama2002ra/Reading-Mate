import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, Image, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import ScreenContainer from '../components/ScreenContainer';
import Button from '../components/Button';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToSessions, deleteSession } from '../services/firestore';
import { levelLabel } from '../constants/levels';
import { confirmDestructive } from '../utils/confirm';

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// §2: "reading log / bookshelf entry," not "inbox row" — a scannable
// excerpt of the actual passage instead of a "You: ..." last-message line,
// which read as recent chats rather than things being read.
function passageExcerpt(session) {
  const messages = session.messages || [];
  const passage = messages.find((m) => m.role === 'model' && m.type === 'text');
  if (passage) {
    const firstLine = String(passage.content || '')
      .split('\n')
      .find((line) => line.trim());
    if (firstLine?.trim()) return firstLine.trim();
  }
  // Reader-mode sessions (§3) open straight into the WebView with zero
  // messages until the student selects something — falling through to
  // "No passage yet" here would be misleading when there's a whole
  // document sitting there, just no logged reply yet.
  if (session.mode === 'reader' && session.sourceFile?.name) {
    return session.sourceFile.name;
  }
  return 'No passage yet';
}

// A small thumbnail if the session has a photographed page attached —
// supports both the current Storage-backed shape and the older inline
// base64 one (see services/uploads.js / firestore.js).
function sourcePhotoUri(session) {
  const image = (session.messages || []).find((m) => m.type === 'image');
  if (!image) return null;
  return image.content.url || `data:${image.content.mimeType};base64,${image.content.base64}`;
}

export default function SessionsListScreen({ navigation }) {
  const theme = useTheme();
  const { colors, spacing } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { user } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToSessions(user.uid, setSessions);
    return unsubscribe;
  }, [user]);

  // §7 backlog: search/filter by title — only worth showing once there
  // are enough sessions that scanning the list stops being instant.
  const filteredSessions = useMemo(() => {
    if (!sessions) return sessions;
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(trimmed));
  }, [sessions, query]);

  const handleDelete = (session) => {
    confirmDestructive({
      title: 'Delete reading session?',
      message: `"${session.title || 'New reading session'}" will be gone for good.`,
      confirmText: 'Delete',
      onConfirm: () => deleteSession(user.uid, session.id),
    });
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.header}>
        <Text style={styles.heading}>Your reading sessions</Text>
        <Text style={styles.subheading}>Pick up where you left off, or start something new.</Text>
        <Button title="New reading session" onPress={() => navigation.navigate('NewSession')} />
        {sessions && sessions.length > 3 && (
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={15} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by title"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={15} color={colors.textFaint} />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {sessions === null ? (
        <ActivityIndicator color={colors.lamp} style={{ marginTop: spacing.xl }} />
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="book-outline" size={32} color={colors.textFaint} />
          <Text style={styles.emptyText}>No reading sessions yet. Tap "New reading session" to begin reading.</Text>
        </View>
      ) : filteredSessions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={28} color={colors.textFaint} />
          <Text style={styles.emptyText}>No reading sessions match "{query.trim()}".</Text>
        </View>
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const photoUri = sourcePhotoUri(item);
            const isReader = item.mode === 'reader';
            return (
              <Pressable
                style={styles.card}
                onPress={() => navigation.navigate('Session', { sessionId: item.id })}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.thumbnail} resizeMode="cover" />
                ) : isReader ? (
                  <View style={[styles.thumbnail, styles.readerBadge]}>
                    <Ionicons name="document-text-outline" size={18} color={colors.lamp} />
                  </View>
                ) : null}
                <View style={styles.cardBody}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.title || 'New reading session'}
                    </Text>
                    <Pressable hitSlop={10} onPress={() => handleDelete(item)} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={16} color={colors.textFaint} />
                    </Pressable>
                  </View>
                  <Text style={styles.cardPreview} numberOfLines={2}>
                    {passageExcerpt(item)}
                  </Text>
                  <View style={styles.cardMetaRow}>
                    <Text style={styles.cardMeta}>{levelLabel(item.level)}</Text>
                    <Text style={styles.cardMetaDot}>·</Text>
                    <Text style={styles.cardMeta}>{formatDate(item.updatedAt)}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

function createStyles({ colors, fonts, spacing, radius, shadow }) {
  return StyleSheet.create({
    header: { padding: spacing.lg, paddingBottom: spacing.md },
    heading: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.textPrimary },
    subheading: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginTop: spacing.md,
    },
    searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.textPrimary, marginHorizontal: 8, padding: 0 },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    card: {
      flexDirection: 'row',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      ...shadow,
    },
    thumbnail: { width: 44, height: 44, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.paperRaised },
    readerBadge: { alignItems: 'center', justifyContent: 'center' },
    cardBody: { flex: 1 },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.textPrimary, marginBottom: 4, flex: 1, marginRight: spacing.sm },
    deleteBtn: { padding: 2 },
    cardPreview: { fontFamily: fonts.displayRegular, fontSize: 13, color: colors.textMuted, marginBottom: 6, lineHeight: 18 },
    cardMetaRow: { flexDirection: 'row', alignItems: 'center' },
    cardMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
    cardMetaDot: { fontFamily: fonts.body, fontSize: 12, color: colors.textFaint, marginHorizontal: 6 },
    empty: { alignItems: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.xl },
    emptyText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textFaint, textAlign: 'center', marginTop: spacing.sm },
  });
}
