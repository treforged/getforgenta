import { registerPlugin } from '@capacitor/core';

export interface AuthSessionPlugin {
  start(options: { url: string; callbackURLScheme: string }): Promise<{ url: string }>;
}

export const AuthSession = registerPlugin<AuthSessionPlugin>('AuthSession');
