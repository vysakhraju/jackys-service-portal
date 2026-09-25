import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { resolvePriceListRow } from './billing-channel-resolution.util';
import { ServicePriceList, JobType, CustomerType } from './entities/service-price-list.entity';
import { ApplianceCategory } from './entities/fault-symptom.entity';

describe('resolvePriceListRow', () => {
  const makeRepo = (row: any) =>
    ({
      findOne: jest.fn().mockResolvedValue(row),
    } as unknown as Repository<ServicePriceList>);

  const baseParams = {
    category: ApplianceCategory.REFRIGERATOR,
    jobType: JobType.REPAIR,
    customerType: CustomerType.B2C,
    billingChannelId: null,
  };

  it('resolves a plain (no billing channel) row and passes an IsNull() operator for billingChannelId', async () => {
    const row = { id: 'p1', price: 100, billingChannelId: null, billingChannel: null } as any;
    const repo = makeRepo(row);

    const result = await resolvePriceListRow(repo, baseParams);

    expect(result).toEqual({ row, billingChannelId: null, billingChannelName: null });
    const where = (repo.findOne as jest.Mock).mock.calls[0][0].where;
    expect(where.category).toBe(ApplianceCategory.REFRIGERATOR);
    expect(where.jobType).toBe(JobType.REPAIR);
    expect(where.customerType).toBe(CustomerType.B2C);
    expect(where.isActive).toBe(true);
    // IsNull() operator, not a raw null - TypeORM would otherwise ignore the filter.
    expect(where.billingChannelId).toBeDefined();
    expect(typeof where.billingChannelId).toBe('object');
  });

  it('resolves a channel-specific row, filtering on the exact billingChannelId', async () => {
    const row = {
      id: 'p2',
      price: 55,
      billingChannelId: 'bc-jer-c',
      billingChannel: { id: 'bc-jer-c', name: 'JER-C' },
    } as any;
    const repo = makeRepo(row);

    const result = await resolvePriceListRow(repo, { ...baseParams, billingChannelId: 'bc-jer-c' });

    expect(result).toEqual({ row, billingChannelId: 'bc-jer-c', billingChannelName: 'JER-C' });
    const where = (repo.findOne as jest.Mock).mock.calls[0][0].where;
    expect(where.billingChannelId).toBe('bc-jer-c');
  });

  it('throws a clear 400 naming the combination when no channel is picked and no row matches', async () => {
    const repo = makeRepo(null);

    await expect(resolvePriceListRow(repo, baseParams)).rejects.toThrow(BadRequestException);
    await expect(resolvePriceListRow(repo, baseParams)).rejects.toThrow(/REFRIGERATOR.*REPAIR.*B2C/);
  });

  it('throws naming the picked channel, and never silently falls back to the non-channel rate, when a channel is picked but no matching row exists', async () => {
    const repo = makeRepo(null);

    await expect(
      resolvePriceListRow(repo, {
        ...baseParams,
        billingChannelId: 'bc-jer-c',
        billingChannelName: 'JER-C',
      }),
    ).rejects.toThrow(/JER-C/);
  });
});
