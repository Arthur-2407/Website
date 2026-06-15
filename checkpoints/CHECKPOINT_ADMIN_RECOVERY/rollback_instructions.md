# Checkpoint Rollback Instructions: CHECKPOINT_ADMIN_RECOVERY

To revert the modifications made for the administrator recovery system, run the following commands in the project root directory:

```powershell
# Restore backed up source files
Copy-Item checkpoints\CHECKPOINT_ADMIN_RECOVERY\backup_routes.js backend-api\src\modules\auth\routes.js -Force
Copy-Item checkpoints\CHECKPOINT_ADMIN_RECOVERY\backup_BootstrapSetupPage.tsx frontend\src\pages\BootstrapSetupPage.tsx -Force

# Rebuild and restart the modified Docker containers
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
```
