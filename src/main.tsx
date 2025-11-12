import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeIds } from "./lib/storage";

// Initialize IDs from URL parameters or localStorage before rendering
const { fromUrl } = initializeIds();

if (fromUrl) {
  console.log('Loaded shared conversation from URL parameters');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('Service Worker registered:', registration.scope);
        
        let refreshing = false;
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New version available! Reloading...');
                
                // Auto-reload to get the new version
                if (!refreshing) {
                  refreshing = true;
                  window.location.reload();
                }
              }
            });
          }
        });
        
        // Check for updates when page becomes visible
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            registration.update();
          }
        });
        
        // Check for updates when page gains focus
        window.addEventListener('focus', () => {
          registration.update();
        });
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

