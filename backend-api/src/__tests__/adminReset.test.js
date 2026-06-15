const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');

// Mock database and other services
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../config/redis', () => ({
  setWithExpiry: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
}));

jest.mock('../config/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../modules/security-monitoring/securityLogger', () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock('axios');
const axios = require('axios');

const { query } = require('../config/database');
const redis = require('../config/redis');

// Setup mini-express app to test admin routes
const app = express();
app.use(express.json());

// Mock authenticateToken middleware and req.user
app.use((req, res, next) => {
  req.user = { id: 1, employeeId: 'admin', role: 'admin' };
  next();
});

const adminRoutes = require('../modules/admin/routes');
app.use('/api/admin', adminRoutes);

describe('Admin Reset Workflow Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/admin/reset/initiate - successful password and face verification', async () => {
    // Mock password query
    query.mockResolvedValueOnce({
      rows: [{ id: 1, employee_id: 'admin', password_hash: '$2a$10$abcdefghijklmnopqrstuv' }],
    });
    // Mock bcrypt compare
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    // Mock embedding query
    query.mockResolvedValueOnce({
      rows: [{ embedding_vector: '[0.1, 0.2]' }],
    });
    // Mock face match service call
    axios.post.mockResolvedValue({
      data: { success: true, authenticated: true },
    });
    // Mock recovery email query
    query.mockResolvedValueOnce({
      rows: [{ recovery_email: 'admin_rec@test.com' }],
    });
    // Mock redis OTP save
    redis.setWithExpiry.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/admin/reset/initiate')
      .send({ password: 'Password123', frames: ['frame1'] });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('OTP has been sent');
  });

  test('POST /api/admin/reset/verify-otp - successful OTP verification', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 1 }],
    });
    redis.get.mockResolvedValue('123456');

    const response = await request(app)
      .post('/api/admin/reset/verify-otp')
      .send({ otp: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(redis.setWithExpiry).toHaveBeenCalledWith(expect.stringContaining('admin_reset_verified'), 'true', 600);
  });

  test('GET /api/admin/configuration - successful configuration retrieval', async () => {
    // Mock admin check
    query.mockResolvedValueOnce({
      rows: [{ id: 1, employee_id: 'admin' }],
    });
    // Mock config check
    query.mockResolvedValueOnce({
      rows: [{
        admin_name: 'Test Admin',
        admin_email: 'admin@test.com',
        admin_phone: '1234567890',
        admin_address: '123 Test St',
        admin_designation: 'Lead Admin',
        recovery_email: 'recovery@test.com',
        recovery_phone: '0987654321'
      }],
    });

    const response = await request(app)
      .get('/api/admin/configuration');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.adminName).toBe('Test Admin');
    expect(response.body.data.adminEmail).toBe('admin@test.com');
  });

  test('POST /api/admin/configuration - successful configuration update', async () => {
    // Mock admin check
    query.mockResolvedValueOnce({
      rows: [{ id: 1, employee_id: 'admin' }],
    });
    // Mock transaction BEGIN
    query.mockResolvedValueOnce({});
    // Mock exists check
    query.mockResolvedValueOnce({
      rows: [{ '1': 1 }],
    });
    // Mock transaction UPDATE, employees UPDATE, COMMIT
    query.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/admin/configuration')
      .send({
        adminName: 'Updated Admin',
        adminEmail: 'updated@test.com',
        adminPhone: '1234567890',
        adminAddress: '123 New St',
        adminDesignation: 'Principal Admin',
        recoveryEmail: 'recovery@test.com',
        recoveryPhone: '0987654321'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('POST /api/admin/configuration - validation error for invalid emails', async () => {
    // Mock admin check
    query.mockResolvedValueOnce({
      rows: [{ id: 1, employee_id: 'admin' }],
    });

    const response = await request(app)
      .post('/api/admin/configuration')
      .send({
        adminEmail: 'invalid-email',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid administrator email format');
  });
});
