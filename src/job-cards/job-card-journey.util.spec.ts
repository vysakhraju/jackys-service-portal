import { JobCardStatus, JobCardSection } from './entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { DeliveryStatus } from '../delivery/entities/delivery.entity';
import { buildJourneySteps, JourneyInput } from './job-card-journey.util';

function baseInput(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    appointment: { createdAt: new Date('2026-09-01T08:00:00Z'), scheduledAt: new Date('2026-09-01T09:00:00Z') },
    visit: { startedAt: new Date('2026-09-01T09:05:00Z') },
    jobCard: {
      createdAt: new Date('2026-09-01T09:30:00Z'),
      status: JobCardStatus.OPEN,
      section: null,
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      snValidatedAgainstInvoice: false,
      snValidationNotes: null,
      customerApproved: false,
      qcRejectionCount: 0,
      cancellationReason: null,
      onSiteCompletionNotes: null,
    },
    delivery: null,
    ...overrides,
  };
}

function stateOf(steps: ReturnType<typeof buildJourneySteps>, key: string) {
  return steps.find((s) => s.key === key)?.state;
}

describe('buildJourneySteps', () => {
  it('marks the first two steps done and job_card_created done, sn_validated current, for a freshly-created OPEN job card', () => {
    const steps = buildJourneySteps(baseInput());

    expect(stateOf(steps, 'scheduled')).toBe('done');
    expect(stateOf(steps, 'visit_started')).toBe('done');
    expect(stateOf(steps, 'job_card_created')).toBe('done');
    expect(stateOf(steps, 'sn_validated')).toBe('current');
    expect(stateOf(steps, 'section_assigned')).toBe('pending');
  });

  it('shows sn_validated as current with a detour detail when the job is RWR (customer rejected the estimate)', () => {
    const steps = buildJourneySteps(baseInput({ jobCard: { ...baseInput().jobCard, status: JobCardStatus.RWR } }));

    const snStep = steps.find((s) => s.key === 'sn_validated')!;
    expect(snStep.state).toBe('current');
    expect(snStep.detail).toMatch(/rejected the estimate/);
  });

  it('omits the workshop-only steps once the section is known to be ON_SITE_REPAIR', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.READY_FOR_QC, section: JobCardSection.ON_SITE_REPAIR },
      }),
    );

    expect(steps.some((s) => s.key === 'workshop_assigned')).toBe(false);
    expect(steps.some((s) => s.key === 'in_progress')).toBe(false);
    expect(stateOf(steps, 'section_assigned')).toBe('done');
    expect(stateOf(steps, 'ready_for_qc')).toBe('current');
  });

  it('includes the workshop-only steps and marks them current/pending correctly for a WORKSHOP job', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.IN_PROGRESS, section: JobCardSection.WORKSHOP },
      }),
    );

    expect(stateOf(steps, 'workshop_assigned')).toBe('done');
    expect(stateOf(steps, 'in_progress')).toBe('current');
    expect(stateOf(steps, 'ready_for_qc')).toBe('pending');
  });

  it('marks ready_for_qc current (not pending) for an on-site job actively being worked at SECTION_ASSIGNED - the status on-site repairs sit at while work is under way, since they skip the workshop tier entirely', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.SECTION_ASSIGNED, section: JobCardSection.ON_SITE_REPAIR },
      }),
    );

    expect(stateOf(steps, 'section_assigned')).toBe('done');
    expect(stateOf(steps, 'ready_for_qc')).toBe('current');
    // Never leave the stepper with NO current step - every non-cancelled, non-terminal
    // journey must have exactly one 'current' entry so the UI always highlights something.
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1);
  });

  it('marks workshop_assigned current (not pending) for a workshop job at SECTION_ASSIGNED, waiting on a technician assignment', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.SECTION_ASSIGNED, section: JobCardSection.WORKSHOP },
      }),
    );

    expect(stateOf(steps, 'section_assigned')).toBe('done');
    expect(stateOf(steps, 'workshop_assigned')).toBe('current');
    expect(stateOf(steps, 'in_progress')).toBe('pending');
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1);
  });

  it('flags SPARE_PENDING with a waiting-on-stock detail, still counted at the in_progress tier', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.SPARE_PENDING, section: JobCardSection.WORKSHOP },
      }),
    );

    const step = steps.find((s) => s.key === 'in_progress')!;
    expect(step.state).toBe('current');
    expect(step.detail).toMatch(/spare part stock/);
  });

  it('notes a prior QC rejection count once QC_PASSED', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: {
          ...baseInput().jobCard,
          status: JobCardStatus.QC_PASSED,
          section: JobCardSection.ON_SITE_REPAIR,
          qcRejectionCount: 2,
        },
      }),
    );

    expect(steps.find((s) => s.key === 'qc_passed')!.detail).toMatch(/2x/);
  });

  it('stops after a cancelled-job-card marker and never claims a delivery step for a cancelled job', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: {
          ...baseInput().jobCard,
          status: JobCardStatus.CANCELLED,
          cancellationReason: 'Customer withdrew the item',
        },
      }),
    );

    expect(steps[steps.length - 1]).toEqual(
      expect.objectContaining({ key: 'cancelled', state: 'cancelled', detail: 'Customer withdrew the item' }),
    );
    expect(steps.some((s) => s.key === 'delivery_created')).toBe(false);
  });

  it('shows delivery_created done and dispatched/delivered pending for a QC_PASSED job inside a still-PENDING delivery', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.QC_PASSED, section: JobCardSection.ON_SITE_REPAIR },
        delivery: {
          createdAt: new Date('2026-09-05T10:00:00Z'),
          status: DeliveryStatus.PENDING,
          dispatchedAt: null,
          deliveredAt: null,
          cancellationReason: null,
          deliveryNumber: 'DLV-0099',
        },
      }),
    );

    expect(stateOf(steps, 'delivery_created')).toBe('done');
    expect(stateOf(steps, 'dispatched')).toBe('pending');
    expect(stateOf(steps, 'delivered')).toBe('pending');
  });

  it('marks dispatched done but delivered pending while DISPATCHED', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.QC_PASSED, section: JobCardSection.ON_SITE_REPAIR },
        delivery: {
          createdAt: new Date('2026-09-05T10:00:00Z'),
          status: DeliveryStatus.DISPATCHED,
          dispatchedAt: new Date('2026-09-05T11:00:00Z'),
          deliveredAt: null,
          cancellationReason: null,
          deliveryNumber: 'DLV-0099',
        },
      }),
    );

    expect(stateOf(steps, 'dispatched')).toBe('done');
    expect(stateOf(steps, 'delivered')).toBe('pending');
  });

  it('marks every delivery step done once DELIVERED', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.DELIVERED, section: JobCardSection.ON_SITE_REPAIR },
        delivery: {
          createdAt: new Date('2026-09-05T10:00:00Z'),
          status: DeliveryStatus.DELIVERED,
          dispatchedAt: new Date('2026-09-05T11:00:00Z'),
          deliveredAt: new Date('2026-09-05T12:00:00Z'),
          cancellationReason: null,
          deliveryNumber: 'DLV-0099',
        },
      }),
    );

    expect(stateOf(steps, 'delivery_created')).toBe('done');
    expect(stateOf(steps, 'dispatched')).toBe('done');
    expect(stateOf(steps, 'delivered')).toBe('done');
  });

  it('stops after delivery_cancelled and never claims dispatched/delivered for a cancelled delivery - this is the JC-0120-shaped case', () => {
    const steps = buildJourneySteps(
      baseInput({
        jobCard: { ...baseInput().jobCard, status: JobCardStatus.QC_PASSED, section: JobCardSection.ON_SITE_REPAIR },
        delivery: {
          createdAt: new Date('2026-09-05T10:00:00Z'),
          status: DeliveryStatus.CANCELLED,
          dispatchedAt: null,
          deliveredAt: null,
          cancellationReason: null,
          deliveryNumber: 'DLV-0099',
        },
      }),
    );

    expect(steps[steps.length - 1].key).toBe('delivery_cancelled');
    expect(steps.some((s) => s.key === 'dispatched')).toBe(false);
  });

  // Matrix regression for the SECTION_ASSIGNED gap found in QA review: walk every
  // (status, section) combination a real, non-cancelled Job Card can actually be in and
  // assert the stepper always highlights exactly one 'current' step - except DELIVERED,
  // where everything is legitimately 'done' and zero 'current' is correct. Without this,
  // the SECTION_ASSIGNED case (both sections) silently had ZERO 'current' steps - the
  // stepper would render fully truthfully but with no green highlight anywhere, which is
  // a real UX bug on the very screen this feature exists to deliver ("Bullets with green
  // highlight as stage goes").
  it.each([
    [JobCardStatus.OPEN, null],
    [JobCardStatus.SN_VALIDATED, null],
    [JobCardStatus.RWR, null],
    [JobCardStatus.SECTION_ASSIGNED, JobCardSection.ON_SITE_REPAIR],
    [JobCardStatus.SECTION_ASSIGNED, JobCardSection.WORKSHOP],
    [JobCardStatus.WORKSHOP_ASSIGNED, JobCardSection.WORKSHOP],
    [JobCardStatus.IN_PROGRESS, JobCardSection.WORKSHOP],
    [JobCardStatus.SPARE_PENDING, JobCardSection.WORKSHOP],
    [JobCardStatus.READY_FOR_QC, JobCardSection.ON_SITE_REPAIR],
    [JobCardStatus.READY_FOR_QC, JobCardSection.WORKSHOP],
    [JobCardStatus.QC_PASSED, JobCardSection.ON_SITE_REPAIR],
    [JobCardStatus.QC_PASSED, JobCardSection.WORKSHOP],
  ] as const)('always highlights exactly one current step for status=%s / section=%s (no delivery yet)', (status, section) => {
    const steps = buildJourneySteps(baseInput({ jobCard: { ...baseInput().jobCard, status, section } }));
    expect(steps.filter((s) => s.state === 'current')).toHaveLength(1);
  });

  it.each([JobCardSection.ON_SITE_REPAIR, JobCardSection.WORKSHOP] as const)(
    'has zero current steps once DELIVERED (section=%s) - everything is legitimately done',
    (section) => {
      const steps = buildJourneySteps(
        baseInput({
          jobCard: { ...baseInput().jobCard, status: JobCardStatus.DELIVERED, section },
          delivery: {
            createdAt: new Date('2026-09-05T10:00:00Z'),
            status: DeliveryStatus.DELIVERED,
            dispatchedAt: new Date('2026-09-05T11:00:00Z'),
            deliveredAt: new Date('2026-09-05T12:00:00Z'),
            cancellationReason: null,
            deliveryNumber: 'DLV-0099',
          },
        }),
      );
      expect(steps.filter((s) => s.state === 'current')).toHaveLength(0);
    },
  );
});
