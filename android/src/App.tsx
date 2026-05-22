import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider } from './components/ThemeProvider';
import { useAppStore } from './stores/appStore';
import { LoginScreen } from './screens/LoginScreen';
import { MainScreen } from './screens/MainScreen';
import { ActivityDetailScreen } from './screens/ActivityDetailScreen';
import type { RouteProperties } from './services/types';

// ── Param lists ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

export type MainStackParamList = {
  Home: undefined;
  ActivityDetail: { activityId: number; properties: RouteProperties };
};

// ── Navigators ────────────────────────────────────────────────────────────────

const RootStack = createNativeStackNavigator<RootStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

function MainNavigator() {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="Home" component={MainScreen} />
      <MainStack.Screen
        name="ActivityDetail"
        component={ActivityDetailScreen}
        options={({ route }) => ({ headerShown: true, title: route.params.properties.name })}
      />
    </MainStack.Navigator>
  );
}

function RootNavigator() {
  const authenticated = useAppStore(s => s.authenticated);
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {authenticated ? (
        <RootStack.Screen name="Main" component={MainNavigator} />
      ) : (
        <RootStack.Screen name="Login" component={LoginScreen} />
      )}
    </RootStack.Navigator>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const setTheme = useAppStore(s => s.setTheme);
  const setBaseMap = useAppStore(s => s.setBaseMap);
  const setAuthenticated = useAppStore(s => s.setAuthenticated);
  const setDeepseekApiKey = useAppStore(s => s.setDeepseekApiKey);

  useEffect(() => {
    AsyncStorage.getItem('theme').then(v => { if (v) setTheme(v as any); });
    AsyncStorage.getItem('baseMap').then(v => { if (v) setBaseMap(v as any); });

    import('./services/secureStorage').then(async ({ loadToken, loadCredentials }) => {
      const [token, creds] = await Promise.all([loadToken(), loadCredentials()]);
      if (token) setAuthenticated(true, token.athlete_name, token.athlete_id);
      if (creds?.deepseek_api_key) setDeepseekApiKey(creds.deepseek_api_key);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
