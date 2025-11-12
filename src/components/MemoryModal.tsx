import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Brain, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiClient } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Memory {
  id: string;
  memory: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

interface MemoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

export const MemoryModal = ({ open, onOpenChange, userId }: MemoryModalProps) => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && userId) {
      fetchMemories();
    }
  }, [open, userId]);

  const fetchMemories = async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.request<{ memories: Memory[]; count?: number }>(
        `/api/memory/${userId}/all`
      );

      if (response.success && response.data) {
        // Handle response.data structure: { memories: [], count: number }
        const data = response.data as any;
        const memoryList = data.memories || (Array.isArray(data) ? data : []);
        setMemories(memoryList);
      } else {
        setMemories([]);
        if (response.error) {
          toast({
            title: "Error",
            description: response.error,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("Error fetching memories:", error);
      setMemories([]);
      toast({
        title: "Error",
        description: "Failed to load memories",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const response = await apiClient.request(
        `/api/memory/${userId}/${memoryId}`,
        { method: "DELETE" }
      );

      if (response.success) {
        setMemories(memories.filter((m) => m.id !== memoryId));
        toast({
          title: "Success",
          description: "Memory deleted",
        });
      } else {
        toast({
          title: "Error",
          description: response.error || "Failed to delete memory",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error deleting memory:", error);
      toast({
        title: "Error",
        description: "Failed to delete memory",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Memory
          </DialogTitle>
          <DialogDescription>
            Memories stored about you to provide personalized assistance
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading memories...</span>
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No memories stored yet</p>
              <p className="text-xs mt-2">The AI will remember important information as you chat</p>
            </div>
          ) : (
            <div className="space-y-3">
              {memories.map((memory) => (
                <div
                  key={memory.id || Math.random()}
                  className="group relative p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed">{memory.memory || memory.content || "No content"}</p>
                      {memory.metadata && Object.keys(memory.metadata).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(memory.metadata).map(([key, value]) => (
                            <span
                              key={key}
                              className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground"
                            >
                              {key}: {String(value)}
                            </span>
                          ))}
                        </div>
                      )}
                      {memory.created_at && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(memory.created_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 shrink-0"
                      onClick={() => handleDeleteMemory(memory.id)}
                      title="Delete memory"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            {memories.length} {memories.length === 1 ? "memory" : "memories"} stored
          </p>
          <Button variant="outline" size="sm" onClick={fetchMemories} disabled={isLoading}>
            <Loader2 className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : "hidden"}`} />
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

