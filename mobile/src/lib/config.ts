// Central place for the one URL the whole app needs to know about.
//
// Unlike the web app (which is served from the same origin/proxy as the API in
// production), this app runs on a physical device or emulator and always needs an
// explicit reachable address for the backend - localhost on the phone is not the
// same machine as localhost on the dev laptop running the API.
//
// Set EXPO_PUBLIC_API_BASE_URL in a .env file (see .env.example) to your backend's
// LAN address while developing, e.g. http://192.168.1.50:3000/api/v1 - "localhost"
// below is a placeholder that will not work from a real device.
export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';
