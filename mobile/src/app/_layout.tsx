import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../context/AuthContext';

SplashScreen.preventAutoHideAsync();

// One QueryClient for the whole app - created once at module scope (not inside the
// component) so it survives re-renders of the root layout.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Gates the whole app on auth state via expo-router's Stack.Protected: while a
// technician is signed in, only the schedule screen (and later phases' screens) are
// reachable; while signed out, only /login is. Navigating to a screen that's currently
// protected redirects to the anchor route automatically - no manual router.replace()
// calls needed anywhere else in the app (see AuthContext's login/logout).
function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  if (isLoading) {
    // Native splash screen is still showing (preventAutoHideAsync above) - nothing to
    // render here.
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="index" />
        <Stack.Screen name="appointment/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
