# BACKUP_REPORT.md
**Generated:** 2026-06-14  
**Purpose:** Database backup strategy and validation procedures  
**Status:** PLAN READY - Awaiting execution before Phase 1

---

## BACKUP STRATEGY

### Pre-Migration Backup Requirements

**MANDATORY:** Before executing any database migration or schema change:

1. ✅ Create full database backup
2. ✅ Verify backup integrity
3. ✅ Test restore on temporary database
4. ✅ Document backup timestamp and size
5. ✅ Validate restore result matches source

---

## BACKUP EXECUTION PLAN

### Step 1: Create Full Database Backup

**Command:**
```bash
pg_dump -h localhost -U postgres -d attendance_db > backup_attendance_$(date +%Y%m%d_%H%M%S).sql
```

**Expected Output:**
- SQL dump file containing all tables, views, indexes, constraints
- File size: ~5-50MB (depending on data volume)
- Filename format: `backup_attendance_20260614_235959.sql`

**Validation Checklist:**
- [ ] Backup file created
- [ ] File size > 1MB (contains data)
- [ ] File is readable
- [ ] SQL syntax valid

---

### Step 2: Verify Table Counts

**Pre-Backup Count Query:**
```sql
SELECT 
  'employees' as table_name, COUNT(*) as row_count FROM employees
UNION ALL
SELECT 'attendance_records', COUNT(*) FROM attendance_records
UNION ALL
SELECT 'leave_requests', COUNT(*) FROM leave_requests
UNION ALL
SELECT 'work_reports', COUNT(*) FROM work_reports
UNION ALL
SELECT 'login_logs', COUNT(*) FROM login_logs
UNION ALL
SELECT 'security_events', COUNT(*) FROM security_events
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL
SELECT 'office_locations', COUNT(*) FROM office_locations
UNION ALL
SELECT 'work_timings', COUNT(*) FROM work_timings
UNION ALL
SELECT 'leave_policy', COUNT(*) FROM leave_policy
UNION ALL
SELECT 'leave_balance', COUNT(*) FROM leave_balance
UNION ALL
SELECT 'supervisor_assignments', COUNT(*) FROM supervisor_assignments
UNION ALL
SELECT 'refresh_tokens', COUNT(*) FROM refresh_tokens
UNION ALL
SELECT 'department_config', COUNT(*) FROM department_config;
```

**Record Counts:**
[TO BE FILLED DURING BACKUP EXECUTION]

---

### Step 3: Test Restore Procedure

**Create Temporary Database:**
```bash
createdb attendance_db_restore_test
```

**Restore Backup:**
```bash
psql -h localhost -U postgres -d attendance_db_restore_test < backup_attendance_20260614_235959.sql
```

**Verify Restore Integrity:**
```sql
-- Run same count query on restored database
-- Compare row counts - must match exactly
-- Check primary keys are intact
-- Check constraints exist
```

**Validation Checklist:**
- [ ] Temporary database created successfully
- [ ] Restore completed without errors
- [ ] All row counts match source database
- [ ] All indexes exist
- [ ] All constraints intact
- [ ] No warnings during restore

---

### Step 4: Document Backup Metadata

**Backup Manifest:**
```json
{
  "backup_timestamp": "2026-06-14T00:00:00Z",
  "backup_file": "backup_attendance_20260614_000000.sql",
  "backup_size_bytes": 0,
  "database_name": "attendance_db",
  "postgresql_version": "14.0",
  "backup_tool": "pg_dump",
  "compression": "none",
  "tables_backed_up": 17,
  "validation_status": "PENDING",
  "restore_tested": false,
  "restore_timestamp": null,
  "restore_status": null
}
```

---

### Step 5: Store Backup Securely

**Backup Locations:**

1. **Primary Storage (Hot):**
   - Location: `/backups/database/` (local server)
   - Retention: 30 days
   - Access: Database admin only
   - Frequency: Daily

2. **Archive Storage (Cold):**
   - Location: Cloud storage (AWS S3, Azure, GCP)
   - Retention: 90 days
   - Encryption: AES-256
   - Access: Restricted

3. **Repository (Reference):**
   - Keep one backup in project repo for testing
   - Filename: `backup_baseline_prod.sql` (anonymized)
   - Retention: Until next major release

---

## CRITICAL TABLES FOR PRESERVATION

### Immutable Tables (Must Never Be Hard-Deleted)

These tables require soft-delete pattern with `deleted_at` column:

```sql
-- attendance_records: Historical attendance data
ALTER TABLE attendance_records
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- leave_requests: Historical leave data
ALTER TABLE leave_requests
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- security_events: Historical security events
ALTER TABLE security_events
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- login_logs: Historical login data
ALTER TABLE login_logs
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- audit_logs: Historical audit data
ALTER TABLE audit_logs
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- work_reports: Historical work reports
ALTER TABLE work_reports
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
```

