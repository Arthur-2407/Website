# Enterprise Attendance System - API Documentation

## Admin Management API (`/api/admin`)

All endpoints require:
- **Authentication:** JWT token in `Authorization: Bearer <token>` header
- **Authorization:** `admin` role only
- **Rate Limit:** 100 requests per 10 minutes

### Employee Management

#### List Employees
```
GET /api/admin/employees
Query Parameters:
  - page: number (default: 1)
  - limit: number (default: 20, max: 100)
  - role: "admin" | "supervisor" | "employee" (optional)
  - search: string (search by name/email, optional)
  - department: string (optional)

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": 1,
      "employee_id": "EMP001",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@company.com",
      "role": "employee",
      "department": "Engineering",
      "supervisor_id": 2,
      "is_active": true,
      "metadata": {},
      "created_at": "2026-01-15T08:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

#### Create Employee
```
POST /api/admin/employees
Content-Type: application/json

Request Body:
{
  "employee_id": "EMP123",
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@company.com",
  "password": "SecurePassword123!",
  "role": "employee",           // "admin", "supervisor", "employee"
  "department": "Marketing",
  "supervisor_id": 2,           // (optional)
  "office_location_id": 1,      // (optional)
  "metadata": {}                // (optional)
}

Response: 201 Created
{
  "success": true,
  "data": {
    "id": 151,
    "employee_id": "EMP123",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@company.com",
    "role": "employee",
    "department": "Marketing",
    "is_active": true
  }
}

Errors:
- 400: Validation failed (missing required fields, invalid email format)
- 409: Employee ID already exists
```

#### Update Employee
```
PUT /api/admin/employees/:employeeId
Content-Type: application/json

Request Body:
{
  "first_name": "Jane",
  "last_name": "Johnson",
  "email": "jane.johnson@company.com",
  "role": "supervisor",
  "department": "Engineering",
  "supervisor_id": 3,
  "is_active": true
}

Response: 200 OK
{
  "success": true,
  "data": { /* updated employee object */ }
}
```

#### Deactivate Employee
```
DELETE /api/admin/employees/:employeeId

Response: 200 OK
{
  "success": true,
  "message": "Employee deactivated"
}

Note: Soft-delete - data preserved in database
```

### Supervisor Assignment

#### Assign Employees to Supervisor
```
POST /api/admin/supervisors/:supervisorId/assign-employees
Content-Type: application/json

Request Body:
{
  "employee_ids": [1, 2, 3, 5]
}

Response: 200 OK
{
  "success": true,
  "data": {
    "supervisor_id": 10,
    "assigned_count": 4,
    "assignments": [
      {
        "employee_id": 1,
        "supervisor_id": 10,
        "is_active": true,
        "assigned_at": "2026-01-20T10:30:00Z"
      }
    ]
  }
}
```

#### Get Supervisor's Assigned Employees
```
GET /api/admin/supervisors/:supervisorId/employees
Query Parameters:
  - page: number (default: 1)
  - limit: number (default: 20, max: 100)
  - include_inactive: boolean (default: false)

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "employee_id": "EMP001",
      "first_name": "John",
      "last_name": "Doe",
      "department": "Engineering",
      "assigned_at": "2026-01-15T08:00:00Z",
      "is_active": true
    }
  ],
  "pagination": { /* ... */ }
}
```

#### Remove Employee from Supervisor
```
DELETE /api/admin/supervisors/:supervisorId/employees/:employeeId

Response: 200 OK
{
  "success": true,
  "message": "Employee removed from supervisor"
}
```

### Department Management

#### List Departments
```
GET /api/admin/departments
Query Parameters:
  - page: number (default: 1)
  - limit: number (default: 20, max: 100)

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Engineering",
      "description": "Software Engineering Department",
      "head_employee_id": 5,
      "is_active": true,
      "created_at": "2025-06-01T00:00:00Z"
    }
  ],
  "pagination": { /* ... */ }
}
```

#### Create Department
```
POST /api/admin/departments
Content-Type: application/json

Request Body:
{
  "name": "Sales",
  "description": "Sales and Business Development",
  "head_employee_id": 12   // (optional)
}

