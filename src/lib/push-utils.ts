/**
 * Push notification utility functions for PWA
 */

/**
 * Convert a base64 VAPID key to Uint8Array for Push API
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Convert PushSubscription to format expected by backend
 */
export function serializePushSubscription(subscription: PushSubscription): {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
} {
  // Modern browsers support toJSON() which returns the correct format
  const subscriptionJson = subscription.toJSON();
  
  if (subscriptionJson.keys) {
    return {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscriptionJson.keys.p256dh || '',
        auth: subscriptionJson.keys.auth || ''
      }
    };
  }
  
  // Fallback for browsers that don't support toJSON() properly
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
      auth: arrayBufferToBase64(subscription.getKey('auth'))
    }
  };
}

/**
 * Check if push notifications are supported
 */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 
         'PushManager' in window && 
         'Notification' in window;
}

/**
 * Check if user is already subscribed to push
 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (error) {
    console.error('Error getting existing subscription:', error);
    return null;
  }
}

