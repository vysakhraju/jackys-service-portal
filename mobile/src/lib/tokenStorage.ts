// JWT storage for this app. expo-secure-store (iOS Keychain / Android Keystore) rather
// than AsyncStorage, since these are auth credentials, not app preferences - same
// reasoning the web app applies by keeping tokens out of anything a script on the page
// could read, just with the mobile-appropriate equivalent.
//
// Keys mirror the web app's ACCESS_TOKEN_KEY/REFRESH_TOKEN_KEY naming (src/lib/api.ts)
// so the two clients are easy to cross-reference, even though the storage backend differs.
//
// Web-target exception: expo-secure-store has no browser implementation - calling it
// throws (ExpoSecureStore.default.getValueWithKeyAsync is not a function), which used to
// crash the app on boot when running via `expo start --web` (localhost:8081). The web
// preview is a dev convenience only (the shipped app is native iOS/Android, where
// SecureStore is unaffected and unchanged) - falling back to localStorage there, with the
// exact same keys the real frontend/src/lib/api.ts already uses, keeps that path usable
// without touching the native behavior at all.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'jsp_access_token';
const REFRESH_TOKEN_KEY = 'jsp_refresh_token';

const isWeb = Platform.OS === 'web';

async function getItem(key: string): Promise<string | null> {
  return isWeb ? window.localStorage.getItem(key) : SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getAccessToken(): Promise<string | null> {
  return getItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return getItem(REFRESH_TOKEN_KEY);
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([setItem(ACCESS_TOKEN_KEY, accessToken), setItem(REFRESH_TOKEN_KEY, refreshToken)]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([deleteItem(ACCESS_TOKEN_KEY), deleteItem(REFRESH_TOKEN_KEY)]);
}
