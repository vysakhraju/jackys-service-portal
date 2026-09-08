import { getJobCardLane, getJobCardNextStepText, getJobCardProgressFields } from './job-card-progress.util';
import { JobCardSection, JobCardStatus } from './entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';

describe('getJobCardLane', () => {
  it('returns null when no section is assigned yet, regardless of warranty status', () => {
    expect(getJobCardLane({ section: null, warrantyStatus: WarrantyStatus.IN_WARRANTY })).toBeNull();
    expect(getJobCardLane({ section: null, warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY })).toBeNull();
  });

  it('Lane A: on-site repair, in warranty', () => {
    expect(getJobCardLane({ section: JobCardSection.ON_SITE_REPAIR, warrantyStatus: WarrantyStatus.IN_WARRANTY })).toBe('A');
  });

  it('Lane B: on-site repair, out of warranty', () => {
    expect(getJobCardLane({ section: JobCardSection.ON_SITE_REPAIR, warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY })).toBe('B');
  });

  it('Lane C: workshop, in warranty', () => {
    expect(getJobCardLane({ section: JobCardSection.WORKSHOP, warrantyStatus: WarrantyStatus.IN_WARRANTY })).toBe('C');
  });

  it('Lane D: workshop, out of warranty', () => {
    expect(getJobCardLane({ section: JobCardSection.WORKSHOP, warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY })).toBe('D');
  });
});

describe('getJobCardNextStepText', () => {
  const base = {
    section: null as JobCardSection | null,
    warrantyStatus: WarrantyStatus.IN_WARRANTY,
    customerApproved: false,
  };

  it('every JobCardStatus value produces a non-empty string', () => {
    for (const status of Object.values(JobCardStatus)) {
      const text = getJobCardNextStepText({ ...base, status });
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('OPEN asks for S/N validation', () => {
    expect(getJobCardNextStepText({ ...base, status: JobCardStatus.OPEN })).toMatch(/serial number/i);
  });

  it('SN_VALIDATED + OOW + not customerApproved asks for customer approval first', () => {
    const text = getJobCardNextStepText({
      ...base,
      status: JobCardStatus.SN_VALIDATED,
      warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY,
      customerApproved: false,
    });
    expect(text).toMatch(/customer approval/i);
  });

  it('SN_VALIDATED + OOW + customerApproved=true skips the approval text', () => {
    const text = getJobCardNextStepText({
      ...base,
      status: JobCardStatus.SN_VALIDATED,
      warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY,
      customerApproved: true,
    });
    expect(text).toMatch(/assign a section/i);
  });

  it('SN_VALIDATED + IN_WARRANTY never mentions customer approval', () => {
    const text = getJobCardNextStepText({
      ...base,
      status: JobCardStatus.SN_VALIDATED,
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      customerApproved: false,
    });
    expect(text).toMatch(/assign a section/i);
  });

  it('SECTION_ASSIGNED differs between ON_SITE_REPAIR and WORKSHOP', () => {
    const onSite = getJobCardNextStepText({ ...base, status: JobCardStatus.SECTION_ASSIGNED, section: JobCardSection.ON_SITE_REPAIR });
    const workshop = getJobCardNextStepText({ ...base, status: JobCardStatus.SECTION_ASSIGNED, section: JobCardSection.WORKSHOP });
    expect(onSite).not.toBe(workshop);
    expect(onSite).toMatch(/on-site repair/i);
    expect(workshop).toMatch(/workshop technician/i);
  });

  it('CANCELLED and DELIVERED are terminal, distinct messages', () => {
    const cancelled = getJobCardNextStepText({ ...base, status: JobCardStatus.CANCELLED });
    const delivered = getJobCardNextStepText({ ...base, status: JobCardStatus.DELIVERED });
    expect(cancelled).not.toBe(delivered);
  });
});

describe('getJobCardProgressFields', () => {
  it('bundles lane and nextStepText together', () => {
    const result = getJobCardProgressFields({
      status: JobCardStatus.IN_PROGRESS,
      section: JobCardSection.WORKSHOP,
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      customerApproved: false,
    });
    expect(result).toEqual({
      lane: 'C',
      nextStepText: 'Technician to complete the repair (or request a spare part)',
    });
  });
});
