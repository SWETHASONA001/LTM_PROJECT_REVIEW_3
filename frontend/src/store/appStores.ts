import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LayoutTurbine } from '../physics/constraints';
import type { SiteId } from './siteStore';

/* ----------------------------------------------------------------- UI ---- */

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  tone: 'info' | 'success' | 'warning';
  createdAt: string;
  read: boolean;
  href?: string;
}

interface UiStore {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  searchOpen: boolean;
  copilotOpen: boolean;
  /** Question to prefill when the copilot opens (e.g. from a turbine panel). */
  copilotDraft: string;
  notifications: AppNotification[];
  toggleSidebar: () => void;
  setMobileNav: (v: boolean) => void;
  setSearch: (v: boolean) => void;
  setCopilot: (v: boolean) => void;
  openCopilot: (draft?: string) => void;
  clearDraft: () => void;
  notify: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      searchOpen: false,
      copilotOpen: false,
      copilotDraft: '',
      notifications: [],
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (v) => set({ mobileNavOpen: v }),
      setSearch: (v) => set({ searchOpen: v }),
      setCopilot: (v) => set({ copilotOpen: v }),
      openCopilot: (draft) => set({ copilotOpen: true, copilotDraft: draft ?? '' }),
      clearDraft: () => set({ copilotDraft: '' }),
      notify: (n) =>
        set((s) => ({
          notifications: [
            { ...n, id: Math.random().toString(36).slice(2), createdAt: new Date().toISOString(), read: false },
            ...s.notifications,
          ].slice(0, 40),
        })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      clearNotifications: () => set({ notifications: [] }),
    }),
    {
      name: 'aerohydro.ui.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, notifications: s.notifications }),
    },
  ),
);

/* ------------------------------------------------------------ Scenarios ---- */

export interface ScenarioMetrics {
  nTurbines: number;
  farmKw: number;
  wakeLossInstant: number;
  aepMWh: number;
  aepNoWakeMWh: number;
  wakeLossAnnual: number;
  violations: number;
  minSpacingM: number;
}

export interface Scenario {
  id: string;
  name: string;
  site: SiteId;
  createdAt: string;
  origin: 'manual' | 'baseline' | 'optimized' | 'duplicate';
  turbines: LayoutTurbine[];
  conditions: { windDir: number; windSpeed: number; ti: number; minSpacingD: number };
  resourceLabel: string;
  wakeModel: string;
  metrics: ScenarioMetrics;
  note?: string;
}

interface ScenarioStore {
  scenarios: Scenario[];
  add: (s: Omit<Scenario, 'id' | 'createdAt'>) => string;
  duplicate: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useScenarioStore = create<ScenarioStore>()(
  persist(
    (set, get) => ({
      scenarios: [],
      add: (s) => {
        const id = `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        set((st) => ({ scenarios: [{ ...s, id, createdAt: new Date().toISOString() }, ...st.scenarios].slice(0, 60) }));
        return id;
      },
      duplicate: (id) => {
        const s = get().scenarios.find((x) => x.id === id);
        if (s) get().add({ ...s, name: `${s.name} (copy)`, origin: 'duplicate' });
      },
      rename: (id, name) => set((st) => ({ scenarios: st.scenarios.map((s) => (s.id === id ? { ...s, name } : s)) })),
      remove: (id) => set((st) => ({ scenarios: st.scenarios.filter((s) => s.id !== id) })),
      clear: () => set({ scenarios: [] }),
    }),
    { name: 'aerohydro.scenarios.v1', storage: createJSONStorage(() => localStorage) },
  ),
);

/* -------------------------------------------------------------- Copilot ---- */

export interface CopilotReference {
  label: string;
  kind: string;
  detail?: string;
  href?: string;
}

export interface OperatorInstruction {
  turbine: string;
  change: string;
  reason: string;
  expectedEffect: string;
  constraints: string[];
  confidence: string;
  source: string;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  facts?: string[];
  assumptions?: string[];
  recommendations?: string[];
  references?: CopilotReference[];
  tools?: { name: string; summary: string }[];
  instruction?: OperatorInstruction;
  mode?: 'local-tools' | 'backend-llm';
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messages: CopilotMessage[];
  context: { turbine?: string; site?: SiteId };
}

interface CopilotStore {
  conversations: Conversation[];
  activeId: string | null;
  newConversation: () => string;
  select: (id: string) => void;
  append: (convId: string, m: Omit<CopilotMessage, 'id' | 'createdAt'>) => void;
  setContext: (convId: string, ctx: Conversation['context']) => void;
  remove: (id: string) => void;
}

export const useCopilotStore = create<CopilotStore>()(
  persist(
    (set) => ({
      conversations: [],
      activeId: null,
      newConversation: () => {
        const id = `cv-${Date.now().toString(36)}`;
        set((s) => ({
          conversations: [{ id, title: 'New conversation', createdAt: new Date().toISOString(), messages: [], context: {} }, ...s.conversations].slice(0, 30),
          activeId: id,
        }));
        return id;
      },
      select: (id) => set({ activeId: id }),
      append: (convId, m) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  title: c.messages.length === 0 && m.role === 'user' ? m.content.slice(0, 60) : c.title,
                  messages: [...c.messages, { ...m, id: Math.random().toString(36).slice(2), createdAt: new Date().toISOString() }],
                }
              : c,
          ),
        })),
      setContext: (convId, ctx) =>
        set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, context: { ...c.context, ...ctx } } : c)) })),
      remove: (id) =>
        set((s) => {
          const conversations = s.conversations.filter((c) => c.id !== id);
          return { conversations, activeId: s.activeId === id ? (conversations[0]?.id ?? null) : s.activeId };
        }),
    }),
    { name: 'aerohydro.copilot.v1', storage: createJSONStorage(() => localStorage) },
  ),
);

export function ensureConversation(): string {
  const st = useCopilotStore.getState();
  if (st.activeId && st.conversations.some((c) => c.id === st.activeId)) return st.activeId;
  return st.newConversation();
}
