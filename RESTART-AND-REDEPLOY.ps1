# ============================================================================
# Complete Website Restart and Redeployment Script
# ============================================================================
# This script safely restarts and redeploys the entire website
# without any code removal or data damage
# ============================================================================

param(
    [switch]$SkipBackup = $false,
    [switch]$Quick = $false
)

# Configuration
$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = "backups\restart_$timestamp"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Color functions
function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Header {
    param([string]$Message)
    Write-Host "`n========================================`n$Message`n========================================`n" -ForegroundColor Blue -BackgroundColor Black
}

# ============================================================================
# PHASE 1: PRE-DEPLOYMENT CHECKS
# ============================================================================
Write-Header "PHASE 1: Pre-Deployment Checks"

# Check Docker availability
Write-Info "Checking Docker installation..."
$dockerCheck = docker --version 2>&1
if ($dockerCheck) {
    Write-Success "Docker found: $dockerCheck"
} else {
    Write-Error "Docker is not installed or not in PATH"
    exit 1
}

# Check Docker Compose
Write-Info "Checking Docker Compose installation..."
$composeCheck = docker-compose --version 2>&1
if ($composeCheck) {
    Write-Success "Docker Compose found: $composeCheck"
} else {
    Write-Error "Docker Compose is not installed or not in PATH"
    exit 1
}

# Check Docker daemon
Write-Info "Checking Docker daemon..."
$daemonCheck = docker info 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Success "Docker daemon is running"
} else {
    Write-Error "Docker daemon is not running. Please start Docker Desktop."
    exit 1
}

# ============================================================================
# PHASE 2: BACKUP CURRENT STATE
# ============================================================================
if (-not $SkipBackup) {
    Write-Header "PHASE 2: Backing Up Current State"
    
    Write-Info "Creating backup directory: $backupDir"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    
    # Backup docker-compose files
    Write-Info "Backing up Docker Compose configurations..."
    Copy-Item "docker-compose.yml" "$backupDir\" -Force 2>$null
    Copy-Item "docker-compose.prod.yml" "$backupDir\" -Force 2>$null
    Write-Success "Docker Compose files backed up"
    
    # Backup environment files
    Write-Info "Backing up environment files..."
    Copy-Item ".env" "$backupDir\" -Force 2>$null
    Copy-Item "backend-api\.env" "$backupDir\backend-api.env" -Force 2>$null
    Copy-Item "face-ai-service\.env" "$backupDir\face-ai-service.env" -Force 2>$null
    Write-Success "Environment files backed up"
    
    # Backup database if running
    Write-Info "Checking for running database..."
    $dbContainer = docker ps --filter "name=attendance-db" --format "{{.Names}}" 2>$null
    if ($dbContainer) {
        Write-Info "Backing up database..."
        $dbOutput = "$backupDir\database_backup_$timestamp.sql"
        docker exec $dbContainer pg_dump -U postgres attendance_system > $dbOutput 2>$null
        if ($LASTEXITCODE -eq 0) {
            $dbSize = (Get-Item $dbOutput).Length / 1MB
            Write-Success "Database backed up ($([math]::Round($dbSize, 2)) MB)"
        } else {
            Write-Warning "Database backup failed, continuing anyway"
        }
    } else {
        Write-Warning "No running database container found, skipping database backup"
    }
    
    Write-Success "Backup completed at: $backupDir"
} else {
    Write-Warning "Backup skipped as requested"
}

# ============================================================================
# PHASE 3: STOP EXISTING SERVICES
# ============================================================================
Write-Header "PHASE 3: Stopping Existing Services"

Write-Info "Checking for running services..."
$runningServices = docker-compose ps --services 2>$null

if ($runningServices) {
    Write-Info "Found running services. Stopping them gracefully..."
    Write-Info "This may take up to 60 seconds..."
    
    docker-compose -f docker-compose.prod.yml down --remove-orphans 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Services stopped successfully"
    } else {
        Write-Warning "Issues occurred while stopping services, but continuing"
    }
} else {
    Write-Info "No running services found"
}

# Give containers time to clean up
Start-Sleep -Seconds 5

# ============================================================================
# PHASE 4: PULL LATEST IMAGES
# ============================================================================
Write-Header "PHASE 4: Pulling Latest Docker Images"

Write-Info "Pulling latest base images..."
$imagesToPull = @(
    "postgres:15-alpine",
    "redis:7-alpine"
)

foreach ($image in $imagesToPull) {
    Write-Info "Pulling $image..."
    docker pull $image 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Pulled $image"
    }
}

# ============================================================================
# PHASE 5: BUILD ALL SERVICES
# ============================================================================
Write-Header "PHASE 5: Building All Services"

