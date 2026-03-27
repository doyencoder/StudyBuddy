import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { FlashcardDeck, type FlashcardItem } from "@/components/flashcards/FlashcardDeck";
import { API_BASE } from "@/config/api";
import { offlineFetch } from "@/lib/offlineFetch";
import { addToSyncQueue, cacheAPIResponse, getAllSyncQueue } from "@/lib/offlineStore";
import { toast } from "sonner";
import { useUser } from "@/contexts/UserContext";

interface Deck {
  id: string;
  conversationId: string;
  cards: FlashcardItem[];
}

interface PendingDeck {
  requestId: number;
  conversationId: string;
  title: string;
}

interface FlashcardGenerationState {
  flashcardGeneration?: {
    conversationId: string;
    title: string;
    requestId: number;
  };
}




function buildFlashcardsCachePayload(decks: Deck[]) {
  return {
    flashcards: decks.map((deck) => ({
      deck_id: deck.id,
      conversation_id: deck.conversationId,
      cards: deck.cards,
    })),
  };
}

function PendingFlashcardDeck() {
  return (
    <div className="group relative mx-auto w-full max-w-[15rem] animate-fade-in-up">
      <div
        className="relative h-[20rem] w-full"
        style={{ isolation: "isolate" }}
      >
        <div
          className="absolute inset-0 overflow-hidden rounded-xl border border-blue-500/10 animate-pulse"
          style={{
            zIndex: 16,
            transform: "translate(28px, 18px) scale(0.9) rotate(6deg)",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.08), transparent 52%), linear-gradient(180deg, rgba(24, 36, 64, 0.9), rgba(14, 20, 36, 0.94))",
            opacity: 0.88,
            filter: "saturate(0.78) brightness(0.88)",
            boxShadow: "0 12px 22px rgba(15, 23, 42, 0.16)",
          }}
        />

        <div
          className="absolute inset-0 overflow-hidden rounded-xl border border-blue-500/10 animate-pulse"
          style={{
            zIndex: 24,
            transform: "translate(-18px, 10px) scale(0.94) rotate(-4deg)",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.08), transparent 52%), linear-gradient(180deg, rgba(24, 36, 64, 0.92), rgba(14, 20, 36, 0.96))",
            opacity: 0.92,
            filter: "saturate(0.86) brightness(0.92)",
            boxShadow: "0 18px 34px rgba(15, 23, 42, 0.2)",
          }}
        />

        <div
          className="absolute inset-0 overflow-hidden rounded-xl border border-blue-500/10 animate-pulse"
          style={{
            zIndex: 30,
            transform: "translate(14px, 12px) scale(0.96) rotate(3deg)",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.1), transparent 52%), linear-gradient(180deg, rgba(24, 36, 64, 0.95), rgba(14, 20, 36, 0.98))",
            opacity: 0.95,
            filter: "saturate(0.9) brightness(0.95)",
            boxShadow: "0 18px 38px rgba(15, 23, 42, 0.22)",
          }}
        />

        <div
          className="absolute inset-0 overflow-hidden rounded-xl border border-blue-500/20 animate-pulse"
          style={{
            zIndex: 40,
            transform: "translateY(0px) scale(1) rotate(0deg)",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 52%), linear-gradient(180deg, rgba(24, 36, 64, 0.98), rgba(14, 20, 36, 1))",
            boxShadow: "0 26px 54px rgba(15, 23, 42, 0.34)",
          }}
        >
          <div className="flex h-full flex-col p-5">
            <div className="flex items-start justify-between">
              <div className="h-3 w-28 rounded bg-white/10" />
              <div className="h-8 w-8 rounded-full border border-white/10 bg-white/5" />
            </div>

            <div className="mt-7 space-y-3 pr-2">
              <div className="h-6 w-4/5 rounded bg-white/10" />
              <div className="h-6 w-2/3 rounded bg-white/10" />
              <div className="h-4 w-full rounded bg-white/10" />
              <div className="h-4 w-5/6 rounded bg-white/10" />
              <div className="h-4 w-3/4 rounded bg-white/10" />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -right-2 -top-2 z-40 flex h-6 min-w-6 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 text-[10px] font-medium text-blue-400">
        ...
      </div>
    </div>
  );
}

