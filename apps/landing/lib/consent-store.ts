"use client";

import { create } from "zustand";

export type ConsentStatus = "undecided" | "accepted" | "rejected";

interface ConsentState {
  status: ConsentStatus;
  accept: () => void;
  reject: () => void;
}

const KEY = "pgh-cookie-consent";

function readStored(): ConsentStatus {
  if (typeof window === "undefined") return "undecided";
  try {
    const v = localStorage.getItem(KEY);
    if (v === "accepted" || v === "rejected") return v;
  } catch {}
  return "undecided";
}

export const useConsentStore = create<ConsentState>((set) => ({
  status: readStored(),
  accept: () => {
    try {
      localStorage.setItem(KEY, "accepted");
    } catch {}
    set({ status: "accepted" });
  },
  reject: () => {
    try {
      localStorage.setItem(KEY, "rejected");
    } catch {}
    set({ status: "rejected" });
  },
}));
