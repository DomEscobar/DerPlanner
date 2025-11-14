import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { query, withTransaction } from '../../config/database';
import { Event, EventSchema } from '../../types';

// Create Event Tool
export const createEventTool = createTool({
  id: 'create_event',
  description: 'Create a new event with title, description, start/end dates, and optional location. IMPORTANT: Always calculate dates relative to the CURRENT DATE provided in the system message!',
  inputSchema: z.object({
    title: z.string().describe('Event title'),
    description: z.string().optional().describe('Event description'),
    startDate: z.string().describe('Start date in ISO format (MUST be calculated from the current date/time provided in system message)'),
    endDate: z.string().describe('End date in ISO format (MUST be calculated from the current date/time provided in system message)'),
    location: z.string().optional().describe('Event location'),
    type: z.enum(['meeting', 'appointment', 'deadline', 'reminder', 'other']).default('other').describe('Event type'),
    attendees: z.array(z.string()).default([]).describe('List of attendees'),
    metadata: z.record(z.any()).optional().describe('Additional metadata'),
    userId: z.string().describe('User ID for event ownership')
  }),
  execute: async ({ context }) => {
    const { title, description, startDate, endDate, location, type, attendees, metadata, userId } = context;
    try {
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      
      if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
        return {
          success: false,
          error: 'Invalid date format for startDate or endDate'
        };
      }
      
      const result = await query(
        `INSERT INTO events (title, description, start_date, end_date, location, type, attendees, metadata, user_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled')
         RETURNING id, title, description, start_date as "startDate", end_date as "endDate", location, type, attendees, metadata, user_id as "userId", status, created_at as "createdAt", updated_at as "updatedAt"`,
        [title, description || null, startDateObj.toISOString(), endDateObj.toISOString(), location || null, type || 'other', attendees || [], JSON.stringify(metadata || {}), userId]
      );
      
      return {
        success: true,
        event: result.rows[0],
        message: `Event "${title}" created successfully`
      };
    } catch (error) {
      console.error('Error creating event:', error);
      return {
        success: false,
        error: `Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Get Event Tool
export const getEventTool = createTool({
  id: 'get_event',
  description: 'Retrieve an event by ID',
  inputSchema: z.object({
    eventId: z.string().describe('Event ID')
  }),
  execute: async ({ context }) => {
    const { eventId } = context;
    try {
      const result = await query('SELECT * FROM events WHERE id = $1', [eventId]);
      
      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Event not found'
        };
      }
      
      return {
        success: true,
        event: result.rows[0]
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get event: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Update Event Tool
export const updateEventTool = createTool({
  id: 'update_event',
  description: 'Update an existing event',
  inputSchema: z.object({
    eventId: z.string().describe('Event ID'),
    title: z.string().optional().describe('New event title'),
    description: z.string().optional().describe('New event description'),
    startDate: z.string().optional().describe('New start date in ISO format'),
    endDate: z.string().optional().describe('New end date in ISO format'),
    location: z.string().optional().describe('New event location'),
    type: z.enum(['meeting', 'appointment', 'deadline', 'reminder', 'other']).optional().describe('Event type'),
    status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional().describe('Event status'),
    attendees: z.array(z.string()).optional().describe('List of attendees'),
    metadata: z.record(z.any()).optional().describe('Additional metadata')
  }),
  execute: async ({ context }) => {
    const { eventId, ...updates } = context;
    try {
      const updateFields = [];
      const values = [];
      let paramCount = 1;
      
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
          if (key === 'startDate') {
            const dateObj = new Date(value as string);
            if (isNaN(dateObj.getTime())) {
              throw new Error('Invalid startDate format');
            }
            updateFields.push(`start_date = $${paramCount}`);
            values.push(dateObj.toISOString());
          } else if (key === 'endDate') {
            const dateObj = new Date(value as string);
            if (isNaN(dateObj.getTime())) {
              throw new Error('Invalid endDate format');
            }
            updateFields.push(`end_date = $${paramCount}`);
            values.push(dateObj.toISOString());
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
      values.push(eventId);
      
      const result = await query(
        `UPDATE events SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );
      
      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Event not found'
        };
      }
      
      return {
        success: true,
        event: result.rows[0],
        message: 'Event updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update event: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Delete Event Tool
export const deleteEventTool = createTool({
  id: 'delete_event',
  description: 'Delete an event by ID',
  inputSchema: z.object({
    eventId: z.string().describe('Event ID')
  }),
  execute: async ({ context }) => {
    const { eventId } = context;
    try {
      const result = await query('DELETE FROM events WHERE id = $1 RETURNING *', [eventId]);
      
      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Event not found'
        };
      }
      
      return {
        success: true,
        message: 'Event deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete event: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// List Events Tool
export const listEventsTool = createTool({
  id: 'list_events',
  description: 'List events with optional filtering',
  inputSchema: z.object({
    userId: z.string().describe('User ID to filter events'),
    type: z.enum(['meeting', 'appointment', 'deadline', 'reminder', 'other']).optional().describe('Filter by type'),
    status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional().describe('Filter by status'),
    startDateFrom: z.string().optional().describe('Filter events from this date (ISO format)'),
    startDateTo: z.string().optional().describe('Filter events until this date (ISO format)'),
    limit: z.number().default(10).describe('Maximum number of events to return'),
    offset: z.number().default(0).describe('Number of events to skip'),
    search: z.string().optional().describe('Search in title and description')
  }),
  execute: async ({ context }) => {
    const { userId, type, status, startDateFrom, startDateTo, limit, offset, search } = context;
    try {
      let whereClause = 'WHERE user_id = $1';
      const values: any[] = [userId];
      let paramCount = 2;
      
      const conditions = ['user_id = $1'];
      
      if (type) {
        conditions.push(`type = $${paramCount}`);
        values.push(type);
        paramCount++;
      }
      
      if (status) {
        conditions.push(`status = $${paramCount}`);
        values.push(status);
        paramCount++;
      }
      
      if (startDateFrom) {
        const fromDate = new Date(startDateFrom);
        if (isNaN(fromDate.getTime())) {
          return {
            success: false,
            error: 'Invalid startDateFrom format'
          };
        }
        conditions.push(`start_date >= $${paramCount}`);
        values.push(fromDate.toISOString());
        paramCount++;
      }
      
      if (startDateTo) {
        const toDate = new Date(startDateTo);
        if (isNaN(toDate.getTime())) {
          return {
            success: false,
            error: 'Invalid startDateTo format'
          };
        }
        conditions.push(`start_date <= $${paramCount}`);
        values.push(toDate.toISOString());
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
        `SELECT * FROM events ${whereClause} ORDER BY start_date ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        values
      );
      
      const countResult = await query(
        `SELECT COUNT(*) FROM events ${whereClause}`,
        values.slice(0, -2)
      );
      
      return {
        success: true,
        events: result.rows,
        total: parseInt(countResult.rows[0].count),
        pagination: {
          limit,
          offset,
          total: parseInt(countResult.rows[0].count)
        }
      };
    } catch (error) {
      console.error('Error listing events:', error);
      return {
        success: false,
        error: `Failed to list events: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Get Upcoming Events Tool
export const getUpcomingEventsTool = createTool({
  id: 'get_upcoming_events',
  description: 'Get events happening in the next specified time period',
  inputSchema: z.object({
    userId: z.string().describe('User ID to filter events'),
    hours: z.number().default(24).describe('Number of hours to look ahead'),
    limit: z.number().default(10).describe('Maximum number of events to return')
  }),
  execute: async ({ context }) => {
    const { userId, hours, limit } = context;
    try {
      const result = await query(
        `SELECT * FROM events 
         WHERE user_id = $1
           AND start_date BETWEEN NOW() AND NOW() + INTERVAL '${hours} hours'
           AND status = 'scheduled'
         ORDER BY start_date ASC 
         LIMIT $2`,
        [userId, limit]
      );
      
      return {
        success: true,
        events: result.rows,
        timeRange: `${hours} hours from now`
      };
    } catch (error) {
      console.error('Error getting upcoming events:', error);
      return {
        success: false,
        error: `Failed to get upcoming events: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

// Search Events Tool (using vector similarity)
export const searchEventsTool = createTool({
  id: 'search_events',
  description: 'Search events using semantic similarity',
  inputSchema: z.object({
    userId: z.string().describe('User ID to filter events'),
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
        `SELECT e.*, 
                ts_rank(to_tsvector('english', e.title || ' ' || COALESCE(e.description, '')), 
                       plainto_tsquery('english', $1)) as rank
         FROM events e
         WHERE user_id = $2
           AND to_tsvector('english', e.title || ' ' || COALESCE(e.description, '')) @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $3`,
        [searchQuery, userId, limit]
      );
      
      return {
        success: true,
        events: result.rows,
        query: searchQuery
      };
    } catch (error) {
      console.error('Error searching events:', error);
      return {
        success: false,
        error: `Failed to search events: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});
