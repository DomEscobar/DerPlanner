import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, Loader2, Sparkles, Zap, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StreamStep {
  number: number;
  agent: string;
  action: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  timestamp: string;
  result?: any;
}

interface StreamingProgressProps {
  steps: StreamStep[];
  currentMessage?: string;
  isComplete?: boolean;
}

const agentIcons: Record<string, React.ReactNode> = {
  'RoutingAgent': <Brain className="h-3 w-3" />,
  'TaskManager': <CheckCircle2 className="h-3 w-3" />,
  'EventManager': <Sparkles className="h-3 w-3" />,
};

export const StreamingProgress = ({ steps, currentMessage, isComplete }: StreamingProgressProps) => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isComplete) {
      const interval = setInterval(() => {
        setDots(prev => prev.length >= 3 ? '' : prev + '.');
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isComplete]);

  // For ADHD users, we want to show a simplified "Processing..." state 
  // rather than a complex technical breakdown of agents and steps.
  const activeStep = steps.find(s => s.status === 'in_progress') || steps[steps.length - 1];

  if (!activeStep && !isComplete) return null;

  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 p-2 rounded-xl bg-primary/5 border border-primary/10"
      >
        <div className="relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {!isComplete ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 className="h-4 w-4 text-primary" />
            </motion.div>
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90">
            {isComplete ? "Done!" : "Thinking..."}
          </p>
          {!isComplete && activeStep && (
            <p className="text-xs text-muted-foreground truncate">
               {activeStep.agent === 'RoutingAgent' ? 'Understanding request...' : 
                activeStep.agent === 'TaskManager' ? 'Organizing tasks...' :
                activeStep.agent === 'EventManager' ? 'Scheduling events...' :
                'Working on it...'}
            </p>
          )}
        </div>
      </motion.div>

      {/* Simplified Progress Bar */}
      {!isComplete && steps.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full h-1 bg-muted rounded-full overflow-hidden mt-2"
        >
          <motion.div
            className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `${Math.min((steps.length / 5) * 100, 100)}%` }}
            transition={{ duration: 0.3 }}
          />
        </motion.div>
      )}
    </div>
  );
};

