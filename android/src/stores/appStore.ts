import { create } from 'zustand';
import type { SyncStatus } from '../services/types';

export type Theme = 'default' | 'cyberpunk' | 'classical' | 'alp';
export type BaseMapType = 'street' | 'satellite' | 'terrain' | 'dark';

interface AppState {
  authenticated: boolean;
  athleteName: string;
  athleteId: number;
  deepseekApiKey: string;
  syncState: SyncStatus;
  theme: Theme;
  baseMap: BaseMapType;
  setAuthenticated: (v: boolean, name?: string, athleteId?: number) => void;
  setDeepseekApiKey: (key: string) => void;
  setSyncState: (s: SyncStatus) => void;
  setTheme: (t: Theme) => void;
  setBaseMap: (bm: BaseMapType) => void;
}

export const useAppStore = create<AppState>(set => ({
  authenticated: false,
  athleteName: '',
  athleteId: 0,
  deepseekApiKey: '',
  syncState: { running: false, total: 0, done: 0, errors: 0, last_error: '' },
  theme: 'default',
  baseMap: 'street',
  setAuthenticated: (v, name, athleteId) =>
    set({ authenticated: v, athleteName: name ?? '', athleteId: athleteId ?? 0 }),
  setDeepseekApiKey: key => set({ deepseekApiKey: key }),
  setSyncState: s => set({ syncState: s }),
  setTheme: t => set({ theme: t }),
  setBaseMap: bm => set({ baseMap: bm }),
}));
