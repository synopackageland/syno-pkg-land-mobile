import shell from './variants/land/config.json';
// Side-by-side development build that loads JS from Metro; release output is unchanged
const dev = process.env.MOBILE_DEV_VARIANT === '1';
export default {
  expo: {
    name: dev ? `${shell.name} Dev` : shell.name, slug: 'package-land', version: shell.version, scheme: shell.scheme,
    orientation: 'default', userInterfaceStyle: 'light',
    // Package Land brand artwork (website icon set); the cream matches the logo's circle
    icon: './assets/brand/icon.png',
    ios: { icon: './assets/brand/icon.png' },
    android: {
      package: dev ? `${shell.appId}.dev` : shell.appId, versionCode: shell.versionCode,
      adaptiveIcon: { foregroundImage: './assets/brand/adaptive-icon.png', backgroundColor: '#FDF8EB' },
      permissions: ['android.permission.CAMERA'],
      blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'],
      softwareKeyboardLayoutMode: 'resize', predictiveBackGestureEnabled: false,
      intentFilters: [
        { action: 'VIEW', category: ['DEFAULT', 'BROWSABLE'], data: [{ scheme: 'synopkgland', host: 'add-nas' }] },
        { action: 'SEND', category: ['DEFAULT'], data: [{ mimeType: 'text/*' }, { mimeType: 'application/*' }] },
        { action: 'SEND_MULTIPLE', category: ['DEFAULT'], data: [{ mimeType: 'text/*' }, { mimeType: 'application/*' }] },
        { action: 'VIEW', category: ['DEFAULT', 'BROWSABLE'], data: shell.intakeSchemes.map(scheme => ({ scheme })) },
      ],
    },
    // Browser build (`npm run build:web`), served under the hosting package's path
    web: { bundler: 'metro', output: 'single', name: shell.name, shortName: shell.name, backgroundColor: '#FFFFFF', themeColor: '#FFFFFF' },
    ...(process.env.WEB_BASE_URL ? { experiments: { baseUrl: process.env.WEB_BASE_URL } } : {}),
    plugins: [['expo-camera', { cameraPermission: 'Scan a NAS QR code', recordAudioAndroid: false, barcodeScannerEnabled: true }], 'expo-sharing', ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/brand/splash-icon.png', imageWidth: 160 }], ['expo-build-properties', { android: { usesCleartextTraffic: true, minSdkVersion: 29 } }]],
  },
};
