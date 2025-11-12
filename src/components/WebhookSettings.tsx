import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Settings, Zap, Clock, Shield, TestTube, X } from 'lucide-react';

interface WebhookConfig {
  enabled: boolean;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: Record<string, any>;
  triggerOffset: number;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
  };
  authentication?: {
    type: 'none' | 'bearer' | 'basic' | 'api_key';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    apiKeyHeader?: string;
  };
}

interface WebhookSettingsProps {
  eventId: string;
  initialConfig?: WebhookConfig;
  onSave: (config: WebhookConfig) => Promise<void>;
  onTest: (config: WebhookConfig) => Promise<any>;
}

export const WebhookSettings = ({ eventId, initialConfig, onSave, onTest }: WebhookSettingsProps) => {
  const [config, setConfig] = useState<WebhookConfig>(initialConfig || {
    enabled: false,
    url: '',
    method: 'POST',
    triggerOffset: 0,
    authentication: { type: 'none' },
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [bodyKeyInput, setBodyKeyInput] = useState("");
  const [bodyValueInput, setBodyValueInput] = useState("");

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(config);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(config);
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  };

  const handleAddBodyField = () => {
    if (!bodyKeyInput.trim()) return;
    
    const currentBody = config.body || {};
    setConfig({
      ...config,
      body: {
        ...currentBody,
        [bodyKeyInput.trim()]: bodyValueInput.trim()
      }
    });
    setBodyKeyInput("");
    setBodyValueInput("");
  };

  const handleRemoveBodyField = (key: string) => {
    if (!config.body) return;
    const newBody = { ...config.body };
    delete newBody[key];
    setConfig({
      ...config,
      body: Object.keys(newBody).length > 0 ? newBody : undefined
    });
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="h-5 w-5" />
        <h3 className="text-lg font-semibold">Webhook Configuration</h3>
      </div>

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">
            <Zap className="h-4 w-4 mr-2" />
            Basic
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Shield className="h-4 w-4 mr-2" />
            Advanced
          </TabsTrigger>
          <TabsTrigger value="body">
            <Shield className="h-4 w-4 mr-2" />
            Body
          </TabsTrigger>
          <TabsTrigger value="test">
            <TestTube className="h-4 w-4 mr-2" />
            Test
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 mt-4">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="webhook-enabled" className="flex flex-col gap-1">
              <span>Enable Webhook</span>
              <span className="text-xs text-muted-foreground font-normal">
                Trigger HTTP request when event starts
              </span>
            </Label>
            <Switch
              id="webhook-enabled"
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Webhook URL *</Label>
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://api.example.com/webhook"
              value={config.url}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
              disabled={!config.enabled}
            />
          </div>

          {/* HTTP Method */}
          <div className="space-y-2">
            <Label htmlFor="webhook-method">HTTP Method</Label>
            <Select
              value={config.method}
              onValueChange={(value: any) => setConfig({ ...config, method: value })}
              disabled={!config.enabled}
            >
              <SelectTrigger id="webhook-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trigger Offset */}
          <div className="space-y-2">
            <Label htmlFor="trigger-offset" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Trigger Offset (minutes)
            </Label>
            <Input
              id="trigger-offset"
              type="number"
              min="0"
              placeholder="0"
              value={config.triggerOffset}
              onChange={(e) => setConfig({ ...config, triggerOffset: parseInt(e.target.value) || 0 })}
              disabled={!config.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Trigger webhook X minutes before event start (0 = at event start time)
            </p>
          </div>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 mt-4">
          {/* Authentication Type */}
          <div className="space-y-2">
            <Label htmlFor="auth-type">Authentication</Label>
            <Select
              value={config.authentication?.type || 'none'}
              onValueChange={(value: any) => setConfig({
                ...config,
                authentication: { ...config.authentication, type: value }
              })}
              disabled={!config.enabled}
            >
              <SelectTrigger id="auth-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="basic">Basic Auth</SelectItem>
                <SelectItem value="api_key">API Key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bearer Token */}
          {config.authentication?.type === 'bearer' && (
            <div className="space-y-2">
              <Label htmlFor="auth-token">Bearer Token</Label>
              <Input
                id="auth-token"
                type="password"
                placeholder="Enter bearer token"
                value={config.authentication?.token || ''}
                onChange={(e) => setConfig({
                  ...config,
                  authentication: { ...config.authentication, type: 'bearer', token: e.target.value }
                })}
                disabled={!config.enabled}
              />
            </div>
          )}

          {/* Retry Configuration */}
          <div className="space-y-2">
            <Label htmlFor="max-retries">Max Retries</Label>
            <Input
              id="max-retries"
              type="number"
              min="0"
              max="10"
              placeholder="3"
              value={config.retryConfig?.maxRetries || 3}
              onChange={(e) => setConfig({
                ...config,
                retryConfig: {
                  ...config.retryConfig,
                  maxRetries: parseInt(e.target.value) || 3,
                  retryDelay: config.retryConfig?.retryDelay || 60000
                }
              })}
              disabled={!config.enabled}
            />
          </div>
        </TabsContent>

        <TabsContent value="body" className="space-y-4 mt-4">
          <Alert>
            <AlertDescription>
              Add custom fields to the request body. Default event data is always included.
            </AlertDescription>
          </Alert>

          {/* Add Body Field */}
          <div className="space-y-3">
            <Label>Custom Request Body Fields</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Key (e.g., user_id)"
                value={bodyKeyInput}
                onChange={(e) => setBodyKeyInput(e.target.value)}
                disabled={!config.enabled}
                className="flex-1"
              />
              <Input
                placeholder="Value (e.g., 12345)"
                value={bodyValueInput}
                onChange={(e) => setBodyValueInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAddBodyField()}
                disabled={!config.enabled}
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleAddBodyField}
                size="sm"
                disabled={!config.enabled || !bodyKeyInput.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Display existing body fields */}
          {config.body && Object.keys(config.body).length > 0 && (
            <div className="space-y-2">
              <Label>Current Body Fields</Label>
              <div className="border rounded-md p-3 space-y-2">
                {Object.entries(config.body).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 p-2 bg-muted rounded">
                    <div className="flex-1 flex items-center gap-2 font-mono text-sm">
                      <span className="font-semibold">{key}:</span>
                      <span className="text-muted-foreground">{String(value)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveBodyField(key)}
                      disabled={!config.enabled}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info about default fields */}
          <Alert>
            <AlertDescription>
              <strong>Note:</strong> The default request body includes the event object with id, title, description, startDate, endDate, location, type, and attendees.
              Your custom fields will be merged with the default data.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="test" className="space-y-4 mt-4">
          <Alert>
            <AlertDescription>
              Test your webhook configuration by sending a test request. This will not affect the event.
            </AlertDescription>
          </Alert>

          <Button 
            onClick={handleTest} 
            disabled={!config.enabled || !config.url || isTesting}
            className="w-full"
          >
            {isTesting ? 'Testing...' : 'Send Test Request'}
          </Button>

          {testResult && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={testResult.success ? 'default' : 'destructive'}>
                  {testResult.success ? 'Success' : 'Failed'}
                </Badge>
                {testResult.statusCode && (
                  <Badge variant="outline">HTTP {testResult.statusCode}</Badge>
                )}
                <Badge variant="outline">{testResult.duration}ms</Badge>
              </div>
              {testResult.error && (
                <p className="text-sm text-destructive">{testResult.error}</p>
              )}
              {testResult.responseBody && (
                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                  {testResult.responseBody}
                </pre>
              )}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 mt-6">
        <Button onClick={handleSave} disabled={isSaving || !config.enabled} className="flex-1">
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </Card>
  );
};

