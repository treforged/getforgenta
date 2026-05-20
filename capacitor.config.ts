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
  ios: {
    backgroundColor: '#09090b', // zinc-950 — prevents black WKWebView flash on reload
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;