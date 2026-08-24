import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { EstimatesService } from './estimates.service';
import { CreateEstimateDto } from './dto/create-estimate.dto';
import { RespondEstimateDto } from './dto/respond-estimate.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import { ReviseEstimateDto } from './dto/revise-estimate.dto';
import { Estimate } from './entities/estimate.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction } from '../auth/entities/audit-log.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// General Estimate management (create/send/revise/view): same office-side role set used
// across Appointments/Job Cards.
const ESTIMATE_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE'];
// Who may record a customer's decision on the customer's behalf (phone/WhatsApp/email
// call, not the self-service link). Deliberately a SEPARATE constant from ESTIMATE_ROLES
// (and from Job Cards' own role lists) so the business can extend who's allowed to take
// approval calls - e.g. adding a dedicated "Estimate Desk" role later - without touching
// unrelated permission sets. Still a plain TS constant for this MVP (no admin UI to edit
// roles yet); that's a documented future step, not a design gap in this endpoint.
const ESTIMATE_APPROVAL_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER', 'CCE'];

@ApiTags('estimates')
@Controller('estimates')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class EstimatesController {
  constructor(private estimatesService: EstimatesService) {}

  @Post()
  @Roles(...ESTIMATE_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'Estimate',
    getNewValues: (result) => ({ id: result?.id, jobCardId: result?.jobCardId, totalAmount: result?.totalAmount }),
  })
  @ApiOperation({ summary: 'Create a DRAFT Estimate for an OOW, SN_VALIDATED Job Card' })
  @ApiResponse({ status: 201, type: Estimate })
  @ApiResponse({ status: 400, description: 'Job Card is not OOW, or not yet SN_VALIDATED' })
  @ApiResponse({ status: 404, description: 'Job Card not found' })
  @ApiResponse({ status: 409, description: 'An active Estimate already exists for this Job Card' })
  async create(@Body() dto: CreateEstimateDto, @CurrentUser() user: User) {
    return this.estimatesService.create(dto, user.id);
  }

  @Post(':id/send')
  @Roles(...ESTIMATE_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Estimate',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, channelsAttempted: result?.channelsAttempted, channelsDelivered: result?.channelsDelivered }),
  })
  @ApiOperation({ summary: 'Send the estimate: generates the shareable link and attempts customer notification (FR-06/FR-07)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: Estimate })
  @ApiResponse({ status: 400, description: 'Estimate is not DRAFT' })
  async send(@Param('id', ParseUUIDPipe) id: string) {
    return this.estimatesService.send(id);
  }

  @Post(':id/record-response')
  @Roles(...ESTIMATE_APPROVAL_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Estimate',
    getEntityId: (args) => args.params?.id,
    getNewValues: (result) => ({ status: result?.status, respondedVia: result?.respondedVia, contactMethod: result?.contactMethod }),
  })
  @ApiOperation({
    summary: 'Record a customer decision obtained by phone/WhatsApp/email call rather than the self-service link ' +
      '(most customers never click the link) - contactValue must match the phone/email already on file',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: Estimate })
  @ApiResponse({ status: 400, description: 'Contact value does not match what is on file, or Estimate is not SENT' })
  @ApiResponse({ status: 409, description: 'Estimate was already responded to' })
  async recordResponse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordResponseDto, @CurrentUser() user: User) {
    return this.estimatesService.recordResponse(id, dto, user.id);
  }

  @Post(':id/revise')
  @Roles(...ESTIMATE_ROLES)
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.CREATE,
    entityType: 'Estimate',
    getNewValues: (result) => ({ id: result?.id, previousEstimateId: result?.previousEstimateId, totalAmount: result?.totalAmount }),
  })
  @ApiOperation({ summary: 'After a rejection: create a revised Estimate and move the Job Card out of RWR (FR-08 is not a dead end)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, type: Estimate })
  @ApiResponse({ status: 400, description: 'Estimate is not REJECTED' })
  async revise(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviseEstimateDto, @CurrentUser() user: User) {
    return this.estimatesService.revise(id, dto, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an Estimate by id (staff view - full detail)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Estimate })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.estimatesService.findById(id);
  }

  @Get('by-job-card/:jobCardId')
  @ApiOperation({ summary: 'List all Estimates for a Job Card, newest first (includes the full revise chain)' })
  @ApiParam({ name: 'jobCardId', type: String })
  @ApiResponse({ status: 200, type: [Estimate] })
  async findByJobCardId(@Param('jobCardId', ParseUUIDPipe) jobCardId: string) {
    return this.estimatesService.findByJobCardId(jobCardId);
  }
}

/**
 * Public, unauthenticated endpoints for the customer-facing shareable link (FR-06). Kept
 * as a separate controller (no JwtAuthGuard/RolesGuard at class level) rather than
 * bypassing guards per-route on EstimatesController, so the "this route needs no login"
 * decision is visible from the class declaration, not a decorator easy to miss on one
 * method among staff-only ones.
 */
@ApiTags('estimates-public')
@Controller('estimates/public')
export class EstimatesPublicController {
  constructor(private estimatesService: EstimatesService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Customer-facing view of an Estimate by its link token (no login required)' })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Customer-safe estimate summary' })
  @ApiResponse({ status: 404, description: 'Unknown token' })
  @ApiResponse({ status: 410, description: 'Link expired or already responded to' })
  async getPublicView(@Param('token') token: string) {
    return this.estimatesService.getPublicView(token);
  }

  @Post(':token/respond')
  @UseInterceptors(AuditInterceptor)
  @Audit({
    action: AuditAction.UPDATE,
    entityType: 'Estimate',
    getNewValues: (result) => ({ status: result?.status, respondedVia: result?.respondedVia }),
  })
  @ApiOperation({ summary: 'Customer approves or rejects the estimate via the link (no login required)' })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 201, type: Estimate })
  @ApiResponse({ status: 404, description: 'Unknown token' })
  @ApiResponse({ status: 409, description: 'Already responded to' })
  @ApiResponse({ status: 410, description: 'Link expired' })
  async respond(@Param('token') token: string, @Body() dto: RespondEstimateDto) {
    return this.estimatesService.respondViaLink(token, dto);
  }
}
