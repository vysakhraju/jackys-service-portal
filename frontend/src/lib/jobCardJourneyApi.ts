// Thin wrappers over src/job-card-journey/job-card-journey.controller.ts - a read-only
// pair of endpoints (search + get-one) layered on top of every module a Job Card's
// lifecycle touches. See jobCardJourneyTypes.ts for the response shapes.
import { api } from './api';
import type { JobCardJourney, JourneySearchResult } from './jobCardJourneyTypes';

const BASE = '/job-card-journey';

export const searchJobCardJourney = (q: string) =>
  api.get<JourneySearchResult[]>(`${BASE}/search`, { params: { q } }).then((r) => r.data);

export const getJobCardJourney = (jobCardId: string) =>
  api.get<JobCardJourney>(`${BASE}/${jobCardId}`).then((r) => r.data);
