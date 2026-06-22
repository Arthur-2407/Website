![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Docker](https://img.shields.io/badge/docker-supported-blue)
![Node.js](https://img.shields.io/badge/node.js-supported-green)

# Enterprise Employee Attendance & Face Recognition System

An enterprise-grade Employee Attendance Management System featuring biometric face recognition, role-based access control, leave management, real-time notifications, workforce analytics, geofencing, and secure authentication workflows.

---

## Overview

This platform provides a complete workforce attendance solution built using a modern microservice architecture.

The system combines:

* Traditional authentication
* Face recognition login
* Attendance tracking
* Leave management
* Reporting & analytics
* Security monitoring
* Geofencing
* Real-time notifications

The project is designed for enterprise environments requiring scalability, security, reliability, and auditability.

---

## Architecture

```text
┌─────────────────────┐
│     Frontend        │
│ React + TypeScript  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    Backend API      │
│ Node.js + Express   │
└───────┬─────┬───────┘
        │     │
        │     ▼
        │ Redis Cache
        │
        ▼
┌─────────────────────┐
│ Face AI Service     │
│ Face Recognition    │
│ Liveness Detection  │
└──────────┬──────────┘
           │
           ▼
 Face Database

           +

 Main PostgreSQL Database
```

---

## Core Features

### Authentication

* JWT Authentication
* Face Recognition Login
* Multi-Factor Authentication (MFA)
* Password-Based Login
* Role-Based Access Control (RBAC)

### Attendance Management

* Employee Check-In
* Employee Check-Out
* Attendance History
* Attendance Analytics
* Real-Time Attendance Updates

### Face Recognition

* Face Enrollment
* Face Verification
* Face Login
* Anti-Spoofing Support
* Liveness Detection
* Face Embedding Management

### Workforce Management

* Leave Requests
* Leave Approval Workflow
* Work Reports
* Employee Tracking
* Supervisor Dashboard

### Reporting & Analytics

* Attendance Reports
* Employee Statistics
* Dashboard Analytics
* Export Functionality
* Excel Report Generation

### Security

* Rate Limiting
* Security Monitoring
* Audit Logging
* JWT Security
* Helmet Security Headers
* Request Validation

### Enterprise Operations

* Telemetry Collection
* Distributed Tracing
* Health Monitoring
* Circuit Breakers
* Degraded Mode Support
* WebSocket Notifications

---

## Technology Stack

### Frontend

* React
* TypeScript
* Vite
* React Router
* Zustand
* Recharts
* Framer Motion
* React Webcam

### Backend

* Node.js
* Express.js
* PostgreSQL
* Redis
* Socket.IO
* JWT
* Bcrypt

### AI Service

* Python
* Face Recognition Models
* OpenCV
* Anti-Spoofing Detection
* Liveness Verification

### Infrastructure

* Docker
* Docker Compose
* Nginx
* Kubernetes
* Helm
* Terraform

---

## Repository Structure

```text
.
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
│
├── backend-api/
│   ├── src/
│   ├── migrations/
│   └── package.json
│
├── face-ai-service/
│   ├── models/
│   ├── services/
│   └── requirements.txt
│
├── database/
│   └── init.sql
│
├── nginx/
│
├── deployment/
│
├── k8s/
│
├── helm/
│
├── terraform/
│
└── docker-compose.yml
```

---

## User Roles

### Admin

* Manage users
* System configuration
* Security monitoring
* Face enrollment approval
* Access reports
* Platform administration

### Supervisor

* Team oversight
* Attendance monitoring
* Leave approvals
* Workforce reporting

### Employee

* Attendance check-in/out
* Face login
* Leave requests
* Personal reports
* Profile management

---

## Main Routes

### Public

```text
/login
/face-login
/setup/admin-face
/recovery-request
```

### Protected

```text
/dashboard
/attendance
/leave
/reports
```

### Supervisor

```text
/supervisor
```

### Admin

```text
/admin
/security
/system-status
```

---

## Quick Start

### Clone Repository

```bash
git clone <repository-url>
cd Website
```

### Environment Variables

```bash
cp .env.example .env
```

Configure:

```env
DB_NAME=attendance_system
DB_USER=postgres
DB_PASSWORD=securepassword123

FACE_DB_NAME=attendance_face_system
FACE_DB_USER=face_admin
FACE_DB_PASSWORD=securefacepassword123

REDIS_PASSWORD=redispassword123

JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
```

---

## Docker Deployment

Start all services:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

Stop services:

```bash
docker compose down
```

---

## Services

| Service         | Port |
| --------------- | ---- |
| Frontend        | 3000 |
| Backend API     | 3001 |
| Face AI Service | 8000 |
| PostgreSQL      | 5432 |
| Face PostgreSQL | 5433 |
| Redis           | 6379 |

---

## Health Checks

Backend:

```bash
curl http://localhost:3001/health
```

Face AI:

```bash
curl http://localhost:8000/health
```

---

## Security Features

* JWT Access Tokens
* Refresh Tokens
* MFA Support
* Rate Limiting
* Request Validation
* Secure Headers
* Audit Logging
* Security Monitoring
* Face Verification Controls

---

## Monitoring & Observability

* Application Telemetry
* Request Tracing
* Correlation IDs
* Health Monitoring
* Circuit Breakers
* Alerting Infrastructure
* Service Status Dashboard

---

## Development

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend:

```bash
cd backend-api
npm install
npm run dev
```

Face AI Service:

```bash
cd face-ai-service
pip install -r requirements.txt
python app.py
```

---

## License

This project is licensed under the Apache License, Version 2.0.

You may obtain a copy of the License at:

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the LICENSE file for the specific language governing permissions and limitations under the License.
