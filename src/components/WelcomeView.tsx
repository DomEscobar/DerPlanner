import { motion } from "framer-motion";
import { Github, Mic, Calendar, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const WelcomeView = () => {
  const features = [
    {
      icon: <Mic className="w-6 h-6 text-primary" />,
      title: "Just Speak",
      description: "Hold the microphone button and say what's on your mind. I'll transcribe and organize it."
    },
    {
      icon: <Calendar className="w-6 h-6 text-purple-500" />,
      title: "Auto-Planning",
      description: "I'll automatically create tasks and calendar events from our conversations."
    },
    {
      icon: <Sparkles className="w-6 h-6 text-amber-500" />,
      title: "Stay Focused",
      description: "I help you track priorities and catch up on overdue tasks without the stress."
    }
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 pb-40 space-y-8 max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center space-y-4"
      >
        <div className="inline-block p-3 rounded-full bg-primary/10 mb-2">
          <span className="text-4xl">👋</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
          Welcome to DerPlanner
        </h1>
        <p className="text-lg text-muted-foreground max-w-md mx-auto leading-relaxed">
          Your personal AI assistant designed to help you navigate life with less friction.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full"
      >
        {features.map((feature, idx) => (
          <div
            key={idx}
            className="p-5 rounded-2xl bg-white/40 dark:bg-white/5 border border-border/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all hover:-translate-y-1"
          >
            <div className="mb-3 p-2 w-fit rounded-xl bg-background/50">
              {feature.icon}
            </div>
            <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="flex flex-col items-center gap-4 pt-4"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground/80 bg-secondary/30 px-4 py-2 rounded-full">
          <span>This is a technical demo</span>
          <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <a
            href="https://github.com/FujiwaraChoki/DerPlanner"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-primary hover:underline font-medium group"
          >
            <Github className="w-3.5 h-3.5" />
            View on GitHub
            <ArrowRight className="w-3 h-3 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
          </a>
        </div>
      </motion.div>
      
      {/* Arrow pointing to mic */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 1 }}
        className="absolute bottom-24 md:bottom-32 left-1/2 -translate-x-1/2 text-muted-foreground/40 animate-bounce hidden md:block"
      >
        <ArrowRight className="w-6 h-6 rotate-90" />
      </motion.div>
    </div>
  );
};

