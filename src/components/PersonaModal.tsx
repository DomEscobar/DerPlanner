import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Save, Share2, Copy, Check, Info, Bell, BellOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getPersona, savePersona, getAlarmSettings, saveAlarmSettings, type AlarmSettings, savePushSubscription } from "@/lib/storage";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chatApi } from "@/lib/api";
import { isPushSupported, urlBase64ToUint8Array, serializePushSubscription, getExistingSubscription } from "@/lib/push-utils";

interface PersonaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  conversationId: string;
  sessionId: string;
}

const DEFAULT_PERSONA = `Act like a mysteriouse butler answering in metaphors and somethimes ascii art`;

export const PersonaModal = ({ 
  open, 
  onOpenChange, 
  userId,
  conversationId,
  sessionId 
}: PersonaModalProps) => {
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [copied, setCopied] = useState(false);
  const [copiedInfo, setCopiedInfo] = useState(false);
  const [alarmSettings, setAlarmSettings] = useState<AlarmSettings>(getAlarmSettings());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      const savedPersona = getPersona();
      setPersona(savedPersona || DEFAULT_PERSONA);
      setAlarmSettings(getAlarmSettings());
      
      if ('Notification' in window) {
        setNotificationPermission(Notification.permission);
      }
    }
  }, [open]);

  const handleSavePersona = () => {
    try {
      savePersona(persona);
      toast({
        title: "Persona saved",
        description: "Your AI persona has been updated. It will be applied to future conversations.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save persona",
        variant: "destructive",
      });
    }
  };

  const handleResetPersona = () => {
    setPersona(DEFAULT_PERSONA);
  };

  const generateShareUrl = (): string => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      userId,
      sessionId,
      conversationId,
    });
    return `${baseUrl}?${params.toString()}`;
  };

  const handleCopyShareUrl = () => {
    const shareUrl = generateShareUrl();
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "Share this link to collaborate on the same conversation",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyConversationInfo = () => {
    const info = `User ID: ${userId}\nSession ID: ${sessionId}\nConversation ID: ${conversationId}`;
    navigator.clipboard.writeText(info);
    setCopiedInfo(true);
    toast({
      title: "Info copied!",
      description: "Conversation details copied to clipboard",
    });
    setTimeout(() => setCopiedInfo(false), 2000);
  };

  const handleSaveAlarmSettings = async () => {
    try {
      if (alarmSettings.enabled && notificationPermission !== 'granted') {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        
        if (permission !== 'granted') {
          toast({
            title: "Permission required",
            description: "Please allow notifications to use event alarms",
            variant: "destructive",
          });
          return;
        }
      }
      
      // Subscribe to push notifications if enabled
      if (alarmSettings.enabled && isPushSupported()) {
        try {
          // Get VAPID public key from backend
          const vapidPublicKey = await chatApi.getVapidPublicKey();
          
          // Get service worker registration
          const registration = await navigator.serviceWorker.ready;
          
          // Check for existing subscription
          let subscription = await registration.pushManager.getSubscription();
          
          // If no subscription exists, create one
          if (!subscription) {
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
            });
          }
          
          // Convert subscription to backend format
          const subscriptionData = serializePushSubscription(subscription);
          
          // Send subscription to backend
          await chatApi.subscribeToPush(userId, subscriptionData, alarmSettings);
          
          // Save subscription locally
          savePushSubscription(subscription);
          
          console.log('✅ Successfully subscribed to push notifications');
        } catch (error) {
          console.error('Push subscription error:', error);
          toast({
            title: "Subscription failed",
            description: error instanceof Error ? error.message : "Could not enable push notifications",
            variant: "destructive",
          });
          return;
        }
      }
      
      // Save alarm settings to localStorage
      saveAlarmSettings(alarmSettings);
      
      toast({
        title: "Alarm settings saved",
        description: alarmSettings.enabled 
          ? "You'll receive notifications before events start" 
          : "Event notifications disabled",
      });
    } catch (error) {
      console.error('Save alarm settings error:', error);
      toast({
        title: "Error",
        description: "Failed to save alarm settings",
        variant: "destructive",
      });
    }
  };

  const handleTestNotification = async () => {
    if (notificationPermission !== 'granted') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      
      if (permission !== 'granted') {
        toast({
          title: "Permission denied",
          description: "Please allow notifications to test",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      // Get existing subscription
      const subscription = await getExistingSubscription();
      
      if (!subscription) {
        toast({
          title: "Not subscribed",
          description: "Please enable alarms and save settings first",
          variant: "destructive",
        });
        return;
      }
      
      // Convert subscription to backend format
      const subscriptionData = serializePushSubscription(subscription);
      
      // Send test notification via backend (tests the full flow)
      const result = await chatApi.sendTestPush(userId, subscriptionData);
      
      if (result.success) {
        toast({
          title: "Test notification sent!",
          description: "Check your notifications. Works even when app is closed!",
        });
      } else {
        throw new Error(result.error || 'Test failed');
      }
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast({
        title: "Test failed",
        description: error instanceof Error ? error.message : "Could not send test notification",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] sm:max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            AI Configuration
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Customize AI behavior and share this conversation
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="persona" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-4 sm:mx-6 mt-3 grid w-auto grid-cols-3 h-9 sm:h-10 flex-shrink-0">
            <TabsTrigger value="persona" className="text-xs sm:text-sm">
              <Sparkles className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Persona</span>
              <span className="xs:hidden">AI</span>
            </TabsTrigger>
            <TabsTrigger value="alarm" className="text-xs sm:text-sm">
              <Bell className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Alarm
            </TabsTrigger>
            <TabsTrigger value="share" className="text-xs sm:text-sm">
              <Share2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Share
            </TabsTrigger>
          </TabsList>

          <TabsContent 
            value="persona" 
            className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 mt-4 space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-900 dark:text-blue-200">
                  Define how DerPlanner should behave and respond. This instruction guides the AI's tone, style, and approach.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">System Instruction</label>
                <Textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Enter system instructions for the AI..."
                  className="min-h-[240px] sm:min-h-[300px] font-mono text-xs sm:text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Saved locally and applied to all future conversations
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-4 border-t">
              <Button 
                variant="outline" 
                onClick={handleResetPersona}
                className="w-full sm:w-auto text-sm"
              >
                Reset to Default
              </Button>
              <Button 
                onClick={handleSavePersona}
                className="w-full sm:w-auto text-sm"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Persona
              </Button>
            </div>
          </TabsContent>

          <TabsContent 
            value="alarm" 
            className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 mt-4 space-y-4"
          >
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
                <Info className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-purple-900 dark:text-purple-200">
                  Get push notifications before your events start. Works even when the app is closed.
                </p>
              </div>

              <div className="space-y-6 p-4 rounded-lg border bg-card">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="alarm-enabled" className="text-sm font-semibold flex items-center gap-2">
                      {alarmSettings.enabled ? (
                        <Bell className="h-4 w-4 text-primary" />
                      ) : (
                        <BellOff className="h-4 w-4 text-muted-foreground" />
                      )}
                      Event Alarms
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Receive notifications before events
                    </p>
                  </div>
                  <Switch
                    id="alarm-enabled"
                    checked={alarmSettings.enabled}
                    onCheckedChange={(checked) => 
                      setAlarmSettings({ ...alarmSettings, enabled: checked })
                    }
                  />
                </div>

                {alarmSettings.enabled && (
                  <>
                    <div className="space-y-2 pt-2 border-t">
                      <Label htmlFor="minutes-before" className="text-sm font-medium">
                        Notification Time
                      </Label>
                      <Select
                        value={alarmSettings.minutesBefore.toString()}
                        onValueChange={(value) => 
                          setAlarmSettings({ ...alarmSettings, minutesBefore: parseInt(value) })
                        }
                      >
                        <SelectTrigger id="minutes-before">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5 minutes before</SelectItem>
                          <SelectItem value="10">10 minutes before</SelectItem>
                          <SelectItem value="15">15 minutes before</SelectItem>
                          <SelectItem value="30">30 minutes before</SelectItem>
                          <SelectItem value="60">1 hour before</SelectItem>
                          <SelectItem value="120">2 hours before</SelectItem>
                          <SelectItem value="1440">1 day before</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        When to notify you before an event starts
                      </p>
                    </div>

                    <div className="space-y-3 pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="show-notification" className="text-sm font-medium">
                            Show Notifications
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Display push notifications
                          </p>
                        </div>
                        <Switch
                          id="show-notification"
                          checked={alarmSettings.showNotification}
                          onCheckedChange={(checked) => 
                            setAlarmSettings({ ...alarmSettings, showNotification: checked })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="sound-enabled" className="text-sm font-medium">
                            Notification Sound
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Play sound with notifications
                          </p>
                        </div>
                        <Switch
                          id="sound-enabled"
                          checked={alarmSettings.soundEnabled}
                          onCheckedChange={(checked) => 
                            setAlarmSettings({ ...alarmSettings, soundEnabled: checked })
                          }
                        />
                      </div>
                    </div>

                    {notificationPermission !== 'granted' && (
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                        <p className="text-xs text-amber-900 dark:text-amber-200">
                          ⚠️ Notification permission is required. Click "Save Settings" to request permission.
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button 
                        onClick={handleTestNotification} 
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        <Bell className="h-4 w-4 mr-2" />
                        Test Notification
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end pt-4 border-t">
                <Button 
                  onClick={handleSaveAlarmSettings}
                  className="w-full sm:w-auto"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Settings
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent 
            value="share" 
            className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 mt-4 space-y-4"
          >
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-900 dark:text-blue-200">
                  Share this conversation with others to collaborate in real-time. They'll see all chat history, tasks, and events with full context.
                </p>
              </div>

              <div className="p-4 rounded-lg border bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border-orange-200 dark:border-orange-800 space-y-3">
                <div className="flex items-start gap-2">
                  <Share2 className="h-5 w-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-orange-900 dark:text-orange-100 mb-1">
                      Shareable Conversation Link
                    </h4>
                    <p className="text-xs text-orange-800/80 dark:text-orange-200/80 mb-3">
                      This unique URL gives anyone instant access to:
                    </p>
                    <ul className="text-xs text-orange-800/80 dark:text-orange-200/80 space-y-1 mb-3 ml-4">
                      <li>• Full chat history and AI responses</li>
                      <li>• All tasks created in this conversation</li>
                      <li>• All events and meetings scheduled</li>
                      <li>• Ability to continue the conversation</li>
                      <li>• Permission to create new tasks/events</li>
                    </ul>
                    <p className="text-xs text-orange-800/80 dark:text-orange-200/80">
                      No login required—they can join immediately by clicking the link.
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-orange-200 dark:border-orange-700">
                  <div className="flex-1 p-3 rounded-lg border bg-white dark:bg-gray-950 font-mono text-xs break-all overflow-x-auto scrollbar-thin">
                    {generateShareUrl()}
                  </div>
                  <Button 
                    onClick={handleCopyShareUrl} 
                    variant="default"
                    className="w-full sm:w-auto flex-shrink-0"
                    size="sm"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Copy Link</span>
                        <span className="sm:hidden">Copy</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                <p className="text-xs text-green-900 dark:text-green-200 font-medium mb-2">
                  💡 Perfect for:
                </p>
                <ul className="text-xs text-green-800/80 dark:text-green-200/80 space-y-1 ml-4">
                  <li>• Team collaboration and planning</li>
                  <li>• Project updates with stakeholders</li>
                  <li>• Client presentations and proposals</li>
                  <li>• Cross-department coordination</li>
                </ul>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end px-4 sm:px-6 py-3 sm:py-4 border-t bg-muted/30 flex-shrink-0">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            className="text-sm"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

