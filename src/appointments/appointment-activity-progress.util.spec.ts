import { computeActivityStatus } from './appointment-activity-progress.util';

describe('computeActivityStatus', () => {
  const activity = (overrides: any = {}) => ({
    id: 'act-1',
    appointmentId: 'apt-1',
    startedAt: new Date('2026-09-23T08:00:00Z'),
    startedByUserId: 'user-1',
    finishedAt: null,
    finishedByUserId: null,
    ...overrides,
  });

  const pause = (overrides: any = {}) => ({
    id: 'pause-1',
    appointmentActivityId: 'act-1',
    reason: 'BREAK',
    notes: null,
    pausedByUserId: 'user-1',
    pausedAt: new Date('2026-09-23T09:00:00Z'),
    resumedByUserId: null,
    resumedAt: null,
    ...overrides,
  });

  it('returns NOT_STARTED when no activity row exists', () => {
    expect(computeActivityStatus(null, null)).toBe('NOT_STARTED');
  });

  it('returns IN_PROGRESS when started, not finished, and no open pause', () => {
    expect(computeActivityStatus(activity() as any, null)).toBe('IN_PROGRESS');
  });

  it('returns PAUSED when an open pause row exists', () => {
    expect(computeActivityStatus(activity() as any, pause() as any)).toBe('PAUSED');
  });

  it('returns FINISHED once finishedAt is set, even if an open pause row somehow still exists', () => {
    expect(computeActivityStatus(activity({ finishedAt: new Date('2026-09-23T10:00:00Z') }) as any, pause() as any)).toBe(
      'FINISHED',
    );
  });
});