---

## MIGRATION SAFETY CHECKLIST

Before executing any migration:

- [ ] Current backup taken
- [ ] Backup integrity verified
- [ ] Restore test successful
- [ ] Rollback plan documented
- [ ] Change log entry created
- [ ] All dependent APIs checked
- [ ] Data migration script tested
- [ ] Rollback script prepared
- [ ] Team notified
- [ ] Maintenance window scheduled

After executing migration:

- [ ] Verify no errors in logs
- [ ] Check all tables accessible
- [ ] Verify row counts unchanged
- [ ] Run sanity queries
- [ ] Test API endpoints
- [ ] Monitor for errors
- [ ] Update CHANGELOG.md
- [ ] Archive backup to cold storage

---

## ROLLBACK PROCEDURE

If migration fails:

1. **Stop Application:**
   ```bash
   # Stop backend
   # Stop frontend
   # Prevent new connections
   ```

2. **Drop New Database:**
   ```sql
   DROP DATABASE attendance_db;
   ```

3. **Restore from Backup:**
   ```bash
   createdb attendance_db
   psql -h localhost -U postgres -d attendance_db < backup_attendance_20260614_235959.sql
   ```

4. **Verify Restore:**
   ```sql
   SELECT COUNT(*) FROM employees;
   SELECT COUNT(*) FROM attendance_records;
   -- etc for all tables
   ```

5. **Restart Application:**
   ```bash
   # Restart backend
   # Restart frontend
   ```

6. **Validate:**
   - Test login
   - Test check-in
   - Check logs for errors
   - Verify data integrity

---

## DISASTER RECOVERY PLAN

### Complete System Failure

**Recovery Checklist:**

1. **Database Recovery:**
   - [ ] Retrieve backup from cold storage
   - [ ] Download to recovery server
   - [ ] Verify backup integrity (checksums)
   - [ ] Create new database instance
   - [ ] Restore from backup
   - [ ] Verify all tables present
   - [ ] Run integrity checks

2. **Configuration Recovery:**
   - [ ] Restore .env files from secure storage
   - [ ] Restore database credentials
   - [ ] Restore API keys/secrets
   - [ ] Restore SSL certificates

3. **Application Recovery:**
   - [ ] Deploy application from version control
   - [ ] Install dependencies
   - [ ] Run migrations (if needed)
   - [ ] Start services
   - [ ] Verify health checks pass

4. **Data Validation:**
   - [ ] Verify employee counts match
   - [ ] Verify attendance records present
   - [ ] Verify leave requests intact
   - [ ] Verify audit logs present
   - [ ] Run spot checks on random records

---

## BACKUP VALIDATION CHECKLIST

**Pre-Migration:**
- [ ] Full backup created
- [ ] Backup file size > 1MB
- [ ] Backup integrity verified
- [ ] Restore test completed
- [ ] All row counts match
- [ ] All constraints intact
- [ ] Backup timestamped
- [ ] Backup documented
- [ ] Access credentials stored securely

**Periodic (Monthly):**
- [ ] Backup retrieval test (restore from cold storage)
- [ ] Backup integrity scan
- [ ] Documentation review
- [ ] Access credential rotation

---

## DATA RETENTION POLICY

| Data Type | Retention | Immutable | Backup Frequency |
|-----------|-----------|-----------|------------------|
| Employees | Permanent | Yes (soft-delete) | Daily |
| Attendance | Permanent | Yes (soft-delete) | Daily |
| Leave Requests | Permanent | Yes (soft-delete) | Daily |
| Security Events | 1 Year | Yes (soft-delete) | Daily |
| Login Logs | 90 Days | Yes (soft-delete) | Daily |
| Audit Logs | Permanent | Yes (soft-delete) | Daily |
| Work Reports | Permanent | Yes (soft-delete) | Daily |
| Notifications | 30 Days | No (can delete) | Weekly |
| Refresh Tokens | 7 Days | No (can revoke) | Daily |

---

## BACKUP EXECUTION LOG

[TO BE FILLED DURING EXECUTION]

```
Backup Attempt #1
==================
Date: [timestamp]
Command: pg_dump -h localhost -U postgres -d attendance_db > backup_attendance_20260614_235959.sql
Status: [PENDING/SUCCESS/FAILED]
File Size: [bytes]
Row Counts: [employee:X, attendance:Y, leave:Z, ...]
Restore Test: [PENDING/PASSED/FAILED]
Notes: [any issues encountered]
```

---

## SIGN-OFF CHECKLIST

**Before Phase 1 can begin:**

- [ ] Backup created: _______________
- [ ] Integrity verified: _______________
- [ ] Restore tested: _______________
- [ ] Documentation complete: _______________
- [ ] Team approved: _______________
- [ ] Go/No-Go decision: _______________

**Authorized by:**
- Name: _________________
- Title: _________________
- Date: _________________
- Signature: _________________
