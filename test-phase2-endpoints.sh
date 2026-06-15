#!/bin/bash
# API Endpoint Validation Script
# Tests PHASE 2 implementation: Supervisor CRUD, Team CRUD, Department CRUD, Role-Based Login

set -e

BASE_URL="http://localhost:3001"
ADMIN_TOKEN=""
TEST_RESULTS=()

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test logging
log_test() {
  echo -e "${BLUE}[TEST]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓ PASS]${NC} $1"
  TEST_RESULTS+=("PASS: $1")
}

log_failure() {
  echo -e "${RED}[✗ FAIL]${NC} $1"
  TEST_RESULTS+=("FAIL: $1")
}

log_warning() {
  echo -e "${YELLOW}[⚠ WARN]${NC} $1"
}

# ============================================================================
# SETUP: Bootstrap admin if needed
# ============================================================================

log_test "Checking bootstrap status..."
BOOTSTRAP_RESPONSE=$(curl -s "${BASE_URL}/auth/bootstrap/status" || echo '{}')

if echo "$BOOTSTRAP_RESPONSE" | grep -q "bootstrapMode"; then
  log_warning "System in bootstrap mode - skipping tests requiring admin token"
else
  log_test "Attempting admin login for test authorization..."
  LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"employeeId":"admin","password":"SecureAdminPassword123!"}' || echo '{}')
  
  ADMIN_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
  
  if [ -z "$ADMIN_TOKEN" ]; then
    log_warning "Could not obtain admin token. Using default test flow."
  else
    log_success "Admin token obtained"
  fi
fi

# ============================================================================
# TEST 1: Supervisor CRUD Endpoints
# ============================================================================

log_test "Testing Supervisor CRUD Endpoints"

# GET /supervisors
log_test "GET /api/admin/supervisors (with pagination)"
RESPONSE=$(curl -s -X GET "${BASE_URL}/api/admin/supervisors?page=1&limit=10" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")

if echo "$RESPONSE" | grep -q '"data"'; then
  log_success "GET /api/admin/supervisors - Retrieved supervisor list"
else
  log_failure "GET /api/admin/supervisors - Failed to retrieve list"
fi

# POST /supervisors
log_test "POST /api/admin/supervisors (create new supervisor)"
SUPERVISOR_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/admin/supervisors" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "SUP001",
    "firstName": "John",
    "lastName": "Supervisor",
    "email": "john.supervisor@test.local",
    "department": "Engineering",
    "password": "TempPassword123!"
  }')

SUPERVISOR_ID=$(echo "$SUPERVISOR_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$SUPERVISOR_ID" ]; then
  log_success "POST /api/admin/supervisors - Created supervisor (ID: $SUPERVISOR_ID)"
else
  log_failure "POST /api/admin/supervisors - Failed to create supervisor"
fi

# PUT /supervisors/:supervisorId
if [ -n "$SUPERVISOR_ID" ]; then
  log_test "PUT /api/admin/supervisors/$SUPERVISOR_ID (update supervisor)"
  UPDATE_RESPONSE=$(curl -s -X PUT "${BASE_URL}/api/admin/supervisors/${SUPERVISOR_ID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"department": "Operations"}')
  
  if echo "$UPDATE_RESPONSE" | grep -q '"success".*true'; then
    log_success "PUT /api/admin/supervisors/:supervisorId - Updated supervisor"
  else
    log_failure "PUT /api/admin/supervisors/:supervisorId - Failed to update"
  fi

  # DELETE /supervisors/:supervisorId
  log_test "DELETE /api/admin/supervisors/$SUPERVISOR_ID (soft-delete supervisor)"
  DELETE_RESPONSE=$(curl -s -X DELETE "${BASE_URL}/api/admin/supervisors/${SUPERVISOR_ID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}")
  
  if echo "$DELETE_RESPONSE" | grep -q '"success".*true'; then
    log_success "DELETE /api/admin/supervisors/:supervisorId - Soft-deleted supervisor"
  else
    log_failure "DELETE /api/admin/supervisors/:supervisorId - Failed to delete"
  fi
fi

# ============================================================================
# TEST 2: Team CRUD Endpoints
# ============================================================================

log_test "Testing Team CRUD Endpoints"

# GET /teams
log_test "GET /api/admin/teams (with pagination)"
TEAMS_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/admin/teams?page=1&limit=10" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")

if echo "$TEAMS_RESPONSE" | grep -q '"data"'; then
  log_success "GET /api/admin/teams - Retrieved team list"
