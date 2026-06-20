/**
 * Face Recognition Authentication Test Suite
 *
 * Tests all critical authentication scenarios:
 * - Correct face + correct password (Admin/Supervisor)
 * - Correct face + wrong password
 * - Wrong face + correct password
 * - Empty camera / no frames
 * - No registered face
 * - Admin face vs Supervisor credentials (cross-role collision)
 * - Corrupted embedding in DB
 * - Multiple faces in frame
 * - Logout consistency (both buttons)
 *
 * Run with: npx jest face-recognition.test.js
 */

process.env.PORT = '0';
process.env.RUN_MIGRATIONS = 'false';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app } = require('../server');
const { pool, query, faceQuery } = require('../config/database');
const bcrypt = require('bcryptjs');
const { connectRedis, disconnectRedis } = require('../config/redis');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

// 512-element valid embedding (simulates ArcFace output for person A)
const VALID_EMBEDDING_A = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1) * 0.5 + 0.5);

// 512-element valid embedding (simulates ArcFace output for person B — different identity)
const VALID_EMBEDDING_B = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + Math.PI) * 0.5 + 0.5);

// Normalize embeddings to unit vectors (as ArcFace does)
function normalizeEmbedding(emb) {
  const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
  return emb.map(v => v / norm);
}

const EMB_A_NORMALIZED = normalizeEmbedding(VALID_EMBEDDING_A);
const EMB_B_NORMALIZED = normalizeEmbedding(VALID_EMBEDDING_B);

// Blank/empty frames (white frames)
const BLANK_FRAME = Buffer.alloc(100).toString('base64');
const EMPTY_FRAMES = Array(20).fill(BLANK_FRAME);

// Legitimate frames (non-empty base64 — in real tests these would be real face images)
// For DB-level tests we only care about the embedding comparison path, not AI image processing
const MOCK_FRAMES = Array(20).fill('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');

let testEmployeeId;
let testAdminId;
let testSupervisorId;
let adminAccessToken;
let supervisorAccessToken;
let employeeAccessToken;

// ─────────────────────────────────────────────────────────────────────────────
// TEST DATABASE SETUP
// ─────────────────────────────────────────────────────────────────────────────

