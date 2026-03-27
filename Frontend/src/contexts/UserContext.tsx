// ─────────────────────────────────────────────────────────────────────────────
// UserContext.tsx — Multi-user profile management for StudyBuddy
//
// Architecture:
//   • Provides currentUser, allUsers, and switchUser to the entire app.
//   • Active profile is persisted to localStorage (sb_active_user) so it
//     survives page reloads without a backend round-trip.
//   • On switchUser, the IndexedDB API cache is wiped to prevent data from
//     one profile bleeding into another's UI.
//   • The context shape is deliberately forward-compatible with real auth:
//     - currentUser      → populate from JWT payload when auth is added
//     - switchUser(id)   → becomes a login() call
//     - allUsers         → becomes a roles/members endpoint
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { USER_PROFILES, DEFAULT_USER, type UserProfile } from "@/config/users";
import { clearAPICache } from "@/lib/offlineStore";

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "sb_active_user";



// ── Context shape ─────────────────────────────────────────────────────────────

export interface UserContextValue {
  /** The currently active profile */
  currentUser: UserProfile;
  /** All 5 available profiles — useful for building the switcher UI */
  allUsers: readonly UserProfile[];
  /** Switch to a different profile by ID; no-op if already active */
  switchUser: (id: string) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────


function getInitialUser(): UserProfile {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const found = USER_PROFILES.find((u) => u.id === stored);
      if (found) return found;
    }
  } catch {
    // sessionStorage blocked in some environments
  }
  return DEFAULT_USER;
}
// ── Provider ──────────────────────────────────────────────────────────────────

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile>(getInitialUser);

  const switchUser = useCallback(
    (id: string) => {
      if (id === currentUser.id) return;

      const found = USER_PROFILES.find((u) => u.id === id);
      if (!found) return;

      // 1. Wipe the IndexedDB API cache so the new profile never sees stale
      //    data from the previous profile.
      clearAPICache().catch(() => {});

     
      // 2. Persist for this session so page refresh restores the right profile.
        try {
        sessionStorage.setItem(STORAGE_KEY, id);
        } catch {
        // Ignore in restricted environments
        }

        // 3. Update React state
        setCurrentUser(found);
    },
    [currentUser.id],
  );

  const value = useMemo<UserContextValue>(
    () => ({
      currentUser,
      allUsers: USER_PROFILES,
      switchUser,
    }),
    [currentUser, switchUser],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within a UserProvider");
  return ctx;
}