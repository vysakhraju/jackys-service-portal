import axios from 'axios';
import { API_BASE_URL } from './config';

// A completely separate client from lib/api.ts, used ONLY by the unauthenticated
// customer-facing routes (the public Estimate link).
//
// Why this exists (the-fool pre-mortem, Frontend Phase 5): `api` in lib/api.ts attaches
// whatever bearer token is sitting in localStorage to every outgoing request, and its
// response interceptor hard-redirects the whole page to /login on an unrecoverable 401.
// Both behaviors are correct for the staff app, but wrong for a page a customer opens
// from an SMS/WhatsApp/email link:
//   - A customer has no token, but a staff member previewing/QA-ing the link in their own
//     logged-in browser would otherwise send their own bearer token to a public endpoint
//     that has no use for it.
//   - If a public endpoint ever returned a 401 for any reason (misconfiguration, a guard
///    added by mistake later), the shared client would try a token refresh and, on
//     failure, redirect the customer's browser to a staff login screen that means nothing
//     to them.
// This client has no request or response interceptors at all - no auth header is ever
// attached, and no redirect ever fires. Every non-2xx response is just a plain rejected
// promise, handled explicitly by the page that calls it.
export const publicApi = axios.create({
  baseURL: API_BASE_URL,
});
