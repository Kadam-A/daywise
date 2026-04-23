export default {
  expo: {
    name: 'DayWise',
    slug: 'daywise',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'daywise',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/images/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#6D529E',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.adam.daywise',
      infoPlist: {
        NSCalendarsUsageDescription:
          'This app needs access to your calendar to schedule and manage your tasks intelligently.',
        NSRemindersUsageDescription:
          'This app needs access to reminders to help you stay on track with your tasks.',
      },
    },
    android: {
      package: 'com.adam.daywise',
      adaptiveIcon: {
        foregroundImage: './ic_launcher_foreground.png',
        backgroundColor: '#6D529E',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      permissions: [
        'READ_CALENDAR',
        'WRITE_CALENDAR',
        'RECEIVE_BOOT_COMPLETED',
        'VIBRATE',
        'INTERNET',
        'ACCESS_NETWORK_STATE',
        'com.google.android.gms.permission.AD_ID',
      ],
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      [
        '@sentry/react-native/expo',
        {
          url: 'https://sentry.io/',
          project: 'react-native',
          organization: 'wisecraft',
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#6D529E',
          dark: {
            backgroundColor: '#6D529E',
          },
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#2563eb',
          sounds: [],
        },
      ],
      '@react-native-community/datetimepicker',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {
        origin: false,
      },
      eas: {
        projectId: 'd326d99b-162a-4748-b97c-dacfe94ee82e',
      },
      // PostHog analytics configuration
      // Values are read from EXPO_PUBLIC_POSTHOG_API_KEY / EXPO_PUBLIC_POSTHOG_HOST at build time
      posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
      posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    },
  },
}
