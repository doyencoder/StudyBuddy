import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API_BASE } from "@/config/api";
import { cacheAPIResponse, getCachedAPI } from "@/lib/offlineStore";
import {
  clearLegacyCoinState,
  createDefaultCoinState,
  getLegacyCoinState,
  hasMeaningfulCoinState,
  type CoinState,
} from "@/lib/coinStore";
import { useUser } from "@/contexts/UserContext";

interface DailyLoginReward {
  coins_earned: number;
  new_streak: number;
  streak_bonus: number;
  streak_milestone: string | null;
}

interface ReferralApplyResult {
  applied: boolean;
  reason: "self_referral" | "already_referred" | null;
}

interface CoinContextValue {
  coinState: CoinState;
  initialized: boolean;
  refresh: () => Promise<CoinState>;
  claimDailyLogin: () => Promise<DailyLoginReward | null>;
  completeMission: (missionId: string) => Promise<number>;
  applyReferralCode: (code: string) => Promise<ReferralApplyResult>;
}

const CoinContext = createContext<CoinContextValue | null>(null);

function getCoinCacheKey(userId: string): string {
  return `/coins?user_id=${encodeURIComponent(userId)}`;
}

async function readCachedCoinState(userId: string): Promise<CoinState | null> {
  const cached = await getCachedAPI<CoinState>(getCoinCacheKey(userId));
  return cached?.data ?? null;
}

export function CoinProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useUser();
  const userId = currentUser.id;

  const [coinState, setCoinState] = useState<CoinState>(() => getLegacyCoinState() ?? createDefaultCoinState());
  const [initialized, setInitialized] = useState(false);
  const bootstrapPromiseRef = useRef<Promise<CoinState> | null>(null);
  const backendReadyRef = useRef(false);

  // ── Reset when the active user changes ──────────────────────────────────────
  // Using a ref to track the previous userId lets us reset state without
  // triggering an infinite loop.
  const prevUserIdRef = useRef(userId);
  if (prevUserIdRef.current !== userId) {
    prevUserIdRef.current = userId;
    // Reset synchronously (inside render) so the new user never briefly
    // sees the previous user's coin balance.
    bootstrapPromiseRef.current = null;
    backendReadyRef.current = false;
    // We can't call setCoinState during render without warnings, so we
    // defer it to the useEffect below via the userId dependency.
  }

  const persistCoinState = useCallback(async (next: CoinState, fromBackend = true) => {
    setCoinState(next);
    if (fromBackend) {
      backendReadyRef.current = true;
      clearLegacyCoinState();
      await cacheAPIResponse(getCoinCacheKey(userId), next).catch(() => {});
    }
  }, [userId]);

  const bootstrap = useCallback(async (force = false): Promise<CoinState> => {
    if (bootstrapPromiseRef.current && !force) return bootstrapPromiseRef.current;

    const run = async () => {
      const legacyState = getLegacyCoinState();
      try {
        const response = hasMeaningfulCoinState(legacyState)
          ? await fetch(`${API_BASE}/coins/bootstrap`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: userId,
                legacy_state: legacyState,
              }),
            })
          : await fetch(`${API_BASE}/coins?user_id=${encodeURIComponent(userId)}`);
        if (!response.ok) {
          throw new Error(`Coin bootstrap failed with HTTP ${response.status}`);
        }
        const data = (await response.json()) as CoinState;
        await persistCoinState(data, true);
        return data;
      } catch (error) {
        const cached = await readCachedCoinState(userId);
        if (cached) {
          setCoinState(cached);
          return cached;
        }
        if (legacyState) {
          setCoinState(legacyState);
          return legacyState;
        }
        throw error;
      } finally {
        setInitialized(true);
      }
    };

    bootstrapPromiseRef.current = run().finally(() => {
      bootstrapPromiseRef.current = null;
    });

    return bootstrapPromiseRef.current;
  }, [userId, persistCoinState]);

  // Re-bootstrap whenever the active user changes
  useEffect(() => {
    setCoinState(createDefaultCoinState());
    setInitialized(false);
    backendReadyRef.current = false;
    bootstrapPromiseRef.current = null;
    bootstrap().catch(() => {
      setInitialized(true);
    });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleOnline = () => {
      bootstrap(true).catch(() => {});
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [bootstrap]);

  const ensureBackendReady = useCallback(async () => {
    if (backendReadyRef.current) return;
    await bootstrap(true);
  }, [bootstrap]);

  const refresh = useCallback(async (): Promise<CoinState> => {
    if (!backendReadyRef.current) {
      await ensureBackendReady();
      if (!backendReadyRef.current) return coinState;
    }

    const response = await fetch(`${API_BASE}/coins?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      const cached = await readCachedCoinState(userId);
      if (cached) {
        setCoinState(cached);
        return cached;
      }
      throw new Error(`Failed to refresh coins: HTTP ${response.status}`);
    }

    const data = (await response.json()) as CoinState;
    await persistCoinState(data, true);
    return data;
  }, [userId, coinState, ensureBackendReady, persistCoinState]);

  const claimDailyLogin = useCallback(async (): Promise<DailyLoginReward | null> => {
    await ensureBackendReady();

    const response = await fetch(`${API_BASE}/coins/daily-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!response.ok) {
      throw new Error(`Failed to claim daily login: HTTP ${response.status}`);
    }

    const data = await response.json() as { coin_state: CoinState; reward: DailyLoginReward | null };
    await persistCoinState(data.coin_state, true);
    return data.reward;
  }, [userId, ensureBackendReady, persistCoinState]);

  const completeMission = useCallback(async (missionId: string): Promise<number> => {
    try {
      await ensureBackendReady();

      const response = await fetch(`${API_BASE}/coins/missions/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, mission_id: missionId }),
      });
      if (!response.ok) return 0;

      const data = await response.json() as { coin_state: CoinState; earned_amount: number };
      await persistCoinState(data.coin_state, true);
      return data.earned_amount ?? 0;
    } catch {
      return 0;
    }
  }, [userId, ensureBackendReady, persistCoinState]);

  const applyReferralCode = useCallback(async (code: string): Promise<ReferralApplyResult> => {
    await ensureBackendReady();

    const response = await fetch(`${API_BASE}/coins/referral/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, code }),
    });
    if (!response.ok) {
      throw new Error(`Failed to apply referral code: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      coin_state: CoinState;
      applied: boolean;
      reason: ReferralApplyResult["reason"];
    };
    await persistCoinState(data.coin_state, true);
    return {
      applied: data.applied,
      reason: data.reason ?? null,
    };
  }, [userId, ensureBackendReady, persistCoinState]);

  const value = useMemo<CoinContextValue>(() => ({
    coinState,
    initialized,
    refresh,
    claimDailyLogin,
    completeMission,
    applyReferralCode,
  }), [coinState, initialized, refresh, claimDailyLogin, completeMission, applyReferralCode]);

  return <CoinContext.Provider value={value}>{children}</CoinContext.Provider>;
}

export function useCoins(): CoinContextValue {
  const context = useContext(CoinContext);
  if (!context) {
    throw new Error("useCoins must be used within a CoinProvider");
  }
  return context;
}