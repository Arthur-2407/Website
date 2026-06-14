# Enterprise Attendance System - Monitoring Report

**Generated:** 13/6/2026, 10:35:09 pm  
**Monitoring Duration:** 5.0 minutes  
**Total Health Checks:** 188  

---

## 🎯 Executive Summary

### Overall System Status: ✅ **OPERATIONAL**

| Metric | Value |
|--------|-------|
| Services Healthy | 4/4 |
| Total Errors | 376 |
| Average Response Time | 6.88ms |
| Uptime Percentage | 100% |

---

## 🐳 Container Status

```
• attendance-db: running (Up 9 minutes (healthy))
• attendance-frontend: running (Up 9 minutes)
• attendance-nginx: running (Up 9 minutes (unhealthy))
• attendance-redis: running (Up 9 minutes (healthy))
• backend-api: running (Up 9 minutes (healthy))
• face-ai-service: running (Up 9 minutes (healthy))
```

---

## 📊 Service Health Report

### ✅ BACKEND
- Uptime: **100.0%** (47/47)
- Last Check: 10:35:08 pm
- Status: ✅ Healthy

### ✅ FRONTEND
- Uptime: **100.0%** (47/47)
- Last Check: 10:35:08 pm
- Status: ✅ Healthy

### ✅ NGINX
- Uptime: **100.0%** (47/47)
- Last Check: 10:35:08 pm
- Status: ✅ Healthy

### ✅ FACEAI
- Uptime: **100.0%** (47/47)
- Last Check: 10:35:08 pm
- Status: ✅ Healthy

---

## 🔗 API Endpoint Performance

| Endpoint | Avg Response Time | Status Code | Checks |
|----------|------------------|------------|--------|
| /health | 12.00ms | 200 | 188 |
| /api/system/status | 3.23ms | 200 | 47 |
| /api/system/features | 3.68ms | 403 | 47 |
| /api/system/permissions | 3.49ms | 403 | 47 |
| /api/reports | 3.21ms | 403 | 47 |
| /api/attendance | 3.40ms | 403 | 47 |
| /api/leave | 3.77ms | 403 | 47 |

### Performance Insights

- **Fastest Endpoint:** /api/reports (2ms)
- **Slowest Endpoint:** /health (45ms)
- **Average Response Time:** 6.88ms

---

## 🚨 Error Analysis

### Total Errors Detected: 376


| Service | Error Type | Count | Severity |
|---------|-----------|-------|----------|
| Backend API | endpoint_error | 235 | Warning |
| backend-api | unknown | 141 | Warning |

### Error Details

```
[10:30:09 pm] Backend API: Unexpected status code
[10:30:09 pm] Backend API: Unexpected status code
[10:30:09 pm] Backend API: Unexpected status code
[10:30:09 pm] Backend API: Unexpected status code
[10:30:09 pm] Backend API: Unexpected status code
[10:30:09 pm] backend-api: {"timestamp":"2026-06-13T16:58:16.156Z","level":"info","service":"backend-api","env":"production","message":"[Trace] GET /api/system/features","traceId":"74515c87981a7abfa67d05fc07f080e0","spanId":"28
[10:30:09 pm] backend-api: {"timestamp":"2026-06-13T16:58:16.160Z","level":"info","service":"backend-api","env":"production","message":"[Trace] GET /api/system/permissions","traceId":"fa18222c514d1e2e35d57435b1cbecdf","spanId":
[10:30:09 pm] backend-api: {"timestamp":"2026-06-13T16:58:16.164Z","level":"info","service":"backend-api","env":"production","message":"[Trace] GET /api/reports","traceId":"77515ffc19e948dc81cd8838637e1960","spanId":"4682e1562b
[10:30:15 pm] Backend API: Unexpected status code
[10:30:15 pm] Backend API: Unexpected status code
[10:30:15 pm] Backend API: Unexpected status code
[10:30:15 pm] Backend API: Unexpected status code
[10:30:15 pm] Backend API: Unexpected status code
[10:30:16 pm] backend-api: {"timestamp":"2026-06-13T16:58:22.395Z","level":"info","service":"backend-api","env":"production","message":"[Trace] GET /api/system/features","traceId":"8e8c0c83a7042a907f7e62085cb28ffb","spanId":"f1
[10:30:16 pm] backend-api: {"timestamp":"2026-06-13T16:58:22.398Z","level":"info","service":"backend-api","env":"production","message":"[Trace] GET /api/system/permissions","traceId":"2e3b2025fcf3fca89b67554c3eb15729","spanId":
[10:30:16 pm] backend-api: {"timestamp":"2026-06-13T16:58:22.402Z","level":"info","service":"backend-api","env":"production","message":"[Trace] GET /api/reports","traceId":"f806d356e734402b6973723e4f8db4f8","spanId":"0836c261fa
[10:30:22 pm] Backend API: Unexpected status code
[10:30:22 pm] Backend API: Unexpected status code
[10:30:22 pm] Backend API: Unexpected status code
[10:30:22 pm] Backend API: Unexpected status code
```


---

## 📈 Performance Metrics

### Response Time Distribution

- **0-100ms:** 470 requests
- **100-200ms:** 0 requests
- **200-500ms:** 0 requests
- **500ms+:** 0 requests

### Service Latency

```
Backend API: Avg 5.34ms (Min: 2ms, Max: 45ms)
Frontend: Avg 7.79ms (Min: 5ms, Max: 12ms)
Nginx Proxy: Avg 14.34ms (Min: 9ms, Max: 20ms)
Face AI Service: Avg 9.28ms (Min: 6ms, Max: 13ms)
```

---

## ✅ System Checklist

- [x] All Services Operational
- [ ] No Critical Errors
- [x] Response Times Acceptable (<200ms)
- [x] All Services >95% Uptime
- [x] All Containers Running

---

## 🎯 Recommendations

1. **Address Errors**: Review and fix the detected errors listed above
2. **Performance Good**: Current response times are acceptable
3. **Reliable**: All services maintaining good uptime

---

## 📋 Monitoring Details

**Monitoring System Version:** 1.0.0  
**Check Interval:** 5000ms  
**Total Checks Performed:** 188  
**Errors Found:** 376  
**Uptime Average:** 100.0%  

**System Ready for:** ✅ Production Testing

---

*This report was automatically generated by the Enterprise Attendance System Monitoring System*
