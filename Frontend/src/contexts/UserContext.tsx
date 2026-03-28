// ─────────────────────────────────────────────────────────────────────────────
// UserContext.tsx — Multi-user profile management for StudyBuddy
//
// Architecture:
//   • Provides currentUser, allUsers, switchUser, profileNames, and
//     setProfileName to the entire app.
//   • Active profile is persisted to sessionStorage (sb_active_user) so it
//     survives page reloads without a backend round-trip.
//   • On switchUser, the IndexedDB API cache is wiped to prevent data from
//     one profile bleeding into another's UI.
//   • profileNames: Record<string, string> holds the live display_name fetched
//     from Cosmos for all 5 users on startup. Falls back to the static
//     displayName from users.ts when the DB has no custom name set.
//   • setProfileName(id, name) lets SettingsPage update the map instantly
//     after a successful save — no second fetch needed.
//   • The context shape is deliberately forward-compatible with real auth:
//     - currentUser      → populate from JWT payload when auth is added
//     - switchUser(id)   → becomes a login() call
//     - allUsers         → becomes a roles/members endpoint
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { USER_PROFILES, DEFAULT_USER, type UserProfile } from "@/config/users";
import { clearAPICache } from "@/lib/offlineStore";
import { API_BASE } from "@/config/api";

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
  /**
   * Live display names fetched from Cosmos at startup.
   * Key = user_id (e.g. "student-003"), value = custom name or "" if unset.
   * Always prefer getDisplayName(id) over reading this directly.
   */
  profileNames: Record<string, string>;
  /**
   * Update a single user's live display name in the context map.
   * Called by SettingsPage immediately after a successful PUT /settings save
   * so the header and dashboard update without a second fetch.
   */
  setProfileName: (userId: string, name: string) => void;
  /**
   * Convenience helper — returns the best available name for a user:
   * custom DB name if set, otherwise the static displayName from users.ts.
   */
  getDisplayName: (userId: string) => string;
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
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  // ── Fetch all 5 display names from Cosmos on startup ─────────────────────
  // Fires 5 tiny parallel reads. Non-blocking — UI renders with static names
  // first, then swaps in DB names (~50-80ms) when they arrive.
  useEffect(() => {
    const fetchAllNames = async () => {
      try {
        const results = await Promise.all(
          USER_PROFILES.map((u) =>
            fetch(`${API_BASE}/settings/?user_id=${u.id}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((data) => ({
                id: u.id,
                name: (data?.profile?.display_name as string) || "",
              }))
              .catch(() => ({ id: u.id, name: "" }))
          )
        );
        const map: Record<string, string> = {};
        results.forEach(({ id, name }) => {
          map[id] = name;
        });
        setProfileNames(map);
      } catch {
        // Network failure — silent, static names remain as fallback
      }
    };
    fetchAllNames();
  }, []); // Runs once on app mount

  // ── setProfileName — instant context update after Settings save ───────────
  const setProfileName = useCallback((userId: string, name: string) => {
    setProfileNames((prev) => ({ ...prev, [userId]: name }));
  }, []);

  // ── getDisplayName — convenience helper ───────────────────────────────────
  const getDisplayName = useCallback(
    (userId: string): string => {
      const custom = profileNames[userId];
      if (custom) return custom;
      return USER_PROFILES.find((u) => u.id === userId)?.displayName ?? "";
    },
    [profileNames]
  );

  // ── switchUser ────────────────────────────────────────────────────────────
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
    [currentUser.id]
  );

  const value = useMemo<UserContextValue>(
    () => ({
      currentUser,
      allUsers: USER_PROFILES,
      switchUser,
      profileNames,
      setProfileName,
      getDisplayName,
    }),
    [currentUser, switchUser, profileNames, setProfileName, getDisplayName]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within a UserProvider");
  return ctx;
}