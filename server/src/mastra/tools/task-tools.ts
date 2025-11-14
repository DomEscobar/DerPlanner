import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { query, withTransaction } from '../../config/database';
import { Task, TaskSchema } from '../../types';
import { webhookService } from '../../services/webhook-service';

// Create Task Tool
export const createTaskTool = createTool({
  id: 'create_task',
  description: 'Create a new task with title, description, priority, and optional due date',
  inputSchema: z.object({
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium').describe('Task priority'),
    dueDate: z.string().optional().describe('Due date in ISO format'),
    tags: z.array(z.string()).default([]).describe('Task tags'),
    metadata: z.record(z.any()).optional().describe('Additional metadata'),
    userId: z.string().describe('User ID for task ownership')
  }),
  execute: async ({ context }) => {
    const { title, description, priority, dueDate, tags, metadata, userId } = context;
    try {
      let dueDateISO: string | null = null;
      if (dueDate) {
        const dueDateObj = new Date(dueDate);
        if (isNaN(dueDateObj.getTime())) {
          return {
            success: false,
            error: 'Invalid dueDate format'
          };
        }
        dueDateISO = dueDateObj.toISOString();
      }
      
      const result = await query(
        `INSERT INTO tasks (title, description, priority, due_date, tags, metadata, user_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id, title, description, priority, due_date as "dueDate", tags, metadata, user_id as "userId", status, created_at as "createdAt", updated_at as "updatedAt", webhook_config`,
        [title, description || null, priority || 'medium', dueDateISO, tags || [], JSON.stringify(metadata || {}), userId]
      );
      
      const task = result.rows[0];
      
      // Trigger webhook if configured for 'created' event
      if (task.webhook_config && task.webhook_config.enabled) {
        const webhookConfig = task.webhook_config;
        webhookService.executeTaskWebhook(
          task.id,
          task,
          webhookConfig,
          'created',
          undefined,
          'pending'
        ).catch(error => {
          console.error('Error triggering task created webhook:', error);
        });
      }
      
      return {
        success: true,
        task,
        message: `Task "${title}" created successfully`
      };
    } catch (error) {
      console.error('Error creating task:', error);
      return {
        success: false,
        error: `Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Get Task Tool
export const getTaskTool = createTool({
  id: 'get_task',
  description: 'Retrieve a task by ID',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID')
  }),
  execute: async ({ context }) => {
    const { taskId } = context;
    try {
      const result = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      
      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Task not found'
        };
      }
      
      return {
        success: true,
        task: result.rows[0]
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get task: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Update Task Tool
export const updateTaskTool = createTool({
  id: 'update_task',
  description: 'Update an existing task',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID'),
    title: z.string().optional().describe('New task title'),
    description: z.string().optional().describe('New task description'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().describe('Task status'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority'),
    dueDate: z.string().optional().describe('Due date in ISO format'),
    tags: z.array(z.string()).optional().describe('Task tags'),
    metadata: z.record(z.any()).optional().describe('Additional metadata')
  }),
  execute: async ({ context }) => {
    const { taskId, ...updates } = context;
    try {
      // Get current task state before update (for webhook comparison)
      const currentResult = await query(
        'SELECT status, webhook_config FROM tasks WHERE id = $1',
        [taskId]
      );
      
      if (currentResult.rows.length === 0) {
        return {
          success: false,
          error: 'Task not found'
        };
      }
      
      const previousStatus = currentResult.rows[0].status;
      const webhookConfig = currentResult.rows[0].webhook_config;
      
      const updateFields = [];
      const values = [];
      let paramCount = 1;
      
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
          if (key === 'dueDate') {
            if (value) {
              const dateObj = new Date(value as string);
              if (isNaN(dateObj.getTime())) {
                throw new Error('Invalid dueDate format');
              }
              updateFields.push(`due_date = $${paramCount}`);
              values.push(dateObj.toISOString());
            } else {
              updateFields.push(`due_date = $${paramCount}`);
              values.push(null);
            }
          } else {
            updateFields.push(`${key} = $${paramCount}`);
            values.push(value);
          }
          paramCount++;
        }
      });
      
      if (updateFields.length === 0) {
        return {
          success: false,
          error: 'No fields to update'
        };
      }
      
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(taskId);
      
      const result = await query(
        `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );
      
      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Task not found'
        };
      }
      
      const updatedTask = result.rows[0];
      const newStatus = updatedTask.status;
      
      // Trigger webhook if configured
      if (webhookConfig && webhookConfig.enabled) {
        let triggerEvent = 'updated';
        if (previousStatus !== newStatus) {
          triggerEvent = 'status_changed';
          if (newStatus === 'completed') {
            triggerEvent = 'completed';
          }
        }
        
        webhookService.executeTaskWebhook(
          taskId,
          updatedTask,
          webhookConfig,
          triggerEvent,
          previousStatus,
          newStatus
        ).catch(error => {
          console.error('Error triggering task webhook:', error);
        });
      }
      
      return {
        success: true,
        task: updatedTask,
        message: 'Task updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Delete Task Tool
export const deleteTaskTool = createTool({
  id: 'delete_task',
  description: 'Delete a task by ID',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID')
  }),
  execute: async ({ context }) => {
    const { taskId } = context;
    try {
      const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING *', [taskId]);
      
      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Task not found'
        };
      }
      
      return {
        success: true,
        message: 'Task deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete task: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// List Tasks Tool
export const listTasksTool = createTool({
  id: 'list_tasks',
  description: 'List tasks with optional filtering',
  inputSchema: z.object({
    userId: z.string().describe('User ID to filter tasks'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().describe('Filter by status'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Filter by priority'),
    limit: z.number().default(10).describe('Maximum number of tasks to return'),
    offset: z.number().default(0).describe('Number of tasks to skip'),
    search: z.string().optional().describe('Search in title and description')
  }),
  execute: async ({ context }) => {
    const { userId, status, priority, limit, offset, search } = context;
    try {
      let whereClause = 'WHERE user_id = $1';
      const values: any[] = [userId];
      let paramCount = 2;
      
      const conditions = ['user_id = $1'];
      
      if (status) {
        conditions.push(`status = $${paramCount}`);
        values.push(status);
        paramCount++;
      }
      
      if (priority) {
        conditions.push(`priority = $${paramCount}`);
        values.push(priority);
        paramCount++;
      }
      
      if (search) {
        conditions.push(`(title ILIKE $${paramCount} OR description ILIKE $${paramCount})`);
        values.push(`%${search}%`);
        paramCount++;
      }
      
      whereClause = `WHERE ${conditions.join(' AND ')}`;
      values.push(limit, offset);
      
      const result = await query(
        `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        values
      );
      
      const countResult = await query(
        `SELECT COUNT(*) FROM tasks ${whereClause}`,
        values.slice(0, -2)
      );
      
      return {
        success: true,
        tasks: result.rows,
        total: parseInt(countResult.rows[0].count),
        pagination: {
          limit,
          offset,
          total: parseInt(countResult.rows[0].count)
        }
      };
    } catch (error) {
      console.error('Error listing tasks:', error);
      return {
        success: false,
        error: `Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Search Tasks Tool (using vector similarity)
export const searchTasksTool = createTool({
  id: 'search_tasks',
  description: 'Search tasks using semantic similarity',
  inputSchema: z.object({
    userId: z.string().describe('User ID to filter tasks'),
    query: z.string().describe('Search query'),
    limit: z.number().default(5).describe('Maximum number of results'),
    threshold: z.number().default(0.7).describe('Similarity threshold (0-1)')
  }),
  execute: async ({ context }) => {
    const { userId, query: searchQuery, limit, threshold } = context;
    try {
      // This would use the vector search functionality
      // For now, we'll use a simple text search
      const result = await query(
        `SELECT t.*, 
                ts_rank(to_tsvector('english', t.title || ' ' || COALESCE(t.description, '')), 
                       plainto_tsquery('english', $1)) as rank
         FROM tasks t
         WHERE user_id = $2
           AND to_tsvector('english', t.title || ' ' || COALESCE(t.description, '')) @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $3`,
        [searchQuery, userId, limit]
      );
      
      return {
        success: true,
        tasks: result.rows,
        query: searchQuery
      };
    } catch (error) {
      console.error('Error searching tasks:', error);
      return {
        success: false,
        error: `Failed to search tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});
