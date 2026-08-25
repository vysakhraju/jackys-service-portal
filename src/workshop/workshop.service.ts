import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { PermissionsService } from '../permissions/permissions.service';
import { PermissionType } from '../permissions/entities/user-permission-grant.entity';

@Injectable()
export class WorkshopService {
  constructor(
    // Every mutation goes through JobCardsService so the guarded transitions (and
    // the lean-fetch-to-avoid-stale-relations pattern) stay in one place.
    private jobCardsService: JobCardsService,
    private inventoryService: InventoryService,
    private permissionsService: PermissionsService,
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
   *
   * Phase 6 rework gate: if this exact spare part was already requested/reserved once
   * before on this exact Job Card (InventoryService.hasPriorReservationForPart) AND this
   * job has at least one prior QC rejection (jobCard.qcRejectionCount > 0), this is a
   * same-part rework re-request - it needs sign-off from someone else holding the
   * REWORK_APPROVAL grant (reworkApproverId, hard-enforced != requestedByUserId) or a
   * verbal-override fallback (reworkVerbalOverrideBy + notes). Both conditions must hold
   * together - a same-part top-up before any QC rejection is ordinary Phase 5 behaviour
   * and is NOT gated by this at all.
   */
  async requestSpare(
    jobCardId: string,
    sparePartId: string,
    quantity: number,
    requestedByUserId: string,
    callerId: string,
    isPrivilegedRole: boolean,
    reworkApproverId?: string,
    reworkVerbalOverrideBy?: string,
    reworkVerbalOverrideNotes?: string,
  ) {
    const jobCard = await this.findEntityById(jobCardId);
    this.assertOwnership(jobCard, callerId, isPrivilegedRole);

    if (
      jobCard.status !== JobCardStatus.IN_PROGRESS &&
      jobCard.status !== JobCardStatus.SPARE_PENDING &&
      jobCard.status !== JobCardStatus.READY_FOR_QC
    ) {
      throw new BadRequestException(
        `Cannot request a spare from status ${jobCard.status} (expected IN_PROGRESS, SPARE_PENDING, or READY_FOR_QC - a READY_FOR_QC job can still take a top-up request to resolve a stock shortfall QC-approval blocked on).`,
      );
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

    let reworkApprovedByUserId: string | undefined;
    let reworkVerbalBy: string | undefined;
    let reworkVerbalNotes: string | undefined;

    const isReworkReRequest =
      jobCard.qcRejectionCount > 0 && (await this.inventoryService.hasPriorReservationForPart(jobCardId, sparePartId));

    if (isReworkReRequest) {
      if (reworkApproverId) {
        if (reworkApproverId === requestedByUserId) {
          throw new BadRequestException(
            'The person requesting this rework re-consumption cannot also be its approver - get a different supervisor/Team Leader to sign off (approverId must differ from the requester).',
          );
        }
        // Throws ForbiddenException if reworkApproverId does not hold an active
        // REWORK_APPROVAL grant - admin-assignable to any user regardless of role.
        await this.permissionsService.requireActiveGrant(reworkApproverId, PermissionType.REWORK_APPROVAL);
        reworkApprovedByUserId = reworkApproverId;
      } else if (reworkVerbalOverrideBy) {
        if (!reworkVerbalOverrideNotes || reworkVerbalOverrideNotes.trim().length < 5) {
          throw new BadRequestException(
            'A verbal rework override requires verbalOverrideNotes explaining the circumstances (no one with the REWORK_APPROVAL grant was reachable).',
          );
        }
        reworkVerbalBy = reworkVerbalOverrideBy;
        reworkVerbalNotes = reworkVerbalOverrideNotes;
      } else {
        throw new BadRequestException(
          `Spare part ${sparePartId} was already requested once before on this Job Card, and this job has a prior QC rejection - consuming it again requires supervisor/Team Leader sign-off (approverId, held by someone with the REWORK_APPROVAL grant) or a verbal override (verbalOverrideBy + verbalOverrideNotes).`,
        );
      }
    }

    const reservation = await this.inventoryService.reserve(
      sparePartId,
      quantity,
      jobCardId,
      jobCard.assignedWorkshopTechnicianId,
      requestedByUserId,
      undefined,
      reworkApprovedByUserId,
      reworkVerbalBy,
      reworkVerbalNotes,
    );

    // A READY_FOR_QC job is already-complete work waiting on QC, not work waiting on parts -
    // this request exists purely to resolve a stock shortfall QC-approval's negative-inventory
    // gate reported. Leave its status alone either way; QC approval re-checks stock itself and
    // will report the real remaining deficit (if any) the next time it's attempted.
    if (jobCard.status === JobCardStatus.READY_FOR_QC) {
      // no-op: status stays READY_FOR_QC
    } else if (reservation.status === ReservationStatus.HELD) {
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
