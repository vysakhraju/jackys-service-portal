import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Static regression guard for the 2026-09-07 finding: the live Kanban WebSocket ("Live"
 * connection pill on Reports/Dashboards) sat stuck on "Offline - live updates paused"
 * against a real running server, even though every REST call worked fine.
 *
 * Root cause: `@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',')
 * || [...] } })`'s object literal is evaluated the instant this file is first imported -
 * Node's static module-resolution time, which happens while `main.ts`'s top-level
 * `import { AppModule } from './app.module'` is still being resolved, well before
 * `NestFactory.create(AppModule)` ever instantiates `ConfigModule.forRoot()` and actually
 * populates `process.env` from `.env`. So `process.env.CORS_ORIGIN` is reliably undefined
 * right here, and the hardcoded fallback array is ALWAYS the one actually enforced for the
 * WebSocket handshake's CORS check - unlike `main.ts`'s own `app.use(cors(...))`, which
 * runs at request time (long after bootstrap finished) and so was never affected.
 *
 * `main.ts`'s fallback array was correctly updated to include the Vite dev server's port
 * (5173) when the frontend was scaffolded; the gateway's fallback array was never updated
 * to match, so every local WebSocket handshake from the real frontend was silently CORS-
 * rejected while Swagger/curl-based REST testing (which never exercises this code path)
 * stayed green. This test catches that class of drift for good: it asserts every
 * gateway's fallback CORS origin list is always a superset of main.ts's own fallback
 * list, rather than hardcoding a duplicate list here that could just as easily go stale a
 * second time.
 *
 * Extended 2026-09-07 to cover InventoryGateway (the Need Spare review notification
 * channel) too, once it copied this exact CORS block verbatim - a second gateway means a
 * second place this drift can silently recur, so the check is now parameterized over
 * every gateway file rather than hardcoded to Reports alone.
 */
describe('WebSocket gateways CORS fallback stays in sync with main.ts', () => {
  const srcDir = join(__dirname, '..');

  const GATEWAYS: Array<{ name: string; relativePath: string[] }> = [
    { name: 'ReportsGateway', relativePath: ['reports', 'reports.gateway.ts'] },
    { name: 'InventoryGateway', relativePath: ['inventory', 'inventory.gateway.ts'] },
  ];

  function extractFallbackOrigins(source: string, marker: string): string[] {
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error(`Could not find "${marker}" in source - has the code moved?`);
    }
    const afterMarker = source.slice(markerIndex);
    const arrayMatch = afterMarker.match(/\[([\s\S]*?)\]/);
    if (!arrayMatch) {
      throw new Error(`Could not find a fallback array literal after "${marker}"`);
    }
    const urlMatches = arrayMatch[1].match(/http:\/\/localhost:\d+/g);
    return urlMatches ?? [];
  }

  it("main.ts's cors() fallback includes the Vite dev server port (5173)", () => {
    const mainSource = readFileSync(join(srcDir, 'main.ts'), 'utf-8');
    const origins = extractFallbackOrigins(mainSource, "origin: process.env.CORS_ORIGIN?.split(',') ||");
    expect(origins).toContain('http://localhost:5173');
  });

  it.each(GATEWAYS)("$name's own CORS fallback is a superset of main.ts's fallback", ({ relativePath }) => {
    const mainSource = readFileSync(join(srcDir, 'main.ts'), 'utf-8');
    const gatewaySource = readFileSync(join(srcDir, ...relativePath), 'utf-8');

    const mainOrigins = extractFallbackOrigins(mainSource, "origin: process.env.CORS_ORIGIN?.split(',') ||");
    const gatewayOrigins = extractFallbackOrigins(gatewaySource, "origin: process.env.CORS_ORIGIN?.split(',') ||");

    // Every origin main.ts's fallback allows for plain REST calls must also be allowed by
    // the gateway's fallback for the WebSocket handshake - otherwise the two "same app,
    // same dev server" fallback lists silently diverge again, exactly like this bug.
    for (const origin of mainOrigins) {
      expect(gatewayOrigins).toContain(origin);
    }
  });

  it.each(GATEWAYS)('$name CORS fallback explicitly includes http://localhost:5173', ({ relativePath }) => {
    const gatewaySource = readFileSync(join(srcDir, ...relativePath), 'utf-8');
    const origins = extractFallbackOrigins(gatewaySource, "origin: process.env.CORS_ORIGIN?.split(',') ||");
    expect(origins).toContain('http://localhost:5173');
  });
});
