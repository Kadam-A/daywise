import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';

const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4A90E2', // Serene Blue
    secondary: '#7C6FBF', // Soft Purple
    tertiary: '#62C4D8', // Cyan
    error: '#E25555', // Soft Red
    background: '#F8F9FB', // Off-white
    surface: '#FFFFFF', // White cards
    surfaceVariant: '#F1F3F5', // Subtle cards
    onPrimary: '#FFFFFF', // Text on primary
    onSecondary: '#FFFFFF', // Text on secondary
    onBackground: '#2C3E50', // Text on background
    onSurface: '#2C3E50', // Text on surface
    outline: '#E1E4E8', // Borders
    // Custom colors
    success: '#5FBF73',
    warning: '#F5A962',
    info: '#62C4D8',
    // Task status
    scheduled: '#4A90E2',
    completed: '#5FBF73',
    overdue: '#E25555',
    pending: '#9CA3AF',
  },
};

const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#6FA8EA', // Lighter blue for dark mode
    secondary: '#9B8DD4', // Lighter purple
    tertiary: '#7DD3DE', // Lighter cyan
    error: '#FF6B6B', // Brighter red for dark
    background: '#1A1D23', // Dark background
    surface: '#25282E', // Dark cards
    surfaceVariant: '#2F3239', // Subtle dark cards
    onPrimary: '#1A1D23', // Dark text on primary
    onSecondary: '#1A1D23', // Dark text on secondary
    onBackground: '#E1E4E8', // Light text on dark bg
    onSurface: '#E1E4E8', // Light text on dark surface
    outline: '#3F4349', // Dark borders
    // Custom colors (adjusted for dark mode)
    success: '#6FCF8D',
    warning: '#FFB974',
    info: '#7DD3DE',
    // Task status (adjusted for dark mode)
    scheduled: '#6FA8EA',
    completed: '#6FCF8D',
    overdue: '#FF6B6B',
    pending: '#6B7280',
  },
};

export { lightTheme, darkTheme };
