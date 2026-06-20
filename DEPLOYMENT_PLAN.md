# Phase 5 — Deployment Plan

Created: 2026-06-21T00:50:00+05:30

This plan outlines the detailed step-by-step procedure for deploying the Enterprise Attendance Portal onto the remote production VPS.

---

## 1. Operating System & Package Setup
- **Target OS**: Ubuntu 22.04 LTS (Jammy Jellyfish) or Ubuntu 24.04 LTS (Noble Numbat).
- **Essential Packages**:
  ```bash
  sudo apt-get update
  sudo apt-get install -y curl wget git ufw fail2ban certbot python3-certbot-nginx
  ```

---

## 2. Docker & Docker Compose Installation
Install Docker CE using the official repository:
```bash
# Add Docker's official GPG key:
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify service is running:
```bash
sudo systemctl status docker
```

---

## 3. Firewall Security Configuration (UFW)
Only expose web-traffic ports (HTTP/HTTPS) and SSH management. Keep databases internal to the Docker subnet network.
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH Port'
sudo ufw allow 80/tcp comment 'HTTP Web Port'
sudo ufw allow 443/tcp comment 'HTTPS SSL Web Port'
sudo ufw enable
```

---

## 4. Reverse Proxy Setup (Nginx)
The reverse proxy container handles SSL decryption and directs requests internally:
- `http://localhost/` → `frontend:80`
- `http://localhost/api` → `backend-api:3001`
- `http://localhost/face-ai` → `face-ai-service:8000`

---

## 5. SSL / HTTPS Setup
Obtain certificates using Let's Encrypt Certbot:
```bash
sudo certbot --nginx -d example.com -d www.example.com
```
Certbot will modify the system nginx virtual host configuration to auto-redirect HTTP to HTTPS.

---

## 6. Database Persistence & Initialization
- **Persistence**: Mount host folders to `/var/lib/postgresql/data` (main db: `postgres_data`, face db: `postgres_face_data`) to prevent data loss when containers restart.
- **Initialization**: On backend start, migration scripts in `backend-api` populate schemas if missing (triggered via `RUN_MIGRATIONS=true` environment flag).

---

## 7. Backup Cronjob Configuration
Configure nightly database backup script using `cron`:
Create `/opt/backup_dbs.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/attendance"
DATE=$(date +%F_%H%M%S)
mkdir -p $BACKUP_DIR
docker exec -t attendance-db-prod pg_dump -U postgres attendance_system | gzip > $BACKUP_DIR/main_db_$DATE.sql.gz
docker exec -t attendance-face-db-prod pg_dump -U face_admin attendance_face_system | gzip > $BACKUP_DIR/face_db_$DATE.sql.gz
find $BACKUP_DIR -type f -mtime +14 -delete # Prune backups older than 14 days
```

Add cron entry via `sudo crontab -e`:
```text
0 2 * * * /bin/bash /opt/backup_dbs.sh
```
