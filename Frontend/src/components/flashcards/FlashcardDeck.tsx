import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { FlashcardCard } from "./FlashcardCard";

export interface FlashcardItem {
  id: string;
  title: string;
  description: string;
}

interface FlashcardDeckProps {
  id: string;
  conversationId: string;
  cards: FlashcardItem[];
  onDelete?: (id: string) => void;
  onOpenChat?: (conversationId: string) => void;
}

type VisibleCardSlot = "center" | "left" | "right" | "back";

type TransitionPhase = "retreat" | "settle";

interface DeckTransition {
  prevOrder: number[];
  nextOrder: number[];
  phase: TransitionPhase;
}

function buildVisibleStack(cardOrder: number[]) {
  const total = cardOrder.length;
  if (total === 0) return [] as Array<{ cardIndex: number; slot: VisibleCardSlot }>;
  if (total === 1) {
    return [{ cardIndex: cardOrder[0], slot: "center" as const }];
  }
  if (total === 2) {
    return [
      { cardIndex: cardOrder[1], slot: "right" as const },
      { cardIndex: cardOrder[0], slot: "center" as const },
    ];
  }
  if (total === 3) {
    return [
      { cardIndex: cardOrder[2], slot: "left" as const },
      { cardIndex: cardOrder[1], slot: "right" as const },
      { cardIndex: cardOrder[0], slot: "center" as const },
    ];
  }

  return [
    { cardIndex: cardOrder[cardOrder.length - 1], slot: "left" as const },
    { cardIndex: cardOrder[2], slot: "back" as const },
    { cardIndex: cardOrder[1], slot: "right" as const },
    { cardIndex: cardOrder[0], slot: "center" as const },
  ];
}

export function FlashcardDeck({
  id,
  conversationId,
  cards,
  onDelete,
  onOpenChat,
}: FlashcardDeckProps) {
  const [cardOrder, setCardOrder] = useState(cards.map((_, index) => index));
  const [isHovered, setIsHovered] = useState(false);
  const [isCycling, setIsCycling] = useState(false);
  const [transition, setTransition] = useState<DeckTransition | null>(null);
  const cycleTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    setCardOrder(cards.map((_, index) => index));
    setIsCycling(false);
    setTransition(null);
  }, [cards]);

  useEffect(() => {
    return () => {
      cycleTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      cycleTimeoutsRef.current = [];
    };
  }, []);

  const handleCardClick = () => {
    if (cards.length <= 1 || isCycling) return;

    const prevOrder = [...cardOrder];
    const nextOrder = [...cardOrder];
    const first = nextOrder.shift();
    if (first !== undefined) nextOrder.push(first);

    setIsCycling(true);
    setTransition({ prevOrder, nextOrder, phase: "retreat" });

    const settleTimeout = window.setTimeout(() => {
      setCardOrder(nextOrder);
      setTransition({ prevOrder, nextOrder, phase: "settle" });
    }, 220);

    const finishTimeout = window.setTimeout(() => {
      setIsCycling(false);
      setTransition(null);
      cycleTimeoutsRef.current = [];
    }, 700);

    cycleTimeoutsRef.current = [settleTimeout, finishTimeout];
  };

  const currentVisibleCards = buildVisibleStack(cardOrder);
  const transitionPrevVisibleCards = transition
    ? buildVisibleStack(transition.prevOrder)
    : [];
  const transitionNextVisibleCards = transition
    ? buildVisibleStack(transition.nextOrder)
    : [];

  const visibleCards = transition
    ? Array.from(
        new Map(
          [...transitionPrevVisibleCards, ...transitionNextVisibleCards].map((item) => [
            item.cardIndex,
            item,
          ]),
        ).values(),
      )
    : currentVisibleCards;

  const currentSlotMap = new Map(
    currentVisibleCards.map((item) => [item.cardIndex, item.slot]),
  );
  const prevSlotMap = new Map(
    transitionPrevVisibleCards.map((item) => [item.cardIndex, item.slot]),
  );
  const nextSlotMap = new Map(
    transitionNextVisibleCards.map((item) => [item.cardIndex, item.slot]),
  );

  const getSlotForCard = (cardIndex: number) => {
    if (!transition) {
      return currentSlotMap.get(cardIndex) ?? "back";
    }

    if (transition.phase === "retreat") {
      const outgoingIndex = transition.prevOrder[0];
      const incomingIndex = transition.nextOrder[0];

      if (cardIndex === outgoingIndex) return "retreat";
      if (cardIndex === incomingIndex) return "incoming";
      return nextSlotMap.get(cardIndex) ?? prevSlotMap.get(cardIndex) ?? "back";
    }

    return nextSlotMap.get(cardIndex) ?? "back";
  };

  const handleDelete = () => {
    if (isCycling) return;
    onDelete?.(id);
  };

  const badgeCount = cards.length;
  const deleteVisible = isHovered && !isCycling;

  return (
    <div
      className="group relative mx-auto w-full max-w-[15rem] animate-fade-in-up"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="relative h-[20rem] w-full"
        style={{ isolation: "isolate" }}
      >
        {visibleCards.map(({ cardIndex }) => {
          const card = cards[cardIndex];
          const slot = getSlotForCard(cardIndex);

          return (
            <FlashcardCard
              key={card.id}
              title={card.title}
              description={card.description}
              slot={slot}
              onCycle={handleCardClick}
              onOpenChat={() => onOpenChat?.(conversationId)}
              isHovered={isHovered}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleDelete}
        className={`absolute -bottom-3 right-2 z-40 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs text-white/60 backdrop-blur-sm transition-all duration-200 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 ${
          deleteVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <Trash2 className="h-3 w-3" />
        <span>Delete</span>
      </button>

      <div className="absolute -right-2 -top-2 z-40 flex h-6 w-6 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-medium text-blue-400">
        {badgeCount}
      </div>
    </div>
  );
}
