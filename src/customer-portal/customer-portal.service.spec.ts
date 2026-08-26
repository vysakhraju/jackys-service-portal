import { NotFoundException } from '@nestjs/common';
import { CustomerPortalService } from './customer-portal.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { InvoiceStatus } from '../invoicing/entities/invoice.entity';

describe('CustomerPortalService', () => {
  let service: CustomerPortalService;
  let jobCardsService: any;
  let estimatesService: any;
  let invoicingService: any;
  let deliveryService: any;

  const jobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0001',
      brand: 'Acme',
      status: JobCardStatus.QC_PASSED,
      warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY,
      faultCode: 'F1',
      symptomCode: 'S1',
      customerApproved: true,
      qcApprovedAt: new Date('2026-08-10'),
      createdAt: new Date('2026-08-01'),
      ...overrides,
    } as any);

  beforeEach(() => {
    jobCardsService = { findByPublicToken: jest.fn() };
    estimatesService = { findByJobCardId: jest.fn().mockResolvedValue([]) };
    invoicingService = {
      findByJobCardId: jest.fn().mockResolvedValue(null),
      getAmountPaid: jest.fn().mockResolvedValue(0),
    };
    deliveryService = { findByJobCardId: jest.fn().mockResolvedValue(null) };

    service = new CustomerPortalService(jobCardsService, estimatesService, invoicingService, deliveryService);
  });

  describe('token resolution', () => {
    it('404s on an unknown/expired token for every public method', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(null);

      await expect(service.trackByToken('bad-token')).rejects.toThrow(NotFoundException);
      await expect(service.getInvoiceByToken('bad-token')).rejects.toThrow(NotFoundException);
      await expect(service.getSummaryByToken('bad-token')).rejects.toThrow(NotFoundException);
    });
  });

  describe('trackByToken', () => {
    it('returns a customer-safe status summary with no delivery yet', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard());

      const result = await service.trackByToken('good-token');

      expect(result.jobCardNumber).toBe('JC-0001');
      expect(result.status).toBe(JobCardStatus.QC_PASSED);
      expect(result.delivery).toBeNull();
      // Customer-safe: no internal ids should leak through.
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('createdById');
    });

    it('includes delivery status once one exists', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard({ status: JobCardStatus.DELIVERED }));
      deliveryService.findByJobCardId.mockResolvedValue({
        deliveryNumber: 'DLV-0001',
        status: 'DELIVERED',
        dispatchedAt: new Date('2026-08-11'),
        deliveredAt: new Date('2026-08-12'),
      });

      const result: any = await service.trackByToken('good-token');

      expect(result.delivery.deliveryNumber).toBe('DLV-0001');
    });
  });

  describe('getInvoiceByToken', () => {
    it('reports not-applicable for an in-warranty job', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY }));

      const result: any = await service.getInvoiceByToken('good-token');

      expect(result.applicable).toBe(false);
    });

    it('reports no invoice created yet for an OOW job with none drafted', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard());
      invoicingService.findByJobCardId.mockResolvedValue(null);

      const result: any = await service.getInvoiceByToken('good-token');

      expect(result.applicable).toBe(true);
      expect(result.invoiceCreated).toBe(false);
    });

    it('shows the amount due for a DRAFT invoice with a partial payment', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard());
      invoicingService.findByJobCardId.mockResolvedValue({
        id: 'inv-1',
        invoiceNumber: 'INV-0001',
        subtotal: 1428.57,
        vatRate: 5,
        vatAmount: 71.43,
        amount: 1500,
        status: InvoiceStatus.PARTIALLY_PAID,
      });
      invoicingService.getAmountPaid.mockResolvedValue(500);

      const result: any = await service.getInvoiceByToken('good-token');

      expect(result.amountDue).toBe(1000);
      expect(result.amountPaid).toBe(500);
      expect(result.message).toContain('contact us');
    });

    it('shows a thank-you message once fully paid', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard());
      invoicingService.findByJobCardId.mockResolvedValue({
        id: 'inv-1',
        invoiceNumber: 'INV-0001',
        amount: 1500,
        status: InvoiceStatus.PAID,
      });
      invoicingService.getAmountPaid.mockResolvedValue(1500);

      const result: any = await service.getInvoiceByToken('good-token');

      expect(result.amountDue).toBe(0);
      expect(result.message).toContain('thank you');
    });
  });

  describe('getSummaryByToken', () => {
    it('combines job card, estimate, invoice, and delivery into one payload', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard());
      estimatesService.findByJobCardId.mockResolvedValue([
        { lineItems: [{ description: 'Part', quantity: 1, unitPrice: 100 }], subtotal: 100, vatAmount: 5, totalAmount: 105, status: 'APPROVED' },
      ]);
      deliveryService.findByJobCardId.mockResolvedValue({ deliveryNumber: 'DLV-0001', status: 'DELIVERED', deliveredAt: new Date('2026-08-12') });

      const result: any = await service.getSummaryByToken('good-token');

      expect(result.jobCardNumber).toBe('JC-0001');
      expect(result.estimate.totalAmount).toBe(105);
      expect(result.delivery.deliveryNumber).toBe('DLV-0001');
      expect(result.invoice).toBeDefined();
    });

    it('handles a job with no Estimate yet (in-warranty)', async () => {
      jobCardsService.findByPublicToken.mockResolvedValue(jobCard({ warrantyStatus: WarrantyStatus.IN_WARRANTY }));
      estimatesService.findByJobCardId.mockResolvedValue([]);

      const result: any = await service.getSummaryByToken('good-token');

      expect(result.estimate).toBeNull();
      expect(result.invoice.applicable).toBe(false);
    });
  });
});
