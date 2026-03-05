/**
 * ThemeContext
 *
 * Provides dark/light mode state throughout the app.
 * Persists user preference via AsyncStorage.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = '@theme_mode';

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  mode: 'system',
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setModeState(stored);
      }
      setLoaded(true);
    });
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';

  return (
    <ThemeContext.Provider value={{ isDark, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeContext);
}

// Color palettes for light and dark modes
const LIGHT_COLORS = {
  primary: '#4A90E2',
  secondary: '#7C6FBF',
  secondaryLight: '#F3F0FF',
  background: '#F8F9FB',
  surface: '#FFFFFF',
  textPrimary: '#1A1D23',
  textSecondary: '#5C6370',
  textTertiary: '#9CA3AF',
  success: '#5FBF73',
  warning: '#F5A962',
  error: '#E25555',
  border: '#E5E7EB',
  gradientStart: '#4A90E2',
  gradientEnd: '#7C6FBF',
  aiPurple: '#7C6FBF',
  aiPurpleLight: '#E8E5F5',
  priorityHigh: '#E25555',
  priorityMedium: '#F5A962',
  priorityLow: '#5FBF73',
  errorLight: '#FEF2F2',
  successLight: '#D1FAE5',
  warningLight: '#FEF3C7',
  primaryLight: '#EBF4FF',
  chipBg: '#F3F4F6',
  inputBg: '#F8F9FB',
};

const DARK_COLORS = {
  primary: '#6FA8EA',
  secondary: '#9B8DD4',
  secondaryLight: '#2A2540',
  background: '#1A1D23',
  surface: '#25282E',
  textPrimary: '#E1E4E8',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  success: '#6FCF8D',
  warning: '#FFB974',
  error: '#FF6B6B',
  border: '#3F4349',
  gradientStart: '#6FA8EA',
  gradientEnd: '#9B8DD4',
  aiPurple: '#9B8DD4',
  aiPurpleLight: '#2A2540',
  priorityHigh: '#FF6B6B',
  priorityMedium: '#FFB974',
  priorityLow: '#6FCF8D',
  errorLight: '#3D2020',
  successLight: '#1A3328',
  warningLight: '#3D3118',
  primaryLight: '#1A2840',
  chipBg: '#2F3238',
  inputBg: '#2A2D33',
};

export type AppColors = typeof LIGHT_COLORS;

export function useAppColors(): AppColors {
  const { isDark } = useThemeMode();
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}

export function getColors(isDark: boolean): AppColors {
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}
