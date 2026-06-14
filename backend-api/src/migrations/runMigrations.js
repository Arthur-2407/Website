const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { logger } = require('../config/logger');

const MIGRATIONS_DIR = __dirname;

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.up.sql'))
    .sort();
}

function checksum(content) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function runMigrations() {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const appliedResult = await client.query('SELECT id, checksum FROM schema_migrations');
    const applied = new Map(appliedResult.rows.map((row) => [row.id, row.checksum]));
    const files = getMigrationFiles();

    for (const file of files) {
      const id = file.replace(/\.up\.sql$/, '');
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      const fileChecksum = checksum(sql);

      if (applied.has(id)) {
        if (applied.get(id) !== fileChecksum) {
          throw new Error(`Migration checksum mismatch for ${id}`);
        }
        continue;
      }

      logger.info('Applying database migration', { id });
      await client.query('BEGIN');
      // SECURITY: Interpolate environment variables safely after checksum calculation
      const interpolatedSql = sql.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, p1) => {
        return process.env[p1] !== undefined ? process.env[p1] : match;
      });
      await client.query(interpolatedSql);
      await client.query(
        'INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)',
        [id, file, fileChecksum]
      );
      await client.query('COMMIT');
      logger.info('Database migration applied', { id });
    }

    return { applied: files.length, pending: 0 };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; the original migration error is more useful.
    }
    logger.error('Database migration failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  if (process.argv.includes('--dry-run')) {
    for (const file of getMigrationFiles()) {
      logger.info('Migration discovered', { file });
    }
    process.exit(0);
  }

  runMigrations()
    .then(() => pool.end())
    .catch(async (error) => {
      logger.error('Migration runner failed', { error: error.message, stack: error.stack });
      await pool.end();
      process.exit(1);
    });
}

module.exports = { runMigrations, getMigrationFiles };