Response: 201 Created
{
  "success": true,
  "data": { /* new department */ }
}
```

### Work Timings Configuration

#### List Work Timings
```
GET /api/admin/work-timings
Query Parameters:
  - department_id: number (optional)
  - location_id: number (optional)
  - employee_id: number (optional)

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": 1,
      "department_id": 2,
      "location_id": null,
      "employee_id": null,
      "work_start_time": "09:00",
      "work_end_time": "18:00",
      "lunch_start_time": "12:00",
      "lunch_end_time": "13:00",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

#### Configure Work Timings
```
POST /api/admin/work-timings
Content-Type: application/json

Request Body:
{
  "department_id": 2,          // (optional)
  "location_id": 1,            // (optional)
  "employee_id": null,         // (optional)
  "work_start_time": "09:00",  // HH:mm format
  "work_end_time": "18:00",
  "lunch_start_time": "12:00",
  "lunch_end_time": "13:00"
}

Response: 201 Created
{
  "success": true,
  "data": { /* new work timing */ }
}
```

---

## Location Management API (`/api/locations`)

### List Locations
```
GET /api/locations

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Head Office",
      "address": "123 Main St, City, State",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "geofence_radius": 100,  // meters
      "work_start_time": "09:00",
      "work_end_time": "18:00",
      "lunch_start_time": "12:00",
      "lunch_end_time": "13:00",
      "is_active": true,
      "created_at": "2025-06-01T00:00:00Z"
    }
  ]
}
```

### Get Location Details
```
GET /api/locations/:locationId

Response: 200 OK
{
  "success": true,
  "data": { /* location object */ }
}
```

### Create Location (Admin Only)
```
POST /api/locations
Content-Type: application/json
Authorization: Bearer <token>

Request Body:
{
  "name": "Regional Office",
  "address": "456 Oak Ave, City, State",
  "latitude": 40.7580,
  "longitude": -73.9855,
  "geofence_radius": 100,
  "work_start_time": "08:30",
  "work_end_time": "17:30",
  "lunch_start_time": "12:00",
  "lunch_end_time": "13:00"
}

Response: 201 Created
{
  "success": true,
  "data": { /* new location */ }
}
```

### Update Location (Admin Only)
```
PUT /api/locations/:locationId
Content-Type: application/json
Authorization: Bearer <token>

Request Body:
{
  "name": "Regional Office - Updated",
  "geofence_radius": 150,
  "work_end_time": "18:00"
  // ... other fields to update
}

Response: 200 OK
{
  "success": true,
  "data": { /* updated location */ }
}
```

### Delete Location (Admin Only)
```
DELETE /api/locations/:locationId
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "message": "Location deleted"
}

Note: Soft-delete operation
```

### Get Location Work Hours
```
GET /api/locations/:locationId/work-hours

Response: 200 OK
{
  "success": true,
  "data": {
    "location_id": 1,
    "work_start_time": "09:00",
    "work_end_time": "18:00",
    "lunch_start_time": "12:00",
    "lunch_end_time": "13:00",
    "timezone": "UTC"
  }
}
```

---

## Authentication API (`/api/auth`)

### Login
```
POST /api/auth/login
Content-Type: application/json

Request Body:
{
  "username": "EMP001",
  "password": "UserPassword123!"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "user": {
      "id": 1,
      "employee_id": "EMP001",
      "first_name": "John",
      "last_name": "Doe",
      "role": "employee",
      "email": "john@company.com"
    }
  }
}
```

### Refresh Token
```
POST /api/auth/refresh
Content-Type: application/json

Request Body:
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}

Response: 200 OK
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 3600
  }
}
```

### Logout
```
POST /api/auth/logout
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Attendance API (`/api/attendance`)

### Check In
```
POST /api/attendance/check-in
Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "location_id": 1,
  "device_id": "device-uuid-12345"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "id": 1,
    "employee_id": 5,
    "check_in_time": "2026-01-20T09:15:30Z",
    "location_id": 1,
    "latitude": 40.7128,
    "longitude": -74.0060
  }
}
```

### Check Out
```
POST /api/attendance/check-out
Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "location_id": 1,
  "device_id": "device-uuid-12345"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "id": 1,
    "employee_id": 5,
    "check_out_time": "2026-01-20T17:45:00Z",
    "duration_minutes": 510,
    "location_id": 1
  }
}
```

### Get Attendance History
```
GET /api/attendance/history
Authorization: Bearer <token>
Query Parameters:
  - start_date: ISO date (optional)
  - end_date: ISO date (optional)
  - employee_id: number (optional, admin/supervisor only)
  - page: number (default: 1)
  - limit: number (default: 50, max: 200)

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": 1,
      "employee_id": 5,
      "check_in_time": "2026-01-20T09:15:30Z",
      "check_out_time": "2026-01-20T17:45:00Z",
      "duration_minutes": 510,
      "location_id": 1
    }
  ],
  "pagination": { /* ... */ }
}
```

---

## Leave Management API (`/api/leave`)

### Request Leave
```
POST /api/leave/request
Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "leave_type": "vacation",    // "vacation", "sick", "personal", etc.
  "start_date": "2026-02-01",
  "end_date": "2026-02-05",
  "reason": "Family vacation",
  "documents": []              // (optional)
}

