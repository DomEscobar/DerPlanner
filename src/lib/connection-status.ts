/**
 * Connection status monitoring and retry logic
 */

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
};

/**
 * Check if the user is online
 */
export const isOnline = (): boolean => {
  return navigator.onLine;
};

/**
 * Get current connection status
 */
export const getConnectionStatus = (): ConnectionStatus => {
  return navigator.onLine ? 'online' : 'offline';
};

/**
 * Add connection status change listener
 */
export const addConnectionListener = (
  callback: (status: ConnectionStatus) => void
): (() => void) => {
  const onOnline = () => callback('online');
  const onOffline = () => callback('offline');

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Return cleanup function
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
};

/**
 * Calculate delay for retry attempt using exponential backoff
 */
const calculateDelay = (
  attempt: number,
  options: Required<RetryOptions>
): number => {
  const delay = Math.min(
    options.initialDelay * Math.pow(options.backoffMultiplier, attempt),
    options.maxDelay
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
};

/**
 * Wait for specified milliseconds
 */
const wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry a function with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      // Check if online before attempting
      if (!isOnline()) {
        throw new Error('Network offline');
      }

      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // Don't retry on last attempt
      if (attempt === opts.maxRetries - 1) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw error;
      }

      // Calculate and wait for delay
      const delay = calculateDelay(attempt, opts);
      console.log(`Retry attempt ${attempt + 1}/${opts.maxRetries} after ${delay}ms`);
      await wait(delay);
    }
  }

  throw lastError || new Error('Max retries exceeded');
};

/**
 * Determine if an error is retryable
 */
const isRetryableError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Network errors are retryable
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('offline')
    ) {
      return true;
    }

    // HTTP 5xx errors are retryable
    if (message.match(/http.*5\d\d/i)) {
      return true;
    }

    // 429 Too Many Requests is retryable
    if (message.includes('429') || message.includes('too many requests')) {
      return true;
    }
  }

  return false;
};

/**
 * Wait for network to come online
 */
export const waitForOnline = (timeout: number = 30000): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (isOnline()) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Network timeout'));
    }, timeout);

    const onOnline = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', onOnline);
    };

    window.addEventListener('online', onOnline);
  });
};

/**
 * Ping the API to check connectivity
 */
export const pingApi = async (apiUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    return response.ok;
  } catch (error) {
    console.error('API ping failed:', error);
    return false;
  }
};

/**
 * Monitor connection and automatically retry on reconnect
 */
export class ConnectionMonitor {
  private status: ConnectionStatus = 'online';
  private listeners: Set<(status: ConnectionStatus) => void> = new Set();
  private cleanup?: () => void;

  constructor(private apiUrl?: string) {
    this.status = getConnectionStatus();
    this.setup();
  }

  private setup() {
    this.cleanup = addConnectionListener((status) => {
      this.updateStatus(status);
    });
  }

  private updateStatus(status: ConnectionStatus) {
    if (this.status !== status) {
      this.status = status;
      this.notifyListeners();

      // Ping API when coming back online
      if (status === 'online' && this.apiUrl) {
        this.verifyConnection();
      }
    }
  }

  private async verifyConnection() {
    if (!this.apiUrl) return;

    this.updateStatus('reconnecting');
    const isConnected = await pingApi(this.apiUrl);

    if (isConnected) {
      this.updateStatus('online');
    } else {
      this.updateStatus('offline');
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.status));
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public subscribe(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    // Immediately notify with current status
    listener(this.status);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  public destroy() {
    this.cleanup?.();
    this.listeners.clear();
  }
}

/**
 * Create a singleton connection monitor
 */
export const createConnectionMonitor = (apiUrl?: string): ConnectionMonitor => {
  return new ConnectionMonitor(apiUrl);
};




