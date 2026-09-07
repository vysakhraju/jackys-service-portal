// Holistic test-master pass (2026-09-07): every screen test mocks this whole module
// wholesale (`jest.mock('../../lib/masterDataApi', ...)`), so the real implementation
// - the actual URL, HTTP method, and query params each function sends - has never run
// anywhere. A wrong path or param name here would silently 404/no-op in production
// with no test catching it. These thin wrappers have no other behavior to verify, so
// this asserts exactly the call each one makes against a mocked `api`.
import { api } from './api';
import { listFaultSymptoms, listSpareParts } from './masterDataApi';

jest.mock('./api', () => ({ api: { get: jest.fn() } }));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue({ data: [] });
});

describe('listFaultSymptoms', () => {
  it('calls GET /master-data/fault-symptoms with no params when no category is given', async () => {
    await listFaultSymptoms();
    expect(mockedGet).toHaveBeenCalledWith('/master-data/fault-symptoms', { params: {} });
  });

  it('calls GET /master-data/fault-symptoms filtered by category when one is given', async () => {
    await listFaultSymptoms('REFRIGERATOR');
    expect(mockedGet).toHaveBeenCalledWith('/master-data/fault-symptoms', { params: { category: 'REFRIGERATOR' } });
  });

  it('resolves with the response body, not the full axios response', async () => {
    mockedGet.mockResolvedValue({ data: [{ id: 'fs-1' }] });
    await expect(listFaultSymptoms()).resolves.toEqual([{ id: 'fs-1' }]);
  });
});

describe('listSpareParts', () => {
  it('calls GET /master-data/spare-parts filtered to active parts only', async () => {
    await listSpareParts();
    expect(mockedGet).toHaveBeenCalledWith('/master-data/spare-parts', { params: { active: true } });
  });

  it('resolves with the response body, not the full axios response', async () => {
    mockedGet.mockResolvedValue({ data: [{ id: 'part-1' }] });
    await expect(listSpareParts()).resolves.toEqual([{ id: 'part-1' }]);
  });
});