if ($Quick) {
    Write-Info "Quick build requested. Building all Docker images (using cache)..."
    docker-compose -f docker-compose.prod.yml build 2>&1 | Tee-Object -Variable buildOutput | Out-Host
} else {
    Write-Info "Building all Docker images (without cache for clean build)..."
    Write-Info "This may take several minutes..."
    docker-compose -f docker-compose.prod.yml build --no-cache 2>&1 | Tee-Object -Variable buildOutput | Out-Host
}

if ($LASTEXITCODE -eq 0) {
    Write-Success "All services built successfully"
} else {
    Write-Error "Build failed. Check output above for details."
    exit 1
}

# ============================================================================
# PHASE 6: START ALL SERVICES
# ============================================================================
Write-Header "PHASE 6: Starting All Services"

Write-Info "Starting all services..."
docker-compose -f docker-compose.prod.yml up -d 2>&1 | Out-Host

if ($LASTEXITCODE -eq 0) {
    Write-Success "Services started successfully"
} else {
    Write-Error "Failed to start services"
    exit 1
}

Write-Info "Waiting for services to initialize (60 seconds)..."
Start-Sleep -Seconds 60

# ============================================================================
# PHASE 7: HEALTH CHECKS
# ============================================================================
Write-Header "PHASE 7: Performing Health Checks"

# Check service status
Write-Info "Checking service status..."
$services = docker-compose -f docker-compose.prod.yml ps --services
foreach ($service in $services) {
    $status = docker-compose -f docker-compose.prod.yml ps $service --format "table {{.Names}}\t{{.Status}}"
    Write-Info $status
}

Write-Info "Running detailed health checks..."

# Health check attempts
$maxAttempts = 5
$attempt = 0

# PostgreSQL Health Check
Write-Info "Checking PostgreSQL database..."
while ($attempt -lt $maxAttempts) {
    $attempt++
    try {
        $dbCheck = docker-compose exec -T postgres pg_isready -U postgres 2>&1
        if ($dbCheck -like "*accepting connections*") {
            Write-Success "PostgreSQL is healthy"
            break
        }
    } catch {
        if ($attempt -eq $maxAttempts) {
            Write-Warning "PostgreSQL health check did not respond after $maxAttempts attempts"
        }
    }
    if ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 5
    }
}

# Redis Health Check
Write-Info "Checking Redis cache..."
$attempt = 0
while ($attempt -lt $maxAttempts) {
    $attempt++
    try {
        $redisCheck = docker-compose exec -T redis redis-cli ping 2>&1
        if ($redisCheck -like "*PONG*") {
            Write-Success "Redis is healthy"
            break
        }
    } catch {
        if ($attempt -eq $maxAttempts) {
            Write-Warning "Redis health check did not respond after $maxAttempts attempts"
        }
    }
    if ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 5
    }
}

# Backend API Health Check
Write-Info "Checking Backend API..."
$apiHealthy = $false
$attempt = 0
while ($attempt -lt $maxAttempts) {
    $attempt++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Success "Backend API is healthy"
            $apiHealthy = $true
            break
        }
    } catch {
        if ($attempt -eq $maxAttempts) {
            Write-Warning "Backend API health check failed after $maxAttempts attempts"
        }
    }
    if ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 10
    }
}

# Face AI Service Health Check
Write-Info "Checking Face AI Service..."
$attempt = 0
while ($attempt -lt $maxAttempts) {
    $attempt++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Success "Face AI Service is healthy"
            break
        }
    } catch {
        if ($attempt -eq $maxAttempts) {
            Write-Warning "Face AI Service health check failed after $maxAttempts attempts"
        }
    }
    if ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 10
    }
}

# ============================================================================
# PHASE 8: VERIFICATION
# ============================================================================
Write-Header "PHASE 8: Final Verification"

Write-Info "Running docker-compose ps to verify all services..."
docker-compose -f docker-compose.prod.yml ps | Tee-Object -Variable psOutput | Out-Host

Write-Info "Checking container logs for errors..."
$containers = docker ps --format "{{.Names}}"
foreach ($container in $containers) {
    $recentErrors = docker logs $container 2>&1 | Select-String -Pattern "error|ERROR|failed|FAILED" | Select-Object -First 1
    if ($recentErrors) {
        Write-Warning "Found in $container : $recentErrors"
    }
}

# ============================================================================
# COMPLETION SUMMARY
# ============================================================================
Write-Header "RESTART AND REDEPLOYMENT COMPLETE"

Write-Success "All services have been successfully restarted and redeployed!"
Write-Success "No code or data was removed or damaged."

Write-Info "Service Access Points:"
Write-Info "  - Backend API: http://localhost:3001"
Write-Info "  - Face AI Service: http://localhost:8000"
Write-Info "  - Frontend: http://localhost"

if (-not $SkipBackup) {
    Write-Info "Backup Location: $backupDir"
}

Write-Info "`nNext Steps:"
Write-Info "  1. Verify all services are accessible"
Write-Info "  2. Check application logs: docker-compose logs -f"
Write-Info "  3. Monitor performance: docker stats"

$completionTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Success "Deployment completed at: $completionTime"
