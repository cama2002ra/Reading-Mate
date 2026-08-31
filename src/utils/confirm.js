import { Alert, Platform } from 'react-native';

// A destructive-action confirm dialog ("Log out?", "Delete this?", "Reset
// progress?") that actually works on web.
//
// Alert.alert(title, message, buttons) is fine on native — iOS/Android
// show a real dialog and call the tapped button's onPress. React Native
// Web's Alert.alert does NOT implement that: it either no-ops or falls
// back to a bare single-button window.alert(title), with nothing wired to
// the buttons array at all. So every screen that used Alert.alert to ask
// "are you sure?" before something destructive — Settings' log out,
// SessionsListScreen's delete session, ProgressScreen's reset progress —
// looked like tapping the button did nothing on web: the confirm dialog
// itself never appeared, so the destructive onPress never fired.
//
// window.confirm() is the plain-browser equivalent of that same
// yes/no dialog, and its return value tells us which one was pressed, so
// this just branches on Platform.OS and calls the destructive action from
// whichever path actually ran.
export function confirmDestructive({ title, message, confirmText, onConfirm }) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    if (window.confirm(text)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}
