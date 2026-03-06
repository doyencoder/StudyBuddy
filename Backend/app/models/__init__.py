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
    conversation_id: str
    topic: Optional[str] = None
    num_questions: int = 5          # default 5 questions


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: List[str]              # plain strings ["Paris", "London", ...]


class QuizGenerateResponse(BaseModel):
    quiz_id: str
    topic: str
    questions: List[QuizQuestion]


class QuizSubmitRequest(BaseModel):
    user_id: str
    quiz_id: str
    answers: List[int]              # selected option index per question (0-based)


class QuizResult(BaseModel):
    question_id: str
    correct: bool
    selected_index: int
    correct_index: int
    explanation: str
    question: str
    options: List[str]


class QuizSubmitResponse(BaseModel):
    quiz_id: str
    score: int                      # percentage 0–100
    total_questions: int
    correct_count: int
    weak_areas: List[str]
    results: List[QuizResult]


class QuizHistoryItem(BaseModel):
    quiz_id: str
    topic: str
    created_at: str
    submitted: bool
    score: Optional[int] = None
    correct_count: Optional[int] = None
    total_questions: int = 5
    weak_areas: List[str] = []
    results: List[QuizResult] = []      # full per-question breakdown


class QuizHistoryResponse(BaseModel):
    quizzes: List[QuizHistoryItem]


# ── Diagrams ──────────────────────────────────────────────────────────────────

class DiagramGenerateRequest(BaseModel):
    user_id: str
    conversation_id: Optional[str] = None   # optional — if None, uses general knowledge
    topic: str
    diagram_type: str = "flowchart"   # "flowchart" | "diagram"


class DiagramGenerateResponse(BaseModel):
    diagram_id: str
    type: str
    topic: str
    mermaid_code: str
    created_at: str


class DiagramHistoryItem(BaseModel):
    diagram_id: str
    type: str
    topic: str
    mermaid_code: str
    created_at: str
    conversation_id: str


class DiagramHistoryResponse(BaseModel):
    diagrams: List[DiagramHistoryItem]