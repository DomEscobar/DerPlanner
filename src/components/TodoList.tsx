import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, RefreshCw, Trash2, X, Clock, AlertCircle, CheckCircle, XCircle, LayoutGrid, List, Settings } from "lucide-react";
import { TaskPreview } from "@/components/TaskPreview";
import { TaskWebhookSettings } from "@/components/TaskWebhookSettings";
import { useTasks } from "@/hooks/useTasks";
import { useToast } from "@/hooks/use-toast";
import { getUserId, getTaskViewMode, saveTaskViewMode } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { chatApi } from "@/lib/api";

// Extended Task interface matching backend schema
interface ExtendedTask {
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

// Column configuration for the board
const COLUMNS = [
  {
    id: "pending" as const,
    title: "To Do",
    icon: Clock,
    color: "bg-slate-100 dark:bg-slate-800",
    headerColor: "bg-slate-200 dark:bg-slate-700",
  },
  {
    id: "in_progress" as const,
    title: "In Progress",
    icon: AlertCircle,
    color: "bg-blue-50 dark:bg-blue-950",
    headerColor: "bg-blue-100 dark:bg-blue-900",
  },
  {
    id: "completed" as const,
    title: "Completed",
    icon: CheckCircle,
    color: "bg-green-50 dark:bg-green-950",
    headerColor: "bg-green-100 dark:bg-green-900",
  },
  {
    id: "cancelled" as const,
    title: "Cancelled",
    icon: XCircle,
    color: "bg-red-50 dark:bg-red-950",
    headerColor: "bg-red-100 dark:bg-red-900",
  },
] as const;

export const TodoList = () => {
  const [newTodo, setNewTodo] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ExtendedTask | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "board">(() => getTaskViewMode());
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
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
    saveTaskViewMode(viewMode);
  }, [viewMode]);

  const handleSaveWebhook = async (taskId: string, config: any) => {
    try {
      await chatApi.updateTaskWebhook(taskId, config);
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

  const handleTestWebhook = async (taskId: string, config: any) => {
    try {
      return await chatApi.testTaskWebhook(taskId, config);
    } catch (error) {
      console.error('Failed to test webhook:', error);
      throw error;
    }
  };

  const {
    tasks,
    isLoading,
    createTask,
    updateTask,
    deleteTask,
    refreshTasks,
  } = useTasks({
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

  // Convert LocalTask to ExtendedTask format for display
  const displayTasks: ExtendedTask[] = tasks.map(task => ({
    id: task.id,
    title: task.text,
    description: task.description,
    status: task.status,
    priority: task.priority === 'high' ? 'high' : task.priority === 'medium' ? 'medium' : 'low',
    dueDate: task.dueDate,
    tags: task.tags,
    createdAt: undefined,
    updatedAt: undefined,
  }));

  const addTodo = async () => {
    if (!newTodo.trim()) return;
    await createTask(newTodo);
    setNewTodo("");
  };

  const handleEdit = (task: ExtendedTask) => {
    setEditingTask({ ...task });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingTask) return;

    const localTask = tasks.find(t => t.id === editingTask.id);
    if (!localTask) return;

    await updateTask(editingTask.id, {
      text: editingTask.title,
      description: editingTask.description,
      status: editingTask.status,
      priority: editingTask.priority === 'urgent' ? 'high' : editingTask.priority,
      dueDate: editingTask.dueDate ? new Date(editingTask.dueDate) : undefined,
      tags: editingTask.tags,
    });

    setIsEditModalOpen(false);
    setEditingTask(null);
  };

  const handleAddTag = () => {
    if (!editingTask || !tagInput.trim()) return;

    const currentTags = editingTask.tags || [];
    if (!currentTags.includes(tagInput.trim())) {
      setEditingTask({
        ...editingTask,
        tags: [...currentTags, tagInput.trim()]
      });
    }
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!editingTask) return;
    setEditingTask({
      ...editingTask,
      tags: (editingTask.tags || []).filter(tag => tag !== tagToRemove)
    });
  };

  const handleDeleteFromModal = async () => {
    if (!editingTask) return;

    if (confirm('Are you sure you want to delete this task?')) {
      await deleteTask(editingTask.id);
      setIsEditModalOpen(false);
      setEditingTask(null);
    }
  };

  // Group tasks by status for board columns
  const tasksByStatus = displayTasks.reduce((acc, task) => {
    if (!acc[task.status]) {
      acc[task.status] = [];
    }
    acc[task.status].push(task);
    return acc;
  }, {} as Record<ExtendedTask["status"], ExtendedTask[]>);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Fixed Header with Add Task */}
      <div className="flex-shrink-0 p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto">
          <Card className="p-4">
            <div className="flex gap-2">
              <Input
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && addTodo()}
                placeholder="Add a new task (AI will help organize it)..."
                className="flex-1"
                disabled={isLoading}
              />
              <Button onClick={addTodo} size="icon" disabled={isLoading || !newTodo.trim()}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setViewMode(viewMode === "board" ? "list" : "board")}
                title={viewMode === "board" ? "Switch to List View" : "Switch to Board View"}
              >
                {viewMode === "board" ? (
                  <List className="h-4 w-4" />
                ) : (
                  <LayoutGrid className="h-4 w-4" />
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Board View */}
      {viewMode === "board" ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="h-full min-w-max p-4">
            <div className="flex gap-4 h-full max-w-7xl mx-auto">
              {COLUMNS.map((column) => {
                const columnTasks = tasksByStatus[column.id] || [];
                const Icon = column.icon;

                return (
                  <div
                    key={column.id}
                    className="flex-1 min-w-[280px] md:min-w-[320px] flex flex-col"
                  >
                    {/* Column Header */}
                    <div className={cn(
                      "rounded-t-lg p-3 flex items-center justify-between",
                      column.headerColor
                    )}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5" />
                        <h3 className="font-semibold">{column.title}</h3>
                        <Badge variant="secondary" className="ml-1">
                          {columnTasks.length}
                        </Badge>
                      </div>
                    </div>

                    {/* Column Content - Scrollable */}
                    <div className={cn(
                      "flex-1 rounded-b-lg p-3 overflow-y-auto",
                      column.color
                    )}>
                      <div className="space-y-3">
                        {columnTasks.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            No tasks
                          </div>
                        ) : (
                          columnTasks.map((task) => (
                            <div
                              key={task.id}
                              className="cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
                              onClick={() => handleEdit(task)}
                            >
                              <Card className="p-4 hover:shadow-md transition-shadow">
                                <div className="space-y-2">
                                  <div className="font-medium text-sm line-clamp-2">
                                    {task.title}
                                  </div>
                                  
                                  {task.description && (
                                    <div className="text-xs text-muted-foreground line-clamp-2">
                                      {task.description}
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2 flex-wrap">
                                    {/* Priority Badge */}
                                    <Badge
                                      variant={
                                        task.priority === "urgent" ? "destructive" :
                                        task.priority === "high" ? "destructive" :
                                        task.priority === "medium" ? "default" :
                                        "secondary"
                                      }
                                      className="text-xs"
                                    >
                                      {task.priority}
                                    </Badge>

                                    {/* Due Date */}
                                    {task.dueDate && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        {new Date(task.dueDate).toLocaleDateString()}
                                      </div>
                                    )}
                                  </div>

                                  {/* Tags */}
                                  {task.tags && task.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {task.tags.map((tag, idx) => (
                                        <Badge
                                          key={idx}
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </Card>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* List View */
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {displayTasks.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-muted-foreground">
                  No tasks yet. Create your first task above!
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {displayTasks.map((task) => (
                  <div
                    key={task.id}
                    className="cursor-pointer transition-transform hover:scale-[1.01]"
                  >
                    <TaskPreview 
                      tasks={[task]} 
                      onTaskClick={() => handleEdit(task)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Task Modal - Mobile (Sheet) */}
      {isMobile ? (
        <Sheet open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
          <SheetContent 
            side="bottom" 
            className="h-[95vh] flex flex-col p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex-1 overflow-y-auto">
              <SheetHeader className="px-6 pt-6 pb-4 border-b">
                <SheetTitle className="text-xl">Edit Task</SheetTitle>
              </SheetHeader>

              {editingTask && (
                <div className="px-6 py-6 space-y-6">
                  {/* Title */}
                  <div className="space-y-3">
                    <Label htmlFor="title" className="text-base font-medium">Title *</Label>
                    <Input
                      id="title"
                      value={editingTask.title}
                      onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                      placeholder="Task title"
                      className="h-12 text-base"
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-3">
                    <Label htmlFor="description" className="text-base font-medium">Description</Label>
                    <Textarea
                      id="description"
                      value={editingTask.description || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                      placeholder="Task description (optional)"
                      rows={4}
                      className="text-base resize-none"
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-3">
                    <Label htmlFor="status" className="text-base font-medium">Status</Label>
                    <Select
                      value={editingTask.status}
                      onValueChange={(value: ExtendedTask["status"]) =>
                        setEditingTask({ ...editingTask, status: value })
                      }
                    >
                      <SelectTrigger id="status" className="h-12 text-base">
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
                  <div className="space-y-3">
                    <Label htmlFor="priority" className="text-base font-medium">Priority</Label>
                    <Select
                      value={editingTask.priority}
                      onValueChange={(value: ExtendedTask["priority"]) =>
                        setEditingTask({ ...editingTask, priority: value })
                      }
                    >
                      <SelectTrigger id="priority" className="h-12 text-base">
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

                  {/* Due Date */}
                  <div className="space-y-3">
                    <Label htmlFor="dueDate" className="text-base font-medium">Due Date</Label>
                    <Input
                      id="dueDate"
                      type="datetime-local"
                      value={editingTask.dueDate ?
                        new Date(editingTask.dueDate).toISOString().slice(0, 16) :
                        ''
                      }
                      onChange={(e) => setEditingTask({
                        ...editingTask,
                        dueDate: e.target.value ? new Date(e.target.value) : undefined
                      })}
                      className="h-12 text-base"
                    />
                  </div>

                  {/* Tags */}
                  <div className="space-y-3">
                    <Label htmlFor="tags" className="text-base font-medium">Tags</Label>
                    <div className="flex gap-2">
                      <Input
                        id="tags"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
                        placeholder="Add a tag..."
                        className="h-12 text-base"
                      />
                      <Button type="button" onClick={handleAddTag} className="h-12 px-6">
                        Add
                      </Button>
                    </div>
                    {editingTask.tags && editingTask.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {editingTask.tags.map((tag, index) => (
                          <Badge key={index} variant="secondary" className="flex items-center gap-2 text-sm py-1.5 px-3">
                            {tag}
                            <X
                              className="h-4 w-4 cursor-pointer"
                              onClick={() => handleRemoveTag(tag)}
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
                    disabled={isLoading || !editingTask?.title.trim()}
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
                {editingTask && (
                  <TaskWebhookSettings
                    taskId={editingTask.id}
                    initialConfig={editingTask.metadata?.webhookConfig}
                    onSave={(config) => handleSaveWebhook(editingTask.id, config)}
                    onTest={(config) => handleTestWebhook(editingTask.id, config)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </SheetContent>
        </Sheet>
      ) : (
        /* Edit Task Modal - Desktop (Dialog) */
        <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
          <DialogContent 
            className="max-w-2xl max-h-[90vh] overflow-y-auto"
            onOpenAutoFocus={(e) => isMobile && e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Edit Task</DialogTitle>
            </DialogHeader>

            {editingTask && (
              <div className="space-y-4">
                {/* Title */}
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={editingTask.title}
                    onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                    placeholder="Task title"
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={editingTask.description || ''}
                    onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                    placeholder="Task description (optional)"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Status */}
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={editingTask.status}
                      onValueChange={(value: ExtendedTask["status"]) =>
                        setEditingTask({ ...editingTask, status: value })
                      }
                    >
                      <SelectTrigger id="status">
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
                    <Label htmlFor="priority">Priority</Label>
                    <Select
                      value={editingTask.priority}
                      onValueChange={(value: ExtendedTask["priority"]) =>
                        setEditingTask({ ...editingTask, priority: value })
                      }
                    >
                      <SelectTrigger id="priority">
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
                  <Label htmlFor="dueDate">Due Date</Label>
                  <Input
                    id="dueDate"
                    type="datetime-local"
                    value={editingTask.dueDate ?
                      new Date(editingTask.dueDate).toISOString().slice(0, 16) :
                      ''
                    }
                    onChange={(e) => setEditingTask({
                      ...editingTask,
                      dueDate: e.target.value ? new Date(e.target.value) : undefined
                    })}
                  />
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tags"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
                      placeholder="Add a tag..."
                    />
                    <Button type="button" onClick={handleAddTag} size="sm">
                      Add
                    </Button>
                  </div>
                  {editingTask.tags && editingTask.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {editingTask.tags.map((tag, index) => (
                        <Badge key={index} variant="secondary" className="flex items-center gap-1">
                          {tag}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => handleRemoveTag(tag)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <DialogFooter className="flex flex-col sm:flex-row sm:justify-between gap-2">
              <Button
                variant="destructive"
                onClick={handleDeleteFromModal}
                disabled={isLoading}
                className="sm:mr-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Task
              </Button>
              
              <Dialog open={isWebhookModalOpen} onOpenChange={setIsWebhookModalOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Advanced Settings
                  </Button>
                </DialogTrigger>
                <DialogContent 
                  className="max-w-2xl max-h-[80vh] overflow-y-auto"
                  onOpenAutoFocus={(e) => isMobile && e.preventDefault()}
                >
                  <DialogHeader>
                    <DialogTitle>Advanced Settings: {editingTask?.title}</DialogTitle>
                  </DialogHeader>
                  {editingTask && (
                    <TaskWebhookSettings
                      taskId={editingTask.id}
                      initialConfig={editingTask.metadata?.webhookConfig}
                      onSave={(config) => handleSaveWebhook(editingTask.id, config)}
                      onTest={(config) => handleTestWebhook(editingTask.id, config)}
                    />
                  )}
                </DialogContent>
              </Dialog>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={isLoading || !editingTask?.title.trim()}
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
