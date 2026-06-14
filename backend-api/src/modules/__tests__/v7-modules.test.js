/**
 * V7 — Impossible Travel + WebSocket Telemetry Tests
 */

// ── Impossible Travel Tests ────────────────────────────────────────────────
describe('ImpossibleTravelDetector', () => {
  let ImpossibleTravelDetector;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../config/database', () => null);
    ({ ImpossibleTravelDetector } = require('../security/impossibleTravel'));
  });

  test('first login is never a threat', async () => {
    const detector = new ImpossibleTravelDetector();
    const result = await detector.check('user1', { lat: 40.7128, lng: -74.0060, timestamp: Date.now() });
    expect(result.isThreat).toBe(false);
  });

  test('nearby login is not a threat', async () => {
    const detector = new ImpossibleTravelDetector();
    const now = Date.now();
    await detector.check('user2', { lat: 40.7128, lng: -74.0060, timestamp: now });
    // 10km away, 1 hour later
    const result = await detector.check('user2', { lat: 40.8, lng: -74.0, timestamp: now + 3600000 });
    expect(result.isThreat).toBe(false);
  });

  test('impossible travel triggers a threat', async () => {
    const detector = new ImpossibleTravelDetector();
    const now = Date.now();
    // New York
    await detector.check('user3', { lat: 40.7128, lng: -74.0060, timestamp: now });
    // Tokyo, 5 minutes later (impossible)
    const result = await detector.check('user3', { lat: 35.6762, lng: 139.6503, timestamp: now + 300000 });
    expect(result.isThreat).toBe(true);
    expect(result.details.severity).toBeDefined();
    expect(result.details.distanceKm).toBeGreaterThan(1000);
  });

  test('no location returns no threat', async () => {
    const detector = new ImpossibleTravelDetector();
    const result = await detector.check('user4', null);
    expect(result.isThreat).toBe(false);
  });

  test('getStats returns tracked users and alerts', async () => {
    const detector = new ImpossibleTravelDetector();
    await detector.check('user5', { lat: 40.7, lng: -74.0, timestamp: Date.now() });
    const stats = await detector.getStats();
    expect(stats.trackedUsers).toBe(1);
    expect(stats.totalAlerts).toBe(0);
  });

  test('clearUser removes tracking data', async () => {
    const detector = new ImpossibleTravelDetector();
    await detector.check('user6', { lat: 40.7, lng: -74.0, timestamp: Date.now() });
    await detector.clearUser('user6');
    const stats = await detector.getStats();
    expect(stats.trackedUsers).toBe(0);
  });
});

// ── WebSocket Telemetry Tests ──────────────────────────────────────────────
describe('WebSocketTelemetry', () => {
  let WebSocketTelemetry;

  beforeEach(() => {
    jest.resetModules();
    ({ WebSocketTelemetry } = require('../telemetry/wsTelemetry'));
  });

  test('tracks connections and disconnections', () => {
    const ws = new WebSocketTelemetry();
    ws.onConnect('s1');
    ws.onConnect('s2');
    expect(ws.getStats().activeConnections).toBe(2);
    expect(ws.getStats().totalConnections).toBe(2);
    ws.onDisconnect('s1');
    expect(ws.getStats().activeConnections).toBe(1);
    expect(ws.getStats().totalDisconnections).toBe(1);
  });

  test('tracks peak connections', () => {
    const ws = new WebSocketTelemetry();
    ws.onConnect('a');
    ws.onConnect('b');
    ws.onConnect('c');
    ws.onDisconnect('a');
    ws.onDisconnect('b');
    expect(ws.getStats().peakConnections).toBe(3);
    expect(ws.getStats().activeConnections).toBe(1);
  });

  test('tracks auth failures', () => {
    const ws = new WebSocketTelemetry();
    ws.onAuthFailure();
    ws.onAuthFailure();
    expect(ws.getStats().authFailures).toBe(2);
  });

  test('generates Prometheus metrics', () => {
    const ws = new WebSocketTelemetry();
    ws.onConnect('p1');
    const metrics = ws.toPrometheus();
    expect(metrics).toContain('ws_active_connections 1');
    expect(metrics).toContain('ws_total_connections 1');
  });
});
