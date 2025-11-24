import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, RefreshCw, Loader2, Unlink } from 'lucide-react';

interface IntegrationStatus {
  connected: boolean;
  syncStatus?: string;
  lastSyncAt?: string;
  syncError?: string;
  historyId?: string;
}

export const IntegrationsCard = ({ userId }: { userId: string }) => {
  const [gmailStatus, setGmailStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshStatus();
  }, [userId]);

  const refreshStatus = async () => {
    try {
      setError(null);
      const res = await fetch(`/api/integrations/google/status?userId=${userId}`);
      const data = await res.json();

      if (data.success) {
        setGmailStatus(data.data);
      }
    } catch (err) {
      console.error('Error fetching integration status:', err);
      setError('Failed to fetch integration status');
    }
  };

  const handleGoogleConnect = async () => {
    try {
      setError(null);
      const res = await fetch(`/api/integrations/google/url?userId=${userId}`);
      const data = await res.json();

      if (data.success) {
        window.location.href = data.data.authUrl;
      } else {
        setError(data.error);
      }
    } catch (err) {
      console.error('Error connecting Gmail:', err);
      setError('Failed to initiate Gmail connection');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      setError(null);
      const res = await fetch(`/api/integrations/google/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();

      if (data.success) {
        setTimeout(refreshStatus, 1000);
      } else {
        setError(data.error);
      }
    } catch (err) {
      console.error('Error syncing Gmail:', err);
      setError('Failed to trigger sync');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Gmail? Synced events will remain in DerPlanner.')) {
      return;
    }

    setLoading(true);
    try {
      setError(null);
      const res = await fetch(`/api/integrations/google/disconnect`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();

      if (data.success) {
        await refreshStatus();
      } else {
        setError(data.error);
      }
    } catch (err) {
      console.error('Error disconnecting Gmail:', err);
      setError('Failed to disconnect Gmail');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'idle':
        return 'bg-green-100 text-green-700';
      case 'syncing':
        return 'bg-blue-100 text-blue-700';
      case 'error':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">📧 Calendar Integrations</h2>
        <p className="text-sm text-muted-foreground">Connect your email and calendar services to sync events automatically</p>
      </div>

      {error && (
        <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Gmail Integration */}
      <div className="border rounded-lg p-4 space-y-4 hover:border-primary/50 transition-colors">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              📧 Gmail
              {gmailStatus?.connected && (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-200">
                  Connected
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Sync calendar invitations and events from Gmail
            </p>
          </div>
        </div>

        {gmailStatus?.connected ? (
          <div className="space-y-3">
            {/* Status Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground">Status</p>
                <Badge className={getStatusColor(gmailStatus.syncStatus)}>
                  {gmailStatus.syncStatus || 'unknown'}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">Last Sync</p>
                <p className="text-sm font-mono">{formatDate(gmailStatus.lastSyncAt)}</p>
              </div>
            </div>

            {/* Error Message */}
            {gmailStatus.syncError && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {gmailStatus.syncError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSync}
                disabled={syncing || loading || gmailStatus.syncStatus === 'syncing'}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                {syncing || gmailStatus.syncStatus === 'syncing' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Sync Now
                  </>
                )}
              </Button>
              <Button
                onClick={handleDisconnect}
                disabled={loading}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 text-destructive hover:text-destructive"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  <>
                    <Unlink className="h-4 w-4" />
                    Disconnect
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={handleGoogleConnect} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Connecting...
              </>
            ) : (
              'Connect Gmail'
            )}
          </Button>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
        <p className="font-semibold text-blue-900 mb-1">💡 How it works</p>
        <ul className="text-blue-800 space-y-1 text-xs">
          <li>• Events and calendar invitations are synced automatically every 5 minutes</li>
          <li>• Synced events appear in your DailyBriefing and calendar view</li>
          <li>• You can edit synced events within DerPlanner</li>
          <li>• Your changes are preserved (not overwritten on next sync)</li>
        </ul>
      </div>

      {/* Coming Soon */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm opacity-50">
        <p className="font-semibold text-gray-900 mb-1">📆 Coming Soon</p>
        <ul className="text-gray-800 space-y-1 text-xs">
          <li>• Outlook Calendar Integration</li>
          <li>• Apple Calendar Support</li>
          <li>• Write events back to source calendar</li>
        </ul>
      </div>
    </Card>
  );
};

