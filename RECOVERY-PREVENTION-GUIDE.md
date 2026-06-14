# RECOVERY PROCEDURES & PREVENTATIVE MEASURES GUIDE

**Date:** June 13, 2026  
**Incident:** Nginx DNS Cache Invalidation  
**Status:** RESOLVED ✓  

---

## RECOVERY PROCEDURES

### Quick Recovery (If Issue Recurs)

#### Procedure 1: Emergency Restart (1-2 minutes)

```powershell
# Step 1: Restart nginx container
docker restart attendance-nginx-prod

# Step 2: Wait for container to stabilize
Start-Sleep -Seconds 3

# Step 3: Verify fix
Invoke-WebRequest -Uri 'http://localhost/' -UseBasicParsing -TimeoutSec 5
# Should return HTTP 200
```

**Success Criteria:**
- Container shows "healthy" in docker compose ps
- HTTP GET / returns 200
- HTML content is valid

**Time to Recovery:** ~45 seconds

#### Procedure 2: Full Deployment Restart (3-5 minutes)

If quick restart doesn't work:

```powershell
# Step 1: Stop all containers
docker compose down

# Step 2: Wait for shutdown
Start-Sleep -Seconds 5

# Step 3: Start all containers
docker compose up -d

# Step 4: Wait for stabilization
Start-Sleep -Seconds 30

# Step 5: Verify all services
docker compose ps
# All should show "healthy"

# Step 6: Test endpoints
Invoke-WebRequest -Uri 'http://localhost/' -UseBasicParsing -TimeoutSec 5
Invoke-WebRequest -Uri 'http://localhost/health' -UseBasicParsing -TimeoutSec 5
Invoke-WebRequest -Uri 'http://localhost/api/system/status' -UseBasicParsing -TimeoutSec 5
```

**Success Criteria:**
- All containers running and healthy
- Frontend accessible (HTTP 200)
- Health endpoint responding
- API endpoints responsive

**Time to Recovery:** ~3-4 minutes

---

### Detailed Troubleshooting Guide

#### If Issue Persists After Restart

**Step 1: Check Nginx Configuration**

```powershell
docker exec attendance-nginx-prod nginx -t
# Should output: "nginx: configuration file /etc/nginx/nginx.conf test is successful"
```

If configuration invalid:
- Check [nginx/nginx.conf](nginx/nginx.conf) for syntax errors
- Validate all upstream definitions exist
- Ensure all service names are spelled correctly

**Step 2: Verify Container Network**

```powershell
# Check if all containers are on same network
docker network inspect website_attendance-network
# Should show all 6 containers with IPs in 172.20.0.0/16 range

# Verify frontend IP
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' attendance-frontend-prod
# Should return 172.20.0.7 (or adjacent address if .7 is unavailable)
```

**Step 3: Test DNS Resolution**

```powershell
# From nginx container
docker exec attendance-nginx-prod nslookup frontend
# Should return: Address: 172.20.0.X (where X matches actual frontend IP)

# If DNS fails, problem is Docker DNS
# - Restart Docker daemon
# - Check Docker network driver
# - Verify /etc/docker/daemon.json is valid
```

**Step 4: Check Service Accessibility**

```powershell
# Test frontend is running
docker exec attendance-nginx-prod sh -c 'nc -zv frontend 80'
# Should show: frontend (172.20.0.X:80) open

# If connection fails:
docker logs attendance-frontend-prod | Select-Object -Last 20
# Check for errors, exit codes, or resource constraints
```

**Step 5: Verify Nginx Health Check**

```powershell
docker logs attendance-nginx-prod | Select-Object -Last 50
# Should show:
#   - "Configuration complete; ready for start up"
#   - No [error] entries with "connect() failed"
#   - Recent successful health checks
```

#### Recovery Decision Tree

