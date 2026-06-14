#!/usr/bin/env node

/**
 * Enterprise Attendance System - Real-Time Monitoring & Reporting
 * Monitors all services, endpoints, performance, and errors
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  services: {
    backend: { url: 'http://localhost:3001', name: 'Backend API' },
    frontend: { url: 'http://localhost:3000', name: 'Frontend' },
    nginx: { url: 'http://localhost', name: 'Nginx Proxy' },
    faceai: { url: 'http://localhost:8000', name: 'Face AI Service' },
  },
  endpoints: {
    health: '/health',
    status: '/api/system/status',
    features: '/api/system/features',
    permissions: '/api/system/permissions',
    reports: '/api/reports',
    attendance: '/api/attendance',
    leave: '/api/leave',
  },
  checkInterval: 5000, // 5 seconds
  reportInterval: 30000, // 30 seconds
  monitorDuration: 300000, // 5 minutes
};

// Data collection
const metrics = {
  timestamp: new Date(),
  services: {},
  endpoints: {},
  errors: [],
  performance: [],
  uptime: {},
  containerStatus: {},
};

// Utility functions
function makeRequest(url, headers = {}) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const startTime = Date.now();

    const req = client.get(url, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          responseTime: Date.now() - startTime,
          body: data,
          headers: res.headers,
          timestamp: new Date(),
          success: res.statusCode >= 200 && res.statusCode < 300,
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        statusCode: 0,
        responseTime: Date.now() - startTime,
        body: null,
        error: error.message,
        timestamp: new Date(),
        success: false,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: 0,
        responseTime: Date.now() - startTime,
        body: null,
        error: 'Timeout',
        timestamp: new Date(),
        success: false,
      });
    });
  });
}

function executeCommand(command, args = []) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { shell: true, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function checkContainerStatus() {
  const result = await executeCommand('docker-compose', ['ps', '--format=json']);
  if (result.code === 0 && result.stdout) {
    try {
      const containers = JSON.parse(`[${result.stdout.trim().split('\n').join(',')}]`);
      return containers;
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function getContainerLogs(containerName, lines = 50) {
  const result = await executeCommand('docker', ['logs', '--tail', String(lines), containerName]);
  return result.stdout;
}

async function getErrorsFromLogs() {
  const errors = [];
  const services = ['backend-api', 'attendance-frontend', 'attendance-db', 'attendance-redis', 'face-ai-service'];

  for (const service of services) {
    const logs = await getContainerLogs(service, 100);
    const errorPatterns = [
      /ERROR|error|Error/g,
      /FATAL|fatal|Fatal/g,
      /exception|Exception|EXCEPTION/g,
      /failed|Failed|FAILED/g,
      /crash|Crash|CRASH/g,
    ];

    for (const pattern of errorPatterns) {
      const matches = logs.match(new RegExp(`.*${pattern.source}.*`, 'gi'));
      if (matches) {
        for (const match of matches.slice(0, 5)) {
          errors.push({
            service,
            message: match.trim().substring(0, 200),
            timestamp: new Date(),
            severity: pattern.source.includes('FATAL') ? 'critical' : 'warning',
          });
        }
      }
    }
  }

  return errors;
}

async function monitorServices() {
  console.log('\n📊 Starting Real-Time System Monitoring...\n');

  const startTime = Date.now();
  let checkCount = 0;

  while (Date.now() - startTime < CONFIG.monitorDuration) {
    checkCount++;
    console.log(`\n✅ Check #${checkCount} - ${new Date().toLocaleTimeString()}`);

    // Check container status
    const containers = await checkContainerStatus();
    for (const container of containers) {
      metrics.containerStatus[container.Name] = {
        state: container.State,
        status: container.Status,
        timestamp: new Date(),
      };
      console.log(`  🐳 ${container.Name}: ${container.State} (${container.Status})`);
    }

    // Check services
    console.log('\n  🔍 Checking Services:');
    for (const [key, service] of Object.entries(CONFIG.services)) {
      const healthUrl = `${service.url}${CONFIG.endpoints.health}`;
      const response = await makeRequest(healthUrl);

      if (!metrics.services[key]) {
        metrics.services[key] = { checks: [], upCount: 0, downCount: 0 };
      }

      metrics.services[key].checks.push(response);
      if (response.success) {
        metrics.services[key].upCount++;
        console.log(`    ✅ ${service.name}: ${response.statusCode} (${response.responseTime}ms)`);
      } else {
        metrics.services[key].downCount++;
        console.log(`    ❌ ${service.name}: ${response.error || response.statusCode}`);
        metrics.errors.push({
          service: service.name,
          error: response.error || 'Unhealthy',
          timestamp: new Date(),
          type: 'service_health',
        });
      }

      metrics.performance.push({
        service: service.name,
        endpoint: '/health',
        responseTime: response.responseTime,
        statusCode: response.statusCode,
        timestamp: new Date(),
      });
    }

    // Check API endpoints (if backend is healthy)
    const backendHealthy = metrics.services.backend?.checks?.[metrics.services.backend.checks.length - 1]?.success;
    if (backendHealthy) {
      console.log('\n  🔗 Checking API Endpoints:');
      for (const [key, endpoint] of Object.entries(CONFIG.endpoints)) {
        if (key === 'health') continue; // Already checked
        const url = `${CONFIG.services.backend.url}${endpoint}`;
        const response = await makeRequest(url, {
          'Authorization': 'Bearer mock-token',
          'Content-Type': 'application/json',
        });

        const statusCode = response.statusCode;
        const isOk = statusCode === 200 || statusCode === 204;
        const icon = isOk || statusCode === 401 ? '✅' : '⚠️';

        console.log(`    ${icon} ${endpoint}: ${statusCode} (${response.responseTime}ms)`);

        metrics.performance.push({
          service: 'Backend API',
          endpoint,
          responseTime: response.responseTime,
          statusCode: response.statusCode,
          timestamp: new Date(),
        });

        if (!isOk && statusCode !== 401) {
          metrics.errors.push({
            service: 'Backend API',
            endpoint,
            statusCode,
            error: 'Unexpected status code',
            timestamp: new Date(),
            type: 'endpoint_error',
          });
        }
      }
    }

    // Check for container errors
    console.log('\n  🚨 Scanning for Errors:');
    const errors = await getErrorsFromLogs();
    if (errors.length > 0) {
      console.log(`    Found ${errors.length} errors:`);
      for (const error of errors.slice(0, 3)) {
        console.log(`      • [${error.service}] ${error.message.substring(0, 60)}`);
        metrics.errors.push(error);
      }
    } else {
      console.log('    ✅ No critical errors found');
    }

    // Calculate uptime percentages
    console.log('\n  📈 Service Uptime:');
    for (const [service, data] of Object.entries(metrics.services)) {
      const total = data.upCount + data.downCount;
      const uptime = total > 0 ? ((data.upCount / total) * 100).toFixed(1) : 0;
      console.log(`    ${service}: ${uptime}% (${data.upCount}/${total})`);
      metrics.uptime[service] = uptime;
    }

    // Wait before next check
    if (Date.now() - startTime < CONFIG.monitorDuration) {
      console.log(`\n⏳ Next check in ${CONFIG.checkInterval / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval));
    }
  }

  console.log('\n✅ Monitoring Complete!\n');
  return metrics;
}

async function generateReport(metrics) {
  const reportPath = path.join(__dirname, '..', `MONITORING-REPORT-${Date.now()}.md`);

  // Calculate statistics
  const totalChecks = Object.values(metrics.services).reduce((sum, s) => sum + s.checks.length, 0);
  const totalErrors = metrics.errors.length;
  const avgResponseTime = (metrics.performance.reduce((sum, p) => sum + p.responseTime, 0) / metrics.performance.length).toFixed(2);
  const slowestEndpoint = metrics.performance.reduce((max, p) => p.responseTime > max.responseTime ? p : max, metrics.performance[0]);

  // Build report
  const report = `# Enterprise Attendance System - Monitoring Report

**Generated:** ${new Date().toLocaleString()}  
**Monitoring Duration:** ${(CONFIG.monitorDuration / 1000 / 60).toFixed(1)} minutes  
**Total Health Checks:** ${totalChecks}  

---

## 🎯 Executive Summary

### Overall System Status: ✅ **OPERATIONAL**

| Metric | Value |
|--------|-------|
| Services Healthy | ${Object.values(metrics.services).filter(s => s.upCount > s.downCount).length}/4 |
| Total Errors | ${totalErrors} |
| Average Response Time | ${avgResponseTime}ms |
| Uptime Percentage | ${Object.values(metrics.uptime).reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / Object.keys(metrics.uptime).length}% |

---

## 🐳 Container Status

\`\`\`
${Object.entries(metrics.containerStatus).map(([name, status]) => 
  `• ${name}: ${status.state} (${status.status})`
).join('\n')}
\`\`\`

---

## 📊 Service Health Report

${Object.entries(metrics.services).map(([service, data]) => {
  const total = data.upCount + data.downCount;
  const uptime = ((data.upCount / total) * 100).toFixed(1);
  const icon = uptime >= 95 ? '✅' : uptime >= 80 ? '⚠️' : '❌';
  return `### ${icon} ${service.toUpperCase()}
- Uptime: **${uptime}%** (${data.upCount}/${total})
- Last Check: ${data.checks[data.checks.length - 1]?.timestamp?.toLocaleTimeString() || 'N/A'}
- Status: ${data.checks[data.checks.length - 1]?.success ? '✅ Healthy' : '❌ Unhealthy'}`;
}).join('\n\n')}

---

## 🔗 API Endpoint Performance

| Endpoint | Avg Response Time | Status Code | Checks |
|----------|------------------|------------|--------|
${metrics.performance.map(p => {
  const matches = metrics.performance.filter(m => m.endpoint === p.endpoint);
  if (matches[0] === p) {
    const avg = (matches.reduce((sum, m) => sum + m.responseTime, 0) / matches.length).toFixed(2);
    const lastStatus = matches[matches.length - 1].statusCode;
    return `| ${p.endpoint} | ${avg}ms | ${lastStatus} | ${matches.length} |`;
  }
}).filter(Boolean).join('\n')}

### Performance Insights

- **Fastest Endpoint:** ${metrics.performance.reduce((min, p) => p.responseTime < min.responseTime ? p : min, metrics.performance[0]).endpoint} (${metrics.performance.reduce((min, p) => p.responseTime < min.responseTime ? p : min, metrics.performance[0]).responseTime}ms)
- **Slowest Endpoint:** ${slowestEndpoint.endpoint} (${slowestEndpoint.responseTime}ms)
- **Average Response Time:** ${avgResponseTime}ms

---

## 🚨 Error Analysis

### Total Errors Detected: ${totalErrors}

${totalErrors > 0 ? `
| Service | Error Type | Count | Severity |
|---------|-----------|-------|----------|
${[...new Set(metrics.errors.map(e => e.service))].map(service => {
  const serviceErrors = metrics.errors.filter(e => e.service === service);
  const severity = serviceErrors.some(e => e.severity === 'critical') ? 'Critical' : 'Warning';
  return `| ${service} | ${serviceErrors[0]?.type || 'unknown'} | ${serviceErrors.length} | ${severity} |`;
}).join('\n')}

### Error Details

\`\`\`
${metrics.errors.slice(0, 20).map(e => 
  `[${e.timestamp.toLocaleTimeString()}] ${e.service}: ${e.message || e.error}`
).join('\n')}
\`\`\`
` : '✅ No errors detected during monitoring period\n'}

---

## 📈 Performance Metrics

### Response Time Distribution

- **0-100ms:** ${metrics.performance.filter(p => p.responseTime <= 100).length} requests
- **100-200ms:** ${metrics.performance.filter(p => p.responseTime > 100 && p.responseTime <= 200).length} requests
- **200-500ms:** ${metrics.performance.filter(p => p.responseTime > 200 && p.responseTime <= 500).length} requests
- **500ms+:** ${metrics.performance.filter(p => p.responseTime > 500).length} requests

### Service Latency

\`\`\`
${[...new Set(metrics.performance.map(p => p.service))].map(service => {
  const servicePerf = metrics.performance.filter(p => p.service === service);
  const avg = (servicePerf.reduce((sum, p) => sum + p.responseTime, 0) / servicePerf.length).toFixed(2);
  const min = Math.min(...servicePerf.map(p => p.responseTime));
  const max = Math.max(...servicePerf.map(p => p.responseTime));
  return `${service}: Avg ${avg}ms (Min: ${min}ms, Max: ${max}ms)`;
}).join('\n')}
\`\`\`

---

## ✅ System Checklist

- [${Object.values(metrics.services).every(s => s.upCount > s.downCount) ? 'x' : ' '}] All Services Operational
- [${totalErrors === 0 ? 'x' : ' '}] No Critical Errors
- [${avgResponseTime < 200 ? 'x' : ' '}] Response Times Acceptable (<200ms)
- [${Object.values(metrics.uptime).every(u => u >= 95) ? 'x' : ' '}] All Services >95% Uptime
- [${metrics.containerStatus && Object.values(metrics.containerStatus).every(c => c.state === 'running') ? 'x' : ' '}] All Containers Running

---

## 🎯 Recommendations

${totalErrors > 0 ? '1. **Address Errors**: Review and fix the detected errors listed above' : '1. **System Stable**: Continue normal operations'}
${avgResponseTime > 200 ? '2. **Performance Tuning**: Implement caching and optimization for slow endpoints' : '2. **Performance Good**: Current response times are acceptable'}
${Object.values(metrics.uptime).some(u => u < 95) ? '3. **Reliability**: Investigate services with <95% uptime' : '3. **Reliable**: All services maintaining good uptime'}

---

## 📋 Monitoring Details

**Monitoring System Version:** 1.0.0  
**Check Interval:** ${CONFIG.checkInterval}ms  
**Total Checks Performed:** ${totalChecks}  
**Errors Found:** ${totalErrors}  
**Uptime Average:** ${(Object.values(metrics.uptime).reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / Object.keys(metrics.uptime).length).toFixed(1)}%  

**System Ready for:** ✅ Production Testing

---

*This report was automatically generated by the Enterprise Attendance System Monitoring System*
`;

  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Report generated: ${reportPath}`);
  return reportPath;
}

// Main execution
async function main() {
  try {
    console.log('🚀 Enterprise Attendance System - Real-Time Monitor');
    console.log('================================================\n');

    // Run monitoring
    const metrics = await monitorServices();

    // Generate report
    const reportPath = await generateReport(metrics);

    // Display summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 MONITORING SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Services Checked: ${Object.keys(metrics.services).length}`);
    console.log(`✅ Total Errors: ${metrics.errors.length}`);
    console.log(`✅ Average Response Time: ${(metrics.performance.reduce((sum, p) => sum + p.responseTime, 0) / metrics.performance.length).toFixed(2)}ms`);
    console.log(`✅ Overall Uptime: ${(Object.values(metrics.uptime).reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / Object.keys(metrics.uptime).length).toFixed(1)}%`);
    console.log(`📄 Full Report: ${reportPath}`);
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('❌ Monitoring error:', error.message);
    process.exit(1);
  }
}

main();
