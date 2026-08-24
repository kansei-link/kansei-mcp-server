/**
 * Seed DB then run L1 agent army.
 * One-off script for the weekly health check.
 */
import { getDb } from "../db/connection.js";
import { initializeDb } from "../db/schema.js";
import { seedDatabase } from "../db/seed.js";
import { seedInfrastructureTips } from "../db/seed-tips.js";

const dbPath = process.env.DB_PATH || "kansei-link.db";
process.env.DB_PATH = dbPath;

const db = getDb(dbPath);
initializeDb(db);
seedDatabase(db);
try { seedInfrastructureTips(db); } catch { /* optional */ }

const count = db.prepare("SELECT COUNT(*) as cnt FROM services").get() as { cnt: number };
console.log(`[seed] Services seeded: ${count.cnt}`);
