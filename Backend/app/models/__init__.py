from pydantic import BaseModel
from typing import Optional, List, Literal, Dict
from datetime import datetime, date


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
    diagram_type: str = "flowchart"   # "flowchart" | "diagram" (mindmap)


class DiagramGenerateResponse(BaseModel):
    diagram_id: str
    type: str
    topic: str
    mermaid_code: str
    created_at: str


# ── Image Generation (Imagen 3) ───────────────────────────────────────────────

class ImageGenerateRequest(BaseModel):
    user_id: str
    conversation_id: Optional[str] = None
    topic: str


class ImageGenerateResponse(BaseModel):
    diagram_id: str
    type: str          # always "image"
    topic: str
    image_url: str     # Azure Blob SAS URL
    created_at: str


class DiagramHistoryItem(BaseModel):
    diagram_id: str
    type: str                             # "flowchart" | "diagram" | "image"
    topic: str
    mermaid_code: Optional[str] = None   # present for flowchart/mindmap, empty for image
    image_url: Optional[str] = None      # present for image type only
    created_at: str
    conversation_id: str


class DiagramHistoryResponse(BaseModel):
    diagrams: List[DiagramHistoryItem]


# ── Study Plans ───────────────────────────────────────────────────────────────

class StudyPlanPreferences(BaseModel):
    hours_per_week: int = 8
    focus_days: Optional[List[str]] = None   # ["Mon", "Wed", "Sat"]


class StudyPlanRequest(BaseModel):
    user_id: str
    conversation_id: Optional[str] = None
    topic: Optional[str] = None
    timeline_weeks: int = 4
    preferences: Optional[StudyPlanPreferences] = None


class WeekPlan(BaseModel):
    week_number: int
    start_date: str
    end_date: str
    tasks: List[str]
    estimate_hours: Optional[int] = None


class StudyPlanResponse(BaseModel):
    plan_id: str
    title: str
    start_date: str
    end_date: str
    weeks: List[WeekPlan]
    summary: str


# ── Goals ─────────────────────────────────────────────────────────────────────

class Reminder(BaseModel):
    enabled: bool = False
    type: Literal["daily", "weekly", "custom"] = "weekly"
    time: Optional[str] = None          # "HH:MM"
    days: Optional[List[str]] = None    # ["Mon", "Thu"]
    interval_days: Optional[int] = None


class GoalCreateRequest(BaseModel):
    user_id: str
    title: str
    start_date: str
    end_date: str
    weekly_plan: List[WeekPlan]
    progress: int = 0
    reminder: Optional[Reminder] = None
    completed_tasks: Optional[Dict[str, bool]] = None


class GoalUpdateRequest(BaseModel):
    title: Optional[str] = None
    weekly_plan: Optional[List[WeekPlan]] = None
    progress: Optional[int] = None
    reminder: Optional[Reminder] = None
    completed_tasks: Optional[Dict[str, bool]] = None


class GoalItem(BaseModel):
    goal_id: str
    user_id: str
    title: str
    start_date: str
    end_date: str
    weekly_plan: List[WeekPlan]
    progress: int
    reminder: Optional[Reminder] = None
    completed_tasks: Optional[Dict[str, bool]] = None
    created_at: str


class GoalsListResponse(BaseModel):
    goals: List[GoalItem]