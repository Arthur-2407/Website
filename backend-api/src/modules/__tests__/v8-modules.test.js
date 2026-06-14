/**
 * V8 — Device Trust + Config Validator + Event Bus + SIEM Exporter Tests
 */

// ── Device Trust Tests ─────────────────────────────────────────────────────
describe('DeviceTrustEngine', () => {
  let DeviceTrustEngine;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../config/database', () => null);
    ({ DeviceTrustEngine } = require('../security/deviceTrust'));
  });

  test('unknown device gets low trust score', async () => {
    const engine = new DeviceTrustEngine();
    const req = { headers: { 'user-agent': 'TestBrowser/1.0' }, ip: '1.2.3.4' };
    const result = await engine.evaluate('user1', req);
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
    expect(result.isNewDevice).toBe(true);
    expect(result.isNewIp).toBe(true);
  });

  test('registered device gets high trust score', async () => {
    const engine = new DeviceTrustEngine();
    const req = { headers: { 'user-agent': 'TestBrowser/1.0', 'accept-language': 'en' }, ip: '1.2.3.4' };
    await engine.register('user2', req);
    const result = await engine.evaluate('user2', req);
    expect(result.score).toBe(100);
    expect(result.level).toBe('high');
    expect(result.isNewDevice).toBe(false);
    expect(result.isNewIp).toBe(false);
  });

  test('known device but new IP gets medium trust', async () => {
    const engine = new DeviceTrustEngine();
    const req1 = { headers: { 'user-agent': 'TestBrowser/1.0', 'accept-language': 'en' }, ip: '1.2.3.4' };
    await engine.register('user3', req1);
    const req2 = { headers: { 'user-agent': 'TestBrowser/1.0', 'accept-language': 'en' }, ip: '5.6.7.8' };
    const result = await engine.evaluate('user3', req2);
    expect(result.score).toBe(50);
    expect(result.level).toBe('medium');
  });

  test('getStats returns correct counts', async () => {
    const engine = new DeviceTrustEngine();
    const req = { headers: { 'user-agent': 'Test' }, ip: '1.1.1.1' };
    await engine.register('u1', req);
    await engine.register('u2', req);
    const stats = await engine.getStats();
    expect(stats.trackedUsers).toBe(2);
  });
});

// ── Config Validator Tests ─────────────────────────────────────────────────
describe('ConfigValidator', () => {
  let validateConfig;
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
    jest.mock('../../config/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    ({ validateConfig } = require('../../config/configValidator'));
  });

  afterEach(() => {
    process.env = origEnv;
  });

  test('validates successfully in development', () => {
    process.env.NODE_ENV = 'development';
    const result = validateConfig();
    expect(result.issues).toBeDefined();
  });

  test('warns about missing recommended vars', () => {
    delete process.env.REDIS_URL;
    delete process.env.JWT_ACCESS_SECRET;
    const result = validateConfig();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('throws in production with insecure JWT', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'short';
    process.env.JWT_REFRESH_SECRET = 'short';
    process.env.DB_PASSWORD = 'set';
    expect(() => validateConfig()).toThrow(/Configuration validation failed/);
  });
});

// ── Event Bus Tests ────────────────────────────────────────────────────────
describe('EventBus', () => {
  let EventBus;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    ({ EventBus } = require('../../config/eventBus'));
  });

  test('emits and handles events', async () => {
    const bus = new EventBus();
    const received = [];
    bus.on('test', (payload) => received.push(payload));
    await bus.emit('test', { key: 'value' });
    expect(received).toHaveLength(1);
    expect(received[0].data.key).toBe('value');
  });

  test('isolates handler errors', async () => {
    const bus = new EventBus();
    bus.on('fail', () => { throw new Error('boom'); });
    bus.on('fail', (p) => p); // second handler should still run
    await bus.emit('fail');
    expect(bus.getStats().errors).toBe(1);
    expect(bus.getStats().handled).toBe(1);
  });

  test('unsubscribes handlers', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.on('unsub', handler);
    bus.off('unsub', handler);
    await bus.emit('unsub');
    expect(handler).not.toHaveBeenCalled();
  });

  test('lists registered events', () => {
    const bus = new EventBus();
    bus.on('a', () => {});
    bus.on('b', () => {});
    expect(bus.listEvents()).toEqual(['a', 'b']);
  });

  test('getStats returns correct totals', async () => {
    const bus = new EventBus();
    bus.on('x', () => {});
    await bus.emit('x');
    await bus.emit('x');
    const stats = bus.getStats();
    expect(stats.emitted).toBe(2);
    expect(stats.registeredEvents).toBe(1);
  });
});

// ── SIEM Exporter Tests ────────────────────────────────────────────────────
describe('SiemExporter', () => {
  let SiemExporter;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    ({ SiemExporter } = require('../security/siemExporter'));
  });

  test('generates valid CEF format', () => {
    const exporter = new SiemExporter();
    const cef = exporter.toCEF({
      eventType: 'LOGIN_SUCCESS',
      severity: 'low',
      ip: '1.2.3.4',
      userId: 'user1',
    });
    expect(cef).toMatch(/^CEF:0\|AttendanceSystem\|/);
    expect(cef).toContain('LOGIN_SUCCESS');
    expect(cef).toContain('src=1.2.3.4');
  });

  test('generates valid SIEM JSON', () => {
    const exporter = new SiemExporter();
    const json = exporter.toJSON({
      eventType: 'LOGIN_FAILED',
      severity: 'high',
      ip: '10.0.0.1',
      employeeId: 'E001',
    });
    expect(json['@timestamp']).toBeDefined();
    expect(json['source.ip']).toBe('10.0.0.1');
    expect(json['user.name']).toBe('E001');
    expect(json['event.severity']).toBe(8);
  });

  test('export logs both formats', () => {
    const exporter = new SiemExporter();
    const result = exporter.export({ eventType: 'TEST', severity: 'medium' });
    expect(result.cef).toBeDefined();
    expect(result.json).toBeDefined();
    expect(exporter.getStats().exported).toBe(2); // toCEF + toJSON
  });
});
