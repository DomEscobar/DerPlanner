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

  // Get only the last 3 steps to avoid clutter
  const displaySteps = steps.slice(-3);
  const lastStep = steps[steps.length - 1];

  return (
    <div className="space-y-2">
      {/* Compact Timeline */}
      <div className="space-y-1.5">
        <AnimatePresence mode="popLayout">
          {displaySteps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 text-xs"
            >
              {/* Status Icon */}
              <div className="relative flex-shrink-0 w-4 h-4 flex items-center justify-center">
                {step.status === 'in_progress' && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  >
                    <Loader2 className="h-3.5 w-3.5 text-purple-500" />
                  </motion.div>
                )}
                {step.status === 'completed' && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                )}
                {step.status === 'pending' && (
                  <Circle className="h-3 w-3 text-muted-foreground/40" />
                )}
                {step.status === 'error' && (
                  <Circle className="h-3.5 w-3.5 text-red-500 fill-red-500/30" />
                )}
              </div>

              {/* Agent and Action */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="font-medium text-foreground/80 whitespace-nowrap flex items-center gap-1">
                  {agentIcons[step.agent] || <Zap className="h-2.5 w-2.5" />}
                  {step.agent}
                </span>
                <span className="text-muted-foreground truncate">
                  {step.action}
                </span>
              </div>

              {/* Active Indicator */}
              {step.status === 'in_progress' && (
                <motion.div
                  animate={{ opacity: [0.5, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="text-[10px] font-medium text-purple-500 whitespace-nowrap"
                >
                  processing
                </motion.div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Progress Bar */}
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

