import { Injectable, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { PermissionsService } from '../permissions/permissions.service';
import { PermissionType } from '../permissions/entities/user-permission-grant.entity';
import { canEditLateStageJobCard } from '../job-cards/job-card-edit-lock.util';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class WorkshopService {
  constructor(
    // Every mutation goes through JobCardsService so the guarded transitions (and
    // the lean-fetch-to-avoid-stale-relations pattern) stay in one place.
    private jobCardsService: JobCardsService,
    private inventoryService: InventoryService,
    private permissionsService: PermissionsService,
    // Modification Request 2026-09-16: getWorkshopState() needs the assigned technician's
    // name. JobCardsService.findById() does not eager-load assignedWorkshopTechnician
    // (deliberately, for its other callers), so this is a small, scoped second lookup.
    @InjectRepository(User) private usersRepo: Repository<User>,
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

  /**
   * Technician Assignment Board (2026-09-09) - hand a WORKSHOP job off to a different
   * technician once it's past its initial assignment. Two guards live here rather than in
   * JobCardsService.reassignWorkshopTechnician(), matching this file's existing split
   * (requestSpare()/addCrewHelper() both compose JobCardsService with another module's
   * checks the same way):
   *
   * 1. Late-stage edit-lock (the-fool finding, 2026-09-09): reassignment is the kind of
   *    edit job-card-edit-lock.util.ts exists to gate once a job hits READY_FOR_QC or
   *    later - reusing it here rather than letting this brand-new mutation path reopen
   *    the exact hole that feature was built to close. In practice this never actually
   *    blocks anyone today, since WorkshopController's WORKSHOP_ASSIGN capability (who can
   *    even call this) grants a subset of the lock's own override roles - kept explicit
   *    anyway so that stays true if either list ever changes independently.
   * 2. Reservation custody (the-fool finding): mirrors AppointmentsService.update()'s own
   *    guard for the identical problem on the field-visit side - don't let the outgoing
   *    technician get silently swapped out while they still physically hold a reserved
   *    spare part for this job.
   */
  async reassign(jobCardId: string, newTechnicianId: string, callerId: string, callerRoleName: string): Promise<JobCard> {
    const jobCard = await this.findEntityById(jobCardId);

    if (!canEditLateStageJobCard(jobCard.status, callerRoleName)) {
      throw new ForbiddenException(
        `Job Card ${jobCard.jobCardNumber} is ${jobCard.status} - reassigning its workshop technician needs Super Admin, Service Head, Technical Team Leader, Accountant, or Finance Manager.`,
      );
    }

    if (jobCard.assignedWorkshopTechnicianId) {
      const hasOpenReservation = await this.inventoryService.hasActiveReservationInCustody(
        jobCardId,
        jobCard.assignedWorkshopTechnicianId,
      );
      if (hasOpenReservation) {
        throw new ConflictException(
          `Cannot reassign this Job Card: the current technician still holds an open spare-parts reservation (PENDING_REVIEW/HELD/PARTIALLY_RESERVED) on it. Release it first via POST /inventory/reservations/:id/release, then reassign.`,
        );
      }
    }

    return this.jobCardsService.reassignWorkshopTechnician(jobCardId, newTechnicianId, callerId);
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

  /**
   * #218 (2026-09-14): backs the rework-approver picker on the Request Spare form (rework
   * re-request path) with real names instead of a pasted UUID. REWORK_APPROVAL is an
   * admin-assignable per-user grant (see PermissionType doc comment), not a role - there is
   * no role-based endpoint to list its holders from, and GET /permissions?type=... is
   * admin-only (PERMISSION_ADMIN_ROLES), unusable by whoever is actually filling out this
   * form. Gated the same capability as the request-spare action itself.
   */
  async listReworkApprovers(): Promise<{ id: string; name: string }[]> {
    const grants = await this.permissionsService.listGrantsByType(PermissionType.REWORK_APPROVAL);
    return grants.map((g) => ({ id: g.user.id, name: g.user.fullName }));
  }

  /**
   * activeReservations added 2026-09-14 (live-tested finding - see
   * InventoryService.getActiveReservationsForJobCard's own doc comment for the full
   * history): staleReservations alone only ever shows a reservation once it's gone idle
   * 24h+, which is exactly why a technician's own just-requested spare used to vanish from
   * this screen the moment they navigated away and back. activeReservations is the
   * persistent, always-current answer to "what's outstanding on this job right now" -
   * staleReservations stays as its own field (a different, TL-facing triage concern: which
   * of these have gone idle too long) rather than being folded together.
   */
  async getWorkshopState(jobCardId: string) {
    const jobCard = await this.findEntityById(jobCardId);
    const [stale, activeReservations, assignedWorkshopTechnicianName] = await Promise.all([
      this.inventoryService.getStaleReservations(),
      this.inventoryService.getActiveReservationsForJobCard(jobCardId),
      this.getAssignedWorkshopTechnicianName(jobCard.assignedWorkshopTechnicianId),
    ]);
    const relevantStale = stale.filter((r) => r.jobCardId === jobCardId);
    return { jobCard, staleReservations: relevantStale, activeReservations, assignedWorkshopTechnicianName };
  }

  // Modification Request 2026-09-16: the "not your job" banner used to show the raw
  // assignedWorkshopTechnicianId UUID - this backs a real name instead. Returns null when
  // the job has no assigned technician (JobCard.assignedWorkshopTechnicianId nullable) or,
  // defensively, if the id somehow no longer resolves to a user.
  private async getAssignedWorkshopTechnicianName(technicianId: string | null): Promise<string | null> {
    if (!technicianId) {
      return null;
    }
    const technician = await this.usersRepo.findOne({ where: { id: technicianId } });
    return technician?.fullName ?? null;
  }

  // Thin passthroughs, same "every mutation goes through JobCardsService" convention as
  // assign()/startWip()/complete() above - Gantt board's "add crew helper" action.
  async addCrewHelper(jobCardId: string, technicianId: string, addedByUserId: string) {
    return this.jobCardsService.addCrewHelper(jobCardId, technicianId, addedByUserId);
  }

  async removeCrewHelper(jobCardId: string, helperId: string, removedByUserId: string) {
    return this.jobCardsService.removeCrewHelper(jobCardId, helperId, removedByUserId);
  }

  async listCrewHelpers(jobCardId: string) {
    return this.jobCardsService.listCrewHelpers(jobCardId);
  }
}
