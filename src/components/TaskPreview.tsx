import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Calendar, Clock, Tag, Settings } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskWebhookSettings } from "./TaskWebhookSettings";
import { chatApi } from "@/lib/api";

// Task type matching backend schema (server/src/types/index.ts)
interface Task {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  tags?: string[];
  metadata?: Record<string, any>;
}

interface TaskPreviewProps {
  tasks: Task[];
}

export const TaskPreview = ({ tasks }: TaskPreviewProps) => {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);

  const handleOpenEdit = (task: Task) => {
    setSelectedTask({ ...task });
    setIsEditModalOpen(true);
  };

  const handleOpenWebhookSettings = () => {
    setIsEditModalOpen(false);
    setIsWebhookModalOpen(true);
  };

  const handleSaveTaskWebhook = async (taskId: string, config: any) => {
    try {
      await chatApi.updateTaskWebhook(taskId, config);
      setIsWebhookModalOpen(false);
      setIsEditModalOpen(true);
    } catch (error) {
      console.error('Failed to save task webhook config:', error);
      throw error;
    }
  };

  const handleTestTaskWebhook = async (taskId: string, config: any) => {
    try {
      return await chatApi.testTaskWebhook(taskId, config);
    } catch (error) {
      console.error('Failed to test task webhook:', error);
      throw error;
    }
  };

  const getPriorityColor = (priority: Task["priority"]) => {
    switch (priority) {
      case "urgent": 
        return "text-red-600";
      case "high": 
        return "text-destructive";
      case "medium": 
        return "text-primary";
      case "low": 
        return "text-muted-foreground";
    }
  };

  const getPriorityBg = (priority: Task["priority"]) => {
    switch (priority) {
      case "urgent": 
        return "bg-red-600/10 border-red-600/30";
      case "high": 
        return "bg-destructive/10 border-destructive/20";
      case "medium": 
        return "bg-primary/10 border-primary/20";
      case "low": 
        return "bg-muted border-border";
    }
  };

  const getStatusColor = (status: Task["status"]) => {
    switch (status) {
      case "pending":
        return "bg-gray-100 text-gray-700 border-gray-200";
      case "in_progress":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "completed":
        return "bg-green-100 text-green-700 border-green-200";
      case "cancelled":
        return "bg-red-100 text-red-700 border-red-200";
    }
  };

  const getStatusIcon = (status: Task["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "in_progress":
        return <Clock className="h-4 w-4 text-blue-600" />;
      case "cancelled":
        return <Circle className="h-4 w-4 text-red-400" />;
      case "pending":
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  };

  const isOverdue = (dueDate?: Date | string, status?: Task["status"]) => {
    if (!dueDate || status === "completed" || status === "cancelled") return false;
    const dueDateObj = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
    return dueDateObj < new Date();
  };

  return (
    <div className="my-2 space-y-1.5 max-w-2xl">
      {tasks.map((task) => (
        <Card
          key={task.id}
          className={`p-2.5 md:p-3 transition-all hover:shadow-md cursor-pointer ${
            task.status === "completed" || task.status === "cancelled" ? "opacity-70" : ""
          } ${getPriorityBg(task.priority)}`}
          onClick={() => handleOpenEdit(task)}
        >
          <div className="flex items-start gap-2">
            <div className="mt-0.5">
              {getStatusIcon(task.status)}
            </div>
            <div className="flex-1 min-w-0">
                {/* Priority and Status Badges */}
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                <span className={`text-[10px] md:text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 md:px-2 md:py-1 rounded-full border ${getPriorityColor(task.priority)} ${getPriorityBg(task.priority)}`}>
                  {task.priority}
                </span>
                <Badge 
                  variant="outline" 
                  className={`text-[10px] md:text-xs px-1.5 py-0 md:px-2 ${getStatusColor(task.status)}`}
                >
                  {task.status.replace('_', ' ')}
                </Badge>
              </div>

              {/* Title */}
              <p
                className={`text-xs md:text-sm font-medium leading-snug mb-1 ${
                  task.status === "completed" ? "line-through text-muted-foreground" : ""
                }`}
              >
                {task.title}
              </p>

              {/* Description */}
              {task.description && (
                <p className="text-[11px] md:text-xs text-muted-foreground mb-1.5 line-clamp-2 leading-tight">
                  {task.description}
                </p>
              )}

              {/* Due Date */}
              {task.dueDate && (
                <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span className={`text-[11px] md:text-xs ${
                    isOverdue(task.dueDate, task.status) ? "text-red-600 font-semibold" : ""
                  }`}>
                    Due: {formatDate(task.dueDate)}
                    {isOverdue(task.dueDate, task.status) && " (Overdue)"}
                  </span>
                </div>
              )}

              {/* Tags */}
              {task.tags && task.tags.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  <div className="flex gap-1 flex-wrap">
                    {task.tags.map((tag, index) => (
                      <Badge 
                        key={index} 
                        variant="secondary" 
                        className="text-[10px] md:text-xs px-1.5 py-0 md:px-2"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}

      {/* Edit Task Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>

          {selectedTask && (
            <div className="space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="task-title">Title *</Label>
                <Input
                  id="task-title"
                  value={selectedTask.title}
                  onChange={(e) => setSelectedTask({ ...selectedTask, title: e.target.value })}
                  placeholder="Task title"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="task-description">Description</Label>
                <Textarea
                  id="task-description"
                  value={selectedTask.description || ''}
                  onChange={(e) => setSelectedTask({ ...selectedTask, description: e.target.value })}
                  placeholder="Task description (optional)"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Status */}
                <div className="space-y-2">
                  <Label htmlFor="task-status">Status</Label>
                  <Select
                    value={selectedTask.status}
                    onValueChange={(value: Task["status"]) =>
                      setSelectedTask({ ...selectedTask, status: value })
                    }
                  >
                    <SelectTrigger id="task-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Priority */}
                <div className="space-y-2">
                  <Label htmlFor="task-priority">Priority</Label>
                  <Select
                    value={selectedTask.priority}
                    onValueChange={(value: Task["priority"]) =>
                      setSelectedTask({ ...selectedTask, priority: value })
                    }
                  >
                    <SelectTrigger id="task-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label htmlFor="task-due-date">Due Date</Label>
                <Input
                  id="task-due-date"
                  type="datetime-local"
                  value={selectedTask.dueDate ?
                    new Date(selectedTask.dueDate).toISOString().slice(0, 16) :
                    ''
                  }
                  onChange={(e) => setSelectedTask({
                    ...selectedTask,
                    dueDate: e.target.value ? new Date(e.target.value) : undefined
                  })}
                />
              </div>

              {/* Advanced Settings Button */}
              <div className="pt-4 border-t">
                <Button onClick={handleOpenWebhookSettings} variant="outline" className="w-full">
                  <Settings className="h-4 w-4 mr-2" />
                  Advanced Settings (Webhooks)
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsEditModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // Here you would call an update task API
                console.log('Save task:', selectedTask);
                setIsEditModalOpen(false);
              }}
              disabled={!selectedTask?.title.trim()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhook Settings Modal */}
      <Dialog open={isWebhookModalOpen} onOpenChange={(open) => {
        setIsWebhookModalOpen(open);
        if (!open) setIsEditModalOpen(true);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Advanced Settings: {selectedTask?.title}</DialogTitle>
          </DialogHeader>
          {selectedTask && (
            <TaskWebhookSettings
              taskId={selectedTask.id}
              initialConfig={selectedTask.metadata?.webhookConfig}
              onSave={(config) => handleSaveTaskWebhook(selectedTask.id, config)}
              onTest={(config) => handleTestTaskWebhook(selectedTask.id, config)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
