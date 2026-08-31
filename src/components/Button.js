import React, { useMemo } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

// variant: 'primary' (lamp-glow, filled) | 'ghost' (outline, quiet)
export default function Button({ title, onPress, variant = 'primary', loading = false, disabled = false, icon = null }) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.ghost,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={isPrimary ? colors.ink : colors.lamp} size="small" />
        ) : (
          <>
            {icon}
            <Text style={[styles.text, isPrimary ? styles.textPrimary : styles.textGhost, icon && { marginLeft: 8 }]}>
              {title}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

function createStyles({ colors, fonts, radius, spacing }) {
  return StyleSheet.create({
    base: {
      borderRadius: radius.pill,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primary: {
      backgroundColor: colors.lamp,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.85,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    text: {
      fontFamily: fonts.bodySemiBold,
      fontSize: 15,
    },
    textPrimary: {
      color: colors.ink,
    },
    textGhost: {
      color: colors.textPrimary,
    },
  });
}
