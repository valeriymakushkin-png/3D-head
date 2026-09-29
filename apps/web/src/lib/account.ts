"use client";

import { apiFetch } from "@/lib/api/fetch";
import { create } from "zustand";

export type Plan = "free" | "pro" | "barber" | "clinic";

export interface Account {
  user: { id: string; name: string | null; telegramId: number | null; email: string | null; anonymous: boolean } | null;
  plan: Plan;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  remainingTransformations: number | null;
  backend: boolean;
}

interface AccountState {
  account: Account;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const EMPTY: Account = { user: null, plan: "free", status: "none", remainingTransformations: 3, backend: false };

export const useAccount = create<AccountState>((set) => ({
  account: EMPTY,
  loaded: false,
  refresh: async () => {
    try {
      const res = await apiFetch("/api/me", { cache: "no-store" });
      if (res.ok) set({ account: (await res.json()) as Account, loaded: true });
      else set({ loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

export const isPaid = (p: Plan) => p !== "free";
