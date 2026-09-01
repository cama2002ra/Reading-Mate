import React, { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme, StackActions } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Lora_400Regular, Lora_600SemiBold, Lora_700Bold } from '@expo-google-fonts/lora';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import SessionsListScreen from './src/screens/SessionsListScreen';
import NewSessionScreen from './src/screens/NewSessionScreen';
import SessionScreen from './src/screens/SessionScreen';
import ProgressScreen from './src/screens/ProgressScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const ReadStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

const TAB_ICONS = {
  Home: 'home-outline',
  Read: 'book-outline',
  Progress: 'trending-up-outline',
  Settings: 'settings-outline',
};

// The Read tab is a small stack (Milestone 2): a Sessions list, a New
// Session input form, and the chat-style Session screen. It gets its own
// header (back button, per-screen title) since the outer tab bar deliberately
// has none.
function ReadStackNavigator() {
  const { colors, fonts } = useTheme();
  const readStackHeaderOptions = {
    headerStyle: { backgroundColor: colors.paper },
    headerTintColor: colors.textPrimary,
    headerTitleStyle: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
    headerShadowVisible: false,
  };

  return (
    <ReadStack.Navigator screenOptions={readStackHeaderOptions}>
      <ReadStack.Screen name="SessionsList" component={SessionsListScreen} options={{ title: 'Reading sessions' }} />
      <ReadStack.Screen name="NewSession" component={NewSessionScreen} options={{ title: 'New reading session' }} />
      <ReadStack.Screen name="Session" component={SessionScreen} options={{ title: 'Reading session' }} />
    </ReadStack.Navigator>
  );
}

function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.lamp,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Read"
        component={ReadStackNavigator}
        options={{ title: 'Read' }}
        listeners={({ navigation, route }) => ({
          // P0 fix (see README): without this, the bottom-tab navigator
          // preserves whatever screen was last active inside the Read
          // stack (NewSession, or an open Session), so the tab could get
          // permanently "stuck" showing the compose form or a stale
          // session instead of the list. The rule this enforces is
          // simple and applies every time the Read tab icon is pressed,
          // whether switching into it from another tab or pressing it
          // again while already on it: reset straight to SessionsList.
          //
          // This is a pure navigation reset — it doesn't touch Firestore,
          // cancel an in-flight Gemini request, or delete anything, so a
          // session backed out of this way is exactly as it was left the
          // next time it's opened from the list.
          tabPress: () => {
            const state = navigation.getState();
            const readRoute = state.routes.find((r) => r.key === route.key);
            if (readRoute?.state) {
              navigation.dispatch({
                ...StackActions.popToTop(),
                target: readRoute.state.key,
              });
            }
          },
        })}
      />
      <Tab.Screen name="Progress" component={ProgressScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// Standard React Navigation auth-flow pattern: one root stack, and which
// screen it contains depends on sign-in state — swapping "Auth" for "Main"
// (or back) happens automatically via AuthContext's onAuthStateChanged
// listener, no manual navigation calls needed anywhere.
function RootNavigator() {
  const { user } = useAuth();
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <RootStack.Screen name="Main" component={MainTabs} />
      ) : (
        <RootStack.Screen name="Auth" component={AuthScreen} />
      )}
    </RootStack.Navigator>
  );
}

function AppShell() {
  const [fontsLoaded] = useFonts({
    Lora_400Regular,
    Lora_600SemiBold,
    Lora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const { initializing } = useAuth();
  const { colors, resolvedMode } = useTheme();

  // React Navigation's own Dark/DefaultTheme just supply sensible base
  // values (e.g. for any built-in chrome this app doesn't style directly);
  // every color that actually shows on screen is overridden with this
  // session's live palette so navigation chrome never falls out of sync
  // with the rest of the app.
  const navTheme = useMemo(() => {
    const base = resolvedMode === 'light' ? DefaultTheme : DarkTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.ink,
        card: colors.paper,
        text: colors.textPrimary,
        border: colors.border,
        primary: colors.lamp,
      },
    };
  }, [resolvedMode, colors]);

  if (!fontsLoaded || initializing) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.ink }]}>
        <ActivityIndicator size="large" color={colors.lamp} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={colors.statusBarStyle} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
