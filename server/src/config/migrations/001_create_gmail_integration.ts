import { query } from '../database';

/**
 * Migration: Create Gmail Integration Tables
 * This migration creates the necessary tables and columns for Gmail synchronization
 */

export async function migrate(): Promise<void> {
  try {
    console.log('🔄 Running migration: Create Gmail integration tables...');

    // Create gmail_integrations table
    await query(`
      CREATE TABLE IF NOT EXISTS gmail_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ,
        history_id VARCHAR(255),
        label_filters JSONB DEFAULT '["INBOX"]'::jsonb,
        last_sync_at TIMESTAMPTZ,
        sync_status VARCHAR(20) DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
        sync_error TEXT,
        watch_expiration TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Created gmail_integrations table');

    // Create indexes
    await query(`
      CREATE INDEX IF NOT EXISTS idx_gmail_user_id ON gmail_integrations(user_id);
      CREATE INDEX IF NOT EXISTS idx_gmail_sync_status ON gmail_integrations(sync_status);
      CREATE INDEX IF NOT EXISTS idx_gmail_last_sync ON gmail_integrations(last_sync_at);
    `);

    console.log('✅ Created indexes for gmail_integrations');

    // Add sync-related columns to events table
    await query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS
        sync_source VARCHAR(20) CHECK (sync_source IN ('manual', 'gmail', 'outlook'));
    `);

    await query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS
        external_id JSONB DEFAULT '{}'::jsonb;
    `);

    await query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS
        last_external_sync TIMESTAMPTZ;
    `);

    await query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS
        is_read_only BOOLEAN DEFAULT false;
    `);

    console.log('✅ Added sync columns to events table');

    // Create indexes on events table
    await query(`
      CREATE INDEX IF NOT EXISTS idx_events_sync_source ON events(sync_source);
      CREATE INDEX IF NOT EXISTS idx_events_external_id ON events USING GIN(external_id);
      CREATE INDEX IF NOT EXISTS idx_events_user_sync ON events(user_id, sync_source);
    `);

    console.log('✅ Created indexes for events table');

    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

export async function rollback(): Promise<void> {
  try {
    console.log('🔄 Rolling back migration...');

    await query('DROP TABLE IF EXISTS gmail_integrations CASCADE;');

    await query(`
      ALTER TABLE events DROP COLUMN IF EXISTS sync_source;
      ALTER TABLE events DROP COLUMN IF EXISTS external_id;
      ALTER TABLE events DROP COLUMN IF EXISTS last_external_sync;
      ALTER TABLE events DROP COLUMN IF EXISTS is_read_only;
    `);

    console.log('✅ Rollback completed');
  } catch (error) {
    console.error('❌ Rollback error:', error);
    throw error;
  }
}

