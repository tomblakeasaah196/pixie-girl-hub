/**
 * Notification UI state — Do Not Disturb schedule + bell panel open/close.
 * DND silences sounds and toasts during specified hours (device-local).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DndSchedule {
  enabled: boolean;
  startHour: number; // 0-23
  endHour: number; // 0-23
}

interface NotifUiState {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;

  dnd: DndSchedule;
  setDnd: (dnd: Partial<DndSchedule>) => void;

  /** Returns true if DND is active RIGHT NOW. */
  isDndActive: () => boolean;
}

export const useNotifStore = create<NotifUiState>()(
  persist(
    (set, get) => ({
      panelOpen: false,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

      dnd: { enabled: false, startHour: 18, endHour: 8 },
      setDnd: (patch) => set((s) => ({ dnd: { ...s.dnd, ...patch } })),

      isDndActive: () => {
        const { dnd } = get();
        if (!dnd.enabled) return false;
        const h = new Date().getHours();
        if (dnd.startHour < dnd.endHour) {
          return h >= dnd.startHour && h < dnd.endHour;
        }
        // Overnight schedule e.g. 22:00 → 08:00
        return h >= dnd.startHour || h < dnd.endHour;
      },
    }),
    { name: "pgh-notif-ui", partialize: (s) => ({ dnd: s.dnd }) },
  ),
);