Response: 201 Created
{
  "success": true,
  "data": {
    "id": 1,
    "employee_id": 5,
    "leave_type": "vacation",
    "start_date": "2026-02-01",
    "end_date": "2026-02-05",
    "status": "pending",
    "created_at": "2026-01-20T10:00:00Z"
  }
}
```

### Get Leave Requests (Employee)
```
GET /api/leave/my-requests
Authorization: Bearer <token>
Query Parameters:
  - status: "pending|approved|rejected" (optional)
  - page: number (default: 1)
  - limit: number (default: 50)

Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": 1,
      "leave_type": "vacation",
      "start_date": "2026-02-01",
      "end_date": "2026-02-05",
      "status": "pending",
      "reason": "Family vacation"
    }
  ],
  "pagination": { /* ... */ }
}
```

### Approve Leave (Supervisor/Admin)
```
PUT /api/leave/request/:id/approve
Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "notes": "Approved - coverage arranged"  // (optional)
}

Response: 200 OK
{
  "success": true,
  "data": {
    "id": 1,
    "status": "approved",
    "approved_by": 2,
    "approval_date": "2026-01-20T11:00:00Z",
    "approval_notes": "Approved - coverage arranged"
  }
}

Audit Log Entry:
{
  "action": "leave.request.approve",
  "actor_id": 2,
  "resource_id": "1",
  "details": {
    "leave_type": "vacation",
    "employee_id": 5,
    "approved_by_role": "supervisor"
  }
}
```

### Reject Leave (Supervisor/Admin)
```
PUT /api/leave/request/:id/reject
Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "reason": "Critical project timeline - coverage not available"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "id": 1,
    "status": "rejected",
    "approved_by": 2,
    "approval_date": "2026-01-20T11:15:00Z",
    "rejection_reason": "Critical project timeline - coverage not available"
  }
}

Audit Log Entry:
{
  "action": "leave.request.reject",
  "actor_id": 2,
  "resource_id": "1",
  "details": {
    "rejection_reason": "Critical project timeline - coverage not available",
    "rejected_by_role": "supervisor"
  }
}
```

---

## Security & Error Handling

### Authentication Errors
```
401 Unauthorized
{
  "error": "Invalid or expired token",
  "code": "UNAUTHORIZED"
}
```

### Authorization Errors
```
403 Forbidden
{
  "error": "Insufficient permissions",
  "code": "FORBIDDEN"
}
```

### Validation Errors
```
400 Bad Request
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "email",
    "message": "Invalid email format"
  }
}
```

### Server Errors
```
500 Internal Server Error
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR",
  "requestId": "req-12345-uuid"
}
```

---

## Rate Limiting

All API endpoints are rate limited:
- **Default:** 100 requests per 10 minutes per user
- **Auth Endpoints:** 5 login attempts per 15 minutes per IP
- **Admin Endpoints:** 200 requests per 10 minutes

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1642674900
```

---

## Best Practices

1. **Always include JWT token** in Authorization header
2. **Validate response status** before accessing data
3. **Handle token refresh** when access token expires
4. **Use pagination** for list endpoints
5. **Cache responses** appropriately (5-15 minutes for non-sensitive data)
6. **Log all API errors** for debugging
7. **Use appropriate HTTP methods** (GET for reads, POST for creates, PUT for updates, DELETE for deletes)
8. **Include relevant query parameters** to filter results server-side

---

**API Version:** 1.0.0  
**Last Updated:** 2026-01-20  
**Status:** Production Ready ✅
