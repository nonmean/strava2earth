import React, { createContext, useContext } from 'react';
import { useAppStore, Theme } from '../stores/appStore';

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  surface: string;
  accent: string;
  text: string;
  textMuted: string;
  border: string;
}

const THEMES: Record<Theme, ThemeColors> = {
  default: {
    bg: '#1a1a2e',
    bgSecondary: '#16213e',
    surface: '#0f3460',
    accent: '#fc4c02',
    text: '#e0e0e0',
    textMuted: '#a0a0b0',
    border: '#2a2a4e',
  },
  cyberpunk: {
    bg: '#0a000f',
    bgSecondary: '#100015',
    surface: '#1a0020',
    accent: '#ff00ff',
    text: '#00fff9',
    textMuted: '#00aaaa',
    border: '#2a003a',
  },
  classical: {
    bg: '#1c1208',
    bgSecondary: '#231608',
    surface: '#2e1e0a',
    accent: '#c8a84b',
    text: '#f0e0c0',
    textMuted: '#b0a080',
    border: '#3e2e1a',
  },
  alp: {
    bg: '#0d1a0f',
    bgSecondary: '#112214',
    surface: '#162d18',
    accent: '#5cb87a',
    text: '#e8f4e8',
    textMuted: '#90b090',
    border: '#1e3a20',
  },
};

const ThemeContext = createContext<ThemeColors>(THEMES.default);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppStore(s => s.theme);
  return (
    <ThemeContext.Provider value={THEMES[theme]}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}
