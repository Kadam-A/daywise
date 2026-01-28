/**
 * TailoredTime - Theme Configuration
 *
 * Configures React Native Paper's Material Design 3 theme
 * with TailoredTime brand colors.
 *
 * Paper automatically generates color variants (light, dark, container, etc.)
 * from the primary, secondary, and tertiary colors you provide.
 */

import { MD3LightTheme, MD3DarkTheme } from "react-native-paper";

/**
 * Light theme configuration
 * Uses Material Design 3 with TailoredTime brand colors
 */
export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#2563eb", // TailoredTime blue
    secondary: "#8b5cf6", // TailoredTime purple
    tertiary: "#06b6d4", // TailoredTime cyan
    // Paper auto-generates:
    // - primaryContainer, onPrimary, onPrimaryContainer
    // - secondaryContainer, onSecondary, onSecondaryContainer
    // - tertiaryContainer, onTertiary, onTertiaryContainer
    // - error, background, surface, outline, etc.
  },
};

/**
 * Dark theme configuration
 * Will be used when user enables dark mode
 */
export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#3b82f6", // Slightly lighter blue for dark mode
    secondary: "#a78bfa", // Slightly lighter purple for dark mode
    tertiary: "#22d3ee", // Slightly lighter cyan for dark mode
  },
};

/**
 * Custom colors for app-specific use cases
 * Use these when Paper's built-in colors don't fit
 */
export const customColors = {
  // Task priority badge colors
  priorityLow: "#10b981", // Green
  priorityMedium: "#f59e0b", // Amber
  priorityHigh: "#ef4444", // Red

  // Task status colors
  statusPending: "#94a3b8", // Slate-400
  statusScheduled: "#3b82f6", // Blue-500
  statusCompleted: "#10b981", // Green-500
  statusOverdue: "#ef4444", // Red-500
  statusCancelled: "#64748b", // Slate-500
};

/**
 * Typography scale (optional - Paper has defaults)
 * Only add if you need custom font sizes
 */
export const typography = {
  // You can customize these later if needed
  // For now, Paper's defaults are good
};

/**
 * Spacing scale (consistent spacing throughout app)
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

/**
 * Border radius values
 */
export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};
