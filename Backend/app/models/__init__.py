from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Upload ────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    file_id: str
    filename: str
    blob_url: str
    chunks_stored: int
    message: str


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    user_id: str
    conversation_id: Optional[str] = None
    message: str


class ChatMessage(BaseModel):
    id: str
    role: str          # "user" | "assistant"
    content: str
    timestamp: datetime


class ChatHistoryResponse(BaseModel):
    conversation_id: str
    messages: List[ChatMessage]


# ── Quiz ──────────────────────────────────────────────────────────────────────

class QuizGenerateRequest(BaseModel):
    user_id: str
    topic: Optional[str] = None
    num_questions: int = 10
    question_type: str = "mcq"   # "mcq" | "short_answer"


class QuizOption(BaseModel):
    key: str    # "A", "B", "C", "D"
    text: str


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: Optional[List[QuizOption]] = None   # None for short_answer
    correct_answer: str
    explanation: str


class QuizGenerateResponse(BaseModel):
    quiz_id: str
    topic: str
    questions: List[QuizQuestion]


class QuizSubmitAnswer(BaseModel):
    question_id: str
    answer: str


class QuizSubmitRequest(BaseModel):
    user_id: str
    quiz_id: str
    answers: List[QuizSubmitAnswer]


class QuizResult(BaseModel):
    question_id: str
    correct: bool
    your_answer: str
    correct_answer: str
    explanation: str


class QuizSubmitResponse(BaseModel):
    quiz_id: str
    score: int           # percentage 0-100
    total_questions: int
    correct_count: int
    results: List[QuizResult]