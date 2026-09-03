// Thin wrapper over src/gl-ledger/gl-ledger.controller.ts - one route, no manual-entry
// endpoint exists (see glLedgerTypes.ts's doc comment), so this is the entire API surface.
// GET /gl-postings returns EVERY matching row, newest first, with no pagination or limit
// on the backend (GlLedgerService.findAll() is a plain repository.find()) - the sourceType
// filter narrows the query server-side, but an unfiltered call still fetches the whole
// table. GlPostingsPage.tsx paginates client-side over what this returns; it does not
// reduce the network/DB cost of the initial fetch.
import { api } from './api';
import type { GlPosting, GlSourceTypeValue } from './glLedgerTypes';

export const listGlPostings = (sourceType?: GlSourceTypeValue) =>
  api.get<GlPosting[]>('/gl-postings', { params: sourceType ? { sourceType } : {} }).then((r) => r.data);
