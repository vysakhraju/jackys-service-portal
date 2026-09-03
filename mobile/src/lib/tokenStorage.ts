// JWT storage for this app. expo-secure-store (iOS Keychain / Android Keystore) rather
// than AsyncStorage, since these are auth credentials, not app preferences - same
// reasoning the web app applies by keeping tokens out of anything a script on the page
// could read, just with the mobile-appropriate equivalent.
//
// Keys mirror the web app's ACCESS_TOKEN_KEY/REFRESH_TOKEN_KEY naming (src/lib/api.ts)
// so the two clients are easy to cross-reference, even though the storage backend differs.
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'jsp_access_token';
const REFRESH_TOKEN_KEY = 'jsp_refresh_token';

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
}
