// expo-secure-store wraps a native module (iOS Keychain / Android Keystore) that
// doesn't exist in the Jest/Node test environment - mock it with a plain in-memory
// object so tests can exercise real login/logout/refresh flows without touching any
// native code, and can be reset between tests with jest.clearAllMocks().
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});
