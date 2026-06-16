/**
 * ChatDock store — global toggle for the floating chat drawer.
 *
 * Opened from the FloatingLauncher (canon §3.4). The selected channel
 * persists across opens so picking back up where you left off is
 * one tap.
 */

import { create } from "zustand";

interface ChatDockState {
  open: boolean;
  selectedChannelId: string | null;
  openDock: (channelId?: string | null) => void;
  closeDock: () => void;
  setChannel: (channelId: string | null) => void;
}

export const useChatDockStore = create<ChatDockState>()((set) => ({
  open: false,
  selectedChannelId: null,
  openDock: (channelId) =>
    set((s) => ({
      open: true,
      selectedChannelId: channelId ?? s.selectedChannelId,
    })),
  closeDock: () => set({ open: false }),
  setChannel: (channelId) => set({ selectedChannelId: channelId }),
}));
