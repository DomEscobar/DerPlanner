import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

export const useTheme = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('app-theme') as ThemeMode | null;
    return saved || 'auto';
  });

  useEffect(() => {
    localStorage.setItem('app-theme', theme);
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
};

const applyTheme = (theme: ThemeMode) => {
  const html = document.documentElement;
  
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.classList.toggle('dark', prefersDark);
  } else {
    html.classList.toggle('dark', theme === 'dark');
  }
};

