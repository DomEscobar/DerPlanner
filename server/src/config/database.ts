import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'derplanner_task_event_planner',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Increased from 2000 to 5000
});

console.log('📋 Database Configuration:');
console.log('  DATABASE_URL:', process.env.DATABASE_URL);
console.log('  POSTGRES_HOST:', process.env.POSTGRES_HOST);
console.log('  POSTGRES_PORT:', process.env.POSTGRES_PORT);
console.log('  POSTGRES_DB:', process.env.POSTGRES_DB);
console.log('  POSTGRES_USER:', process.env.POSTGRES_USER);

// Initialize database tables and extensions
export const initializeDatabase = async (): Promise<void> => {
  let client: PoolClient | null = null;
  try {
    console.log('🔗 Attempting to connect to PostgreSQL...');
    client = await pool.connect();
    console.log('✅ Connected to PostgreSQL successfully!');
    
    // Enable pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;').catch(() => {
      // Ignore if vector extension is not available
    });
    
    // Create tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
        priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tags TEXT[] DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        user_id VARCHAR(255) NOT NULL,
        webhook_config JSONB DEFAULT NULL,
        webhook_last_triggered TIMESTAMP DEFAULT NULL,
        webhook_trigger_count INTEGER DEFAULT 0
      );
    `);
    
    // Remove DEFAULT 'default-user' from existing tables if it exists
    await client.query(`
      ALTER TABLE tasks ALTER COLUMN user_id DROP DEFAULT;
      ALTER TABLE tasks ALTER COLUMN user_id SET NOT NULL;
    `).catch(() => {
      // Ignore errors if column already has no default or is already NOT NULL
    });
    
    // Create events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        location VARCHAR(255),
        type VARCHAR(20) DEFAULT 'other' CHECK (type IN ('meeting', 'appointment', 'deadline', 'reminder', 'other')),
        status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        attendees TEXT[] DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        user_id VARCHAR(255) NOT NULL,
        webhook_config JSONB DEFAULT NULL,
        webhook_last_triggered TIMESTAMP DEFAULT NULL,
        webhook_trigger_count INTEGER DEFAULT 0
      );
    `);
    
    // Remove DEFAULT 'default-user' from existing tables if it exists
    await client.query(`
      ALTER TABLE events ALTER COLUMN user_id DROP DEFAULT;
      ALTER TABLE events ALTER COLUMN user_id SET NOT NULL;
    `).catch(() => {
      // Ignore errors if column already has no default or is already NOT NULL
    });
    
    // Create vector embeddings table for RAG
    await client.query(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_type VARCHAR(50) NOT NULL, -- 'task' or 'event'
        content_id UUID NOT NULL,
        content_text TEXT NOT NULL,
        embedding VECTOR(1536), -- OpenAI embedding dimension
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Note: Memory is now handled by Mastra Memory (PostgreSQL-backed)
    // The conversation_history table below stores the actual conversation data
    
    // Create conversation history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        conversation_id VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        actions JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create event webhook logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS event_webhook_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        trigger_time TIMESTAMP NOT NULL,
        request_url TEXT NOT NULL,
        request_method VARCHAR(10) NOT NULL,
        request_headers JSONB,
        request_body JSONB,
        response_status INTEGER,
        response_body TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        success BOOLEAN NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create task webhook logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_webhook_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        trigger_event VARCHAR(50) NOT NULL,
        previous_status VARCHAR(50),
        new_status VARCHAR(50),
        request_url TEXT NOT NULL,
        request_method VARCHAR(10) NOT NULL,
        request_headers JSONB,
        request_body JSONB,
        response_status INTEGER,
        response_body TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        success BOOLEAN NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create push notification subscriptions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        keys JSONB NOT NULL,
        alarm_settings JSONB NOT NULL DEFAULT '{"enabled": false, "minutesBefore": 15, "soundEnabled": true, "showNotification": true}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create push notification logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_notification_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        event_id UUID,
        subscription_endpoint TEXT,
        payload TEXT,
        success BOOLEAN DEFAULT false,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Add last_notification_sent column to events table if not exists
    await client.query(`
      ALTER TABLE events 
      ADD COLUMN IF NOT EXISTS last_notification_sent TIMESTAMP;
    `).catch(() => {
      // Ignore if column already exists
    });
    
    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
      
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
      CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
      CREATE INDEX IF NOT EXISTS idx_events_end_date ON events(end_date);
      CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
      
      CREATE INDEX IF NOT EXISTS idx_embeddings_content_type ON embeddings(content_type);
      CREATE INDEX IF NOT EXISTS idx_embeddings_content_id ON embeddings(content_id);
      
      CREATE INDEX IF NOT EXISTS idx_conversation_user_id ON conversation_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_session_id ON conversation_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_conversation_id ON conversation_history(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_created_at ON conversation_history(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON event_webhook_logs(event_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_triggered_at ON event_webhook_logs(triggered_at);
      CREATE INDEX IF NOT EXISTS idx_task_webhook_logs_task_id ON task_webhook_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_webhook_logs_triggered_at ON task_webhook_logs(triggered_at);
      CREATE INDEX IF NOT EXISTS idx_task_webhook_logs_trigger_event ON task_webhook_logs(trigger_event);
      
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
      CREATE INDEX IF NOT EXISTS idx_push_logs_user_id ON push_notification_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_push_logs_event_id ON push_notification_logs(event_id);
      CREATE INDEX IF NOT EXISTS idx_push_logs_created_at ON push_notification_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_last_notification ON events(last_notification_sent);
    `);
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    console.error('\n🔍 Debugging Information:');
    console.error('  HOST:', process.env.POSTGRES_HOST || 'localhost');
    console.error('  PORT:', process.env.POSTGRES_PORT || '5432');
    console.error('  DB:', process.env.POSTGRES_DB || 'derplanner_task_event_planner');
    console.error('  USER:', process.env.POSTGRES_USER || 'postgres');
    console.error('\n💡 Solutions:');
    console.error('  1. Make sure PostgreSQL is running');
    console.error('  2. Check the credentials in .env file');
    console.error('  3. Verify the database exists: derplanner_task_event_planner');
    console.error('  4. Check if PostgreSQL is listening on port 5432');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Database query helper
export const query = async (text: string, params?: any[]): Promise<any> => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

// Transaction helper
export const withTransaction = async <T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export default pool;
