-- Migration 011 DOWN: Remove account recovery tables

BEGIN;

DROP TABLE IF EXISTS account_recovery_audit_log CASCADE;
DROP TABLE IF EXISTS account_recovery_requests CASCADE;

COMMIT;
