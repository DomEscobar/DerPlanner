import { useState, useCallback, useEffect } from 'react';
import { chatApi, Event } from '@/lib/api';
import { timezoneService } from '@/lib/timezone';

export interface LocalEvent {
  id: string;
  title: string;
  date: Date;
  endDate: Date;
  type: 'post' | 'story' | 'reel' | 'campaign' | 'meeting' | 'appointment' | 'deadline' | 'reminder' | 'other';
  description?: string;
  location?: string;
  attendees?: string[];
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  metadata?: Record<string, any>;
  webhookConfig?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export interface UseEventsOptions {
  userId?: string;
  autoSync?: boolean;
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

export const useEvents = (options: UseEventsOptions = {}) => {
  const {
    userId,
    autoSync = true,
    onError,
    onSuccess,
  } = options;
  
  if (!userId) {
    throw new Error('userId is required for useEvents hook');
  }

  const [events, setEvents] = useState<LocalEvent[]>([]);

  const [isLoading, setIsLoading] = useState(false);

  // Convert local event to API event format
  const convertToApiEvent = (event: LocalEvent): Partial<Event> => ({
    title: event.title,
    description: event.description,
    startDate: timezoneService.toUTCString(event.date),
    endDate: timezoneService.toUTCString(event.endDate),
    location: event.location,
    type: event.type as Event['type'],
    attendees: event.attendees || [],
  });

  // Convert API event to local event format
  const convertFromApiEvent = (event: any): LocalEvent => ({
    id: event.id,
    title: event.title,
    date: timezoneService.fromUTCString(event.startDate || event.start_date),
    endDate: timezoneService.fromUTCString(event.endDate || event.end_date),
    type: event.type as LocalEvent['type'],
    description: event.description,
    location: event.location,
    attendees: event.attendees || [],
    status: event.status,
    metadata: event.metadata,
    webhookConfig: event.webhook_config || event.webhookConfig,
    createdAt: event.createdAt || event.created_at,
    updatedAt: event.updatedAt || event.updated_at,
  });

  // Create a new event directly via API
  const createEvent = useCallback(async (description: string, eventDate?: Date) => {
    if (!description.trim()) return;

    setIsLoading(true);
    try {
      // Use provided date or current date/time
      const startDate = eventDate || new Date();
      const endDate = new Date(startDate.getTime() + 3600000); // 1 hour later
      
      const apiEvent = await chatApi.createEvent({
        title: description,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        type: 'other',
        status: 'scheduled',
        attendees: []
      }, userId);
      
      const newEvent = convertFromApiEvent(apiEvent);
      setEvents(prev => [...prev, newEvent]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create event';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [userId, onError, onSuccess]);

  // Update an event directly via API
  const updateEvent = useCallback(async (eventId: string, updates: Partial<LocalEvent>) => {
    const event = events.find(e => e.id === eventId);
    if (!event) return;

    setIsLoading(true);
    try {
      const apiUpdates: Partial<Event> = {};
      
      if (updates.title !== undefined) apiUpdates.title = updates.title;
      if (updates.description !== undefined) apiUpdates.description = updates.description;
      if (updates.date !== undefined) apiUpdates.startDate = updates.date.toISOString();
      if (updates.endDate !== undefined) apiUpdates.endDate = updates.endDate.toISOString();
      if (updates.type !== undefined) apiUpdates.type = updates.type as Event['type'];
      if (updates.location !== undefined) apiUpdates.location = updates.location;
      if (updates.attendees !== undefined) apiUpdates.attendees = updates.attendees;
      if (updates.status !== undefined) apiUpdates.status = updates.status;
      if (updates.metadata !== undefined) apiUpdates.metadata = updates.metadata;
      if (updates.webhookConfig !== undefined) apiUpdates.webhookConfig = updates.webhookConfig;

      const updatedApiEvent = await chatApi.updateEvent(eventId, apiUpdates);
      const updatedEvent = convertFromApiEvent(updatedApiEvent);
      
      setEvents(prev => prev.map(e => e.id === eventId ? updatedEvent : e));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update event';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [events, onError, onSuccess]);

  // Delete an event directly via API
  const deleteEvent = useCallback(async (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event) return;

    setIsLoading(true);
    try {
      await chatApi.deleteEvent(eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete event';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [events, onError, onSuccess]);

  // Get events from backend
  const refreshEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiEvents = await chatApi.getEvents(userId);
      const localEvents = apiEvents.map(convertFromApiEvent);
      setEvents(localEvents);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh events';
      console.error('Failed to refresh events:', error);
      // Keep existing events on error
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [userId]); // Removed onError and onSuccess from dependencies to prevent infinite loop

  // Get upcoming events
  const getUpcomingEvents = useCallback(async (hours: number = 24) => {
    setIsLoading(true);
    try {
      const apiEvents = await chatApi.getEvents(userId, { upcoming: true });
      const now = new Date();
      const futureTime = new Date(now.getTime() + hours * 3600000);
      
      const upcomingEvents = apiEvents
        .map(convertFromApiEvent)
        .filter(event => event.date >= now && event.date <= futureTime);
      
      return upcomingEvents;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get upcoming events';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
    return [];
  }, [userId, onError, onSuccess]);

  // Search events
  const searchEvents = useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      const results = await chatApi.search(query, 10);
      if (results) {
        // Handle search results
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to search events';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [onError, onSuccess]);

  // Get events for a specific date
  const getEventsForDate = useCallback((date: Date) => {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    return events.filter(event => {
      const startDate = new Date(event.date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(event.endDate);
      endDate.setHours(0, 0, 0, 0);
      
      return targetDate >= startDate && targetDate <= endDate;
    });
  }, [events]);

  // Auto-sync events on mount
  useEffect(() => {
    if (autoSync) {
      refreshEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]); // Only run when autoSync changes, not when refreshEvents changes

  return {
    events,
    isLoading,
    createEvent,
    updateEvent,
    deleteEvent,
    refreshEvents,
    getUpcomingEvents,
    searchEvents,
    getEventsForDate,
  };
};
