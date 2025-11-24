import React, { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, Trash2, X, Settings, ChevronLeft, ChevronRight, CalendarDays, CalendarRange } from "lucide-react";
import { WebhookSettings } from "@/components/WebhookSettings";
import { useEvents } from "@/hooks/useEvents";
import { useToast } from "@/hooks/use-toast";
import { getUserId, getCalendarViewMode, saveCalendarViewMode } from "@/lib/storage";
import { chatApi } from "@/lib/api";
import { timezoneService } from "@/lib/timezone";

// Extended Event interface matching backend schema
interface ExtendedEvent {
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
  webhookConfig?: Record<string, any>;
}

export const CalendarView = () => {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week">(() => getCalendarViewMode());
  const [newEventTitle, setNewEventTitle] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [newEventDateTime, setNewEventDateTime] = useState<Date | undefined>();
  const [editingEvent, setEditingEvent] = useState<ExtendedEvent | null>(null);
  const [attendeeInput, setAttendeeInput] = useState("");
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [dayEventsModal, setDayEventsModal] = useState<{ date: Date; events: any[] } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    saveCalendarViewMode(viewMode);
  }, [viewMode]);

  const handleSaveWebhook = async (eventId: string, config: any) => {
    try {
      await chatApi.updateEventWebhook(eventId, config);
      
      // Update the editingEvent state to reflect the new webhook config
      if (editingEvent && editingEvent.id === eventId) {
        setEditingEvent({
          ...editingEvent,
          webhookConfig: config
        });
      }
      
      // Refresh events to get the latest data
      await refreshEvents();
      
      toast({
        title: "Success",
        description: "Webhook configuration saved successfully",
      });
    } catch (error) {
      console.error('Failed to save webhook config:', error);
      toast({
        title: "Error",
        description: "Failed to save webhook configuration",
        variant: "destructive",
      });
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

  const {
    events,
    isLoading,
    createEvent,
    updateEvent,
    deleteEvent,
    refreshEvents,
    getEventsForDate,
  } = useEvents({
    userId: getUserId(),
    onError: (error) => {
      toast({
        title: "Error",
        description: error,
        variant: "destructive",
      });
    },
    onSuccess: (message) => {
      toast({
        title: "Success",
        description: message,
      });
    },
  });

  const selectedDateEvents = getEventsForDate(date || new Date());

  // Convert LocalEvent to ExtendedEvent format for display
  const displayEvents: ExtendedEvent[] = selectedDateEvents.map(event => ({
    id: event.id,
    title: event.title,
    description: event.description,
    startDate: event.date,
    endDate: event.endDate,
    location: event.location,
    type: event.type as ExtendedEvent["type"],
    status: event.status || 'scheduled',
    attendees: event.attendees,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    metadata: event.metadata,
    webhookConfig: event.webhookConfig,
  }));

  // Get dates that have events for showing indicators
  const datesWithEvents = useMemo(() => {
    const dates = new Set<string>();
    events.forEach(event => {
      // Add all dates in the range from start to end
      const startDate = new Date(event.date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(event.endDate);
      endDate.setHours(0, 0, 0, 0);

      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        dates.add(currentDate.toDateString());
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });
    return dates;
  }, [events]);

  // Check if a date has events
  const hasEvents = (date: Date) => {
    return datesWithEvents.has(date.toDateString());
  };

  const handleAddEvent = async () => {
    if (!newEventTitle.trim()) return;

    await createEvent(newEventTitle, newEventDateTime || date);
    setNewEventTitle("");
    setNewEventDateTime(undefined);
    setIsCreatingEvent(false);
  };

  const openCreateEventDialog = (selectedDate: Date) => {
    setNewEventDateTime(selectedDate);
    setIsCreatingEvent(true);
  };

  const showDayEventsModal = (day: Date, events: any[]) => {
    if (events.length === 1) {
      // If only one event, open it directly
      handleEdit({
        id: events[0].id,
        title: events[0].title,
        description: events[0].description,
        startDate: events[0].date,
        endDate: events[0].endDate,
        location: events[0].location,
        type: events[0].type as ExtendedEvent["type"],
        status: events[0].status || 'scheduled',
        attendees: events[0].attendees,
        createdAt: events[0].createdAt,
        updatedAt: events[0].updatedAt,
        metadata: events[0].metadata,
        webhookConfig: events[0].webhookConfig,
      });
    } else if (events.length > 1) {
      // Multiple events, show modal with tabs
      setDayEventsModal({ date: day, events });
    }
  };

  const handleEdit = (event: ExtendedEvent) => {
    setEditingEvent({ ...event });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) return;

    const localEvent = events.find(e => e.id === editingEvent.id);
    if (!localEvent) return;

    await updateEvent(editingEvent.id, {
      title: editingEvent.title,
      description: editingEvent.description,
      date: new Date(editingEvent.startDate),
      endDate: new Date(editingEvent.endDate),
      type: editingEvent.type as any,
      location: editingEvent.location,
      attendees: editingEvent.attendees,
      status: editingEvent.status,
      metadata: editingEvent.metadata,
      webhookConfig: editingEvent.webhookConfig,
    });

    setIsEditModalOpen(false);
    setEditingEvent(null);
  };

  const handleAddAttendee = () => {
    if (!editingEvent || !attendeeInput.trim()) return;

    const currentAttendees = editingEvent.attendees || [];
    if (!currentAttendees.includes(attendeeInput.trim())) {
      setEditingEvent({
        ...editingEvent,
        attendees: [...currentAttendees, attendeeInput.trim()]
      });
    }
    setAttendeeInput("");
  };

  const handleRemoveAttendee = (attendeeToRemove: string) => {
    if (!editingEvent) return;
    setEditingEvent({
      ...editingEvent,
      attendees: (editingEvent.attendees || []).filter(attendee => attendee !== attendeeToRemove)
    });
  };

  const handleDeleteFromModal = async () => {
    if (!editingEvent) return;

    if (confirm('Are you sure you want to delete this event?')) {
      await deleteEvent(editingEvent.id);
      setIsEditModalOpen(false);
      setEditingEvent(null);
    }
  };

  const getWeekStart = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
  };

  const getWeekDays = (d: Date) => {
    const start = getWeekStart(d);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      return date;
    });
  };

  const getMonthDays = (d: Date) => {
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const days = [];
    for (let i = 0; i < 42; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);
      days.push(currentDate);
    }
    return days;
  };

  const weekDays = getWeekDays(date || new Date());
  const monthDays = getMonthDays(date || new Date());

  const goToPreviousPeriod = () => {
    const newDate = new Date(date || new Date());
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setDate(newDate);
  };

  const goToNextPeriod = () => {
    const newDate = new Date(date || new Date());
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setDate(newDate);
  };

  const goToToday = () => {
    setDate(new Date());
  };

  const getEventsForDay = (d: Date) => {
    return events.filter(event => {
      const startDate = new Date(event.date);
      const endDate = new Date(event.endDate || event.date);
      
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      
      const checkDate = new Date(d);
      checkDate.setHours(12, 0, 0, 0);
      
      return checkDate >= startDate && checkDate <= endDate;
    });
  };

  const getEventColor = (eventId: string): string => {
    const colors = [
      "from-blue-500 to-blue-600",
      "from-purple-500 to-purple-600",
      "from-pink-500 to-pink-600",
      "from-red-500 to-red-600",
      "from-orange-500 to-orange-600",
      "from-amber-500 to-amber-600",
      "from-yellow-500 to-yellow-600",
      "from-lime-500 to-lime-600",
      "from-green-500 to-green-600",
      "from-emerald-500 to-emerald-600",
      "from-teal-500 to-teal-600",
      "from-cyan-500 to-cyan-600",
      "from-indigo-500 to-indigo-600",
      "from-violet-500 to-violet-600",
      "from-fuchsia-500 to-fuchsia-600",
      "from-rose-500 to-rose-600",
    ];
    
    let hash = 0;
    for (let i = 0; i < eventId.length; i++) {
      const char = eventId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    const colorIndex = Math.abs(hash) % colors.length;
    return colors[colorIndex];
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
  {/* Header */}
     <div className="border-b bg-white dark:bg-slate-900 shadow-sm">
       <div className="p-2 sm:p-4 space-y-2 sm:space-y-3">
         {/* Compact Navigation Row */}
         <div className="flex items-center justify-between gap-2">
           {/* Navigation Controls */}
           <div className="flex items-center gap-1">
             <Button
               variant="outline"
               size="sm"
               onClick={goToPreviousPeriod}
               className="h-8 w-8 p-0"
             >
               <ChevronLeft className="h-4 w-4" />
             </Button>
             <Button
               variant="outline"
               size="sm"
               onClick={goToToday}
               className="h-8 px-2 text-xs sm:text-sm"
             >
               Today
             </Button>
             <Button
               variant="outline"
               size="sm"
               onClick={goToNextPeriod}
               className="h-8 w-8 p-0"
             >
               <ChevronRight className="h-4 w-4" />
             </Button>
           </div>

           {/* Period Title */}
           <h2 className="text-sm sm:text-xl font-semibold text-slate-900 dark:text-slate-50 flex-1 text-center min-w-0">
             <span className="truncate block">
               {viewMode === "week"
                 ? `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                 : (date || new Date()).toLocaleDateString("en-US", { month: "long", year: "numeric" })
               }
             </span>
           </h2>

           {/* View Mode Toggle - Icon Only */}
           <div className="flex items-center gap-1">
             <Button
               variant={viewMode === "month" ? "default" : "outline"}
               size="sm"
               onClick={() => setViewMode("month")}
               className="h-8 w-8 p-0"
               title="Month view"
             >
               <CalendarDays className="h-4 w-4" />
             </Button>
             <Button
               variant={viewMode === "week" ? "default" : "outline"}
               size="sm"
               onClick={() => setViewMode("week")}
               className="h-8 w-8 p-0"
               title="Week view"
             >
               <CalendarRange className="h-4 w-4" />
             </Button>
           </div>
         </div>

         {/* Helper Text - Hidden on Mobile */}
         <div className="hidden sm:block text-xs text-muted-foreground text-center">
           {viewMode === "week" ? "Click on a time slot to add an event" : "Click on a day to add an event"}
         </div>
       </div>
     </div>

      {/* Calendar View */}
      <div className="flex-1 overflow-auto p-2 sm:p-6">
        {viewMode === "week" ? (
          <WeekView
            weekDays={weekDays}
            events={events}
            onEventClick={handleEdit}
            onTimeSlotClick={openCreateEventDialog}
            getEventsForDay={getEventsForDay}
            getEventColor={getEventColor}
            isMobile={isMobile}
          />
        ) : (
          <MonthView
            monthDays={monthDays}
            events={events}
            date={date || new Date()}
            onDayClick={(d) => setDate(d)}
            onDayDoubleClick={(d) => !isMobile && openCreateEventDialog(d)}
            onDayLongPress={(d) => isMobile && openCreateEventDialog(d)}
            onEventClick={handleEdit}
            onShowDayEvents={showDayEventsModal}
            getEventsForDay={getEventsForDay}
            getEventColor={getEventColor}
            isMobile={isMobile}
          />
        )}
      </div>

      {/* Mobile Floating Action Button */}
      {isMobile && (
        <Button
          onClick={() => openCreateEventDialog(date || new Date())}
          className="fixed bottom-6 right-6 rounded-full w-14 h-14 shadow-lg hover:shadow-xl z-50"
          size="icon"
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Day Events Modal - Shows all events for a day with tabs */}
      {dayEventsModal && (
        <Dialog open={true} onOpenChange={() => setDayEventsModal(null)}>
          <DialogContent 
            className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
            onOpenAutoFocus={(e) => isMobile && e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>
                Events for {dayEventsModal.date.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric"
                })}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto">
              <div className="space-y-4">
                {dayEventsModal.events.map((event, idx) => (
                  <Card 
                    key={event.id}
                    className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => {
                      setDayEventsModal(null);
                      handleEdit({
                        id: event.id,
                        title: event.title,
                        description: event.description,
                        startDate: event.date,
                        endDate: event.endDate,
                        location: event.location,
                        type: event.type as ExtendedEvent["type"],
                        status: event.status || 'scheduled',
                        attendees: event.attendees,
                        createdAt: event.createdAt,
                        updatedAt: event.updatedAt,
                        metadata: event.metadata,
                        webhookConfig: event.webhookConfig,
                      });
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-1 h-full min-h-[60px] rounded-full bg-gradient-to-b ${getEventColor(event.id)}`} />
                      <div className="flex-1 space-y-2">
                        <div>
                          <h4 className="font-semibold text-base">{event.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {new Date(event.date).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false
                            })} - {new Date(event.endDate || event.date).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false
                            })}
                          </p>
                        </div>
                        {event.description && (
                          <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                            {event.description}
                          </p>
                        )}
                        {event.location && (
                          <p className="text-xs text-slate-500 dark:text-slate-500">
                            📍 {event.location}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDayEventsModal(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Event Modal - Desktop (Dialog) */}
      {!isMobile && (
        <Dialog open={isCreatingEvent} onOpenChange={setIsCreatingEvent}>
          <DialogContent 
            className="max-w-md"
            onOpenAutoFocus={(e) => isMobile && e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Create New Event</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="eventTitle">Event Title *</Label>
                <Input
                  id="eventTitle"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleAddEvent()}
                  placeholder="Event title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventDateTime">Date & Time</Label>
                <Input
                  id="eventDateTime"
                  type="datetime-local"
                  value={newEventDateTime ? timezoneService.toDateTimeLocalString(newEventDateTime) : ''}
                  onChange={(e) => {
                    const localDate = timezoneService.fromDateTimeLocalString(e.target.value);
                    setNewEventDateTime(localDate);
                  }}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreatingEvent(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddEvent}
                disabled={isLoading || !newEventTitle.trim()}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Event
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Event Modal - Mobile (Sheet) */}
      {isMobile && (
        <Sheet open={isCreatingEvent} onOpenChange={setIsCreatingEvent}>
          <SheetContent 
            side="bottom" 
            className="h-auto p-6"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader className="mb-4">
              <SheetTitle>Create New Event</SheetTitle>
            </SheetHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="eventTitle">Event Title *</Label>
                <Input
                  id="eventTitle"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleAddEvent()}
                  placeholder="Event title"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventDateTime">Date & Time</Label>
                <Input
                  id="eventDateTime"
                  type="datetime-local"
                  value={newEventDateTime ? timezoneService.toDateTimeLocalString(newEventDateTime) : ''}
                  onChange={(e) => {
                    const localDate = timezoneService.fromDateTimeLocalString(e.target.value);
                    setNewEventDateTime(localDate);
                  }}
                  className="h-12 text-base"
                />
              </div>
            </div>

            <SheetFooter className="mt-6 flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsCreatingEvent(false)}
                className="flex-1 h-12"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddEvent}
                disabled={isLoading || !newEventTitle.trim()}
                className="flex-1 h-12"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Event
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      {/* Edit Event Modal - Mobile (Sheet) */}
      {isMobile ? (
        <Sheet open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
          <SheetContent 
            side="bottom" 
            className="h-[95vh] flex flex-col p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex-1 overflow-y-auto">
              <SheetHeader className="px-6 pt-6 pb-4 border-b">
                <SheetTitle className="text-xl">Edit Event</SheetTitle>
              </SheetHeader>

              {editingEvent && (
                <div className="px-6 py-6 space-y-6">
                  {/* Title */}
                  <div className="space-y-3">
                    <Label htmlFor="title" className="text-base font-medium">Title *</Label>
                    <Input
                      id="title"
                      value={editingEvent.title}
                      onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                      placeholder="Event title"
                      className="h-12 text-base"
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-3">
                    <Label htmlFor="description" className="text-base font-medium">Description</Label>
                    <Textarea
                      id="description"
                      value={editingEvent.description || ''}
                      onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                      placeholder="Event description (optional)"
                      rows={4}
                      className="text-base resize-none"
                    />
                  </div>

                  {/* Type */}
                  <div className="space-y-3">
                    <Label htmlFor="type" className="text-base font-medium">Type</Label>
                    <Select
                      value={editingEvent.type}
                      onValueChange={(value: ExtendedEvent["type"]) =>
                        setEditingEvent({ ...editingEvent, type: value })
                      }
                    >
                      <SelectTrigger id="type" className="h-12 text-base">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="appointment">Appointment</SelectItem>
                        <SelectItem value="deadline">Deadline</SelectItem>
                        <SelectItem value="reminder">Reminder</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status */}
                  <div className="space-y-3">
                    <Label htmlFor="status" className="text-base font-medium">Status</Label>
                    <Select
                      value={editingEvent.status}
                      onValueChange={(value: ExtendedEvent["status"]) =>
                        setEditingEvent({ ...editingEvent, status: value })
                      }
                    >
                      <SelectTrigger id="status" className="h-12 text-base">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Start Date */}
                  <div className="space-y-3">
                    <Label htmlFor="startDate" className="text-base font-medium">Start Date & Time (24h)</Label>
                    <Input
                      id="startDate"
                      type="datetime-local"
                      value={editingEvent.startDate ?
                        timezoneService.toDateTimeLocalString(new Date(editingEvent.startDate)) :
                        ''
                      }
                      onChange={(e) => {
                        const localDate = timezoneService.fromDateTimeLocalString(e.target.value);
                        setEditingEvent({
                          ...editingEvent,
                          startDate: localDate
                        });
                      }}
                      className="h-12 text-base"
                    />
                    <p className="text-xs text-muted-foreground">
                      Timezone: {timezoneService.getTimezone()} ({timezoneService.getTimezoneOffsetString()})
                    </p>
                  </div>

                  {/* End Date */}
                  <div className="space-y-3">
                    <Label htmlFor="endDate" className="text-base font-medium">End Date & Time (24h)</Label>
                    <Input
                      id="endDate"
                      type="datetime-local"
                      value={editingEvent.endDate ?
                        timezoneService.toDateTimeLocalString(new Date(editingEvent.endDate)) :
                        ''
                      }
                      onChange={(e) => {
                        const localDate = timezoneService.fromDateTimeLocalString(e.target.value);
                        setEditingEvent({
                          ...editingEvent,
                          endDate: localDate
                        });
                      }}
                      className="h-12 text-base"
                    />
                  </div>

                  {/* Location */}
                  <div className="space-y-3">
                    <Label htmlFor="location" className="text-base font-medium">Location</Label>
                    <Input
                      id="location"
                      value={editingEvent.location || ''}
                      onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                      placeholder="Event location (optional)"
                      className="h-12 text-base"
                    />
                  </div>

                  {/* Attendees */}
                  <div className="space-y-3">
                    <Label htmlFor="attendees" className="text-base font-medium">Attendees</Label>
                    <div className="flex gap-2">
                      <Input
                        id="attendees"
                        value={attendeeInput}
                        onChange={(e) => setAttendeeInput(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && handleAddAttendee()}
                        placeholder="Add attendee email or name..."
                        className="h-12 text-base"
                      />
                      <Button type="button" onClick={handleAddAttendee} className="h-12 px-6">
                        Add
                      </Button>
                    </div>
                    {editingEvent.attendees && editingEvent.attendees.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {editingEvent.attendees.map((attendee, index) => (
                          <Badge key={index} variant="secondary" className="flex items-center gap-2 text-sm py-1.5 px-3">
                            {attendee}
                            <X
                              className="h-4 w-4 cursor-pointer"
                              onClick={() => handleRemoveAttendee(attendee)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <SheetFooter className="border-t px-6 py-4 flex-shrink-0 bg-background">
              <div className="w-full space-y-3">
                <Button
                  variant="outline"
                  onClick={() => setIsWebhookModalOpen(true)}
                  className="w-full h-12 text-base"
                >
                  <Settings className="h-5 w-5 mr-2" />
                  Advanced Settings
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleDeleteFromModal}
                    disabled={isLoading}
                    className="flex-1 h-12 text-base"
                  >
                    <Trash2 className="h-5 w-5 mr-2" />
                    Delete
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={isLoading || !editingEvent?.title.trim()}
                    className="flex-1 h-12 text-base"
                  >
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              </div>
            </SheetFooter>

            {/* Webhook Settings Modal within Sheet */}
            <Dialog open={isWebhookModalOpen} onOpenChange={setIsWebhookModalOpen}>
              <DialogContent 
                className="max-w-[95vw] max-h-[80vh] overflow-y-auto"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <DialogHeader>
                  <DialogTitle>Advanced Settings</DialogTitle>
                </DialogHeader>
                {editingEvent && (
                  <WebhookSettings
                    eventId={editingEvent.id}
                    initialConfig={editingEvent.webhookConfig as any}
                    onSave={(config) => handleSaveWebhook(editingEvent.id, config)}
                    onTest={(config) => handleTestWebhook(editingEvent.id, config)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </SheetContent>
        </Sheet>
      ) : (
        /* Edit Event Modal - Desktop (Dialog) */
        <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
          <DialogContent 
            className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full"
            onOpenAutoFocus={(e) => isMobile && e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Edit Event</DialogTitle>
            </DialogHeader>

            {editingEvent && (
              <div className="space-y-4">
                {/* Title */}
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={editingEvent.title}
                    onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                    placeholder="Event title"
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={editingEvent.description || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                    placeholder="Event description (optional)"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Type */}
                  <div className="space-y-2">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={editingEvent.type}
                      onValueChange={(value: ExtendedEvent["type"]) =>
                        setEditingEvent({ ...editingEvent, type: value })
                      }
                    >
                      <SelectTrigger id="type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="appointment">Appointment</SelectItem>
                        <SelectItem value="deadline">Deadline</SelectItem>
                        <SelectItem value="reminder">Reminder</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status */}
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={editingEvent.status}
                      onValueChange={(value: ExtendedEvent["status"]) =>
                        setEditingEvent({ ...editingEvent, status: value })
                      }
                    >
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Start Date */}
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Start Date & Time (24h)</Label>
                    <Input
                      id="startDate"
                      type="datetime-local"
                      value={editingEvent.startDate ?
                        timezoneService.toDateTimeLocalString(new Date(editingEvent.startDate)) :
                        ''
                      }
                      onChange={(e) => {
                        const localDate = timezoneService.fromDateTimeLocalString(e.target.value);
                        setEditingEvent({
                          ...editingEvent,
                          startDate: localDate
                        });
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Timezone: {timezoneService.getTimezone()} ({timezoneService.getTimezoneOffsetString()})
                    </p>
                  </div>

                  {/* End Date */}
                  <div className="space-y-2">
                    <Label htmlFor="endDate">End Date & Time (24h)</Label>
                    <Input
                      id="endDate"
                      type="datetime-local"
                      value={editingEvent.endDate ?
                        timezoneService.toDateTimeLocalString(new Date(editingEvent.endDate)) :
                        ''
                      }
                      onChange={(e) => {
                        const localDate = timezoneService.fromDateTimeLocalString(e.target.value);
                        setEditingEvent({
                          ...editingEvent,
                          endDate: localDate
                        });
                      }}
                    />
                  </div>
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={editingEvent.location || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                    placeholder="Event location (optional)"
                  />
                </div>

                {/* Attendees */}
                <div className="space-y-2">
                  <Label htmlFor="attendees">Attendees</Label>
                  <div className="flex gap-2">
                    <Input
                      id="attendees"
                      value={attendeeInput}
                      onChange={(e) => setAttendeeInput(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleAddAttendee()}
                      placeholder="Add attendee email or name..."
                    />
                    <Button type="button" onClick={handleAddAttendee} size="sm">
                      Add
                    </Button>
                  </div>
                  {editingEvent.attendees && editingEvent.attendees.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {editingEvent.attendees.map((attendee, index) => (
                        <Badge key={index} variant="secondary" className="flex items-center gap-1">
                          {attendee}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => handleRemoveAttendee(attendee)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="destructive"
                onClick={handleDeleteFromModal}
                disabled={isLoading}
                className="w-full sm:w-auto sm:mr-auto order-3 sm:order-1"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Event
              </Button>

              <Dialog open={isWebhookModalOpen} onOpenChange={setIsWebhookModalOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto order-2 sm:order-1"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">Advanced Settings</span>
                    <span className="sm:hidden">Settings</span>
                  </Button>
                </DialogTrigger>
                <DialogContent 
                  className="max-w-2xl max-h-[80vh] overflow-y-auto"
                  onOpenAutoFocus={(e) => isMobile && e.preventDefault()}
                >
                  <DialogHeader>
                    <DialogTitle>Advanced Settings: {editingEvent?.title}</DialogTitle>
                  </DialogHeader>
                  {editingEvent && (
                    <WebhookSettings
                      eventId={editingEvent.id}
                      initialConfig={editingEvent.webhookConfig as any}
                      onSave={(config) => handleSaveWebhook(editingEvent.id, config)}
                      onTest={(config) => handleTestWebhook(editingEvent.id, config)}
                    />
                  )}
                </DialogContent>
              </Dialog>

              <div className="flex gap-2 order-1 sm:order-2">
                <Button
                  variant="outline"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 sm:flex-none"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={isLoading || !editingEvent?.title.trim()}
                  className="flex-1 sm:flex-none"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      <span className="hidden sm:inline">Saving...</span>
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
interface MonthViewProps {
  monthDays: Date[];
  events: any[];
  date: Date;
  onDayClick: (date: Date) => void;
  onDayDoubleClick: (date: Date) => void;
  onDayLongPress: (date: Date) => void;
  onEventClick: (event: ExtendedEvent) => void;
  onShowDayEvents: (date: Date, events: any[]) => void;
  getEventsForDay: (date: Date) => any[];
  getEventColor: (eventId: string) => string;
  isMobile: boolean;
}

const MonthView = ({ monthDays, events, date, onDayClick, onDayDoubleClick, onDayLongPress, onEventClick, onShowDayEvents, getEventsForDay, getEventColor, isMobile }: MonthViewProps) => {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const currentMonth = date.getMonth();

  const isEventStartOnDay = (event: any, d: Date): boolean => {
    const eventStartDate = new Date(event.date);
    eventStartDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(d);
    checkDate.setHours(0, 0, 0, 0);
    return eventStartDate.toDateString() === checkDate.toDateString();
  };

  const isEventEndOnDay = (event: any, d: Date): boolean => {
    const eventEndDate = new Date(event.endDate || event.date);
    eventEndDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(d);
    checkDate.setHours(0, 0, 0, 0);
    return eventEndDate.toDateString() === checkDate.toDateString();
  };

  const isMultiDayEvent = (event: any): boolean => {
    const startDate = new Date(event.date);
    const endDate = new Date(event.endDate || event.date);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    return (endDate.getTime() - startDate.getTime()) > 0;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {dayNames.map((day) => (
          <div key={day} className="text-center font-semibold text-sm sm:text-base text-slate-600 dark:text-slate-400 py-2">
            {day}
          </div>
        ))}
        {monthDays.map((day, idx) => {
          const dayEvents = getEventsForDay(day);
          const isCurrentMonth = day.getMonth() === currentMonth;
          const isToday = day.toDateString() === new Date().toDateString();
          const isSelected = day.toDateString() === date.toDateString();

          const multiDayEvents = dayEvents.filter(isMultiDayEvent);
          const singleDayEvents = dayEvents.filter((e) => !isMultiDayEvent(e));

          return (
            <DayCell
              key={idx}
              day={day}
              idx={idx}
              isSelected={isSelected}
              isToday={isToday}
              isCurrentMonth={isCurrentMonth}
              dayEvents={dayEvents}
              multiDayEvents={multiDayEvents}
              singleDayEvents={singleDayEvents}
              isMobile={isMobile}
              onDayClick={onDayClick}
              onDayDoubleClick={onDayDoubleClick}
              onDayLongPress={onDayLongPress}
              onEventClick={onEventClick}
              onShowDayEvents={onShowDayEvents}
              isEventStartOnDay={isEventStartOnDay}
              isEventEndOnDay={isEventEndOnDay}
              getEventColor={getEventColor}
            />
          );
        })}
      </div>
    </div>
  );
};

interface DayCellProps {
  day: Date;
  idx: number;
  isSelected: boolean;
  isToday: boolean;
  isCurrentMonth: boolean;
  dayEvents: any[];
  multiDayEvents: any[];
  singleDayEvents: any[];
  isMobile: boolean;
  onDayClick: (date: Date) => void;
  onDayDoubleClick: (date: Date) => void;
  onDayLongPress: (date: Date) => void;
  onEventClick: (event: ExtendedEvent) => void;
  onShowDayEvents: (date: Date, events: any[]) => void;
  isEventStartOnDay: (event: any, d: Date) => boolean;
  isEventEndOnDay: (event: any, d: Date) => boolean;
  getEventColor: (eventId: string) => string;
}

const DayCell = ({ 
  day, 
  isSelected, 
  isToday, 
  isCurrentMonth,
  dayEvents,
  multiDayEvents, 
  singleDayEvents, 
  isMobile,
  onDayClick, 
  onDayDoubleClick, 
  onDayLongPress, 
  onEventClick,
  onShowDayEvents,
  isEventStartOnDay,
  isEventEndOnDay,
  getEventColor
}: DayCellProps) => {
  const [isPressed, setIsPressed] = useState(false);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);
  const hasFiredRef = React.useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    hasFiredRef.current = false;
  };

  const handleClick = () => {
    if (!hasFiredRef.current) {
      onDayClick(day);
    }
  };

  const handleDoubleClick = () => {
    if (!isMobile) {
      onDayDoubleClick(day);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || e.touches.length > 1) return;
    
    setIsPressed(true);
    hasFiredRef.current = false;
    
    timerRef.current = setTimeout(() => {
      if (!hasFiredRef.current) {
        hasFiredRef.current = true;
        onDayLongPress(day);
        
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    }, 500);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setIsPressed(false);
    clearTimer();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Cancel long press if user starts scrolling
    if (timerRef.current) {
      setIsPressed(false);
      clearTimer();
    }
  };

  React.useEffect(() => {
    return () => clearTimer();
  }, []);

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onTouchMove={handleTouchMove}
      className={`min-h-28 sm:min-h-32 p-2 sm:p-3 border-1 cursor-pointer transition-all flex flex-col select-none ${
        isPressed
          ? "border-blue-400 bg-blue-100 dark:bg-blue-900 scale-[0.98]"
          : isSelected
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
          : isToday
          ? "border-blue-300 bg-white dark:bg-slate-800"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600"
      } ${!isCurrentMonth ? "opacity-50" : ""}`}
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <div className={`text-sm sm:text-base font-semibold mb-1.5 ${isToday ? "text-blue-600 dark:text-blue-400" : isCurrentMonth ? "text-slate-900 dark:text-slate-50" : "text-slate-400 dark:text-slate-600"}`}>
        {day.getDate()}
      </div>
      
      {multiDayEvents.length > 0 && (
        <div className="space-y-1 mb-1">
          {multiDayEvents.map((event) => {
            const isStart = isEventStartOnDay(event, day);
            const isEnd = isEventEndOnDay(event, day);
            
            return (
              <div
                key={event.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick({
                    id: event.id,
                    title: event.title,
                    description: event.description,
                    startDate: event.date,
                    endDate: event.endDate,
                    location: event.location,
                    type: event.type as ExtendedEvent["type"],
                    status: event.status || 'scheduled',
                    attendees: event.attendees,
                    createdAt: event.createdAt,
                    updatedAt: event.updatedAt,
                    metadata: event.metadata,
                    webhookConfig: event.webhookConfig,
                  });
                }}
                className={`px-1.5 sm:px-2 py-1 rounded text-white font-semibold hover:opacity-80 transition-all cursor-pointer bg-gradient-to-r ${getEventColor(event.id)} ${
                  !isStart ? "rounded-l-none" : ""
                } ${!isEnd ? "rounded-r-none" : ""} ${
                  isMobile ? "h-1.5" : "text-xs truncate"
                }`}
                title={event.title}
              >
                {!isMobile && (
                  <>
                    {isStart && <span className="font-bold">★ </span>}
                    {event.title}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Desktop: Show event text */}
      {!isMobile && (
        <div className="space-y-1 flex-1 overflow-hidden">
          {singleDayEvents.slice(0, 2).map((event) => (
            <div
              key={event.id}
              onClick={(e) => {
                e.stopPropagation();
                onEventClick({
                  id: event.id,
                  title: event.title,
                  description: event.description,
                  startDate: event.date,
                  endDate: event.endDate,
                  location: event.location,
                  type: event.type as ExtendedEvent["type"],
                  status: event.status || 'scheduled',
                  attendees: event.attendees,
                  createdAt: event.createdAt,
                  updatedAt: event.updatedAt,
                  metadata: event.metadata,
                  webhookConfig: event.webhookConfig,
                });
              }}
              className={`text-xs px-2 py-1 rounded text-white font-semibold truncate hover:opacity-80 transition-all cursor-pointer bg-gradient-to-r ${getEventColor(event.id)}`}
              title={event.title}
            >
              {event.title}
            </div>
          ))}
          {singleDayEvents.length > 2 && (
            <div 
              className="text-xs text-slate-500 dark:text-slate-400 px-2 font-semibold cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onShowDayEvents(day, dayEvents);
              }}
            >
              +{singleDayEvents.length - 2} more
            </div>
          )}
        </div>
      )}

      {/* Mobile: Show colored dots */}
      {isMobile && dayEvents.length > 0 && (
        <div 
          className="flex flex-wrap gap-1 mt-auto cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onShowDayEvents(day, dayEvents);
          }}
        >
          {dayEvents.slice(0, 5).map((event) => (
            <div
              key={event.id}
              className={`w-2.5 h-2.5 rounded-full bg-gradient-to-r ${getEventColor(event.id)} transition-transform`}
              title={event.title}
            />
          ))}
          {dayEvents.length > 5 && (
            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold ml-0.5">
              +{dayEvents.length - 5}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TimeSlotCellProps {
  dayIdx: number;
  hour: number;
  weekDays: Date[];
  cellHeight: number;
  isBusinessHour: boolean;
  isMobile: boolean;
  onTimeSlotClick: (date: Date) => void;
}

const TimeSlotCell = ({ dayIdx, hour, weekDays, cellHeight, isBusinessHour, isMobile, onTimeSlotClick }: TimeSlotCellProps) => {
  const [isPressed, setIsPressed] = useState(false);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);
  const hasFiredRef = React.useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    hasFiredRef.current = false;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isMobile) return; // Prevent click on mobile
    
    e.preventDefault();
    e.stopPropagation();
    
    const clickedDate = new Date(weekDays[dayIdx]);
    clickedDate.setHours(hour, 0, 0, 0);
    onTimeSlotClick(clickedDate);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || e.touches.length > 1) return; // Only single touch
    
    setIsPressed(true);
    hasFiredRef.current = false;
    
    timerRef.current = setTimeout(() => {
      if (!hasFiredRef.current) {
        hasFiredRef.current = true;
        const clickedDate = new Date(weekDays[dayIdx]);
        clickedDate.setHours(hour, 0, 0, 0);
        onTimeSlotClick(clickedDate);
        
        // Haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    }, 500);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setIsPressed(false);
    clearTimer();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Cancel long press if user starts scrolling
    if (timerRef.current) {
      setIsPressed(false);
      clearTimer();
    }
  };

  // Cleanup on unmount
  React.useEffect(() => {
    return () => clearTimer();
  }, []);

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onTouchMove={handleTouchMove}
      className={`border-b border-slate-200 dark:border-slate-700 select-none transition-colors ${
        isMobile ? "cursor-default" : "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
      } ${
        isPressed 
          ? "bg-blue-200 dark:bg-blue-800 scale-[0.98]" 
          : isBusinessHour 
            ? "bg-white dark:bg-slate-800" 
            : "bg-slate-50 dark:bg-slate-900 opacity-60"
      }`}
      style={{ 
        height: `${cellHeight}px`,
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
    />
  );
};

interface WeekViewProps {
  weekDays: Date[];
  events: any[];
  onEventClick: (event: ExtendedEvent) => void;
  onTimeSlotClick: (date: Date) => void;
  getEventsForDay: (date: Date) => any[];
  getEventColor: (eventId: string) => string;
  isMobile: boolean;
}

const WeekView = ({ weekDays, events, onEventClick, onTimeSlotClick, getEventsForDay, getEventColor, isMobile }: WeekViewProps) => {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cellHeight = 80;

  const getEventsForDayIndex = (dayIdx: number) => {
    const day = weekDays[dayIdx];
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return events.filter((event) => {
      const eventStart = new Date(event.date);
      const eventEnd = new Date(event.endDate || event.date);

      return eventStart <= dayEnd && eventEnd >= dayStart;
    });
  };

  const calculateEventPosition = (event: any, dayIdx: number) => {
    const eventStart = new Date(event.date);
    const eventEnd = new Date(event.endDate || event.date);
    const dayStart = new Date(weekDays[dayIdx]);
    dayStart.setHours(0, 0, 0, 0);

    let startHour = eventStart.getHours();
    let endHour = eventEnd.getHours();

    if (eventStart.toDateString() !== dayStart.toDateString()) {
      startHour = 0;
    }

    if (eventEnd.toDateString() !== dayStart.toDateString()) {
      endHour = 24;
    }

    const top = startHour * cellHeight + 48;
    const height = Math.max(1, endHour - startHour) * cellHeight;

    return { top, height, startHour, endHour };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Day headers */}
      <div className="grid grid-cols-8 gap-0 sticky top-0 z-20 bg-white dark:bg-slate-900">
        <div className=""></div>
        {weekDays.map((day, idx) => {
          const isToday = day.toDateString() === new Date().toDateString();
          return (
            <div
              key={idx}
              className={`flex flex-col items-center justify-center p-3 sm:p-4 border-b-2 transition-all ${
                isToday
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                  : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              }`}
            >
              <div className={`text-xs sm:text-sm font-bold ${isToday ? "text-blue-600 dark:text-blue-400" : "text-slate-600 dark:text-slate-400"}`}>
                {dayNames[day.getDay()]}
              </div>
              <div className={`text-lg sm:text-2xl font-bold ${isToday ? "text-blue-600 dark:text-blue-400" : "text-slate-900 dark:text-slate-50"}`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid with background */}
      <div className="flex-1 overflow-y-auto relative">
        <div className="grid grid-cols-8 gap-0">
          <div></div>
          {weekDays.map((day, dayIdx) => (
            <div key={`bg-${dayIdx}`} className="border-r border-slate-200 dark:border-slate-700 last:border-r-0">
              {hours.map((hour) => {
                const isBusinessHour = hour >= 8 && hour < 18;
                return (
                  <TimeSlotCell
                    key={`bg-${dayIdx}-${hour}`}
                    dayIdx={dayIdx}
                    hour={hour}
                    weekDays={weekDays}
                    cellHeight={cellHeight}
                    isBusinessHour={isBusinessHour}
                    isMobile={isMobile}
                    onTimeSlotClick={onTimeSlotClick}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Time labels and events overlay */}
        <div className="absolute inset-0 pointer-events-none grid grid-cols-8 gap-0">
          <div className="pointer-events-auto">
            {hours.map((hour) => {
              const isBusinessHour = hour >= 8 && hour < 18;
              return (
                <div
                  key={`time-${hour}`}
                  className={`p-2 sm:p-4 text-right text-xs sm:text-sm font-medium sticky left-0 z-10 ${
                    isBusinessHour
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                  } border-r border-slate-200 dark:border-slate-700`}
                  style={{ height: `${cellHeight}px`, display: 'flex', alignItems: 'center' }}
                >
                  {`${hour.toString().padStart(2, '0')}:00`}
                </div>
              );
            })}
          </div>

          {/* Events */}
          {weekDays.map((day, dayIdx) => {
            const dayEvents = getEventsForDayIndex(dayIdx);
            return (
              <div key={`events-${dayIdx}`} className="relative">
                {dayEvents.map((event, eventIdx) => {
                  const { top, height, startHour, endHour } = calculateEventPosition(event, dayIdx);

                  return (
                    <div
                      key={`${event.id}-${eventIdx}`}
                      onClick={() => {
                        onEventClick({
                          id: event.id,
                          title: event.title,
                          description: event.description,
                          startDate: event.date,
                          endDate: event.endDate,
                          location: event.location,
                          type: event.type as ExtendedEvent["type"],
                          status: event.status || 'scheduled',
                          attendees: event.attendees,
                          createdAt: event.createdAt,
                          updatedAt: event.updatedAt,
                          metadata: event.metadata,
                          webhookConfig: event.webhookConfig,
                        });
                      }}
                      className={`absolute left-0.5 sm:left-2 right-0.5 sm:right-2 p-1 sm:p-2 rounded text-white font-semibold cursor-pointer transition-all hover:shadow-lg shadow-md bg-gradient-to-br ${getEventColor(event.id)} overflow-hidden pointer-events-auto`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                      }}
                      title={event.title}
                    >
                      <div className="text-[10px] sm:text-xs font-bold leading-tight line-clamp-2 break-words">
                        {event.title}
                      </div>
                      {height > 40 && (
                        <div className="text-[9px] sm:text-xs opacity-90 mt-0.5">
                          {`${new Date(event.date).getHours().toString().padStart(2, '0')}:${new Date(event.date).getMinutes().toString().padStart(2, '0')}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
