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
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'pdf' | 'text' | 'photo'

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = subscribeToSessions(user.uid, setSessions);
    return unsubscribe;
  }, [user]);

  const filteredSessions = useMemo(() => {
    if (!sessions) return sessions;
    let list = sessions;

    // Filter by category
    if (categoryFilter === 'pdf') {
      list = list.filter((s) => s.mode === 'reader');
    } else if (categoryFilter === 'photo') {
      list = list.filter((s) => (s.messages || []).some((m) => m.type === 'image'));
    } else if (categoryFilter === 'text') {
      list = list.filter((s) => s.mode !== 'reader' && !(s.messages || []).some((m) => m.type === 'image'));
    }

    // Filter by query
    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      list = list.filter((s) => (s.title || '').toLowerCase().includes(trimmed));
    }

    return list;
  }, [sessions, categoryFilter, query]);

  const counts = useMemo(() => {
    if (!sessions) return { all: 0, pdf: 0, text: 0, photo: 0 };
    return {
      all: sessions.length,
      pdf: sessions.filter((s) => s.mode === 'reader').length,
      photo: sessions.filter((s) => (s.messages || []).some((m) => m.type === 'image')).length,
      text: sessions.filter((s) => s.mode !== 'reader' && !(s.messages || []).some((m) => m.type === 'image')).length,
    };
  }, [sessions]);

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
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.heading}>Your Library</Text>
            <Text style={styles.subheading}>Pick up where you left off, or start a new reading.</Text>
          </View>
          <Pressable
            style={styles.newBtn}
            onPress={() => navigation.navigate('NewSession')}
          >
            <Ionicons name="add" size={18} color={colors.ink} />
            <Text style={styles.newBtnText}>New</Text>
          </Pressable>
        </View>

        {sessions && sessions.length > 0 && (
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={15} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your library..."
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

        {sessions && sessions.length > 0 && (
          <View style={styles.filterRow}>
            <Pressable
              style={[styles.filterChip, categoryFilter === 'all' && styles.filterChipActive]}
              onPress={() => setCategoryFilter('all')}
            >
              <Text style={[styles.filterChipText, categoryFilter === 'all' && styles.filterChipTextActive]}>
                All ({counts.all})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filterChip, categoryFilter === 'pdf' && styles.filterChipActive]}
              onPress={() => setCategoryFilter('pdf')}
            >
              <Ionicons
                name="document-text-outline"
                size={13}
                color={categoryFilter === 'pdf' ? colors.ink : colors.textMuted}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.filterChipText, categoryFilter === 'pdf' && styles.filterChipTextActive]}>
                PDFs ({counts.pdf})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filterChip, categoryFilter === 'text' && styles.filterChipActive]}
              onPress={() => setCategoryFilter('text')}
            >
              <Ionicons
                name="book-outline"
                size={13}
                color={categoryFilter === 'text' ? colors.ink : colors.textMuted}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.filterChipText, categoryFilter === 'text' && styles.filterChipTextActive]}>
                Passages ({counts.text})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filterChip, categoryFilter === 'photo' && styles.filterChipActive]}
              onPress={() => setCategoryFilter('photo')}
            >
              <Ionicons
                name="image-outline"
                size={13}
                color={categoryFilter === 'photo' ? colors.ink : colors.textMuted}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.filterChipText, categoryFilter === 'photo' && styles.filterChipTextActive]}>
                Photos ({counts.photo})
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {sessions === null ? (
        <ActivityIndicator color={colors.lamp} style={{ marginTop: spacing.xl }} />
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="library-outline" size={38} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>Your library is empty</Text>
          <Text style={styles.emptyText}>Open a PDF or paste text to start your first reading session.</Text>
          <View style={{ marginTop: spacing.md }}>
            <Button title="Start reading" onPress={() => navigation.navigate('NewSession')} />
          </View>
        </View>
      ) : filteredSessions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={28} color={colors.textFaint} />
          <Text style={styles.emptyText}>No reading sessions match your filter.</Text>
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
                    <Ionicons name="document-text" size={20} color={colors.lamp} />
                  </View>
                ) : (
                  <View style={[styles.thumbnail, styles.passageBadge]}>
                    <Ionicons name="book" size={18} color={colors.sage} />
                  </View>
                )}
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
                    <View style={[styles.formatTag, isReader ? styles.formatTagPdf : styles.formatTagText]}>
                      <Text style={[styles.formatTagTextLabel, isReader ? styles.formatTagTextPdf : styles.formatTagTextPassage]}>
                        {isReader ? 'PDF Document' : photoUri ? 'Photo Page' : 'Passage'}
                      </Text>
                    </View>
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
    header: { padding: spacing.lg, paddingBottom: spacing.sm },
    headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.xs },
    heading: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.textPrimary },
    subheading: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textMuted, marginTop: 4 },
    newBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.lamp,
      borderRadius: radius.pill,
      paddingVertical: 6,
      paddingHorizontal: 12,
      gap: 4,
    },
    newBtnText: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 13,
      color: colors.ink,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
      marginTop: spacing.sm,
    },
    searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.textPrimary, marginHorizontal: 8, padding: 0 },
    filterRow: {
      flexDirection: 'row',
      marginTop: spacing.sm,
      gap: 6,
      flexWrap: 'wrap',
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 11,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.paperRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.lamp,
      borderColor: colors.lamp,
    },
    filterChipText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.textMuted,
    },
    filterChipTextActive: {
      fontFamily: fonts.bodySemiBold,
      color: colors.ink,
    },
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
    readerBadge: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lampSoft },
    passageBadge: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sageSoft },
    cardBody: { flex: 1 },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.textPrimary, marginBottom: 4, flex: 1, marginRight: spacing.sm },
    deleteBtn: { padding: 2 },
    cardPreview: { fontFamily: fonts.displayRegular, fontSize: 13, color: colors.textMuted, marginBottom: 6, lineHeight: 18 },
    cardMetaRow: { flexDirection: 'row', alignItems: 'center' },
    formatTag: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      marginRight: 8,
    },
    formatTagPdf: { backgroundColor: colors.lampSoft },
    formatTagText: { backgroundColor: colors.sageSoft },
    formatTagTextLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10 },
    formatTagTextPdf: { color: colors.lamp },
    formatTagTextPassage: { color: colors.sage },
    cardMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
    cardMetaDot: { fontFamily: fonts.body, fontSize: 12, color: colors.textFaint, marginHorizontal: 6 },
    empty: { alignItems: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.xl },
    emptyTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.textPrimary, marginTop: spacing.md, marginBottom: 4 },
    emptyText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textFaint, textAlign: 'center' },
  });
}
