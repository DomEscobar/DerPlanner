import { useState, useCallback, useEffect } from 'react';
import { chatApi, Task } from '@/lib/api';

export interface LocalTask {
  id: string;
  text: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: Date;
  tags?: string[];
}

export interface UseTasksOptions {
  userId?: string;
  autoSync?: boolean;
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

export const useTasks = (options: UseTasksOptions = {}) => {
  const {
    userId,
    autoSync = true,
    onError,
    onSuccess,
  } = options;
  
  if (!userId) {
    throw new Error('userId is required for useTasks hook');
  }

  const [tasks, setTasks] = useState<LocalTask[]>([]);

  const [isLoading, setIsLoading] = useState(false);

  // Convert local task to API task format
  const convertToApiTask = (task: LocalTask): Partial<Task> => ({
    title: task.text,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString(),
    tags: task.tags || [],
  });

  // Convert API task to local task format
  const convertFromApiTask = (task: any): LocalTask => ({
    id: task.id,
    text: task.title,
    description: task.description,
    status: task.status || 'pending',
    priority: task.priority,
    // Handle both camelCase and snake_case from API
    dueDate: (task.dueDate || task.due_date) ? new Date(task.dueDate || task.due_date) : undefined,
    tags: task.tags || [],
  });

  // Create a new task directly via API
  const createTask = useCallback(async (description: string) => {
    if (!description.trim()) return;

    setIsLoading(true);
    try {
      const apiTask = await chatApi.createTask({
        title: description,
        status: 'pending',
        priority: 'medium'
      }, userId);
      
      const newTask = convertFromApiTask(apiTask);
      setTasks(prev => [...prev, newTask]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create task';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [userId, onError, onSuccess]);

  // Update a task directly via API
  const updateTask = useCallback(async (taskId: string, updates: Partial<LocalTask>) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setIsLoading(true);
    try {
      const apiUpdates: Partial<Task> = {};
      
      if (updates.text !== undefined) apiUpdates.title = updates.text;
      if (updates.description !== undefined) apiUpdates.description = updates.description;
      if (updates.status !== undefined) apiUpdates.status = updates.status;
      if (updates.priority !== undefined) apiUpdates.priority = updates.priority;
      if (updates.dueDate !== undefined) apiUpdates.dueDate = updates.dueDate.toISOString();
      if (updates.tags !== undefined) apiUpdates.tags = updates.tags;

      const updatedApiTask = await chatApi.updateTask(taskId, apiUpdates);
      const updatedTask = convertFromApiTask(updatedApiTask);
      
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update task';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [tasks, onError, onSuccess]);

  // Delete a task directly via API
  const deleteTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setIsLoading(true);
    try {
      await chatApi.deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete task';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [tasks, onError, onSuccess]);

  // Toggle task completion
  const toggleTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    await updateTask(taskId, { status: newStatus });
  }, [tasks, updateTask]);

  // Get tasks from backend
  const refreshTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiTasks = await chatApi.getTasks(userId);
      const localTasks = apiTasks.map(convertFromApiTask);
      setTasks(localTasks);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh tasks';
      console.error('Failed to refresh tasks:', error);
      // Keep existing tasks on error
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [userId]); // Removed onError and onSuccess from dependencies to prevent infinite loop

  // Search tasks
  const searchTasks = useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      const results = await chatApi.search(query, 10);
      if (results) {
        // Handle search results
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to search tasks';
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [onError, onSuccess]);

  // Auto-sync tasks on mount
  useEffect(() => {
    if (autoSync) {
      refreshTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]); // Only run when autoSync changes, not when refreshTasks changes

  return {
    tasks,
    isLoading,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    refreshTasks,
    searchTasks,
  };
};
