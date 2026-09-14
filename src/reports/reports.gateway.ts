import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { RolePermissionsService } from '../auth/role-permissions.service';
import { RoleAccessService } from '../auth/role-access.service';
import { MATRIX_LOCKED_ROLES } from '../auth/entities/role-permission.entity';
import { ReportsService } from './reports.service';

/**
 * FR-20/NFR-02: "real-time Kanban dashboard via WebSocket", "<100ms latency for dashboard
 * updates". Read literally, FR-20 wants a push fired from inside every status-changing
 * method across Appointments/TechnicianVisit/JobCards/Workshop/Delivery/Estimates - a
 * cross-cutting change to ~6 already-shipped modules, far more invasive than any other
 * phase's purely-additive work.
 *
 * What's built instead, and documented here rather than silently shipped as if it were
 * the literal spec: this gateway polls ReportsService.getKanbanSummary() (a cheap
 * counts-only query) on POLL_INTERVAL_MS, and only recomputes+broadcasts the full board
 * when the counts actually changed. NFR-02's "<100ms" is genuinely met for the broadcast
 * fan-out itself (a Socket.io `emit` to a room is well under 100ms) but NOT for change
 * *detection* - a status change can sit undetected for up to POLL_INTERVAL_MS before a
 * client sees it. This is the same honest-simplification pattern already used for AMC's
 * manual renewal reminders and the notification-channel stubs: a real limitation, not a
 * hidden one. Closing this gap for real means adding an event-emitter call to every
 * status-changing method in every upstream service - tracked as a known follow-up, not
 * built preemptively.
 */
const POLL_INTERVAL_MS = 5_000;
const APPROVAL_AGING_INTERVAL_MS = 15 * 60 * 1000; // BRD 18.1: Pending Approval Aging refreshes every 15 min.
const DASHBOARD_ROOM = 'dashboard';
// Live-tested finding (2026-09-14): this used to be a second, independent hardcoded role
// list living entirely outside the designation permission matrix - REPORTS_DASHBOARD_VIEW
// on ReportsController (the REST side of this same dashboard) had already been migrated to
// @RequiresCapability, so a Super Admin ticking that box for, say, CCE in Designation
// access would let CCE's GET /reports/overview succeed while this WebSocket handshake
// (JwtAuthGuard/RolesGuard can't run here at all - see handleConnection's own comment)
// kept rejecting them with the old hardcoded list, silently. The Kanban board would sit on
// "Offline" forever for exactly the role the admin just granted access to. This channel now
// asks the same source of truth (RolePermissionsService, via userCanViewDashboard() below),
// mirroring RolesGuard.checkCapability's own bypass -> direct-grant -> delegated-access
// order exactly, so a grant here takes effect immediately, same as the REST endpoint.

