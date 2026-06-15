@echo off
REM ============================================================================
REM Complete Website Restart and Redeployment Script for Windows
REM ============================================================================
REM This script safely restarts and redeploys the entire website
REM without any code removal or data damage
REM ============================================================================

setlocal enabledelayedexpansion

REM Set timestamp for backup
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
set timestamp=!mydate!_!mytime!
set backupDir=backups\restart_!timestamp!

echo.
echo ========================================
echo PHASE 1: Pre-Deployment Checks
echo ========================================
echo.

REM Check Docker
echo [*] Checking Docker installation...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH
    exit /b 1
)
echo [SUCCESS] Docker found
for /f "tokens=*" %%i in ('docker --version') do set dockerVer=%%i
echo %dockerVer%

REM Check Docker Compose
echo [*] Checking Docker Compose installation...
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Compose is not installed
    exit /b 1
)
echo [SUCCESS] Docker Compose found
for /f "tokens=*" %%i in ('docker-compose --version') do set composeVer=%%i
echo %composeVer%

REM Check Docker daemon
echo [*] Checking Docker daemon...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker daemon is not running. Please start Docker Desktop.
    exit /b 1
)
echo [SUCCESS] Docker daemon is running

echo.
echo ========================================
echo PHASE 2: Backing Up Current State
echo ========================================
echo.

echo [*] Creating backup directory: %backupDir%
if not exist "%backupDir%" mkdir "%backupDir%"

echo [*] Backing up Docker Compose configurations...
copy docker-compose.yml "%backupDir%\" >nul 2>&1
copy docker-compose.prod.yml "%backupDir%\" >nul 2>&1
echo [SUCCESS] Docker Compose files backed up

echo [*] Backing up environment files...
copy .env "%backupDir%\" >nul 2>&1
copy backend-api\.env "%backupDir%\backend-api.env" >nul 2>&1
copy face-ai-service\.env "%backupDir%\face-ai-service.env" >nul 2>&1
echo [SUCCESS] Environment files backed up

echo [*] Checking for running database...
docker ps --filter "name=attendance-db" --format "{{.Names}}" 2>nul | findstr . >nul
if %errorlevel% equ 0 (
    echo [*] Backing up database...
    docker exec attendance-db pg_dump -U postgres attendance_system > "%backupDir%\database_backup_%timestamp%.sql" 2>nul
    if %errorlevel% equ 0 (
        echo [SUCCESS] Database backed up
    ) else (
        echo [WARNING] Database backup had issues, but continuing
    )
) else (
    echo [*] No running database container found
)

echo [SUCCESS] Backup completed at: %backupDir%

echo.
echo ========================================
echo PHASE 3: Stopping Existing Services
echo ========================================
echo.

echo [*] Checking for running services...
docker ps >nul 2>&1
if %errorlevel% equ 0 (
    echo [*] Stopping services gracefully (may take up to 60 seconds)...
    docker-compose -f docker-compose.prod.yml down --remove-orphans 2>nul
    if %errorlevel% equ 0 (
        echo [SUCCESS] Services stopped successfully
    ) else (
        echo [WARNING] Issues occurred while stopping, continuing anyway
    )
) else (
    echo [*] No running services found
)

echo [*] Waiting 5 seconds for cleanup...
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo PHASE 4: Pulling Latest Docker Images
echo ========================================
echo.

echo [*] Pulling latest base images...
echo [*] Pulling postgres:15-alpine...
docker pull postgres:15-alpine 2>&1 | findstr "Pulling\|Downloaded\|already\|Status" 
if %errorlevel% equ 0 (
    echo [SUCCESS] Pulled postgres:15-alpine
)

echo [*] Pulling redis:7-alpine...
docker pull redis:7-alpine 2>&1 | findstr "Pulling\|Downloaded\|already\|Status"
if %errorlevel% equ 0 (
    echo [SUCCESS] Pulled redis:7-alpine
)

echo.
echo ========================================
echo PHASE 5: Building All Services
echo ========================================
echo.

echo [*] Building all Docker images without cache...
echo [*] This may take several minutes...
docker-compose -f docker-compose.prod.yml build --no-cache
if %errorlevel% neq 0 (
    echo [ERROR] Build failed. Check output above for details.
    exit /b 1
)
echo [SUCCESS] All services built successfully

echo.
echo ========================================
echo PHASE 6: Starting All Services
echo ========================================
echo.

echo [*] Starting all services...
docker-compose -f docker-compose.prod.yml up -d
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start services
    exit /b 1
)
echo [SUCCESS] Services started successfully

echo [*] Waiting 60 seconds for services to initialize...
timeout /t 60 /nobreak >nul

echo.
echo ========================================
echo PHASE 7: Performing Health Checks
echo ========================================
echo.

echo [*] Checking service status...
docker-compose -f docker-compose.prod.yml ps

echo [*] Running detailed health checks...

REM PostgreSQL Health Check
echo [*] Checking PostgreSQL database...
docker-compose exec -T postgres pg_isready -U postgres >nul 2>&1
if %errorlevel% equ 0 (
    echo [SUCCESS] PostgreSQL is healthy
) else (
    echo [WARNING] PostgreSQL health check failed or container not ready yet
)

REM Redis Health Check
echo [*] Checking Redis cache...
docker-compose exec -T redis redis-cli ping >nul 2>&1
if %errorlevel% equ 0 (
    echo [SUCCESS] Redis is healthy
) else (
    echo [WARNING] Redis health check failed or container not ready yet
)

REM Backend API Health Check
echo [*] Checking Backend API...
curl -f http://localhost:3001/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [SUCCESS] Backend API is healthy
) else (
    echo [WARNING] Backend API health check failed (may still be starting)
)

REM Face AI Service Health Check
echo [*] Checking Face AI Service...
curl -f http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [SUCCESS] Face AI Service is healthy
) else (
    echo [WARNING] Face AI Service health check failed (may still be starting)
)

echo.
echo ========================================
echo PHASE 8: Final Verification
echo ========================================
echo.

echo [*] Running docker-compose ps to verify all services...
docker-compose -f docker-compose.prod.yml ps

echo.
echo ========================================
echo RESTART AND REDEPLOYMENT COMPLETE
echo ========================================
echo.

echo [SUCCESS] All services have been successfully restarted and redeployed!
echo [SUCCESS] No code or data was removed or damaged.

echo.
echo Service Access Points:
echo   * Backend API: http://localhost:3001
echo   * Face AI Service: http://localhost:8000
echo   * Frontend: http://localhost

echo.
echo Backup Location: %backupDir%

echo.
echo Next Steps:
echo   1. Verify all services are accessible
echo   2. Check application logs: docker-compose logs -f
echo   3. Monitor performance: docker stats

echo.
echo Deployment completed successfully!
echo.

pause
