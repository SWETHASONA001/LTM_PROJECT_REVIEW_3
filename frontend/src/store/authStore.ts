import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface SessionUser {
  name: string;
  email: string;
  role: string;
}

export interface Session {
  user: SessionUser;
  /** 'backend' = verified by the API (signed token); 'local' = unauthenticated local workspace. */
  mode: 'backend' | 'local';
  token?: string;
  expiresAt?: number; // epoch seconds
  signedInAt: string;
}

interface AuthStore {
  session: Session | null;
  signIn: (s: Session) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      session: null,
      signIn: (session) => set({ session }),
      signOut: () => set({ session: null }),
    }),
    { name: 'aerohydro.auth.v1', storage: createJSONStorage(() => localStorage) },
  ),
);

export function sessionValid(s: Session | null): boolean {
  if (!s) return false;
  if (s.mode === 'backend') return !!s.token && !!s.expiresAt && s.expiresAt * 1000 > Date.now();
  return true;
}
