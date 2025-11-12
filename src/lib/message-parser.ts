/**
 * Utility functions for parsing structured data from message content
 */

interface ParsedTask {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: Date | string;
  tags?: string[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  metadata?: Record<string, any>;
}

interface ParsedEvent {
  id: string;
  title: string;
  description?: string;
  startDate: Date | string;
  endDate: Date | string;
  location?: string;
  type: "meeting" | "appointment" | "deadline" | "reminder" | "other";
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  attendees?: string[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  metadata?: Record<string, any>;
}

/**
 * Parses task references from message text
 * Format: [Task ID: xxx, Title: "xxx", Priority: xxx, Status: xxx, ...]
 */
export function parseTasksFromText(text: string): { tasks: ParsedTask[]; cleanedText: string } {
  const taskPattern = /\[Task\s+(?:ID:\s*([^,]+),?\s*)?(?:Title:\s*"([^"]+)"|Title:\s*([^,]+))(?:,\s*Description:\s*"([^"]+)"|,\s*Description:\s*([^,\]]+))?(?:,\s*Priority:\s*(low|medium|high|urgent))?(?:,\s*Status:\s*(pending|in_progress|completed|cancelled))?(?:,\s*Due(?:\s+Date)?:\s*"([^"]+)"|,\s*Due(?:\s+Date)?:\s*([^,\]]+))?(?:,\s*Tags:\s*\[([^\]]+)\])?[^\]]*\]/gi;
  
  const tasks: ParsedTask[] = [];
  let cleanedText = text;
  
  let match;
  while ((match = taskPattern.exec(text)) !== null) {
    const [fullMatch, id, quotedTitle, unquotedTitle, quotedDesc, unquotedDesc, priority, status, quotedDueDate, unquotedDueDate, tags] = match;
    
    const title = quotedTitle || unquotedTitle;
    if (!title) continue;
    
    const task: ParsedTask = {
      id: id?.trim() || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: title.trim(),
      description: (quotedDesc || unquotedDesc)?.trim(),
      priority: (priority as any) || "medium",
      status: (status as any) || "pending",
    };
    
    if (quotedDueDate || unquotedDueDate) {
      task.dueDate = (quotedDueDate || unquotedDueDate).trim();
    }
    
    if (tags) {
      task.tags = tags.split(',').map(t => t.trim().replace(/['"]/g, ''));
    }
    
    tasks.push(task);
    
    // Remove the task reference from text (optional)
    cleanedText = cleanedText.replace(fullMatch, '').trim();
  }
  
  return { tasks, cleanedText };
}

/**
 * Parses event references from message text
 * Format: [Event ID: xxx, Title: "xxx", Start: xxx, End: xxx, ...]
 */
export function parseEventsFromText(text: string): { events: ParsedEvent[]; cleanedText: string } {
  const eventPattern = /\[Event\s+(?:ID:\s*([^,]+),?\s*)?(?:Title:\s*"([^"]+)"|Title:\s*([^,]+))(?:,\s*Description:\s*"([^"]+)"|,\s*Description:\s*([^,\]]+))?(?:,\s*Start(?:\s+Date)?:\s*"([^"]+)"|,\s*Start(?:\s+Date)?:\s*([^,\]]+))?(?:,\s*End(?:\s+Date)?:\s*"([^"]+)"|,\s*End(?:\s+Date)?:\s*([^,\]]+))?(?:,\s*Type:\s*(meeting|appointment|deadline|reminder|other))?(?:,\s*Status:\s*(scheduled|in_progress|completed|cancelled))?(?:,\s*Location:\s*"([^"]+)"|,\s*Location:\s*([^,\]]+))?[^\]]*\]/gi;
  
  const events: ParsedEvent[] = [];
  let cleanedText = text;
  
  let match;
  while ((match = eventPattern.exec(text)) !== null) {
    const [fullMatch, id, quotedTitle, unquotedTitle, quotedDesc, unquotedDesc, quotedStart, unquotedStart, quotedEnd, unquotedEnd, type, status, quotedLocation, unquotedLocation] = match;
    
    const title = quotedTitle || unquotedTitle;
    if (!title) continue;
    
    const startDate = (quotedStart || unquotedStart)?.trim() || new Date().toISOString();
    const endDate = (quotedEnd || unquotedEnd)?.trim() || new Date().toISOString();
    
    const event: ParsedEvent = {
      id: id?.trim() || `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: title.trim(),
      description: (quotedDesc || unquotedDesc)?.trim(),
      startDate,
      endDate,
      type: (type as any) || "other",
      status: (status as any) || "scheduled",
    };
    
    if (quotedLocation || unquotedLocation) {
      event.location = (quotedLocation || unquotedLocation).trim();
    }
    
    events.push(event);
    
    // Remove the event reference from text (optional)
    cleanedText = cleanedText.replace(fullMatch, '').trim();
  }
  
  return { events, cleanedText };
}

/**
 * Parses all structured data from message text
 */
export function parseMessageContent(text: string, options?: { keepReferences?: boolean }) {
  const { tasks, cleanedText: textAfterTasks } = parseTasksFromText(text);
  const { events, cleanedText: textAfterEvents } = parseEventsFromText(textAfterTasks);
  
  // By default, remove references from the text. Set keepReferences: true to preserve them.
  return {
    tasks,
    events,
    cleanedText: options?.keepReferences ? text : textAfterEvents,
  };
}

