# Gmail Integration Setup Guide

This guide walks through setting up Gmail calendar synchronization for DerPlanner.

## Prerequisites

- Google Cloud project with API access
- PostgreSQL database running
- Node.js 18+
- OpenSSL (for encryption key generation)

## Step 1: Google Cloud Setup

### 1.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a Project** → **New Project**
3. Name: `DerPlanner`
4. Create the project

### 1.2 Enable APIs

1. Go to **APIs & Services** → **Library**
2. Search for and enable:
   - **Gmail API**
   - **Google Calendar API** (optional, for future features)

### 1.3 Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Choose **Application type: Web application**
4. Add **Authorized redirect URIs**:
   - Development: `http://localhost:3001/api/integrations/google/callback`
   - Production: `https://api.yourdomain.com/api/integrations/google/callback`
5. Click **Create**
6. Download JSON (don't share this!)

### 1.4 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Choose **User Type: External**
3. Fill in:
   - **App name**: `DerPlanner`
   - **User support email**: your@email.com
   - **Developer contact**: your@email.com
4. Go to **Scopes** → **Add or remove scopes**
5. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.readonly`
6. Save and continue
7. **Test users**: Add your email

## Step 2: Environment Configuration

### 2.1 Generate Encryption Key

```bash
cd server
openssl rand -hex 32
```

Copy the output (64 hex characters).

### 2.2 Update .env File

```env
# Gmail OAuth (from Step 1)
GOOGLE_CLIENT_ID=your_client_id_from_console
GOOGLE_CLIENT_SECRET=your_client_secret_from_console
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/google/callback

# Encryption Key (from Step 2.1)
ENCRYPTION_KEY=your_64_character_hex_key_from_above
```

### 2.3 Install Dependencies

```bash
cd server
npm install googleapis ical.js axios
```

## Step 3: Database Setup

The migration runs automatically on server startup. It creates:

- `gmail_integrations` table (stores encrypted tokens)
- Columns in `events` table for sync tracking:
  - `sync_source` (tracks origin: manual, gmail, outlook)
  - `external_id` (JSONB storing provider IDs)
  - `last_external_sync` (timestamp of last sync)
  - `is_read_only` (future: mark synced events)

## Step 4: Start the Server

```bash
npm run dev
```

You should see in the logs:
```
📧 Gmail Sync: ENABLED
🔄 Running migration: Create Gmail integration tables...
✅ Database initialized
🚀 Starting Gmail sync job (every 5 minutes)...
✅ Server ready with Mastra AI agents + Deep Research + Webhooks + Push Notifications + Calendar Sync!
```

## Step 5: Connect Gmail from Frontend

1. Open DerPlanner in browser
2. Go to Settings → **Calendar Integrations** (if component is integrated)
3. Click **Connect Gmail**
4. Authenticate with your Google account
5. Grant permissions when prompted
6. Click **Sync Now** to trigger initial sync

## Testing

### Manual Testing Checklist

- [ ] Google OAuth URL generates correctly
- [ ] Callback URL successfully exchanges code for tokens
- [ ] Tokens are stored encrypted in database
- [ ] Initial sync fetches calendar events
- [ ] Events appear in DailyBriefing with "🔗 gmail" badge
- [ ] Manual "Sync Now" works
- [ ] Background job runs every 5 minutes
- [ ] Disconnect removes credentials
- [ ] Reconnect works again

### Check Logs

```bash
# Watch server logs
tail -f server.log

# Look for:
# ✅ Gmail credentials stored
# 📥 Starting initial Gmail sync
# ✅ Synced event: [event name]
# 🔄 Running incremental Gmail sync
```

### Database Inspection

```sql
-- Check Gmail integrations
SELECT user_id, sync_status, last_sync_at, sync_error FROM gmail_integrations;

-- Check synced events
SELECT id, title, sync_source, external_id, start_date FROM events 
WHERE sync_source = 'gmail' ORDER BY start_date DESC;
```

## Troubleshooting

### "Invalid OAuth state" Error

**Cause**: State token expired or mismatch

**Solution**: 
- Try connecting again
- Check browser console for full error

### "Invalid grant" Error

**Cause**: Refresh token expired or invalid

**Solution**:
- Disconnect Gmail (`DELETE FROM gmail_integrations WHERE user_id = $1`)
- Reconnect and re-authenticate

### No Events Synced

**Causes**:
1. Gmail account has no calendar invitations
2. ICS attachments not detected
3. Token refresh failed

**Solutions**:
1. Check `gmail_integrations.sync_error` column
2. Look for "⚠️ Error" messages in logs
3. Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
4. Check Google OAuth app has correct scopes

### Tokens Not Encrypted

**Cause**: ENCRYPTION_KEY not configured or invalid

**Solution**:
```bash
# Generate new 64-char hex key
openssl rand -hex 32

# Update .env with exact output
ENCRYPTION_KEY=<paste_output_here>

# Restart server
npm run dev
```

### Background Job Not Running

**Cause**: Gmail sync job not started

**Solution**:
1. Check logs for "✅ Gmail sync job started"
2. Verify `gmailSyncJob.start()` called in server.ts
3. Look for errors in runSync() method

## Architecture Overview

```
User clicks "Connect Gmail"
    ↓
Frontend redirects to Google OAuth URL
    ↓
User authenticates and grants permissions
    ↓
Google redirects to /api/integrations/google/callback
    ↓
exchangeCode() exchanges code for access + refresh tokens
    ↓
Tokens encrypted and stored in gmail_integrations table
    ↓
Background job (every 5 min) calls gmailSyncService.incrementalSync()
    ↓
Service fetches messages with calendar invitations (.ics files)
    ↓
Parses ICS content into calendar events
    ↓
Checks for duplicates using external_id
    ↓
Inserts/updates events in events table with sync_source='gmail'
    ↓
Frontend calls useEvents(), displays with 🔗 badge
```

## Next Steps

- [ ] Test with multiple user accounts
- [ ] Add calendar label filtering (future: let users choose which labels to sync)
- [ ] Implement Outlook integration (see CALENDAR_SYNC.md)
- [ ] Add webhook subscriptions for real-time sync (currently 5-min polling)
- [ ] Implement write-back (Phase 2): sync events back to Gmail

## Support

- Check `/docs/CALENDAR_SYNC.md` for detailed architecture
- See `/server/src/services/gmail-sync-service.ts` for implementation details
- Review `/server/src/services/gmail-auth-service.ts` for OAuth flow

