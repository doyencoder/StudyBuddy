// ─────────────────────────────────────────────────────────────────────────────
// users.ts — Static profile definitions for StudyBuddy multi-user system
//
// Design notes:
//   • IDs are intentionally kept as student-001…005 so all existing Cosmos data
//     (which lives under student-001) automatically belongs to Aarav with zero
//     migration required.
//   • avatarBg / avatarText are raw Tailwind colour classes; they are safe to
//     use with arbitrary-value syntax inside className strings.
//   • This file is the SINGLE source of truth for user identities. Never
//     hardcode a user ID anywhere else — always import from here via useUser().
// ─────────────────────────────────────────────────────────────────────────────

export interface UserProfile {
  /** Cosmos DB user_id — maps 1-to-1 to all backend user_id fields */
  id: string;
  displayName: string;
  initials: string;
  /** Tailwind bg colour class for the avatar circle */
  avatarBg: string;
  /** Tailwind text colour class for the avatar initials */
  avatarText: string;
  /** Complementary ring colour for the active-user indicator */
  ringColor: string;
  /** Hex used for inline styles where Tailwind classes can't be computed */
  hex: string;
  /** Subtitle shown below name in the switcher */
  subtitle: string;
}

export const USER_PROFILES: readonly UserProfile[] = [
  {
    id: "student-001",
    displayName: "Aarav",
    initials: "AA",
    avatarBg: "bg-violet-500",
    avatarText: "text-white",
    ringColor: "ring-violet-500",
    hex: "#8b5cf6",
    subtitle: "Class XII · CBSE",
  },
  {
    id: "student-002",
    displayName: "Priya",
    initials: "PR",
    avatarBg: "bg-rose-500",
    avatarText: "text-white",
    ringColor: "ring-rose-500",
    hex: "#f43f5e",
    subtitle: "Class XI · ICSE",
  },
  {
    id: "student-003",
    displayName: "Rohan",
    initials: "RO",
    avatarBg: "bg-amber-500",
    avatarText: "text-white",
    ringColor: "ring-amber-500",
    hex: "#f59e0b",
    subtitle: "Class X · CBSE",
  },
  {
    id: "student-004",
    displayName: "Ananya",
    initials: "AN",
    avatarBg: "bg-emerald-500",
    avatarText: "text-white",
    ringColor: "ring-emerald-500",
    hex: "#10b981",
    subtitle: "Class XII · ICSE",
  },
  {
    id: "student-005",
    displayName: "Kiran",
    initials: "KI",
    avatarBg: "bg-sky-500",
    avatarText: "text-white",
    ringColor: "ring-sky-500",
    hex: "#0ea5e9",
    subtitle: "Class IX · CBSE",
  },
] as const;

/** student-001 / Aarav is the default — all pre-existing Cosmos data lives here */
export const DEFAULT_USER_ID = "student-001";
export const DEFAULT_USER = USER_PROFILES[0];