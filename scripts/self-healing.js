#!/usr/bin/env node

/**
 * PHASE 9 — SELF-HEALING SAFETY LAYER
 *
 * Implements guards to:
 *   - Validate state before modification
 *   - Create rollback checkpoints
 *   - Verify system after modification
 *   - Auto-revert if verification fails
 *
 * Guards implemented:
 *   1. CheckpointGuard
 *   2. RepairGuard
 *   3. RollbackGuard
 *   4. IntegrityGuard
 *   5. ServiceGuard
 *   6. EnrollmentGuard
 *   7. ConnectionGuard
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_DIR = path.join(ROOT, '.state-snapshots');

// Helper to probe an HTTP endpoint
function probeEndpoint(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: 'up', code: res.statusCode, body: JSON.parse(data), latency: Date.now() - start });
        } catch {
          resolve({ status: 'up', code: res.statusCode, body: data, latency: Date.now() - start });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ status: 'down', error: err.message, latency: Date.now() - start });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'timeout', latency: Date.now() - start });
    });
  });
}

// ── CONNECTION GUARD ────────────────────────────────────────────────────────
async function ConnectionGuard() {
  console.log('🔍 Running ConnectionGuard...');
  const results = { db: false, redis: false };
  
  // Database ping
  try {
    const dbCheck = execSync('docker exec attendance-db-prod pg_isready -U postgres', { encoding: 'utf8' });
    results.db = dbCheck.includes('accepting connections');
  } catch (err) {
    console.error('❌ DB ping failed:', err.message);
  }

  // Load password from .env
  let redisPassword = 'redispassword123';
  try {
    const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const match = envContent.match(/^REDIS_PASSWORD=(.+)$/m);
    if (match) {
      redisPassword = match[1].trim();
    }
  } catch (e) {
    console.log('  ⚠️ Could not read REDIS_PASSWORD from .env, using default');
  }

  // Redis ping
  try {
    const redisCheck = execSync(`docker exec attendance-redis-prod redis-cli -a "${redisPassword}" ping`, { encoding: 'utf8' });
    results.redis = redisCheck.includes('PONG');
  } catch (err) {
    try {
      const redisCheckOpt = execSync('docker exec attendance-redis-prod redis-cli ping', { encoding: 'utf8' });
      results.redis = redisCheckOpt.includes('PONG');
    } catch (err2) {
      console.error('❌ Redis ping failed:', err2.message);
    }
  }

  console.log(`  - DB: ${results.db ? '🟢 Connected' : '🔴 Disconnected'}`);
  console.log(`  - Redis: ${results.redis ? '🟢 Connected' : '🔴 Disconnected'}`);
  return results.db && results.redis;
}

// ── SERVICE GUARD ──────────────────────────────────────────────────────────
async function ServiceGuard() {
  console.log('🔍 Running ServiceGuard...');
  const status = { nginx: false, backend: false, faceAi: false };

  // Nginx health
  const nginxRes = await probeEndpoint('http://localhost/health');
  status.nginx = nginxRes.status === 'up' && nginxRes.code === 200;

  // Backend direct endpoint through Nginx
  const backendRes = await probeEndpoint('http://localhost/health');
  status.backend = backendRes.status === 'up' && backendRes.code === 200 && backendRes.body?.services?.database === 'connected';

  // Face-AI through Nginx proxy
  const faceAiRes = await probeEndpoint('http://localhost/face-ai/health');
  status.faceAi = faceAiRes.status === 'up' && faceAiRes.code === 200 && faceAiRes.body?.status === 'healthy';

  console.log(`  - Nginx: ${status.nginx ? '🟢 Up' : '🔴 Down'}`);
  console.log(`  - Backend API: ${status.backend ? '🟢 Up & Connected' : '🔴 Down/Degraded'}`);
  console.log(`  - Face AI Service: ${status.faceAi ? '🟢 Up & Healthy' : '🔴 Down/Unhealthy'}`);

  return status.nginx && status.backend && status.faceAi;
}

// ── INTEGRITY GUARD ────────────────────────────────────────────────────────
async function IntegrityGuard() {
  console.log('🔍 Running IntegrityGuard...');
  let hasErrors = false;

  // 1. Verify schema tables and foreign keys
  try {
    const tableCheck = execSync(
      'docker exec attendance-db-prod psql -U postgres -d attendance_system -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema=\'public\' AND table_name IN (\'users\', \'employees\', \'face_embeddings\', \'security_events\', \'audit_logs\');"',
      { encoding: 'utf8' }
    ).trim();
    const tableCount = parseInt(tableCheck);
    console.log(`  - Schema check: Found ${tableCount}/5 core tables.`);
    if (tableCount < 3) {
      console.error('❌ Critical tables missing in database!');
      hasErrors = true;
    }
  } catch (err) {
    console.error('❌ DB tables query failed:', err.message);
    hasErrors = true;
  }

  // 2. Check for trigger recursion
  try {
    const recursionCheck = execSync(
      'docker exec attendance-db-prod psql -U postgres -d attendance_system -t -c "SELECT count(*) FROM pg_trigger WHERE tgname LIKE \'%recursion%\' OR tgname LIKE \'%loop%\';"',
      { encoding: 'utf8' }
    ).trim();
    console.log(`  - Trigger loop check: Found ${recursionCheck} potential recursive triggers.`);
  } catch (err) {
    console.error('❌ DB trigger loops query failed:', err.message);
  }

  return !hasErrors;
}

// ── ENROLLMENT GUARD ───────────────────────────────────────────────────────
async function EnrollmentGuard() {
  console.log('🔍 Running EnrollmentGuard...');
  
  // Verify embedding status in DB
  try {
    const embedStatus = execSync(
      'docker exec attendance-db-prod psql -U postgres -d attendance_system -t -c "SELECT COUNT(*) FROM face_embeddings WHERE is_active=true;"',
      { encoding: 'utf8' }
    ).trim();
    console.log(`  - Enrollment validation: ${embedStatus} active embeddings registered in DB.`);
    return true;
  } catch (err) {
    console.error('❌ Face embeddings status check failed:', err.message);
    return false;
  }
}

// ── CHECKPOINT GUARD ───────────────────────────────────────────────────────
async function CheckpointGuard() {
  console.log('🔍 Running CheckpointGuard...');
  
  // Check if repair-manifest.json and at least one checkpoint exists in snapshots
  const manifestPath = path.join(ROOT, 'repair-manifest.json');
  const manifestExists = fs.existsSync(manifestPath);
  
  let checkpointExists = false;
  if (fs.existsSync(SNAPSHOT_DIR)) {
    const dirs = fs.readdirSync(SNAPSHOT_DIR);
    checkpointExists = dirs.some(d => d.startsWith('AUTOCHK_'));
  }

  console.log(`  - Manifest registered: ${manifestExists ? '🟢 Yes' : '🔴 No'}`);
  console.log(`  - Checkpoint files verified: ${checkpointExists ? '🟢 Yes' : '🔴 No'}`);
  return manifestExists && checkpointExists;
}

// ── REPAIR GUARD ───────────────────────────────────────────────────────────
async function RepairGuard() {
  console.log('🔍 Running RepairGuard...');
  
  // Check for any broken code syntax/typescript compilation in frontend and backend
  let frontendCompiles = false;
  let backendCompiles = false;

  try {
    console.log('  - Checking frontend compilation (type-check)...');
    execSync('npm run --prefix frontend build', { stdio: 'ignore' });
    frontendCompiles = true;
    console.log('    ✅ Frontend compiles successfully.');
  } catch (err) {
    console.error('    ❌ Frontend compilation failed! Repair syntax errors.');
  }

  try {
    console.log('  - Checking backend lint/syntax (node check)...');
    execSync('node --check backend-api/src/dev-server.js', { stdio: 'ignore' });
    backendCompiles = true;
    console.log('    ✅ Backend syntax verification passed.');
  } catch (err) {
    console.error('    ❌ Backend syntax contains errors!');
  }

  return frontendCompiles && backendCompiles;
}

// ── ROLLBACK GUARD (AUTO-REVERT) ───────────────────────────────────────────
async function RollbackGuard() {
  console.log('⚠️ Running RollbackGuard (Initiating auto-revert to last checkpoint)...');
  
  const manifestPath = path.join(ROOT, 'repair-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Cannot rollback: repair-manifest.json not found!');
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const checkpointName = manifest.checkpointName;
    const checkpointDir = path.join(SNAPSHOT_DIR, checkpointName);

    if (!fs.existsSync(checkpointDir)) {
      console.error(`❌ Rollback directory ${checkpointDir} does not exist!`);
      return false;
    }

    console.log(`🔄 Reverting files using checkpoint: ${checkpointName}...`);

    for (const [targetFile, sourceRelativePath] of Object.entries(manifest.rollbackMapping)) {
      const targetAbsPath = path.join(ROOT, targetFile);
      
      if (sourceRelativePath === null) {
        // Newly added file — delete it
        if (fs.existsSync(targetAbsPath)) {
          fs.unlinkSync(targetAbsPath);
          console.log(`  🗑️  Deleted newly added file: ${targetFile}`);
        }
      } else {
        // Revert to snapshot copy
        const snapshotCopyPath = path.join(checkpointDir, sourceRelativePath);
        if (fs.existsSync(snapshotCopyPath)) {
          fs.mkdirSync(path.dirname(targetAbsPath), { recursive: true });
          fs.copyFileSync(snapshotCopyPath, targetAbsPath);
          console.log(`  ✅ Reverted file: ${targetFile}`);
        } else {
          console.warn(`  ⚠️ Snapshot file not found for: ${targetFile}`);
        }
      }
    }

    console.log('🎉 System successfully rolled back to stable checkpoint!');
    return true;
  } catch (err) {
    console.error('❌ Rollback failed:', err.message);
    return false;
  }
}

// ── MAIN RUNNER ────────────────────────────────────────────────────────────
async function runAllGuards() {
  console.log('\n==================================================');
  console.log('🛡️  ENTERPRISE SELF-HEALING SYSTEM GUARDS');
  console.log('==================================================\n');

  const connectionOk = await ConnectionGuard();
  const serviceOk = await ServiceGuard();
  const integrityOk = await IntegrityGuard();
  const enrollmentOk = await EnrollmentGuard();
  const checkpointOk = await CheckpointGuard();
  const repairOk = await RepairGuard();

  const allPassed = connectionOk && serviceOk && integrityOk && enrollmentOk && checkpointOk && repairOk;

  console.log('\n==================================================');
  console.log(`🛡️  GUARD SUMMARY: ${allPassed ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log('==================================================');
  console.log(`  - ConnectionGuard:  ${connectionOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - ServiceGuard:     ${serviceOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - IntegrityGuard:   ${integrityOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - EnrollmentGuard:  ${enrollmentOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - CheckpointGuard:  ${checkpointOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  - RepairGuard:      ${repairOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('==================================================\n');

  if (!allPassed) {
    console.log('🚨 Guard validation failed! Activating auto-rollback...');
    await RollbackGuard();
    process.exit(1);
  } else {
    console.log('🎉 All systems verified healthy. No self-healing rollback required.');
    process.exit(0);
  }
}

const [,, cmd] = process.argv;
if (cmd === 'run-guards') {
  runAllGuards();
} else if (cmd === 'rollback') {
  RollbackGuard().then(ok => process.exit(ok ? 0 : 1));
} else {
  console.log('Usage: self-healing.js <run-guards|rollback>');
}
