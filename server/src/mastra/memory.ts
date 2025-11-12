import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Mastra Memory Configuration for Agent.network()
 * 
 * This uses PostgreSQL-backed memory storage to enable:
 * - Context retention across requests
 * - Intelligent routing decisions
 * - History tracking for multi-agent networks
 * 
 * REQUIRED for Agent.network() to function properly.
 */

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL not set. Agent.network() will not function properly.');
}

// Create PostgreSQL storage backend
const pgStore = new PostgresStore({
  connectionString: process.env.DATABASE_URL || '',
});

// Create memory instance with PostgreSQL storage
export const memory = new Memory({
  storage: pgStore,
});

export default memory;

