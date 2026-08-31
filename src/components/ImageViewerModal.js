// Full-screen viewer for a chat bubble's photo. The inline chat bubble
// necessarily shows the photo small; since the whole point of "snap a
// page" is reading text off of it, tapping the thumbnail needs to open it
// at a size where that text is actually legible.

import React from 'react';
import { Modal, View, Image, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export default function ImageViewerModal({ visible, uri, onClose }) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Swallow taps on the image itself so tapping the photo (as
            opposed to the space around it) doesn't feel like it should do
            nothing — either way closes, but this avoids a dead-looking
            center. */}
        <Pressable onPress={onClose}>
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,12,15,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: width * 0.94,
    height: height * 0.78,
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
