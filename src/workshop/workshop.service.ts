import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';

@Injectable()
export class WorkshopService {
  constructor(
    // Every mutation goes through JobCardsService so the guarded transitions (and
    // the lean-fetch-to-avoid-stale-relations pattern) stay in one place.
    private jobCardsService: JobCardsService,
    private inventoryService: InventoryService,
  ) {}

  private async findEntityById(id: string) {
    return this.jobCardsService.findById(id);
  }

  /** TECHNICIAN_WORKSHOP callers may only act on jobs assigned to them; TL+ act on any. */
  private assertOwnership(jobCard: JobCard, callerId: string, isPrivilegedRole: boolean) {
    if (isPrivilegedRole) {
      return;
    }
    if (jobCard.assignedWorkshopTechnicianId !== callerId) {
      throw new ForbiddenException('You are not the workshop technician assigned to this Job Card.');
    }
  }

  async assign(jobCardId: string, technicianId: string): Promise<JobCard> {
    return this.jobCardsService.assignWorkshopTechnician(jobCardId, technicianId);
  }

  async startWip(jobCardId: string, callerId: string, isPrivilegedRole: boolean): Promise<JobCard> {
    const jobCard = await this.findEntityById(jobCardId);
    this.assertOwnership(jobCard, callerId, isPrivilegedRole);
    return this.jobCardsService.startWip(jobCardId);
  }

  /**
   * FR-09: reserve (not deduct) a spare against this job. Blocked if the job already has
   * a reservation idle past BLOCK_HOURS with no review decision since - the structural
   * gate that forces a TL to look at it instead of letting the screen go unchecked
   * (the-fool failure #3's mitigation). custodianUserId is always the job's assigned
   * workshop technician, regardless of who actually clicked the button - they're the one
   * who ends up physically holding the part.
   */
  async requestSpare(jobCardId: string, sparePartId: string, quantity: number, requestedByUserId: string, callerId: string, isPrivilegedRole: boolean) {
    const jobCard = await this.findEntityById(jobCardId);
    this.assertOwnership(jobCard, callerId, isPrivilegedRole);

    if (jobCard.status !== JobCardStatus.IN_PROGRESS && jobCard.status !== JobCardStatus.SPARE_PENDING) {
      throw new BadRequestException(`Cannot request a spare from status ${jobCard.status} (expected IN_PROGRESS or SPARE_PENDING).`);
    }
    if (!jobCard.assignedWorkshopTechnicianId) {
      throw new BadRequestException('Job Card has no assigned workshop technician to hold this reservation.');
    }

    const blocking = await this.inventoryService.hasUnresolvedStaleReservation(jobCardId);
    if (blocking) {
      throw new BadRequestException(
        `Cannot request more spares - reservation ${blocking.id} on this Job Card has been idle for over 48h with no review decision. A Team Leader must review it first (POST /inventory/reservations/${blocking.id}/review).`,
      );
    }

    const reservation = await this.inventoryService.reserve(
      sparePartId,
      quantity,
      jobCardId,
      jobCard.assignedWorkshopTechnicianId,
      requestedByUserId,
    );

    if (reservation.status === ReservationStatus.HELD) {
      await this.jobCardsService.resumeFromSparePending(jobCardId);
    } else {
      await this.jobCardsService.setSparePending(jobCardId);
    }

    return reservation;
  }

  async complete(jobCardId: string, callerId: string, isPrivilegedRole: boolean): Promise<JobCard> {
    const jobCard = await this.findEntityById(jobCardId);
    this.assertOwnership(jobCard, callerId, isPrivilegedRole);
    return this.jobCardsService.completeWorkshop(jobCardId);
  }

  async getWorkshopState(jobCardId: string) {
    const jobCard = await this.findEntityById(jobCardId);
    const stale = await this.inventoryService.getStaleReservations();
    const relevantStale = stale.filter((r) => r.jobCardId === jobCardId);
    return { jobCard, staleReservations: relevantStale };
  }
}