const FlashcardsPage = () => {
  const { currentUser } = useUser();
  const USER_ID = currentUser.id;
  const FLASHCARDS_URL = `${API_BASE}/flashcards?user_id=${USER_ID}`;
  const FLASHCARDS_CACHE_KEY =
    new URL(FLASHCARDS_URL).pathname + new URL(FLASHCARDS_URL).search;
  const navigate = useNavigate();
  const location = useLocation();
  const initialGenerationRequestRef = useRef(
    (location.state as FlashcardGenerationState | null)?.flashcardGeneration ?? null,
  );
  const [decks, setDecks] = useState<Deck[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDecks, setPendingDecks] = useState<PendingDeck[]>([]);
  const handledRequestIdsRef = useRef(new Set<number>());

  const fetchDecks = async ({
    setPageLoading = true,
    showErrorToast = true,
  }: {
    setPageLoading?: boolean;
    showErrorToast?: boolean;
  } = {}) => {
    try {
      if (setPageLoading) {
        setIsLoading(true);
      }
      const { data } = await offlineFetch<{
        flashcards?: Array<{
          deck_id: string;
          conversation_id: string;
          cards: FlashcardItem[];
        }>;
      }>(FLASHCARDS_URL, FLASHCARDS_CACHE_KEY);
      const incoming: Deck[] = (data.flashcards || []).map((deck: {
        deck_id: string;
        conversation_id: string;
        cards: FlashcardItem[];
      }) => ({
        id: deck.deck_id,
        conversationId: deck.conversation_id,
        cards: deck.cards || [],
      }));
      setDecks(incoming);
    } catch {
      if (showErrorToast && pendingDecks.length === 0) {
        toast.error("Failed to load flashcards.");
      }
    } finally {
      if (setPageLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchDecks({ setPageLoading: true });

    const handleRefresh = () => {
      fetchDecks({ setPageLoading: false });
    };

    const handleGenerationStarted = (event: Event) => {
      const detail = (event as CustomEvent<PendingDeck>).detail;
      if (!detail?.conversationId) return;
      setPendingDecks((prev) => {
        if (prev.some((deck) => deck.conversationId === detail.conversationId)) {
          return prev;
        }
        return [detail, ...prev];
      });
    };

    const handleGenerationFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      const conversationId = detail?.conversationId;
      if (!conversationId) return;
      setPendingDecks((prev) =>
        prev.filter((deck) => deck.conversationId !== conversationId),
      );
    };

    window.addEventListener("flashcards-updated", handleRefresh);
    window.addEventListener("flashcards-generation-started", handleGenerationStarted as EventListener);
    window.addEventListener("flashcards-generation-failed", handleGenerationFailed as EventListener);
    return () => {
      window.removeEventListener("flashcards-updated", handleRefresh);
      window.removeEventListener("flashcards-generation-started", handleGenerationStarted as EventListener);
      window.removeEventListener("flashcards-generation-failed", handleGenerationFailed as EventListener);
    };
  }, []);

  useEffect(() => {
    const state = location.state as FlashcardGenerationState | null;
    const request = state?.flashcardGeneration;
    if (!request || handledRequestIdsRef.current.has(request.requestId)) {
      return;
    }

    handledRequestIdsRef.current.add(request.requestId);
    navigate(location.pathname, { replace: true, state: null });

    const generateFlashcards = async () => {
      let keepPendingDeck = false;
      try {
        if (!navigator.onLine) {
          const requestBody = JSON.stringify({
            user_id: USER_ID,
            conversation_id: request.conversationId,
            title: request.title,
          });
          const queuedItems = await getAllSyncQueue();
          const alreadyQueued = queuedItems.some((item) => {
            if (item.type !== "flashcard_generate") return false;
            try {
              const payload = JSON.parse(item.body || "{}");
              return payload.conversation_id === request.conversationId;
            } catch {
              return false;
            }
          });

          if (!alreadyQueued) {
            await addToSyncQueue({
              type: "flashcard_generate",
              url: `${API_BASE}/flashcards/generate`,
              method: "POST",
              body: requestBody,
              createdAt: new Date().toISOString(),
            });
          }

          return;
        }

        setPendingDecks((prev) => {
          if (prev.some((deck) => deck.conversationId === request.conversationId)) {
            return prev;
          }
          return [
            {
              requestId: request.requestId,
              conversationId: request.conversationId,
              title: request.title,
            },
            ...prev,
          ];
        });
        keepPendingDeck = true;

        const res = await fetch(`${API_BASE}/flashcards/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: USER_ID,
            conversation_id: request.conversationId,
          }),
        });

        if (!res.ok) {
          throw new Error();
        }

        await fetchDecks({ setPageLoading: false, showErrorToast: false });
      } catch {
        toast.error("Cannot generate flashcards for this chat.");
      } finally {
        if (keepPendingDeck) {
          setPendingDecks((prev) =>
            prev.filter((deck) => deck.conversationId !== request.conversationId),
          );
        }
      }
    };

    generateFlashcards();
  }, [location.pathname, location.state, navigate]);

  const handleDeleteDeck = async (id: string) => {
    const targetDeck = decks.find((deck) => deck.id === id);
    if (!targetDeck) return;

    const nextDecks = decks.filter((deck) => deck.id !== id);
    setDecks(nextDecks);
    cacheAPIResponse(
      FLASHCARDS_CACHE_KEY,
      buildFlashcardsCachePayload(nextDecks),
    ).catch(() => {});

    if (!navigator.onLine) {
      addToSyncQueue({
        type: "flashcard_delete",
        url: `${API_BASE}/flashcards/${targetDeck.conversationId}?user_id=${USER_ID}`,
        method: "DELETE",
        body: "",
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/flashcards/${targetDeck.conversationId}?user_id=${USER_ID}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setDecks(decks);
      cacheAPIResponse(
        FLASHCARDS_CACHE_KEY,
        buildFlashcardsCachePayload(decks),
      ).catch(() => {});
      toast.error("Failed to delete flashcards.");
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-4 md:p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Flashcards</h1>
          <p className="mt-2 text-muted-foreground">
            Review your chat topics with interactive stacked decks.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-20 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <PendingFlashcardDeck key={index} />
            ))}
          </div>
        ) : decks.length > 0 || pendingDecks.length > 0 ? (
          <div className="grid grid-cols-1 gap-20 sm:grid-cols-2 lg:grid-cols-3">
            {pendingDecks.map((deck) => (
              <PendingFlashcardDeck key={deck.requestId} />
            ))}
            {decks.map((deck) => (
              <FlashcardDeck
                key={deck.id}
                id={deck.id}
                conversationId={deck.conversationId}
                cards={deck.cards}
                onDelete={handleDeleteDeck}
                onOpenChat={(conversationId) =>
                  navigate(`/chat?conversationId=${conversationId}`)
                }
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-card/50 py-20 animate-scale-in">
            <div className="mb-4 rounded-full border border-border/50 bg-secondary/50 p-4">
              <Layers className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-foreground">
              No flashcards yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a chat to generate your first deck.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlashcardsPage;
