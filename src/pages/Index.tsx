import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatInterface } from "@/components/ChatInterface";
import { CalendarView } from "@/components/CalendarView";
import { TodoList } from "@/components/TodoList";
import { PWAInstallButton } from "@/components/PWAInstallButton";
import { Home, Calendar, CheckSquare } from "lucide-react";

const Index = () => {
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden relative bg-background">
      <PWAInstallButton />
      
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* Top Navigation Header */}
        <div className="flex-shrink-0 z-50 px-4 py-3 flex items-center justify-center bg-background/80 backdrop-blur-xl border-b border-border/50">
            <TabsList className="bg-muted/50 border border-border/50 p-1 h-9 rounded-full">
              <TabsTrigger 
                value="chat" 
                className="rounded-full px-3 h-full data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
                title="Today"
              >
                <Home className="h-4 w-4" />
              </TabsTrigger>
              
              <TabsTrigger 
                value="calendar" 
                className="rounded-full px-3 h-full data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
                title="Calendar"
              >
                <Calendar className="h-4 w-4" />
              </TabsTrigger>
              
              <TabsTrigger 
                value="todos" 
                className="rounded-full px-3 h-full data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
                title="Tasks"
              >
                <CheckSquare className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
        </div>

        <div className="flex-1 overflow-hidden relative z-0">
            <TabsContent value="chat" className="h-full m-0">
            <ChatInterface />
            </TabsContent>

            <TabsContent value="calendar" className="h-full m-0">
            <CalendarView />
            </TabsContent>

            <TabsContent value="todos" className="h-full m-0">
            <TodoList />
            </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default Index;
