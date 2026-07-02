/**
 * PraxisDock store — global toggle for the Praxis chat drawer (§6.29).
 *
 * Opened from the FloatingLauncher on any screen. The active conversation
 * persists across opens so the CEO picks back up mid-thread; "new chat"
 * simply clears it and the drawer creates one lazily on first send.
 */

import { create } from "zustand";

interface PraxisDockState {
  open: boolean;
  conversationId: string | null;
  openDock: (conversationId?: string | null) => void;
  closeDock: () => void;
  setConversation: (conversationId: string | null) => void;
}

export const usePraxisDockStore = create<PraxisDockState>()((set) => ({
  open: false,
  conversationId: null,
  openDock: (conversationId) =>
    set((s) => ({
      open: true,
      conversationId:
        conversationId === undefined ? s.conversationId : conversationId,
    })),
  closeDock: () => set({ open: false }),
  setConversation: (conversationId) => set({ conversationId }),
}));
