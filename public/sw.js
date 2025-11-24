const VERSION = '2.0.0'; // Glassmorphic Design v2
const CACHE_NAME = `derplanner-${VERSION}`;
const RUNTIME_CACHE = `derplanner-runtime-${VERSION}`;
const ASSET_CACHE = `derplanner-assets-${VERSION}`;

const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/robots.txt'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAME && 
            cacheName !== RUNTIME_CACHE && 
            cacheName !== ASSET_CACHE &&
            cacheName.startsWith('derplanner-')
          ) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);
  const isHTMLRequest = event.request.mode === 'navigate' || 
                        event.request.destination === 'document' ||
                        url.pathname === '/' || 
                        url.pathname.endsWith('.html');

  if (isHTMLRequest) {
    // Network-first strategy for HTML to ensure updates
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first for assets with stale-while-revalidate
    event.respondWith(
      caches.match(event.request).then((response) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Cache successful responses
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            const cacheName = url.pathname.match(/\.(js|css|woff|woff2)$/) ? ASSET_CACHE : RUNTIME_CACHE;
            caches.open(cacheName).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => response);

        // Return cached version immediately, update in background
        return response || fetchPromise;
      })
    );
  }
});

// Listen for push events (from backend via Push API)
self.addEventListener('push', (event) => {
  console.log('🔔 Push event received:', event);
  
  let data = {
    title: 'DerPlanner',
    body: 'You have an upcoming event',
    icon: '/android/android-launchericon-192-192.png',
    badge: '/favicon.ico',
    tag: 'event-notification',
    requireInteraction: false,
    silent: false,
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      console.error('Error parsing push data:', e);
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    requireInteraction: data.requireInteraction,
    silent: data.silent,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      eventId: data.eventId,
      timestamp: Date.now(),
    },
    actions: [
      {
        action: 'open',
        title: 'View Event',
        icon: '/favicon.ico'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ],
    badge: data.badge,
    lang: 'en',
    dir: 'ltr'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
      .catch((error) => console.error('Failed to show notification:', error))
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.action);
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  // Default action or 'open' action
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (let client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('📌 Notification closed:', event.notification.tag);
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_ASSETS') {
    caches.open(ASSET_CACHE).then((cache) => {
      cache.addAll(event.data.urls).catch((error) => {
        console.error('Failed to cache assets:', error);
      });
    });
  }
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(
      clients.matchAll().then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: 'BACKGROUND_SYNC', tag: event.tag });
        });
      })
    );
  }
});

