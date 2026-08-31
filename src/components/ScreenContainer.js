import React, { useMemo } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';

export default function ScreenContainer({ children, scroll = true }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const Wrapper = scroll ? ScrollView : React.Fragment;
  const wrapperProps = scroll
    ? { contentContainerStyle: styles.scrollContent, keyboardShouldPersistTaps: 'handled' }
    : {};

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Wrapper {...wrapperProps}>{children}</Wrapper>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles({ colors, spacing }) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.ink,
    },
    flex: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
  });
}