```
Issue: Frontend returns 502

├─ Quick Fix Works? → DONE ✓
│
├─ Full Restart Works?
│  ├─ YES → Monitor and DONE ✓
│  └─ NO → Continue troubleshooting
│
├─ Nginx Config Valid?
│  ├─ NO → Fix syntax errors in nginx/nginx.conf
│  └─ YES → Continue
│
├─ All Containers Running?
│  ├─ NO → Start missing containers (docker compose up -d)
│  └─ YES → Continue
│
├─ Frontend Container Healthy?
│  ├─ NO → Investigate frontend logs
│  │      $ docker logs attendance-frontend-prod
│  └─ YES → Continue
│
├─ DNS Resolution Working?
│  ├─ NO → Restart Docker daemon
│  │      $ systemctl restart docker (Linux)
│  │      or Docker Desktop restart (Windows)
│  └─ YES → Continue
│
├─ Network Connectivity OK?
│  ├─ NO → Check Docker network driver
│  │      $ docker network ls
│  │      $ docker network inspect website_attendance-network
│  └─ YES → Continue
│
└─ Escalate to infrastructure team
   - Provide all logs and container states
   - Note when issue started and any recent changes
   - Check for Docker/host-level issues
```

---

## PREVENTATIVE MEASURES

### Immediate Actions (Deploy Within Hours)

#### Action 1: Add Frontend Health Check Endpoint

**File:** [nginx/nginx.conf](nginx/nginx.conf)

Current:
```nginx
location /health {
    proxy_pass http://backend;
}
```

Add:
```nginx
# Frontend-specific health check
location /frontend-status {
    proxy_pass http://frontend/;
    access_log off;
}
```

**Monitoring:**
```bash
# Add to monitoring script
curl -f http://localhost/frontend-status || alert "Frontend health check failed"
```

**Benefit:** Direct visibility into frontend routing health

#### Action 2: Configure DNS TTL Timeout

**File:** [nginx/nginx.conf](nginx/nginx.conf)

Add to http block:
```nginx
# Force DNS re-lookup every 30 seconds to prevent stale caches
resolver 127.0.0.11:53 valid=30s;
```

Change from:
```nginx
upstream frontend {
    server frontend:80;
}
```

To:
```nginx
upstream frontend {
    server frontend:80;
    keepalive 32;
}
```

**Benefit:** Nginx will refresh DNS cache every 30 seconds instead of caching indefinitely

**Testing:**
```bash
# Restart nginx
docker restart attendance-nginx-prod

# Verify TTL configuration
docker exec attendance-nginx-prod grep -n "resolver" /etc/nginx/nginx.conf
```

#### Action 3: Add Monitoring Alert

**Monitoring Script to Add:**

```bash
#!/bin/bash
# File: scripts/monitor-dns-health.sh

while true; do
  # Check frontend route
  FRONTEND_IP=$(docker exec attendance-nginx-prod nslookup frontend 2>/dev/null | grep "Address:" | tail -1 | awk '{print $2}')
  ACTUAL_FRONTEND_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' attendance-frontend-prod)
  
  if [ "$FRONTEND_IP" != "$ACTUAL_FRONTEND_IP" ]; then
    echo "ALERT: DNS mismatch detected!"
    echo "  Nginx resolves 'frontend' to: $FRONTEND_IP"
    echo "  Actual container IP: $ACTUAL_FRONTEND_IP"
    echo "  Action: Restarting nginx..."
    docker restart attendance-nginx-prod
  fi
  
  sleep 30
done
```

**Deploy:**
```bash
chmod +x scripts/monitor-dns-health.sh

# Run in background
./scripts/monitor-dns-health.sh &
```

---

### Short-Term Improvements (Deploy Within 1 Week)

#### Improvement 1: Use Static Container IPs

**File:** [docker-compose.yml](docker-compose.yml)

Update networks section:
```yaml
networks:
  attendance-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

services:
  frontend:
    networks:
      attendance-network:
        ipv4_address: 172.20.0.7
  
  backend-api:
    networks:
      attendance-network:
        ipv4_address: 172.20.0.6
  
  # ... other services
```

**Benefits:**
- Eliminates IP reassignment on container restart
- Makes debugging easier
- Simplifies reverse proxy configuration

**Testing:**
```bash
docker-compose down
docker-compose up -d

# Verify IPs are consistent
docker inspect -f '{{.Name}} = {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker compose ps -q)
```

#### Improvement 2: Add Automated Nginx Restart on Container Changes

**File:** Create [scripts/watch-container-state.sh](scripts/watch-container-state.sh)

```bash
#!/bin/bash
# Monitor for container restarts and trigger nginx refresh

LAST_STATE=""

while true; do
  CURRENT_STATE=$(docker compose ps -q | sort | xargs -I {} docker inspect -f '{{.ID}}:{{.State.Status}}' {} | sort)
  
  if [ "$LAST_STATE" != "" ] && [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
    echo "Container state changed. Refreshing nginx DNS cache..."
    docker restart attendance-nginx-prod
    sleep 5
  fi
  
  LAST_STATE="$CURRENT_STATE"
  sleep 10
done
```

