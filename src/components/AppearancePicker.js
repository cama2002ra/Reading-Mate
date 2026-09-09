// The Appearance control on the Settings screen. A three-way segmented
// control (System / Light / Dark) rather than a plain on/off switch —
// "System" is what most people should leave it on, and it's the
// convention every major app's own appearance setting already uses, so
// it doesn't need explaining.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

const OPTIONS = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function AppearancePicker() {
  const theme = useTheme();
  const { colors, mode, setThemeMode } = theme;
  const styles = createStyles(theme);

  return (
    <View style={styles.track}>
      {OPTIONS.map((opt) => {
        const active = mode === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => setThemeMode(opt.key)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Ionicons name={opt.icon} size={14} color={active ? colors.ink : colors.textMuted} />
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles({ colors, fonts, radius, shadow }) {
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      backgroundColor: colors.paperRaised,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 4,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 9,
      borderRadius: radius.pill,
    },
    segmentActive: {
      backgroundColor: colors.lamp,
      ...shadow,
    },
    segmentText: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      color: colors.textMuted,
      marginLeft: 5,
    },
    segmentTextActive: {
      fontFamily: fonts.bodySemiBold,
      color: colors.ink,
    },
  });
}
