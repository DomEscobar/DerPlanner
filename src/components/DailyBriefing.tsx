import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEvents } from "@/hooks/useEvents";
import { useTasks } from "@/hooks/useTasks";
import { getUserId } from "@/lib/storage";
import { Calendar, AlertCircle, MapPin, CheckCircle2, Circle, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { timezoneService } from "@/lib/timezone";
import { differenceInMinutes, differenceInHours, differenceInDays } from "date-fns";

export const DailyBriefing = () => {
  const userId = getUserId();
  const { events } = useEvents({ userId });
  const { tasks, toggleTask } = useTasks({ userId });

  const today = new Date();
  
  // Filter for overdue tasks
  const overdueTasks = useMemo(() => {
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);

    return tasks
      .filter(task => {
        if (task.status === 'completed' || task.status === 'cancelled') return false;
        if (!task.dueDate) return false;
        
        return new Date(task.dueDate) < startOfDay;
      })
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  }, [tasks]);

  // Filter for upcoming events (next 4)
  const upcomingEvents = useMemo(() => {
    const now = new Date();

    return events
      .filter(event => {
        const eventDate = new Date(event.date);
        // Filter for future events
        return eventDate >= now;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 4);
  }, [events]);

  // Filter for pending high-priority tasks or due today (excluding overdue)
  const priorityTasks = useMemo(() => {
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    return tasks
      .filter(task => {
        if (task.status === 'completed' || task.status === 'cancelled') return false;
        
        // Exclude if it's already counted as overdue
        if (task.dueDate && new Date(task.dueDate) < startOfDay) return false;

        const isHighPriority = task.priority === 'high' || task.priority === 'urgent';
        const isDueToday = task.dueDate && 
          new Date(task.dueDate) >= startOfDay && 
          new Date(task.dueDate) <= endOfDay;
        
        return isHighPriority || isDueToday;
      })
      .slice(0, 5);
  }, [tasks]);

  const greeting = useMemo(() => {
    const hour = today.getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  if (upcomingEvents.length === 0 && priorityTasks.length === 0 && overdueTasks.length === 0) {
    return (
      <div className="p-8 text-center space-y-3 bg-background/40 dark:bg-background/30 backdrop-blur-xl rounded-3xl border border-border/50 mx-4 mt-8 shadow-lg hover:shadow-xl hover:bg-background/50 transition-all">
        <h2 className="text-3xl font-bold text-primary">{greeting}!</h2>
        <p className="text-muted-foreground text-lg">
          No upcoming events or tasks.
          <br />
          <span className="text-sm opacity-70">Enjoy your freedom! 🌿</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24 px-4 pt-6"> {/* Added bottom padding for floating UI */}
      <div className="space-y-1">
        <h2 className="text-4xl font-bold tracking-tight text-foreground">
            {greeting}
        </h2>
        <p className="text-xl text-muted-foreground font-medium">
          {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Overdue Tasks - "Catch Up" Section */}
      {overdueTasks.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive uppercase tracking-wider animate-pulse">
            <AlertCircle className="h-4 w-4" />
            <span>Catch Up ({overdueTasks.length})</span>
          </div>
          
          <div className="grid gap-3">
            {overdueTasks.map((task, idx) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div 
                    onClick={() => toggleTask(task.id)}
                    className="p-4 rounded-3xl bg-destructive/10 hover:bg-destructive/15 backdrop-blur-md border border-destructive/40 hover:border-destructive/60 transition-all flex items-start gap-3 group cursor-pointer shadow-lg hover:shadow-xl"
                >
                    <div className="mt-0.5 flex-shrink-0 transition-transform group-hover:scale-110">
                        <Circle className="h-5 w-5 text-destructive group-hover:fill-destructive/20" />
                    </div>
                    
                    <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-snug text-foreground group-hover:text-destructive transition-colors">
                            {task.text}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px] px-1.5 h-5 border-destructive/30 text-destructive bg-destructive/5">
                                Overdue
                            </Badge>
                            {task.dueDate && (
                                <span className="text-[10px] font-medium text-destructive/80">
                                    Due {new Date(task.dueDate).toLocaleDateString()}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline / Agenda */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <Calendar className="h-4 w-4 text-primary" />
          <span>Upcoming Events</span>
        </div>
        
        <div className="space-y-4 relative pl-2">
            {/* Clean Line */}
            <div className="absolute left-[19px] top-2 bottom-2 w-[2px] bg-border z-0" />

            {upcomingEvents.length === 0 ? (
                <div className="pl-12 py-3 text-sm text-muted-foreground/60 italic">
                    No upcoming events.
                </div>
            ) : (
                upcomingEvents.map((event, idx) => {
                    const isPast = new Date(event.endDate || event.date) < new Date();
                    const isNow = new Date(event.date) <= new Date() && new Date(event.endDate || event.date) >= new Date();
                    
                    return (
                        <motion.div 
                            key={event.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="relative z-10 pl-10 group"
                        >
                            {/* Time Bubble on Left */}
                            <div className={`absolute left-0 top-3 w-10 text-right pr-4 z-20`}>
                                {/* Dot */}
                                <div className={`absolute right-[-5px] top-1.5 w-3 h-3 rounded-full border-2 border-background transition-all ${
                                    isNow ? 'bg-primary scale-125 shadow-glow' : isPast ? 'bg-muted-foreground/30' : 'bg-primary/30'
                                }`} />
                            </div>

                            <Card className={`p-4 transition-all backdrop-blur-xl shadow-lg hover:shadow-xl ${
                                isNow 
                                    ? 'bg-background/50 border border-primary/40 ring-1 ring-primary/20 shadow-glow' 
                                    : isPast 
                                        ? 'bg-background/30 border border-border/30 opacity-60' 
                                        : 'bg-background/40 border border-border/50 hover:bg-background/60 hover:border-border/80'
                            }`}>
                                <div className="flex justify-between items-start gap-4">
                                    <div className="space-y-1">
                                        <h4 className={`font-semibold text-base leading-tight ${isPast && 'line-through text-muted-foreground'}`}>
                                            {event.title}
                                        </h4>
                                        
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1 font-medium text-primary/80">
                                                <Clock className="h-3 w-3" />
                                                {(() => {
                                                  const eventDate = new Date(event.date);
                                                  const now = new Date();
                                                  const diffDays = differenceInDays(eventDate, now);
                                                  const diffHours = differenceInHours(eventDate, now);
                                                  const diffMinutes = differenceInMinutes(eventDate, now);
                                                  
                                                  if (diffDays >= 10) {
                                                    return timezoneService.formatDate(eventDate);
                                                  }
                                                  if (diffDays > 0) {
                                                    return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
                                                  }
                                                  if (diffHours > 0) {
                                                    return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
                                                  }
                                                  if (diffMinutes > 0) {
                                                    return `in ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
                                                  }
                                                  return "Now";
                                                })()}
                                            </div>
                                            
                                            {event.location && (
                                                <div className="flex items-center gap-1 opacity-70">
                                                    <MapPin className="h-3 w-3" />
                                                    <span className="truncate max-w-[120px]">{event.location}</span>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {event.description && (
                                            <p className="text-xs text-muted-foreground/70 line-clamp-1 pt-1">
                                                {event.description}
                                            </p>
                                        )}
                                    </div>

                                    {isNow && (
                                        <Badge className="bg-primary text-white border-none px-2 py-0.5 text-[10px] font-bold shadow-glow">NOW</Badge>
                                    )}
                                </div>
                            </Card>
                        </motion.div>
                    );
                })
            )}
        </div>
      </div>

      {/* Priority Tasks */}
      {priorityTasks.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <AlertCircle className="h-4 w-4 text-accent" />
            <span>Top Priorities</span>
          </div>
          
          <div className="grid gap-3">
            {priorityTasks.map((task, idx) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + idx * 0.05 }}
              >
                <div 
                    onClick={() => toggleTask(task.id)}
                    className="p-4 rounded-3xl bg-background/40 hover:bg-background/60 backdrop-blur-md border border-border/50 hover:border-primary/40 transition-all flex items-start gap-3 group cursor-pointer shadow-lg hover:shadow-xl"
                >
                    {task.status === 'completed' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    ) : (
                        <Circle className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary group-hover:fill-primary/10 transition-all mt-0.5 flex-shrink-0" />
                    )}
                    
                    <div className="flex-1 min-w-0 space-y-1">
                        <p className={`text-sm font-medium leading-snug ${task.status === 'completed' && 'line-through text-muted-foreground'}`}>
                            {task.text}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                            {task.priority === 'urgent' && (
                                <Badge variant="destructive" className="text-[10px] px-1.5 h-5">Urgent</Badge>
                            )}
                            {task.priority === 'high' && (
                                <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-transparent hover:bg-orange-200 text-[10px] px-1.5 h-5">High</Badge>
                            )}
                            {task.dueDate && (
                                <span className={`text-[10px] font-medium ${new Date(task.dueDate) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    Due {new Date(task.dueDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
