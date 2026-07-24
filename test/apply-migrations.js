// Vitest setup: bring the local D1 instance to the same schema production runs.
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
