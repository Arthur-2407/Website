# Phase 4 — VPS Requirement Analysis

Created: 2026-06-21T00:47:00+05:30

This document evaluates the system requirements for hosting the Enterprise Attendance Platform, with special focus on CPU/RAM demands of deep learning models and database storage.

---

## 1. Resource Footprint Estimation

### Services Breakdown
1. **Face AI Service**:
   - *RAM*: ~1.5 GB to 2 GB (loads TensorFlow-CPU, PyTorch/InceptionResnetV1, MediaPipe FaceMesh).
   - *CPU*: Highly intensive during face verification and liveness checks (image preprocessing, model forwarding, 512-dim vector math).
2. **Databases (Main DB + Face DB)**:
   - *RAM*: ~512 MB to 1 GB (PostgreSQL buffers, pgvector search operations, connections).
   - *Storage*: Grows dynamically based on enrolled users. The `user_images` table stores raw base64 image data.
3. **Backend API (`backend-api`) & Redis**:
   - *RAM*: ~256 MB (Express Node instance, rate limiters, token caches).
4. **Nginx Reverse Proxy & Frontend**:
   - *RAM*: ~100 MB (Static HTML serving, request routing).

---

## 2. Bandwidth & Network Estimation
- **Payload Size**: Face authentication uploads 10–20 webcam frames in base64.
- **Data per Punch**: ~1.5 MB to 3 MB per check-in transaction.
- **Daily Usage Calculation (100 Employees)**:
  - 100 employees × 2 punches/day × 2 MB = 400 MB/day.
  - Monthly Bandwidth needed: ~12 GB to 20 GB minimum.
  - A VPS with at least **1 TB monthly data transfer** is recommended to handle peaks and admin queries.

---

## 3. VPS Tiers & Specifications

### Tier 1: Minimum Specifications (Single Server / Budget Setup)
> [!WARNING]
> Running deep learning models and database instances on a 2GB RAM system is highly discouraged and will lead to Out-Of-Memory (OOM) killer terminations.
- **CPU**: 2 vCPUs (Shared)
- **RAM**: 4 GB DDR4
- **Storage**: 40 GB SSD (General Purpose)
- **Network**: 1 Gbps port, 1 TB transfer/month
- **Usage**: Non-critical production or staging setups.

### Tier 2: Recommended Specifications (Single Server / Production Standard)
- **CPU**: 4 vCPUs (Dedicated / Compute-optimized)
- **RAM**: 8 GB DDR4/DDR5
- **Storage**: 80 GB NVMe SSD
- **Network**: 1 Gbps port, 2 TB+ transfer/month
- **Usage**: Standard enterprise production (up to 500 active employees).

### Tier 3: High Availability Specifications (Multi-Server / Scaled Cluster)
For large enterprises requiring zero downtime:
- **Application Server (Vite + Node API + Face AI)**:
  - 2× Load-balanced Node instances: 4 vCPUs, 8 GB RAM each.
- **Database Server (Replicated PostgreSQL)**:
  - Dedicated DB instances: 4 vCPUs, 16 GB RAM, 200 GB SSD in RAID.
- **Object Storage (AWS S3 / MinIO)**:
  - For storing raw photo binaries external to PostgreSQL tables.