@WebSocketGateway({
  namespace: '/reports',
  cors: {
    // Same class of bug as the GlLedgerModule boot-crash (2026-09-03): decorator metadata
    // is evaluated the instant this file is imported, at Node's static module-resolution
    // time - well before NestFactory.create() ever instantiates ConfigModule.forRoot() and
    // actually populates process.env from .env. So process.env.CORS_ORIGIN is reliably
    // undefined right here, and this array is ALWAYS the one actually in effect for the
    // WebSocket handshake's CORS check, regardless of what .env says. main.ts's own
    // app.use(cors(...)) call doesn't have this problem (it runs at request time, long
    // after bootstrap has finished), which is exactly why REST calls worked fine while the
    // live Kanban socket sat stuck on "Offline" - its handshake was silently rejected by a
    // fallback list that had never been updated to include the Vite dev server's real port.
    // Keep this array in sync with main.ts's cors() fallback by hand.
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173', // Vite dev server - the one the frontend actually runs on
    ],
    credentials: true,
  },
})
export class ReportsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReportsGateway.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private agingTimer: ReturnType<typeof setInterval> | null = null;
  // Keyed per-socket (not one shared value) since 2026-09-14's self-scoping fix - see
  // pollAndBroadcastKanban()'s doc comment for why a single shared signature/broadcast no
  // longer makes sense once different viewers can legitimately see different boards.
  private lastSummarySignatureBySocket = new Map<string, string>();

  constructor(
    private reportsService: ReportsService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
    private rolePermissionsService: RolePermissionsService,
    private roleAccessService: RoleAccessService,
  ) {}

  onModuleInit() {
    this.pollTimer = setInterval(() => this.pollAndBroadcastKanban(), POLL_INTERVAL_MS);
    this.agingTimer = setInterval(() => this.broadcastApprovalAging(), APPROVAL_AGING_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.agingTimer) clearInterval(this.agingTimer);
  }

  /** Authenticates the handshake (JWT in `auth.token`, matching the JwtStrategy's checks) before
   * admitting the socket to the dashboard room. No JwtAuthGuard/RolesGuard reuse here - both read
   * from `context.switchToHttp().getRequest()`, which doesn't exist for a WS execution context. */
  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('No token provided');

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get('JWT_SECRET') || 'your-super-secret-jwt-key-change-in-production',
        algorithms: ['HS256'],
      });

      const user = await this.userRepo.findOne({ where: { id: payload.sub }, relations: { role: true } });
      if (!user || user.status !== UserStatus.ACTIVE) throw new Error('User not found or inactive');
      if (!(await this.userCanViewDashboard(user))) {
        throw new Error('Role not permitted on the dashboard channel');
      }

      client.data.userId = user.id;
      // Self-scoping (2026-09-14): stash the whole user (with its loaded role) on the
      // socket so every later poll tick knows whether this connection should see the full
      // board or only its own jobs - see ReportsService.getSelfScopedJobCardIds's doc
      // comment for why REPORTS_DASHBOARD_VIEW can legitimately reach a plain technician.
      client.data.user = user;
      client.join(DASHBOARD_ROOM);

      // Send an immediate full snapshot rather than making the client wait for the next poll tick.
      const [board, aging] = await Promise.all([
        this.reportsService.getKanbanBoard(user),
        this.reportsService.getApprovalAging(),
      ]);
      client.emit('kanban:update', board);
      client.emit('approval-aging:update', aging);
    } catch (err) {
      this.logger.warn(`WebSocket connection rejected: ${(err as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.lastSummarySignatureBySocket.delete(client.id);
  }

  // Mirrors RolesGuard.checkCapability's exact order (hardcoded MATRIX_LOCKED_ROLES bypass,
  // then a direct grant on the caller's own role, then delegated "extra role access" to any
  // role that DOES hold it) so a Designation-access grant for REPORTS_DASHBOARD_VIEW works
  // identically here and on the REST side - see the VIEW_ROLES removal comment above for why
  // this exists. Fails CLOSED like the guard does: any lookup error here means "no access",
  // never a silent allow.
  private async userCanViewDashboard(user: User): Promise<boolean> {
    if (MATRIX_LOCKED_ROLES.includes(user.role.name)) {
      return true;
    }

    try {
      if (await this.rolePermissionsService.roleHasCapability(user.role.id, 'REPORTS_DASHBOARD_VIEW')) {
        return true;
      }
    } catch {
      return false;
    }

    try {
      const rolesWithCapability = await this.rolePermissionsService.getGrantedRoleNames('REPORTS_DASHBOARD_VIEW');
      if (rolesWithCapability.length === 0) return false;
      return await this.roleAccessService.hasActiveAccessToAnyRole(user.id, rolesWithCapability);
    } catch {
      return false;
    }
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const fromQuery = client.handshake.query?.token;
    return typeof fromQuery === 'string' ? fromQuery : null;
  }

  /**
   * Self-scoping (2026-09-14, live-tested finding): this used to compute ONE board and
   * `.to(DASHBOARD_ROOM).emit(...)` it to every connected socket regardless of who they
   * were - fine when REPORTS_DASHBOARD_VIEW was Team-Leader-only (everyone with access was
   * meant to see everything), but wrong the moment a plain technician can be granted the
   * same capability and is meant to see only their own jobs (same complaint as the Workshop
   * Queue's). A single shared signature/broadcast can no longer represent "did anything
   * change" for every viewer at once, so each connected socket now gets its own scoped
   * summary, its own change-signature, and (only when that specific viewer's picture
   * actually changed) its own scoped board emitted directly to it - never to the shared room.
   */
  private async pollAndBroadcastKanban() {
    if (!this.server) return;
    const sockets = [...this.server.sockets.sockets.values()];
    if (sockets.length === 0) return;

    await Promise.all(
      sockets.map(async (socket) => {
        const user: User | undefined = socket.data?.user;
        if (!user) return; // shouldn't happen - handleConnection always sets it before joining the room
        try {
          const summary = await this.reportsService.getKanbanSummary(user);
          const signature = summary.columns.map((c) => `${c.key}:${c.count}`).join('|');
          if (signature === this.lastSummarySignatureBySocket.get(socket.id)) return;

          this.lastSummarySignatureBySocket.set(socket.id, signature);
          const board = await this.reportsService.getKanbanBoard(user);
          socket.emit('kanban:update', board);
        } catch (err) {
          this.logger.error(`Kanban poll/broadcast failed for socket ${socket.id}: ${(err as Error).message}`);
        }
      }),
    );
  }

  private async broadcastApprovalAging() {
    if (!this.server) return;
    try {
      const aging = await this.reportsService.getApprovalAging();
      this.server.to(DASHBOARD_ROOM).emit('approval-aging:update', aging);
    } catch (err) {
      this.logger.error(`Approval-aging broadcast failed: ${(err as Error).message}`);
    }
  }
}
