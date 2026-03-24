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
  const [retreatingCardIndex, setRetreatingCardIndex] = useState<number | null>(null);
  const reorderTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setCardOrder(cards.map((_, index) => index));
    setIsCycling(false);
    setRetreatingCardIndex(null);
  }, [cards]);

  useEffect(() => {
    return () => {
      if (reorderTimeoutRef.current !== null) {
        window.clearTimeout(reorderTimeoutRef.current);
      }
    };
  }, []);

  const handleCardClick = () => {
    if (cards.length <= 1 || isCycling) return;

    const outgoingIndex = cardOrder[0];
    const nextOrder = [...cardOrder];
    const first = nextOrder.shift();
    if (first !== undefined) nextOrder.push(first);

    setIsCycling(true);
    setRetreatingCardIndex(outgoingIndex);

    reorderTimeoutRef.current = window.setTimeout(() => {
      setCardOrder(nextOrder);
      setRetreatingCardIndex(null);
      setIsCycling(false);
      reorderTimeoutRef.current = null;
    }, 220);
  };

  const currentVisibleCards = buildVisibleStack(cardOrder);
  const currentSlotMap = new Map(currentVisibleCards.map((item) => [item.cardIndex, item.slot]));

  const handleDelete = () => {
    onDelete?.(id);
  };

  const badgeCount = cards.length;
  const deleteVisible = isHovered;

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
        {currentVisibleCards.map(({ cardIndex }) => {
          const card = cards[cardIndex];
          const slot =
            retreatingCardIndex === cardIndex
              ? "retreat"
              : currentSlotMap.get(cardIndex) ?? "back";

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
