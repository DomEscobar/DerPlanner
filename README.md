# ⚡ DerPlanner - The Shareable Task Event Planner

<div align="center">
  <img width="32%" alt="Sus" src="https://github.com/user-attachments/assets/5d62a2cf-5516-489c-97ad-baf7b4053a5f" />
  <img width="32%" alt="sus3" src="https://github.com/user-attachments/assets/4ed1e89c-a14a-4a68-ad94-b458cea0e48a" />
  <img width="32%" alt="sus2" src="https://github.com/user-attachments/assets/87e0a6e6-5317-4bcb-aa3e-ec70d6fe4b2c" />
</div>

> An AI-powered task management application with real-time chat, event scheduling, intelligent automation, and webhook integrations.

**[Live Demo](https://derplanner.space/) • [Features](#features) • [Quick Start](#quick-start) • [Development](#development)**

---

## What is DerPlanner ?

DerPlanner Task Event Planner is a full-stack web application that helps you manage tasks and events through natural conversation with an AI assistant. Instead of clicking through forms, just tell DerPlanner what you need to do, and it will:

- ✅ Create and manage tasks
- 📅 Schedule events and meetings
- 💬 Have intelligent conversations about your work
- 🔄 Remember your conversation history
- ⚡ Stream real-time responses
- 🔗 Share conversations with family and collaborate in real-time
- 📱 Work as a Progressive Web App (PWA) - install on any device 

---

## 🎯 Use Case: Automated Marketing via Webhook + n8n

DerPlanner's webhook integrations enable powerful automation workflows. Here's a real-world example:

```mermaid
graph LR
    A["📋 DerPlanner Task"] -->|Task Completed| B["🔗 Webhook Trigger"]
    C["📅 DerPlanner Event"] -->|Event Started| B
    B -->|HTTP POST| D["n8n Workflow Engine"]
    D -->|Process Event| E{Workflow Logic}
    E -->|Send Email| F["📧 Email Service"]
    E -->|Send SMS| G["📱 SMS Service"]
    E -->|Create Contact| H["👥 CRM System"]
    E -->|Add to Campaign| I["📊 Marketing Platform"]
    F --> J["✅ Customer Notified"]
    G --> J
    H --> J
    I --> J
    
    style A fill:#e1f5ff
    style C fill:#e1f5ff
    style B fill:#fff3e0
    style D fill:#f3e5f5
    style J fill:#c8e6c9
```

**How it works:**
1. **Task Completion**: When a task is marked complete in DerPlanner, a webhook triggers
2. **Event Start**: When a scheduled event begins, another webhook fires
3. **n8n Processing**: The webhook payload reaches your n8n workflow
4. **Automated Actions**: n8n processes the data and triggers downstream services:
   - Send customer confirmation emails
   - Update CRM with new leads
   - Add contacts to marketing campaigns
   - Send SMS notifications
   - Create calendar entries
   - And much more...

**Example Scenarios:**
- 📞 **Lead Capture**: Task "Follow up with lead X" → Complete → Webhook → Email sent + CRM updated
- 🎉 **Event Marketing**: Event "Product Launch" → Starts → Webhook → SMS blast + email campaign triggered
- 📊 **Analytics**: Task completion → Webhook → Log to analytics platform + Slack notification

---

## ✨ Key Features

### 🎯 Smart Task Management
- Create tasks by typing naturally ("Create a task to finish the report")
- Set priority levels, due dates, and descriptions
- Track task status (pending, in progress, completed)
- Organize with tags and categories

### 📅 Event Scheduling
- Schedule meetings and events in seconds
- Set locations, attendees, and reminders
- View upcoming events in a calendar
- Natural language like "Schedule a meeting tomorrow at 2 PM"

### 🔍 Research & Analysis
- Conduct comprehensive research on various topics
- Web search integration with citation-backed responses
- Multi-step research analysis and synthesis
- Extract key insights and patterns from findings
- Quick research for definitions and explanations

### 🤖 AI Assistant
- Powered by OpenAI's GPT models (including o3/o4 for deep research)
- Understands natural language requests
- Intelligent message routing to the right agent
- Contextual responses based on conversation history

### 💬 Real-Time Chat
- Live streaming responses
- Message history
- Conversation memory (remembers previous context)
- Beautiful, responsive UI

### 🔗 Collaboration & Sharing
- **Share Conversations**: Generate shareable links to invite others to collaborate on the same conversation in real-time
- **Shared Context**: Anyone with the link can see the full chat history, tasks, and events discussed
- **Unified Workspace**: Multiple users can work on the same tasks and events with synchronized updates
- **Easy Access**: No login required to join a shared conversation - just share the URL

### 📊 Dashboard
- Overview of all tasks and events
- Quick stats (completed, pending, upcoming)
- Visual calendar view
- Search and filter options

### 🎣 Webhook Integrations
- **Event Webhooks**: Trigger HTTP requests when events start (with configurable offset)
- **Task Webhooks**: Trigger HTTP requests on task completion, status changes, creation, or updates
- **Flexible Configuration**: Customize trigger events, authentication, retry logic, and request bodies
- **Execution Logging**: Complete audit trail of all webhook executions
- **Test Mode**: Test webhook configurations before enabling

### 🔔 Push Notifications (PWA)
- **Event Alarms**: Receive push notifications before events start (configurable timing: 5 minutes to 1 day before)
- **Works Offline**: Notifications appear even when the PWA is closed or device is locked
- **User Preferences**: Configure notification timing, sound, and display settings per user
- **Service Worker Powered**: Uses browser Push API for reliable, native-like notifications
- **Smart Scheduling**: Backend automatically monitors events and sends notifications at the right time
- **Cross-Platform**: Works on Android, iOS (limited), and Desktop browsers

---

## 🚀 Quick Start

Choose one of the following methods:

### 🐳 Option 1: Docker (Recommended - Easiest)

**Perfect for:** Production deployment, quick testing, or if you don't want to install PostgreSQL manually.

```bash
# 1. Clone the repository
git clone <repository-url>
cd derplanner-task-event-planner

# 2. Run the interactive setup (creates .env and starts everything)
# On macOS/Linux:
cd docker && chmod +x setup.sh && ./setup.sh

# On Windows (PowerShell):
cd docker
.\setup.ps1

# OR manually:
# Create .env file
cp docker/.env.example .env
# Edit .env with your OPENAI_API_KEY

# Start all services
docker-compose up -d
```

**Access your application:**
- 🌐 **Frontend**: http://localhost
- 🔌 **Backend API**: http://localhost:3001
- ❤️ **Health Check**: http://localhost:3001/health

**What you get:**
- ✅ PostgreSQL with pgvector (auto-configured)
- ✅ Backend API (production build)
- ✅ Frontend (production build with Nginx)
- ✅ All networking handled automatically
- ✅ Data persists between restarts

**Useful commands:**
```bash
docker-compose logs -f          # View logs
docker-compose down             # Stop services
docker-compose restart backend  # Restart a service
docker-compose down -v          # Remove everything including data
```

📚 **Full Docker documentation**: See [docker/README.md](docker/README.md) or [docker/QUICKSTART.md](docker/QUICKSTART.md)

---

### 💻 Option 2: Local Development

**Perfect for:** Active development, debugging, or learning the codebase.

#### Prerequisites
- **Node.js** v18+ (LTS recommended)
- **npm** or **yarn**
- **PostgreSQL** (with pgvector extension)

#### Installation (5 minutes)

```bash
# 1. Clone the repository
git clone <repository-url>
cd derplanner-task-event-planner

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp server/.env.example server/.env
# Edit server/.env with your PostgreSQL credentials and OpenAI API key

# 4. Start PostgreSQL (if not running)
# Make sure PostgreSQL is installed and running on port 5432

# 5. Start the development servers
# Terminal 1: Start the backend (with hot reload)
cd server && npm run dev:watch

# Terminal 2: Start the frontend (with hot reload)
npm run dev
```

**Access your application:**
- 🌐 **Frontend**: http://localhost:5173
- 🔌 **Backend API**: http://localhost:3001

---

## 🤝 Collaboration & Sharing

DerPlanner makes it easy to collaborate with family and friends by sharing conversations, tasks, and events.

### How Sharing Works

1. **Open Settings**: Click the settings icon in the chat interface to open the AI Configuration modal
2. **Go to Share Tab**: Navigate to the "Share" tab
3. **Copy Link**: Click "Copy Link" to get a shareable URL
4. **Share with Others**: Send the link via email, Slack, Teams, or any communication tool

### What Gets Shared

When you share a conversation link, anyone with the link can:
- ✅ See all previous messages and responses
- 📋 View all tasks created during the conversation (with full details)
- 📅 Access all events scheduled in the conversation (including attendees and reminders)
- 💬 Continue the conversation and add new messages
- 🔄 Create additional tasks and events
- 🔍 View the AI's analysis and recommendations

### Use Cases

- **Team Planning**: Share a planning conversation with your team to keep everyone aligned
- **Project Collaboration**: Multiple person can contribute to task and event management
- **Client Updates**: Share progress conversations and milestones with clients
- **Knowledge Sharing**: Distribute research findings and analysis across your organization

---

## 📖 How to Use

### For Users

#### Creating a Task
1. Open the chat interface
2. Type: `"Create a task to finish the project by Friday"`
3. The bot will create the task automatically

#### Scheduling an Event
1. Type: `"Schedule a meeting with John tomorrow at 2 PM"`
2. The bot will add it to your calendar

#### Asking Questions
1. Type: `"How many tasks do I have this week?"`
2. Get instant stats and summaries

#### Conducting Research
1. Type: `"Research the latest AI trends in 2025"`
2. The bot will conduct comprehensive research and provide citation-backed insights
3. Ask follow-up questions for deeper analysis

### For Developers

#### Understanding the Project Structure

```
derplanner-task-event-planner/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities and helpers
│   └── pages/              # Main pages
│
├── server/                 # Express backend
│   ├── src/
│   │   ├── mastra/         # AI agents and workflows
│   │   ├── routes/         # API endpoints
│   │   ├── config/         # Database config
│   │   └── types/          # TypeScript types
│   └── package.json
│
└── tests/                  # Integration tests
```

#### AI Agents Architecture

The system uses multiple specialized agents coordinated through an intelligent routing workflow:

- **Task Agent**: Handles task creation, updates, and management
- **Event Agent**: Manages event scheduling and calendar operations
- **Research Agent**: Conducts comprehensive research with web search integration
  - Uses OpenAI's Deep Research API (o3-deep-research/o4-mini-deep-research)
  - Provides `webResearchTool` for complex, multi-faceted research
  - Provides `quickResearchTool` for definitions, explanations, and single-topic queries
  - Returns citation-backed, structured responses
- **Routing Agent**: Intelligently routes user messages to the appropriate agent

See `server/src/mastra/agents/` for implementation details.

#### Building for Production

```bash
# Build frontend
npm run build

# Build backend (in server/)
cd server && npm run build

# Run production server
cd server && npm start
```

---

## 🛠️ Technology Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast build tool
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **Vitest** - Testing

### Backend
- **Express.js** - Web framework
- **TypeScript** - Type safety
- **PostgreSQL** - Database with pgvector for embeddings
- **OpenAI API** - LLM integration (including Deep Research models for o3/o4)
- **Mastra** - AI orchestration with multi-agent support
  - **Mastra Memory** - PostgreSQL-backed conversation context
  - Automatic context retention across sessions
  - Intelligent routing and multi-agent coordination
- **Socket.io** - Real-time communication

### Infrastructure
- **Node.js** - Runtime
- **npm** - Package manager

---

## 📚 API Endpoints

### Health Check
```bash
GET /health
```
Returns server status.

### Chat Endpoints
```bash
POST /api/agent/general       # General questions
POST /api/agent/task          # Task-specific requests
POST /api/agent/event         # Event scheduling
POST /api/agent/stream        # Streaming responses
```

### Task Management
```bash
GET    /api/tasks             # List all tasks
GET    /api/tasks/:id         # Get specific task
POST   /api/tasks             # Create task
PUT    /api/tasks/:id         # Update task
DELETE /api/tasks/:id         # Delete task
```

### Event Management
```bash
GET    /api/events            # List all events
GET    /api/events/:id        # Get specific event
POST   /api/events            # Create event
PUT    /api/events/:id        # Update event
DELETE /api/events/:id        # Delete event
```

### Summaries & Insights
```bash
GET    /api/summary/daily     # Daily summary
POST   /api/search            # Search tasks/events
```

### Webhook Management
```bash
# Event Webhooks
PUT    /api/events/:id/webhook           # Update event webhook configuration
GET    /api/events/:id/webhook/logs      # Get webhook execution logs
POST   /api/events/:id/webhook/test      # Test webhook configuration
POST   /api/events/:id/webhook/trigger   # Manually trigger webhook

# Task Webhooks
PUT    /api/tasks/:id/webhook            # Update task webhook configuration
GET    /api/tasks/:id/webhook/logs       # Get webhook execution logs
POST   /api/tasks/:id/webhook/test      # Test webhook configuration
POST   /api/tasks/:id/webhook/trigger   # Manually trigger webhook
```

### Push Notifications
```bash
GET    /api/push/public-key              # Get VAPID public key for subscription
POST   /api/push/subscribe               # Subscribe to push notifications
POST   /api/push/unsubscribe             # Unsubscribe from push notifications
POST   /api/push/test                    # Send test notification
GET    /api/push/logs/:userId            # Get notification logs
GET    /api/push/subscriptions/:userId   # Get user's push subscriptions
```

---

## 🔧 Development

### Available Commands

```bash
# Frontend
npm run dev              # Start dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run linter
npm test                 # Run tests

# Backend (cd server/)
npm run dev              # Start dev server with auto-reload
npm run build            # Build TypeScript
npm start                # Run production server
npm run dev:watch        # Watch mode
```

### Environment Variables

Create a `.env` file in the `server/` directory:

```env
# Server
PORT=3001
NODE_ENV=development

# Database (optional)
DATABASE_URL=postgresql://user:password@localhost:5432/derplanner_task_event_planner
POSTGRES_DB=derplanner_task_event_planner

# OpenAI
OPENAI_API_KEY=sk_your_key_here

DAILY_REQUEST_LIMIT=20

# Push Notifications (Optional - for PWA event alarms)
# Generate keys with: cd server && node generate-vapid-keys.js
VAPID_PUBLIC_KEY=your_vapid_public_key_here
VAPID_PRIVATE_KEY=your_vapid_private_key_here
VAPID_SUBJECT=mailto:your-email@derplanner.space

# Other services
# Add as needed
```

### Making Changes

1. **Create a branch**: `git checkout -b feature/your-feature`
2. **Make changes**: Edit files as needed
3. **Test locally**: Run `npm run dev` (both frontend and backend)
4. **Commit**: `git commit -m "Add your feature"`
5. **Push**: `git push origin feature/your-feature`
6. **Create PR**: Open a pull request

## 🤝 Contributing

We welcome contributions! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit (`git commit -m 'Add amazing feature'`)
5. Push (`git push origin feature/amazing-feature`)
6. Open a Pull Request

---

## 📝 Code Standards

- **Style Guide**: Follow ESLint rules
- **TypeScript**: Full type coverage required
- **Components**: Keep them small and reusable
- **Comments**: Add comments for complex logic
- **Commits**: Use clear, descriptive messages

---

## 🎨 Project Philosophy

- **User-First**: Design for real users, not just developers
- **Simple**: Easy to understand and use
- **Reliable**: Robust error handling
- **Maintainable**: Clean, well-organized code
- **Scalable**: Built to grow

---

## ❓ FAQ

**Q: Do I need a database to run this locally?**  
A: No, it works with in-memory storage for development. PostgreSQL is optional.

**Q: Can I use this without OpenAI?**  
A: The AI features require OpenAI, but the task management works without it.

**Q: Is this production-ready?**  
A: Yes! It's fully functional. Make sure to set up proper environment variables.

**Q: How do I customize the AI responses?**  
A: Edit the agent prompts in `server/src/mastra/agents/`.

**Q: Can I add more AI agents?**  
A: Absolutely! See `server/src/mastra/agents/` for examples.

**Q: How do push notifications work?**  
A: Push notifications use the browser Push API and Service Workers. Configure alarm settings in the "Alarm" tab, and you'll receive notifications before events start - even when the app is closed. Generate VAPID keys with `node server/generate-vapid-keys.js` and add them to your `.env` file.

---

## 📞 Support

- **Issues**: Open an issue on GitHub
- **Discussions**: Use GitHub Discussions
- **Docs**: Check `/docs` folder
- **Email**: Support contact here

---

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for full license text.

---

## 🌟 Show Your Support

If you find this project helpful, please:
- ⭐ Star the repository
- 🍴 Fork it
- 📤 Share it with others