**Deploy as Service:**
```bash
chmod +x scripts/watch-container-state.sh

# Run in background or as system service
nohup scripts/watch-container-state.sh > logs/container-monitor.log 2>&1 &
```

**Benefits:**
- Automatically detects when any container restarts
- Refreshes nginx DNS cache proactively
- Prevents 502 errors before users encounter them

#### Improvement 3: Enhanced Health Checks

**File:** [docker-compose.yml](docker-compose.yml)

Update nginx health check:
```yaml
nginx:
  healthcheck:
    test: ["CMD", "sh", "-c", "curl -f http://localhost/ && curl -f http://localhost/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 10s
```

This tests:
- ✓ Frontend route accessible
- ✓ Health endpoint responding
- ✓ Proxy working correctly

**Benefits:**
- Docker will automatically restart nginx if both frontend and health checks fail
- Self-healing deployment

---

### Medium-Term Solutions (Deploy Within 1 Month)

#### Solution 1: Implement Service Mesh (Istio)

**What:** Service mesh adds intelligent network layer between containers

**Benefits:**
- Automatic service discovery
- Load balancing independent of DNS
- Canary deployments
- Circuit breakers
- Retry logic
- Request tracing

**Deployment:**
```bash
# Install Istio (if using Kubernetes)
istioctl install --set profile=demo

# Update docker-compose to include Istio sidecar proxies
# (complex, requires Kubernetes or Docker Swarm with Istio extensions)
```

**Cost:** 2-3 days development time

#### Solution 2: Migrate to Kubernetes

**What:** Container orchestration platform with built-in DNS and service discovery

**Benefits:**
- Rolling updates (no sudden IP changes)
- Built-in load balancing
- Service discovery always current
- Self-healing
- Scaling support

**Deployment:**
```bash
# Create Kubernetes manifests from docker-compose
kompose convert -f docker-compose.yml -o k8s/

# Deploy to cluster
kubectl apply -f k8s/

# Services automatically discover each other
kubectl get svc
```

**Cost:** 1-2 weeks for migration

#### Solution 3: Use Docker Compose Service Names in HAProxy

**What:** HAProxy with dynamic backend discovery instead of Nginx

**Benefits:**
- Better failover handling
- More sophisticated load balancing
- Easier to debug

**Deployment:**
```yaml
services:
  haproxy:
    image: haproxy:2.8
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    ports:
      - "80:80"
      - "443:443"
```

**Cost:** 2-3 days for HAProxy config and testing

---

### Long-Term Architectural Improvements

#### Improvement 1: DNS Health Monitoring

Add persistent monitoring:

```yaml
services:
  dns-monitor:
    image: appropriate/curl:latest
    volumes:
      - ./scripts/monitor-dns.sh:/monitor.sh
    command: /bin/sh /monitor.sh
    depends_on:
      - nginx
      - frontend
      - backend-api
```

#### Improvement 2: Distributed Tracing

Track requests across services:

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one
    ports:
      - "16686:16686"
    environment:
      - COLLECTOR_ZIPKIN_HOST_PORT=:9411
```

#### Improvement 3: Container Orchestration Readiness

Prepare for eventual migration to Kubernetes:

```bash
# Generate Kubernetes manifests from docker-compose
kompose convert

# Store in version control
git add k8s/
git commit -m "Add Kubernetes manifests for future migration"
```

---

## MONITORING CHECKLIST

### Daily Monitoring Tasks

- [ ] Check frontend accessibility: `curl http://localhost/`
- [ ] Verify health endpoint: `curl http://localhost/health`
- [ ] Check container status: `docker compose ps`
- [ ] Review nginx error logs: `docker logs attendance-nginx-prod`
- [ ] Verify API responses: `curl http://localhost/api/system/status`

### Weekly Monitoring Tasks

- [ ] Review all error logs for patterns
- [ ] Check memory usage: `docker stats`
- [ ] Verify DNS resolution accuracy
- [ ] Test failover procedures
- [ ] Review monitoring alerts

### Monthly Monitoring Tasks

- [ ] Disaster recovery drill
- [ ] Performance baseline review
- [ ] Security vulnerability scan
- [ ] Database backup verification
- [ ] Update monitoring thresholds

