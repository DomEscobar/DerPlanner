import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatInterface } from "@/components/ChatInterface";
import { CalendarView } from "@/components/CalendarView";
import { TodoList } from "@/components/TodoList";
import { PWAInstallButton } from "@/components/PWAInstallButton";
import { MessageSquare, Calendar, CheckSquare } from "lucide-react";

const Index = () => {
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <PWAInstallButton />
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="flex-shrink-0 w-full justify-center p-4 rounded-none border-b border-border bg-card/95 backdrop-blur-sm">
          <TabsTrigger
            value="chat"
            className="rounded-full data-[state=active]:text-secondary-foreground data-[state=active]:text-primary"
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Chat
          </TabsTrigger>
          <TabsTrigger
            value="calendar"
            className="rounded-full data-[state=active]:text-secondary-foreground data-[state=active]:text-primary"
          >
            <Calendar className="h-4 w-4 mr-2" />
            Calendar
          </TabsTrigger>
          <TabsTrigger
            value="todos"
            className="rounded-full data-[state=active]:text-secondary-foreground data-[state=active]:text-primary"
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Tasks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 m-0 overflow-hidden">
          <ChatInterface />
        </TabsContent>

        <TabsContent value="calendar" className="flex-1 m-0 overflow-hidden">
          <CalendarView />
        </TabsContent>

        <TabsContent value="todos" className="flex-1 m-0 overflow-hidden">
          <TodoList />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Index;
