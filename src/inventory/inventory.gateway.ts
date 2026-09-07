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
import { InventoryService } from './inventory.service';

/**
 * Mobile Phase 5 gap closed (2026-09-07): field technicians' Need Spare requests had no
 * way to reach a Team Leader's attention short of Swagger + a raw SQL lookup - see
 * InventoryService.getPendingNeedSpareRequests()'s own doc comment. Same poll-and-diff
 * simplification as ReportsGateway (see its doc comment for the full FR-20/NFR-02
 * reasoning) rather than a genuine emit-on-mutation push - this is the first gateway
 * anything in the codebase pushes from a plain service into, and threading a gateway
 * dependency directly into InventoryService/TechnicianService for the first time is a
 * bigger architectural change than a 5s poll justifies for what is, in practice, a
 * "somebody go check this soon" nudge rather than a sub-second-critical signal.
 *
 * Broadcasts the FULL current pending list on every change (like kanban:update), not a
 * delta - the frontend decides what's actually new by diffing against what it already
 * knows (see useNeedSpareSocket.ts), including treating the very first snapshot after
 * connecting as a baseline never worth a toast for on its own.
 */
const POLL_INTERVAL_MS = 5_000;
const REVIEWERS_ROOM = 'need-spare-reviewers';
const VIEW_ROLES = ['TECHNICAL_TEAM_LEADER', 'SERVICE_HEAD', 'SUPER_ADMIN'];

@WebSocketGateway({
  namespace: '/inventory',
  cors: {
    // Same static-evaluation-timing caveat as ReportsGateway's identical block - decorator
    // metadata is read at Node's static module-resolution time, before ConfigModule has
    // populated process.env, so this fallback array is what's actually in effect for the
    // handshake's CORS check. Keep in sync with main.ts's cors() fallback and
    // ReportsGateway's own copy by hand.
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173', // Vite dev server
    ],
    credentials: true,
  },
})
export class InventoryGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(InventoryGateway.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSignature = '';

  constructor(
    private inventoryService: InventoryService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  onModuleInit() {
    this.pollTimer = setInterval(() => this.pollAndBroadcast(), POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Same handshake-auth approach as ReportsGateway.handleConnection() - see that
   * gateway's doc comment for why JwtAuthGuard/RolesGuard can't be reused here. */
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
      if (!VIEW_ROLES.includes(user.role.name)) throw new Error('Role not permitted on the Need Spare review channel');

      client.data.userId = user.id;
      client.join(REVIEWERS_ROOM);

      // Immediate full snapshot rather than making the client wait for the next poll tick.
      const pending = await this.inventoryService.getPendingNeedSpareRequests();
      client.emit('need-spare:update', pending);
    } catch (err) {
      this.logger.warn(`WebSocket connection rejected: ${(err as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket) {
    // No per-connection state to clean up beyond what Socket.io already handles.
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const fromQuery = client.handshake.query?.token;
    return typeof fromQuery === 'string' ? fromQuery : null;
  }

  private async pollAndBroadcast() {
    if (!this.server) return;
    try {
      const pending = await this.inventoryService.getPendingNeedSpareRequests();
      const signature = pending.map((r) => r.id).join('|');
      if (signature === this.lastSignature) return; // nothing changed - skip the broadcast

      this.lastSignature = signature;
      this.server.to(REVIEWERS_ROOM).emit('need-spare:update', pending);
    } catch (err) {
      this.logger.error(`Need Spare poll/broadcast failed: ${(err as Error).message}`);
    }
  }
}