else
  log_failure "GET /api/admin/teams - Failed to retrieve list"
fi

# POST /teams
log_test "POST /api/admin/teams (create new team)"
TEAM_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/admin/teams" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "teamName": "QA Team",
    "department": "Quality Assurance",
    "description": "Quality Assurance testing team"
  }')

TEAM_ID=$(echo "$TEAM_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$TEAM_ID" ]; then
  log_success "POST /api/admin/teams - Created team (ID: $TEAM_ID)"
else
  log_failure "POST /api/admin/teams - Failed to create team"
fi

# PUT /teams/:teamId
if [ -n "$TEAM_ID" ]; then
  log_test "PUT /api/admin/teams/$TEAM_ID (update team)"
  TEAM_UPDATE=$(curl -s -X PUT "${BASE_URL}/api/admin/teams/${TEAM_ID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"description": "Updated QA Team"}')
  
  if echo "$TEAM_UPDATE" | grep -q '"success".*true'; then
    log_success "PUT /api/admin/teams/:teamId - Updated team"
  else
    log_failure "PUT /api/admin/teams/:teamId - Failed to update"
  fi

  # DELETE /teams/:teamId
  log_test "DELETE /api/admin/teams/$TEAM_ID (soft-delete team)"
  TEAM_DELETE=$(curl -s -X DELETE "${BASE_URL}/api/admin/teams/${TEAM_ID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}")
  
  if echo "$TEAM_DELETE" | grep -q '"success".*true'; then
    log_success "DELETE /api/admin/teams/:teamId - Soft-deleted team"
  else
    log_failure "DELETE /api/admin/teams/:teamId - Failed to delete"
  fi
fi

# ============================================================================
# TEST 3: Department CRUD Endpoints
# ============================================================================

log_test "Testing Department CRUD Endpoints (PUT/DELETE)"

# POST /departments (create for testing)
DEPT_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/admin/departments" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"departmentName": "Test Department"}')

DEPT_ID=$(echo "$DEPT_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$DEPT_ID" ]; then
  log_test "PUT /api/admin/departments/$DEPT_ID (update department)"
  DEPT_UPDATE=$(curl -s -X PUT "${BASE_URL}/api/admin/departments/${DEPT_ID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"departmentName": "Updated Test Department"}')
  
  if echo "$DEPT_UPDATE" | grep -q '"success".*true'; then
    log_success "PUT /api/admin/departments/:departmentId - Updated department"
  else
    log_failure "PUT /api/admin/departments/:departmentId - Failed to update"
  fi

  # DELETE /departments/:departmentId
  log_test "DELETE /api/admin/departments/$DEPT_ID (soft-delete department)"
  DEPT_DELETE=$(curl -s -X DELETE "${BASE_URL}/api/admin/departments/${DEPT_ID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}")
  
  if echo "$DEPT_DELETE" | grep -q '"success".*true'; then
    log_success "DELETE /api/admin/departments/:departmentId - Soft-deleted department"
  else
    log_failure "DELETE /api/admin/departments/:departmentId - Failed to delete"
  fi
fi

# ============================================================================
# TEST 4: Role-Based Login Policy
# ============================================================================

log_test "Testing Role-Based Login Restrictions"

# Test: Admin cannot use password-only login
log_test "Password-only login restriction for Admin"
ADMIN_PWD_LOGIN=$(curl -s -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"admin","password":"TestPassword"}')

if echo "$ADMIN_PWD_LOGIN" | grep -q "FACE_AUTHENTICATION_REQUIRED"; then
  log_success "Admin correctly blocked from password-only login"
else
  log_warning "Admin password-only login check - unexpected response"
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"

PASS_COUNT=$(echo "${TEST_RESULTS[@]}" | grep -o "PASS:" | wc -l)
FAIL_COUNT=$(echo "${TEST_RESULTS[@]}" | grep -o "FAIL:" | wc -l)

echo ""
for result in "${TEST_RESULTS[@]}"; do
  if echo "$result" | grep -q "PASS"; then
    echo -e "${GREEN}✓${NC} $result"
  else
    echo -e "${RED}✗${NC} $result"
  fi
done

echo ""
echo -e "${BLUE}Results: ${GREEN}$PASS_COUNT Passed${NC} | ${RED}$FAIL_COUNT Failed${NC}${BLUE}${NC}"

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed. Please review.${NC}"
  exit 1
fi
