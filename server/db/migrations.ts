export type Migration = { version: number; name: string; up: string };

// Ordered schema migrations. Each runs exactly once per database, in version
// order, recorded in `schema_migration` (see migrate.ts).
//
// v1 is the baseline — the schema as it exists today. It is written to be
// idempotent (`CREATE TABLE IF NOT EXISTS`) so that adopting the framework on
// the already-provisioned production database is a safe no-op that simply
// records the baseline, while a fresh environment (local, a new Deploy) is
// provisioned identically. Because every later migration is guarded by the
// version table and runs exactly once, v2+ need not be idempotent.
export const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline",
    // NOTE: reconstructed from the code's queries; to be replaced with the exact
    // `SHOW CREATE TABLE` output from production so fresh environments match it.
    up: `
      CREATE TABLE IF NOT EXISTS user (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NULL,
        rating DOUBLE NOT NULL DEFAULT 1000,
        plays INT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS iteration (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        created DATETIME NOT NULL,
        bricks INT NOT NULL,
        power INT NOT NULL,
        checkpoint_x DOUBLE NOT NULL,
        checkpoint_y DOUBLE NOT NULL,
        min DOUBLE NOT NULL,
        rated BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS block (
        iteration INT NOT NULL,
        x INT NOT NULL,
        y INT NOT NULL,
        kind ENUM('block', 'thunder') NOT NULL,
        INDEX block_iteration (iteration)
      );

      CREATE TABLE IF NOT EXISTS run (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user VARCHAR(255) NOT NULL,
        iteration INT NOT NULL,
        time DOUBLE NOT NULL,
        data TEXT NOT NULL,
        void BOOLEAN NOT NULL DEFAULT TRUE,
        daily BOOLEAN NOT NULL DEFAULT FALSE,
        created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX run_user (user),
        INDEX run_iteration (iteration)
      );`,
  },
];

// Fails fast on an ill-formed migration list: versions must be unique and form a
// contiguous run starting at 1, so "apply everything above the current version"
// can never silently skip a gap.
export const validateMigrations = (all: Migration[] = migrations) => {
  const sorted = [...all].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migrations must be contiguous from 1; expected ${
          i + 1
        }, got ${m.version} (${m.name})`,
      );
    }
  });
  return sorted;
};

// The migrations that still need to run against a database at `current`, in
// order. Pure so the sequencing is unit-testable without a database.
export const pendingMigrations = (
  current: number,
  all: Migration[] = migrations,
) => validateMigrations(all).filter((m) => m.version > current);
