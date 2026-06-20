# Rollback Plan

Created: 2026-06-21T00:44:00+05:30

## 1. Local Filesystem / Source Code Rollback
Since all active changes are performed on the `deploy-v2.0` branch, any local source code changes can be completely discarded or reverted to the main branch state.

### Commands to Revert Code Changes:
To discard any uncommitted local changes:
```bash
git checkout -- .
git clean -fd
```

To switch back to the original stable `main` branch:
```bash
git checkout main
```

To delete the deployment branch locally:
```bash
git branch -D deploy-v2.0
```

## 2. Docker Container Rollback
If a container build or run fails on the target VPS:
1. Stop all containers deployed via the deployment compose file:
   ```bash
   docker compose -f docker-compose.prod.yml down
   ```
2. Remove any newly built images to reclaim space:
   ```bash
   docker compose -f docker-compose.prod.yml rm -f
   ```
3. Restart the previous stable containers (if applicable).

## 3. Database Rollback
If migrations fail:
1. Since we do not run destructive migrations, database schema updates should only add nullable/optional columns.
2. In case of schema issues, restore the latest PostgreSQL database backup.
   ```bash
   pg_restore -d attendance_system backup.dump
   ```
