import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Users, Settings, Repeat, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WebhookSettings } from "./WebhookSettings";
import { chatApi } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { timezoneService } from "@/lib/timezone";

// Event type matching backend schema (server/src/types/index.ts)
interface Event {
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

interface EventPreviewProps {
  events: Event[];
  flattenRecurring?: boolean;
}

export const EventPreview = ({ events, flattenRecurring = false }: EventPreviewProps) => {
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const handleSaveWebhook = async (eventId: string, config: any) => {
    try {
      await chatApi.updateEventWebhook(eventId, config);
    } catch (error) {
      console.error('Failed to save webhook config:', error);
      throw error;
    }
  };

  const handleTestWebhook = async (eventId: string, config: any) => {
    try {
      return await chatApi.testEventWebhook(eventId, config);
    } catch (error) {
      console.error('Failed to test webhook:', error);
      throw error;
    }
  };

  // Group events by recurrence
  const { recurringGroups, standaloneEvents } = useMemo(() => {
    const groups = new Map<string, Event[]>();
    const standalone: Event[] = [];

    events.forEach(event => {
      const recurrenceGroupId = event.metadata?.recurrenceGroupId;
      const isRecurring = event.metadata?.isRecurring;

      if (flattenRecurring && isRecurring && recurrenceGroupId) {
        if (!groups.has(recurrenceGroupId)) {
          groups.set(recurrenceGroupId, []);
        }
        groups.get(recurrenceGroupId)!.push(event);
      } else {
        standalone.push(event);
      }
    });

    // Sort events within each group by start date
    groups.forEach(groupEvents => {
      groupEvents.sort((a, b) => 
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );
    });

    return { recurringGroups: groups, standaloneEvents: standalone };
  }, [events, flattenRecurring]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const formatRecurrencePattern = (pattern?: string) => {
    if (!pattern) return "Recurring";
    
    // Parse pattern like "weekly_tuesday_18:00"
    const parts = pattern.split('_');
    if (parts.length >= 2) {
      const frequency = parts[0];
      const day = parts[1];
      
      const frequencyMap: Record<string, string> = {
        'daily': 'Daily',
        'weekly': 'Weekly',
        'biweekly': 'Bi-weekly',
        'monthly': 'Monthly'
      };
      
      const dayCapitalized = day.charAt(0).toUpperCase() + day.slice(1);
      
      if (frequency === 'daily') {
        return 'Every day';
      } else if (frequency === 'weekly') {
        return `Every ${dayCapitalized}`;
      } else if (frequency === 'biweekly') {
        return `Every other ${dayCapitalized}`;
      } else if (frequency === 'monthly') {
        return `Monthly on the ${dayCapitalized}`;
      }
    }
    
    return "Recurring";
  };

  const getTypeColor = (type: Event["type"]) => {
    switch (type) {
      case "meeting": 
        return "bg-primary/10 text-primary border-primary/20";
      case "appointment": 
        return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "deadline": 
        return "bg-destructive/10 text-destructive border-destructive/20";
      case "reminder": 
        return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
      case "other": 
        return "bg-secondary/10 text-secondary-foreground border-secondary/20";
    }
  };

  const getStatusColor = (status: Event["status"]) => {
    switch (status) {
      case "scheduled":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "in_progress":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "cancelled":
        return "bg-gray-100 text-gray-600 border-gray-200";
    }
  };

  const formatDate = (date: Date | string) => {
    return timezoneService.formatDate(date);
  };

  const formatTime = (date: Date | string) => {
    return timezoneService.formatTime(date);
  };

  const formatDateRange = (startDate: Date | string, endDate: Date | string) => {
    return timezoneService.formatDateRange(startDate, endDate);
  };

  const renderEvent = (event: Event) => (
    <Card
      key={event.id}
      className={`p-2.5 md:p-3 transition-all hover:shadow-md border ${
        event.status === 'cancelled' ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <Calendar className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Type and Status Badges */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1 rounded-full text-[10px] md:text-xs font-semibold uppercase tracking-wide border ${getTypeColor(event.type)}`}>
                {event.type}
              </div>
              <Badge 
                variant="outline" 
                className={`text-[10px] md:text-xs px-1.5 py-0 md:px-2 ${getStatusColor(event.status)}`}
              >
                {event.status.replace('_', ' ')}
              </Badge>
              {event.metadata?.isRecurring && (
                <Badge variant="outline" className="text-[10px] md:text-xs px-1.5 py-0 md:px-2 bg-purple-50 text-purple-700 border-purple-200">
                  <Repeat className="h-3 w-3 mr-1" />
                  Recurring
                </Badge>
              )}
            </div>

            {/* Title */}
            <p className="text-xs md:text-sm font-medium leading-snug mb-1">
              {event.title}
            </p>

            {/* Description */}
            {event.description && (
              <p className="text-[11px] md:text-xs text-muted-foreground mb-1.5 line-clamp-2 leading-tight">
                {event.description}
              </p>
            )}

            {/* Date and Time */}
            <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="text-[11px] md:text-xs">
                {formatDateRange(event.startDate, event.endDate)}
              </span>
            </div>

            {/* Location */}
            {event.location && (
              <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="text-[11px] md:text-xs">{event.location}</span>
              </div>
            )}

            {/* Attendees */}
            {event.attendees && event.attendees.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                <Users className="h-3 w-3" />
                <span className="text-[11px] md:text-xs">
                  {event.attendees.length} {event.attendees.length === 1 ? 'attendee' : 'attendees'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );

  const renderRecurringGroup = (groupId: string, groupEvents: Event[]) => {
    const isExpanded = expandedGroups.has(groupId);
    const firstEvent = groupEvents[0];
    const pattern = firstEvent.metadata?.recurrencePattern;
    
    return (
      <Collapsible
        key={groupId}
        open={isExpanded}
        onOpenChange={() => toggleGroup(groupId)}
      >
        <Card className="p-2.5 md:p-3 transition-all hover:shadow-md border bg-purple-50/30">
          <CollapsibleTrigger asChild>
            <div className="flex items-start gap-2 cursor-pointer">
              <div className="mt-0.5">
                <Repeat className="h-4 w-4 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1 rounded-full text-[10px] md:text-xs font-semibold uppercase tracking-wide border ${getTypeColor(firstEvent.type)}`}>
                    {firstEvent.type}
                  </div>
                  <Badge variant="outline" className="text-[10px] md:text-xs px-1.5 py-0 md:px-2 bg-purple-100 text-purple-800 border-purple-200">
                    <Repeat className="h-3 w-3 mr-1" />
                    {formatRecurrencePattern(pattern)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] md:text-xs px-1.5 py-0 md:px-2">
                    {groupEvents.length} occurrences
                  </Badge>
                </div>
                
                <p className="text-xs md:text-sm font-medium leading-snug mb-1">
                  {firstEvent.title}
                </p>
                
                {firstEvent.description && (
                  <p className="text-[11px] md:text-xs text-muted-foreground mb-1.5 line-clamp-1 leading-tight">
                    {firstEvent.description}
                  </p>
                )}

                <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span className="text-[11px] md:text-xs">
                    {formatDate(groupEvents[0].startDate)} - {formatDate(groupEvents[groupEvents.length - 1].startDate)}
                  </span>
                </div>
              </div>
              <div className="mt-0.5">
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CollapsibleTrigger>
          
          <CollapsibleContent className="mt-2 space-y-2 pl-6">
            {groupEvents.map((event) => (
              <div key={event.id} className="border-l-2 border-purple-200 pl-3">
                <div className="text-[11px] md:text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3 inline mr-1" />
                  {formatDateRange(event.startDate, event.endDate)}
                </div>
                {event.location && (
                  <div className="text-[11px] md:text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 inline mr-1" />
                    {event.location}
                  </div>
                )}
              </div>
            ))}
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  };

  return (
    <div className="my-2 space-y-1.5 max-w-2xl">
      {/* Render recurring groups */}
      {Array.from(recurringGroups.entries()).map(([groupId, groupEvents]) =>
        renderRecurringGroup(groupId, groupEvents)
      )}
      
      {/* Render standalone events */}
      {standaloneEvents.map(event => renderEvent(event))}
    </div>
  );
};
