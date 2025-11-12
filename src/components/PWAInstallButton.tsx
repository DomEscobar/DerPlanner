import { useState, useEffect } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
};

const isInStandaloneMode = () => {
  return window.matchMedia('(display-mode: standalone)').matches 
    || (window.navigator as any).standalone 
    || document.referrer.includes('android-app://');
};

export const PWAInstallButton = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    if (isInStandaloneMode()) {
      setIsInstallable(false);
      return;
    }

    const iosDevice = isIOS();
    setIsIOSDevice(iosDevice);

    if (iosDevice) {
      setIsInstallable(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setIsInstallable(false);
      toast({
        title: "App Installed!",
        description: "DerPlanner has been added to your home screen.",
      });
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOSDevice) {
      setShowIOSInstructions(true);
      return;
    }

    if (!deferredPrompt) return;

    deferredPrompt.prompt();

    const choiceResult = await deferredPrompt.userChoice;

    if (choiceResult.outcome === 'accepted') {
      toast({
        title: "Installing...",
        description: "DerPlanner is being installed to your device.",
      });
    }

    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  if (!isInstallable) return null;

  return (
    <>
      <Button
        onClick={handleInstallClick}
        size="icon"
        variant="ghost"
        className="fixed top-[2px] right-[2px] z-50 h-9 w-9 rounded-full shadow-md hover:shadow-lg transition-all animate-in fade-in slide-in-from-top-2 duration-500"
        title="Install DerPlanner as an app"
      >
        <Download className="h-5 w-5" />
      </Button>

      <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install DerPlanner</DialogTitle>
            <DialogDescription>
              Follow these steps to install DerPlanner on your iOS device:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                1
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Tap the Share button</p>
                <p className="text-sm text-muted-foreground">
                  Look for the <Share className="inline h-4 w-4 mx-1" /> share icon in the Safari toolbar
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                2
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Select "Add to Home Screen"</p>
                <p className="text-sm text-muted-foreground">
                  Scroll down in the share menu and tap "Add to Home Screen"
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                3
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Confirm installation</p>
                <p className="text-sm text-muted-foreground">
                  Tap "Add" in the top right corner to complete the installation
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

