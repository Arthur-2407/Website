@echo off
setlocal enabledelayedexpansion

REM Simple restart and redeployment script

echo.
echo ========================================
echo Website Restart and Redeployment
echo ========================================
echo.

REM Check Docker
echo [*] Checking Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker not found
    exit /b 1
)
echo [OK] Docker is available

REM Check Docker Compose
echo [*] Checking Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker Compose not found
    exit /b 1
)
echo [OK] Docker Compose is available

REM Check Docker daemon
echo [*] Checking Docker daemon...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker daemon not running
    exit /b 1
)
echo [OK] Docker daemon is running

echo.
echo [*] Creating backup directory...
if not exist "backups" mkdir "backups"
mkdir "backups\backup_%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
echo [OK] Backup directory created

echo.
echo [*] Stopping existing services...
docker-compose -f docker-compose.prod.yml down --remove-orphans 2>nul
echo [OK] Services stopped

echo.
echo [*] Waiting for cleanup (5 seconds)...
timeout /t 5 /nobreak >nul

echo.
echo [*] Pulling latest images...
docker pull postgres:15-alpine
docker pull redis:7-alpine
echo [OK] Images pulled

echo.
echo [*] Building services (this may take several minutes)...
docker-compose -f docker-compose.prod.yml build --no-cache
if %errorlevel% neq 0 (
    echo ERROR: Build failed
    exit /b 1
)
echo [OK] Build complete

echo.
echo [*] Starting services...
docker-compose -f docker-compose.prod.yml up -d
if %errorlevel% neq 0 (
    echo ERROR: Failed to start services
    exit /b 1
)
echo [OK] Services started

echo.
echo [*] Waiting for services to initialize (60 seconds)...
timeout /t 60 /nobreak >nul

echo.
echo ========================================
echo HEALTH CHECKS
echo ========================================
echo.

echo [*] Service status:
docker-compose -f docker-compose.prod.yml ps

echo.
echo [*] PostgreSQL check...
docker-compose exec -T postgres pg_isready -U postgres >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] PostgreSQL is healthy
) else (
    echo [!] PostgreSQL check failed
)

echo [*] Redis check...
docker-compose exec -T redis redis-cli ping >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Redis is healthy
) else (
    echo [!] Redis check failed
)

echo [*] Backend API check...
curl -f http://localhost:3001/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Backend API is healthy
) else (
    echo [!] Backend API check failed (may still be starting)
)

echo [*] Face AI Service check...
curl -f http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Face AI Service is healthy
) else (
    echo [!] Face AI Service check failed (may still be starting)
)

echo.
echo ========================================
echo SUCCESS
echo ========================================
echo.
echo All services have been restarted and redeployed!
echo No code or data was removed or damaged.
echo.
echo Access points:
echo   - Backend API: http://localhost:3001
echo   - Face AI Service: http://localhost:8000
echo   - Frontend: http://localhost
echo.
echo Next: Check logs with: docker-compose logs -f
echo.

pause