async function createTestEmployee({ employeeIdStr, role, password = 'TestPass123!', hasValidEmbedding = true, embeddingOverride = null }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO employees
       (employee_id, first_name, last_name, email, role, department, position,
        hire_date, is_active, password_hash, face_enrolled)
     VALUES ($1, $2, $3, $4, $5, 'Test Dept', 'Tester', CURRENT_DATE, TRUE, $6, $7)
     ON CONFLICT (employee_id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE,
       face_enrolled = EXCLUDED.face_enrolled
     RETURNING id`,
    [
      employeeIdStr,
      `Test${role}`,
      'User',
      `${employeeIdStr}@test-face.local`,
      role,
      passwordHash,
      hasValidEmbedding,
    ]
  );
  const id = result.rows[0].id;

  // Deactivate any existing embeddings
  await faceQuery('UPDATE face_embeddings SET is_active = FALSE WHERE employee_id = $1', [id]);

  if (hasValidEmbedding) {
    const embedding = embeddingOverride || EMB_A_NORMALIZED;
    await faceQuery(
      `INSERT INTO face_embeddings (employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by)
       VALUES ($1, $2, 'arcface-1.0', 0.95, $1)`,
      [id, JSON.stringify(embedding)]
    );
  }

  return id;
}

async function getAuthTokenFor(employeeIdStr, password) {
  const resp = await request(app)
    .post('/api/auth/login')
    .send({ employeeId: employeeIdStr, password });
  return resp.body.tokens?.accessToken || null;
}

let originalAdminEmbedding = null;

beforeAll(async () => {
  await connectRedis();

  // Temporarily deactivate production admin embedding to avoid test collisions
  try {
    const adminRes = await faceQuery("SELECT embedding_vector FROM face_embeddings WHERE employee_id = 1 AND is_active = TRUE");
    if (adminRes.rows.length > 0) {
      originalAdminEmbedding = adminRes.rows[0];
      await faceQuery("UPDATE face_embeddings SET is_active = FALSE WHERE employee_id = 1");
    }
  } catch (e) {
    console.error("Failed to backup admin embedding:", e);
  }

  // Create test employees
  testEmployeeId = await createTestEmployee({
    employeeIdStr: 'test-face-emp',
    role: 'employee',
    hasValidEmbedding: true,
    embeddingOverride: EMB_A_NORMALIZED,
  });

  testAdminId = await createTestEmployee({
    employeeIdStr: 'test-face-admin',
    role: 'admin',
    password: 'AdminTestPass123!',
    hasValidEmbedding: true,
    embeddingOverride: EMB_A_NORMALIZED,  // Admin has embedding A
  });

  testSupervisorId = await createTestEmployee({
    employeeIdStr: 'test-face-supervisor',
    role: 'supervisor',
    password: 'SuperTestPass123!',
    hasValidEmbedding: true,
    embeddingOverride: EMB_B_NORMALIZED,  // Supervisor has embedding B (different)
  });

  // Get auth tokens for protected endpoint tests
  adminAccessToken = await getAuthTokenFor('test-face-admin', 'AdminTestPass123!');
  supervisorAccessToken = await getAuthTokenFor('test-face-supervisor', 'SuperTestPass123!');
  employeeAccessToken = await getAuthTokenFor('test-face-emp', 'TestPass123!');
});

afterAll(async () => {
  // Cleanup test data
  try {
    const employeesRes = await query("SELECT id FROM employees WHERE employee_id LIKE 'test-face-%'");
    const employeeIds = employeesRes.rows.map(r => r.id);
    if (employeeIds.length > 0) {
      const idsStr = employeeIds.join(',');
      await faceQuery(`DELETE FROM user_images WHERE user_id IN (${idsStr})`);
      await faceQuery(`DELETE FROM users WHERE user_id IN (${idsStr})`);
      await faceQuery(`DELETE FROM face_embeddings WHERE employee_id IN (${idsStr})`);
    }
    await query("DELETE FROM login_logs WHERE employee_id IN (SELECT id FROM employees WHERE employee_id LIKE 'test-face-%')");
    await query("DELETE FROM security_events WHERE employee_id IN (SELECT id FROM employees WHERE employee_id LIKE 'test-face-%')");
    await query("DELETE FROM employees WHERE employee_id LIKE 'test-face-%'");
  } catch (err) {
    console.error('Teardown error:', err);
  }

  // Restore original admin embedding
  if (originalAdminEmbedding) {
    try {
      await faceQuery("UPDATE face_embeddings SET is_active = TRUE WHERE employee_id = 1");
    } catch (e) {
      console.error("Failed to restore admin embedding:", e);
    }
  }

  await disconnectRedis().catch(() => {});
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// MOCK THE FACE AI SERVICE
// These tests focus on the BACKEND logic — we mock the AI service HTTP call
// so tests don't require a live face-ai-service.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('axios', () => {
  const originalAxios = jest.requireActual('axios');
  return {
    ...originalAxios,
    post: jest.fn(),
  };
});

const axios = require('axios');

function mockAIAuthSuccess(similarity = 0.92) {
  axios.post.mockResolvedValueOnce({
    data: {
      authenticated: true,
      confidence: similarity,
      liveness_passed: true,
      spoof_detected: false,
      face_matched: true,
      similarity,
      spoof_confidence: 0.0,
      errors: [],
    }
  });
}

function mockAIAuthFail(reason = 'FACE_MISMATCH', similarity = 0.1) {
  axios.post.mockResolvedValueOnce({
    data: {
      authenticated: false,
      confidence: similarity,
      liveness_passed: reason !== 'LIVENESS_FAILED',
      spoof_detected: reason === 'SPOOF_DETECTED',
      face_matched: false,
      similarity,
      spoof_confidence: reason === 'SPOOF_DETECTED' ? 0.85 : 0.0,
      errors: [reason],
    }
  });
}

function mockAIRegisterSuccess(embedding = EMB_A_NORMALIZED) {
  axios.post.mockResolvedValueOnce({
    data: {
      success: true,
      registered: true,
      embedding,
      face_embedding: embedding,
      embedding_dim: embedding.length,
      quality_score: 0.92,
      model_version: 'arcface-1.0',
    }
  });
}

function mockAIRegisterNoFace() {
  axios.post.mockResolvedValueOnce({
    data: {
      success: false,
      registered: false,
      error: 'No face detected in provided frames',
      code: 'NO_FACE_DETECTED',
    }
  });
}

function mockAIUnavailable() {
  axios.post.mockRejectedValueOnce(Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }));
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: FACE LOGIN
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/face-login — Security Tests', () => {

  // ── 1. Missing required fields ──────────────────────────────────────────────
  test('1. Returns 400 when frames are missing', async () => {
    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ employeeId: 'test-face-emp' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  test('2. Returns 400 when employeeId is missing', async () => {
    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: EMPTY_FRAMES });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  // ── 2. Empty camera / no face ───────────────────────────────────────────────
  test('3. Rejects login with empty camera frames (no face) for employee', async () => {
    // AI service returns NO_FACE_DETECTED — backend should propagate failure
    axios.post.mockResolvedValueOnce({
      data: {
        authenticated: false,
        liveness_passed: false,
        face_matched: false,
        spoof_detected: false,
        errors: ['NO_FACE_DETECTED'],
        spoof_confidence: 0.0,
      }
    });

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: EMPTY_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
  });

  // ── 3. Employee with no registered face ─────────────────────────────────────
  test('4. Returns 403 NO_FACE_REGISTERED when employee has no face embedding', async () => {
    // Create employee with no embedding
    await createTestEmployee({
      employeeIdStr: 'test-no-face-emp',
      role: 'employee',
      hasValidEmbedding: false,
    });

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-no-face-emp' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_FACE_REGISTERED');
    expect(res.body.authenticated).toBe(false);

    // Cleanup
    await query("DELETE FROM security_events WHERE employee_id = (SELECT id FROM employees WHERE employee_id = 'test-no-face-emp')");
    await query("DELETE FROM employees WHERE employee_id = 'test-no-face-emp'");
  });

  // ── 4. Corrupted embedding in DB ─────────────────────────────────────────────
  test('5. Returns 403 CORRUPTED_FACE_EMBEDDING when stored embedding is invalid', async () => {
    // Create employee with corrupted embedding
    const corruptResult = await query(
      `INSERT INTO employees
         (employee_id, first_name, last_name, email, role, department, position,
          hire_date, is_active, password_hash, face_enrolled)
       VALUES ('test-corrupt-emp', 'Corrupt', 'Test', 'corrupt@test.local', 'employee',
               'Test', 'Tester', CURRENT_DATE, TRUE,
               '${await bcrypt.hash('pass', 10)}', TRUE)
       ON CONFLICT (employee_id) DO UPDATE SET is_active = TRUE, face_enrolled = TRUE
       RETURNING id`
    );
    const corruptId = corruptResult.rows[0].id;

    // Insert a corrupted (too-short) embedding that passes DB constraint (length > 100)
    await faceQuery(
      `INSERT INTO face_embeddings (employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by)
       VALUES ($1, '[1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0,1.0,2.0]', '1.0', 0.5, $1)`,
      [corruptId]
    );

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-corrupt-emp' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CORRUPTED_FACE_EMBEDDING');
    expect(res.body.authenticated).toBe(false);

    // Cleanup
    await faceQuery("DELETE FROM face_embeddings WHERE employee_id = $1", [corruptId]);
    await query("DELETE FROM security_events WHERE employee_id = $1", [corruptId]);
    await query("DELETE FROM employees WHERE employee_id = 'test-corrupt-emp'");
  });

  // ── 5. Successful employee face login ────────────────────────────────────────
  test('6. Authenticates employee successfully with valid face', async () => {
    mockAIAuthSuccess(0.92);

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.tokens).toBeDefined();
    expect(res.body.employee.role).toBe('employee');
  });

  // ── 6. Admin requires password ───────────────────────────────────────────────
  test('7. Admin face-only login returns 400 INCOMPLETE_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-admin' });
    // No password provided

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_CREDENTIALS');
    expect(res.body.authenticated).toBeUndefined();
  });

  // ── 7. Admin with wrong password ─────────────────────────────────────────────
  test('8. Admin face + wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/face-login')
      .send({
        frames: MOCK_FRAMES,
        employeeId: 'test-face-admin',
        password: 'WrongPassword999!',
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  // ── 8. Admin with face mismatch ─────────────────────────────────────────────
  test('9. Admin with correct password + wrong face returns 401', async () => {
    mockAIAuthFail('FACE_MISMATCH', 0.12);

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({
        frames: MOCK_FRAMES,
        employeeId: 'test-face-admin',
        password: 'AdminTestPass123!',
      });

    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
  });

  // ── 9. Admin face + Admin credentials: SUCCESS ──────────────────────────────
  test('10. Admin with correct face + correct password authenticates', async () => {
    mockAIAuthSuccess(0.94);

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({
        frames: MOCK_FRAMES,
        employeeId: 'test-face-admin',
        password: 'AdminTestPass123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.employee.role).toBe('admin');
    expect(res.body.tokens).toBeDefined();
  });

  // ── 10. CROSS-ROLE COLLISION: Admin face + Supervisor credentials ─────────────
  test('11. Admin credentials rejected because Supervisor has DIFFERENT stored embedding', async () => {
    // Admin embedding is EMB_A, Supervisor embedding is EMB_B
    // Backend will fetch EMB_B (supervisor's embedding) and pass to AI
    // AI compares Admin face frames against EMB_B — should fail
    mockAIAuthFail('FACE_MISMATCH', 0.08);

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({
        frames: MOCK_FRAMES,  // Pretend these are "Admin face" frames
        employeeId: 'test-face-supervisor',  // Supervisor's account
        password: 'SuperTestPass123!',
      });

    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
  });

  // ── 11. Liveness failed ──────────────────────────────────────────────────────
  test('12. Login fails when liveness check fails', async () => {
    mockAIAuthFail('LIVENESS_FAILED', 0.0);

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
  });

  // ── 12. Spoof detected ──────────────────────────────────────────────────────
  test('13. Login fails and security event logged when spoof detected', async () => {
    mockAIAuthFail('SPOOF_DETECTED', 0.0);

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.spoofDetected).toBe(true);
  });

  // ── 13. AI service unavailable ───────────────────────────────────────────────
  test('14. Returns 503 when AI service is unreachable', async () => {
    mockAIUnavailable();

    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(503);
    expect(res.body.authenticated).toBe(false);
  });

  // ── 14. Non-existent employee ────────────────────────────────────────────────
  test('15. Returns 404 for unknown employee ID', async () => {
    const res = await request(app)
      .post('/api/auth/face-login')
      .send({ frames: MOCK_FRAMES, employeeId: 'nonexistent-emp-00000' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EMPLOYEE_NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: FACE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/register-face — Registration Security Tests', () => {

  test('16. Rejects registration when no face detected by AI service', async () => {
    mockAIRegisterNoFace();

    const res = await request(app)
      .post('/api/auth/register-face')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ frames: EMPTY_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(400);
  });

  test('17. Rejects registration when AI service returns invalid embedding', async () => {
    // AI returns "success" but with null embedding
    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        registered: true,
        embedding: null,         // ← Missing embedding
        quality_score: 0.9,
        model_version: 'arcface-1.0',
      }
    });

    const res = await request(app)
      .post('/api/auth/register-face')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INVALID_EMBEDDING_RETURNED');
  });

  test('18. Successfully registers face and stores valid embedding', async () => {
    mockAIRegisterSuccess(EMB_A_NORMALIZED);

    const res = await request(app)
      .post('/api/auth/register-face')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify embedding was actually stored in DB
    const embResult = await faceQuery(
      'SELECT embedding_vector FROM face_embeddings WHERE employee_id = $1 AND is_active = TRUE',
      [testEmployeeId]
    );
    expect(embResult.rows.length).toBe(1);
    const storedEmb = JSON.parse(embResult.rows[0].embedding_vector);
    expect(Array.isArray(storedEmb)).toBe(true);
    expect(storedEmb.length).toBeGreaterThanOrEqual(512);
  });

  test('19. Employee cannot self-register face', async () => {
    const res = await request(app)
      .post('/api/auth/register-face')
      .set('Authorization', `Bearer ${employeeAccessToken}`)
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    expect(res.status).toBe(403);
  });

  test('20. AI service unavailable returns 500 without silent fallback', async () => {
    mockAIUnavailable();

    const res = await request(app)
      .post('/api/auth/register-face')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ frames: MOCK_FRAMES, employeeId: 'test-face-emp' });

    // Must fail — must NOT silently store a mock embedding
    expect(res.status).not.toBe(200);

    // Verify no garbage embedding was stored
    const embResult = await faceQuery(
      `SELECT embedding_vector FROM face_embeddings
       WHERE employee_id = $1 AND is_active = TRUE
       AND embedding_vector = '[]'`,
      [testEmployeeId]
    );
    expect(embResult.rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: LOGOUT
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout — Session Cleanup Tests', () => {

  test('21. Logout invalidates the access token (refresh token revoked)', async () => {
    // Use a fresh token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ employeeId: 'test-face-admin', password: 'AdminTestPass123!' });
    const token = loginRes.body.tokens?.accessToken;
    const refreshToken = loginRes.body.tokens?.refreshToken;

    expect(token).toBeTruthy();

    // Logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ refreshToken });

    expect(logoutRes.status).toBe(200);

    // Try using the token after logout — should be rejected (blacklisted or revoked)
    const protectedRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(protectedRes.status).toBe(401);
  });

  test('22. Logout without auth token returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE: EMBEDDING INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

describe('Face Embedding Integrity', () => {

  test('23. Admin and Supervisor have different embeddings (no collision)', async () => {
    const adminEmb = await faceQuery(
      'SELECT embedding_vector FROM face_embeddings WHERE employee_id = $1 AND is_active = TRUE',
      [testAdminId]
    );
    const supervisorEmb = await faceQuery(
      'SELECT embedding_vector FROM face_embeddings WHERE employee_id = $1 AND is_active = TRUE',
      [testSupervisorId]
    );

    expect(adminEmb.rows.length).toBe(1);
    expect(supervisorEmb.rows.length).toBe(1);

    const adminVec = JSON.parse(adminEmb.rows[0].embedding_vector);
    const supervisorVec = JSON.parse(supervisorEmb.rows[0].embedding_vector);

    // Compute cosine similarity
    const dot = adminVec.reduce((sum, v, i) => sum + v * supervisorVec[i], 0);
    const normA = Math.sqrt(adminVec.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(supervisorVec.reduce((sum, v) => sum + v * v, 0));
    const similarity = dot / (normA * normB);

    // They MUST be different embeddings (cosine similarity should be < 0.65 threshold)
    expect(similarity).toBeLessThan(0.65);
  });

  test('24. No employee has a seeded bootstrap embedding (starts with [0.5,)', async () => {
    const result = await faceQuery(
      `SELECT employee_id FROM face_embeddings
       WHERE is_active = TRUE AND embedding_vector LIKE '[0.5,%'`
    );
    expect(result.rows.length).toBe(0);
  });

  test('25. No active empty embedding ([]) exists for any employee', async () => {
    const result = await faceQuery(
      `SELECT employee_id FROM face_embeddings
       WHERE is_active = TRUE AND embedding_vector = '[]'`
    );
    expect(result.rows.length).toBe(0);
  });

  test('26. Each employee has at most one active embedding', async () => {
    const result = await faceQuery(
      `SELECT employee_id, COUNT(*) as cnt
       FROM face_embeddings
       WHERE is_active = TRUE
       GROUP BY employee_id
       HAVING COUNT(*) > 1`
    );
    expect(result.rows.length).toBe(0);
  });
});
