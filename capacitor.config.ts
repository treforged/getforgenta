import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.treforged.forged',
  appName: 'Forgenta',
  webDir: 'dist',
  server: {
    url: 'https://getforgenta.com',
    cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;