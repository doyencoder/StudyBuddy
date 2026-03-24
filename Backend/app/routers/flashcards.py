from fastapi import APIRouter, HTTPException, Query

from app.models import (
    FlashcardDeckResponse,
    FlashcardsGenerateRequest,
    FlashcardsListResponse,
    FlashcardItem,
)
from app.services.cosmos_service import delete_flashcard_deck, list_flashcard_decks
from app.services.flashcards_service import generate_and_save_flashcards


router = APIRouter(prefix="/flashcards", tags=["flashcards"])

REFUSAL_DETAIL = (
    "StudyBuddy could not generate flashcards for that conversation because the "
    "content was blocked by the safety policy."
)


def _to_response(deck: dict) -> FlashcardDeckResponse:
    return FlashcardDeckResponse(
        deck_id=deck.get("deck_id", deck.get("id", "")),
        conversation_id=deck.get("conversation_id", ""),
        conversation_title=deck.get("conversation_title", ""),
        card_count=int(deck.get("card_count", len(deck.get("cards", [])))),
        created_at=deck.get("created_at", ""),
        updated_at=deck.get("updated_at", ""),
        cards=[
            FlashcardItem(
                id=str(card.get("id", "")),
                title=str(card.get("title", "")),
                description=str(card.get("description", "")),
            )
            for card in deck.get("cards", [])
        ],
    )


@router.post("/generate", response_model=FlashcardDeckResponse)
async def generate_flashcards_endpoint(req: FlashcardsGenerateRequest):
    try:
        deck = await generate_and_save_flashcards(
            user_id=req.user_id,
            conversation_id=req.conversation_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Flashcard generation failed: {str(e)}")

    if deck.get("__refused__"):
        raise HTTPException(status_code=400, detail=REFUSAL_DETAIL)

    return _to_response(deck)


@router.get("", response_model=FlashcardsListResponse)
async def list_flashcards_endpoint(user_id: str = Query(...)):
    try:
        decks = await list_flashcard_decks(user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch flashcards: {str(e)}")

    return FlashcardsListResponse(flashcards=[_to_response(deck) for deck in decks])


@router.delete("/{conversation_id}")
async def delete_flashcards_endpoint(conversation_id: str, user_id: str = Query(...)):
    try:
        deleted = await delete_flashcard_deck(user_id=user_id, conversation_id=conversation_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete flashcards: {str(e)}")

    if not deleted:
        raise HTTPException(status_code=404, detail="Flashcards not found for that conversation.")

    return {"status": "deleted", "conversation_id": conversation_id}