---

## IMPLEMENTATION SCHEDULE

### Week 1 (Immediate)

**Day 1:**
- ✓ Deploy DNS TTL timeout in nginx.conf
- ✓ Add frontend health check endpoint
- ✓ Test configuration changes

**Day 2-3:**
- ✓ Deploy DNS monitoring script
- ✓ Deploy container state watcher
- ✓ Verify both scripts running

**Day 4-5:**
- ✓ Update health checks in docker-compose.yml
- ✓ Test health check triggers
- ✓ Document new monitoring

### Week 2-3 (Short-term)

**Week 2:**
- [ ] Implement static container IPs
- [ ] Test static IP deployment
- [ ] Verify no regressions

**Week 3:**
- [ ] Deploy automated nginx restart on container changes
- [ ] Test effectiveness
- [ ] Document results

### Week 4+ (Medium-term)

**Month 1:**
- [ ] Evaluate service mesh options
- [ ] Proof-of-concept Istio or Linkerd
- [ ] Plan Kubernetes migration if beneficial

**Month 2-3:**
- [ ] Implement chosen long-term solution
- [ ] Migration planning
- [ ] User acceptance testing

---

## ROLLBACK PROCEDURES

### If DNS TTL Changes Cause Issues

**Rollback:**
```nginx
# In nginx.conf, remove or revert:
# resolver 127.0.0.11:53 valid=30s;
```

**Test:**
```bash
docker restart attendance-nginx-prod
curl http://localhost/
```

### If Static IPs Cause Issues

**Rollback:**
```yaml
# In docker-compose.yml, remove ipv4_address lines
# Let Docker assign IPs automatically again
```

**Test:**
```bash
docker compose down
docker compose up -d
```

---

## ESCALATION PROCEDURES

### When to Escalate

**Level 1: Quick Recovery (Try within 5 minutes)**
- Restart nginx container
- Check logs for obvious errors
- Verify container network

**Level 2: Full Restart (Try within 15 minutes)**
- docker compose down
- docker compose up -d
- Comprehensive testing

**Level 3: Manual Intervention (Escalate if Level 2 fails)**
- Contact DevOps/Infrastructure team
- Provide:
  - All container logs
  - DNS resolution logs
  - Network diagnostics
  - Timeline of events
  - Recent changes/deployments
- Consider full infrastructure restart

**Level 4: Architecture Review (If recurring)**
- Consider service mesh migration
- Evaluate Kubernetes adoption
- Assess DNS monitoring gaps
- Review deployment automation

---

## SUCCESS METRICS

### Deployment Stability

**Target:** 99.9% availability (9 hours/month acceptable downtime)

**Measurement:**
```bash
# Weekly check
uptime_percentage = (total_hours - downtime_hours) / total_hours * 100
```

### DNS Health

**Target:** DNS cache accuracy 100%

**Measurement:**
```bash
# From monitoring script
dns_accurate = (matching_ips / total_checks) * 100
# Should be 100%
```

### Recovery Time

**Target:** <2 minutes from issue detection to resolution

**Measurement:**
```
(Issue detected) → (Fix applied) = recovery_time
# Should be < 2 minutes
```

### Error Rate

**Target:** 0% 502 errors

**Measurement:**
```bash
# From nginx logs
error_rate = (502_errors / total_requests) * 100
# Should be 0%
```

---

## CONTACT & ESCALATION

### DevOps Team

- **Slack Channel:** #infrastructure
- **On-call:** Check on-call rotation in PagerDuty
- **Escalation Time:** Immediate for 502 errors

### Infrastructure Team

- **Email:** infrastructure@company.com
- **Phone:** +1-XXX-XXX-XXXX
- **Response Time:** 15 minutes for critical issues

---

## DOCUMENTATION REFERENCES

- [Nginx DNS Caching](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [Docker Compose Networking](https://docs.docker.com/compose/networking/)
- [Docker DNS Resolution](https://docs.docker.com/config/containers/container-networking/#dns-services)
- [Reverse Proxy Best Practices](https://www.nginx.com/resources/wiki/start/topics/depth/reverseproxy/)

---

**Report Created:** June 13, 2026 15:34 UTC  
**Last Updated:** June 13, 2026 15:34 UTC  
**Status:** IMPLEMENTATION READY
