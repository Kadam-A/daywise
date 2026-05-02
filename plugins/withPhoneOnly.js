const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Restricts app distribution to phones only.
 * Uses two approaches:
 * 1. supports-screens — legacy screen size hint
 * 2. uses-feature telephony — reliable Play Store filter: phones have it, most tablets don't
 */
module.exports = function withPhoneOnly(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Approach 1: screen size declarations
    manifest['supports-screens'] = [
      {
        $: {
          'android:smallScreens': 'true',
          'android:normalScreens': 'true',
          'android:largeScreens': 'false',
          'android:xlargeScreens': 'false',
        },
      },
    ];

    // Approach 2: require telephony — phones have it, most tablets don't
    if (!manifest['uses-feature']) {
      manifest['uses-feature'] = [];
    }
    const hasTelepony = manifest['uses-feature'].some(
      (f) => f.$?.['android:name'] === 'android.hardware.telephony'
    );
    if (!hasTelepony) {
      manifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.telephony',
          'android:required': 'true',
        },
      });
    }

    return config;
  });
};
