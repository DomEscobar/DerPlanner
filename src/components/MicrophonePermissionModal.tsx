import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Mic } from "lucide-react";

interface MicrophonePermissionModalProps {
  open: boolean;
  status: 'requesting' | 'denied' | 'error';
  onRetry?: () => void;
}

export const MicrophonePermissionModal = ({ 
  open, 
  status,
  onRetry 
}: MicrophonePermissionModalProps) => {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Microphone Access
          </DialogTitle>
        </DialogHeader>
        
        {status === 'requesting' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full animate-pulse"></div>
              <Loader2 className="h-12 w-12 text-primary animate-spin relative" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                Waiting for permission...
              </p>
              <DialogDescription className="text-xs">
                Please check your browser's permission dialog. Click "Allow" to enable microphone access.
              </DialogDescription>
            </div>
          </div>
        )}
        
        {status === 'denied' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="p-3 rounded-full bg-destructive/10">
              <Mic className="h-8 w-8 text-destructive" />
            </div>
            <div className="text-center space-y-3">
              <p className="text-sm font-medium text-foreground">
                Microphone Permission Denied
              </p>
              <DialogDescription className="text-xs">
                You denied microphone access. To use voice recording, please enable microphone permissions in your browser settings and try again.
              </DialogDescription>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        )}
        
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="p-3 rounded-full bg-destructive/10">
              <Mic className="h-8 w-8 text-destructive" />
            </div>
            <div className="text-center space-y-3">
              <p className="text-sm font-medium text-foreground">
                Error Accessing Microphone
              </p>
              <DialogDescription className="text-xs">
                Something went wrong while accessing your microphone. Please check that no other application is using your microphone and try again.
              </DialogDescription>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

