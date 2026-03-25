from pydantic import BaseModel, Field
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

class ChatAttachment(BaseModel):
    name: str
    blob_url: str
    proxy_url: str = ""
    blob_name: str = ""   # permanent blob path — used to rebuild proxy URL on any host
    file_type: str  # "image" | "pdf" | "document"

class ChatRequest(BaseModel):
    user_id: str
    conversation_id: Optional[str] = None
    message: str
    blob_url: Optional[str] = None
    filename: Optional[str] = None
    attachments: Optional[List["ChatAttachment"]] = None
    # Set when user clicked an intent tile chip ("quiz", "flowchart", "mindmap", "study_plan", "image")
    intent_hint: Optional[str] = None
    # Optional overrides for quiz retake — avoids encoding these in message text
    # which caused the intent prefix to leak into quiz titles.
    num_questions_override: Optional[int] = None
    timer_seconds_override: Optional[int] = None
    # Dynamic model selection — "azure" | "gemini" | None (None → server default).
    # Sent by the frontend model selector on every request. Resolved by
    # get_provider() in chat.py; never affects the embedding pipeline.
    model_provider: Optional[Literal["azure", "gemini"]] = None


class ChatMessage(BaseModel):
    id: str
    role: str          # "user" | "assistant"
    content: str
    timestamp: datetime


class ChatHistoryResponse(BaseModel):
    conversation_id: str
    messages: List[ChatMessage]
    # Stored provider for this conversation — None means "use server default".
    # Returned by GET /chat/history so the frontend can restore the selector
    # to the correct state when a conversation is loaded or the page is refreshed.
    model_provider: Optional[Literal["azure", "gemini"]] = None


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
    fun_fact: str = ""


class QuizPreclassifyRequest(BaseModel):
    user_id: str
    quiz_id: str


class QuizSubmitRequest(BaseModel):
    user_id: str
    quiz_id: str
    answers: List[int]              # selected option index per question (0-based)
    unanswered_indices: List[int] = []  # indices that timed out unanswered


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
    unanswered_indices: List[int] = []


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

class FlashcardItem(BaseModel):
    id: str
    title: str
    description: str


class FlashcardsGenerateRequest(BaseModel):
    user_id: str
    conversation_id: str


class FlashcardDeckResponse(BaseModel):
    deck_id: str
    conversation_id: str
    conversation_title: str = ""
    card_count: int
    created_at: str
    updated_at: str
    cards: List[FlashcardItem]


class FlashcardsListResponse(BaseModel):
    flashcards: List[FlashcardDeckResponse]


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


# ── Settings ──────────────────────────────────────────────────────────────────

class NotificationSettings(BaseModel):
    goal_reminders: bool = False
    long_term_goals_reminder: bool = False
    study_streak_alerts: bool = False
    flashcard_review_reminders: bool = False


class AIPreferences(BaseModel):
    simplified_explanations: bool = True
    auto_generate_flashcards: bool = False


class AppearanceSettings(BaseModel):
    color_mode: Literal["light", "auto", "dark"] = "auto"
    chat_font: Literal["default", "sans", "system", "dyslexic"] = "default"
    voice: Literal["buttery", "airy", "mellow", "glassy", "rounded"] = "buttery"


class ProfileSettings(BaseModel):
    full_name: str = ""
    display_name: str = ""
    email: str = ""


class UserSettings(BaseModel):
    user_id: str
    profile: ProfileSettings = ProfileSettings()
    notifications: NotificationSettings = NotificationSettings()
    ai_preferences: AIPreferences = AIPreferences()
    appearance: AppearanceSettings = AppearanceSettings()
    updated_at: Optional[str] = None


class SettingsUpdateRequest(BaseModel):
    profile: Optional[ProfileSettings] = None
    notifications: Optional[NotificationSettings] = None
    ai_preferences: Optional[AIPreferences] = None
    appearance: Optional[AppearanceSettings] = None
    # Curriculum-aware feature — top-level fields on the settings document
    curriculum_board: Optional[str] = None    # "CBSE" | "ICSE" | null
    curriculum_grade: Optional[str] = None    # "Class 9" | "Class 10" | ... | null
    curriculum_enabled: Optional[bool] = None  # true | false | null


class ActiveSession(BaseModel):
    device: str
    location: str
    created: str
    updated: str
    is_current: bool = False


class AccountInfo(BaseModel):
    user_id: str
    organization_id: str
    sessions: List[ActiveSession] = []


class ConnectorItem(BaseModel):
    id: str
    name: str
    icon: str              # icon identifier for frontend
    connected: bool = False
    connected_at: Optional[str] = None


class ConnectorsResponse(BaseModel):
    connectors: List[ConnectorItem]


class ConnectorToggleRequest(BaseModel):
    connector_id: str
    action: Literal["connect", "disconnect"]


class BillingPlan(BaseModel):
    id: str
    name: str
    tagline: str
    price: str
    period: str
    features: List[str]
    is_current: bool = False


class BillingResponse(BaseModel):
    current_plan: str
    plans: List[BillingPlan]


# ── Coins / Gamification ─────────────────────────────────────────────────────

class CoinTransaction(BaseModel):
    id: str
    type: Literal["earn", "spend"]
    amount: int
    reason: str
    category: str
    timestamp: str


class StoreOrder(BaseModel):
    id: str
    item_id: str
    item_name: str
    cost: int
    ordered_at: str
    status: Literal["delivered", "pending"] = "delivered"


class MissionProgress(BaseModel):
    mission_id: str
    completed: bool
    completed_at: Optional[str] = None


class LegacyCoinStatePayload(BaseModel):
    balance: int = 0
    lifetime_earned: int = 0
    login_streak: int = 0
    longest_streak: int = 0
    last_login_date: Optional[str] = None
    last_reward_date: Optional[str] = None
    transactions: List[CoinTransaction] = Field(default_factory=list)
    orders: List[StoreOrder] = Field(default_factory=list)
    missions: Dict[str, MissionProgress] = Field(default_factory=dict)
    referral_code: Optional[str] = None
    referred_by: Optional[str] = None
    referral_count: int = 0


class CoinStateResponse(BaseModel):
    user_id: str
    balance: int = 0
    lifetime_earned: int = 0
    login_streak: int = 0
    longest_streak: int = 0
    last_login_date: Optional[str] = None
    last_reward_date: Optional[str] = None
    transactions: List[CoinTransaction] = Field(default_factory=list)
    orders: List[StoreOrder] = Field(default_factory=list)
    missions: Dict[str, MissionProgress] = Field(default_factory=dict)
    referral_code: str = ""
    referred_by: Optional[str] = None
    referral_count: int = 0
    updated_at: Optional[str] = None


class CoinsBootstrapRequest(BaseModel):
    user_id: str
    legacy_state: Optional[LegacyCoinStatePayload] = None


class DailyLoginRewardPayload(BaseModel):
    coins_earned: int
    new_streak: int
    streak_bonus: int
    streak_milestone: Optional[str] = None


class DailyLoginRequest(BaseModel):
    user_id: str


class DailyLoginResponse(BaseModel):
    coin_state: CoinStateResponse
    reward: Optional[DailyLoginRewardPayload] = None


class MissionCompleteRequest(BaseModel):
    user_id: str
    mission_id: str


class MissionCompleteResponse(BaseModel):
    coin_state: CoinStateResponse
    earned_amount: int


class ReferralApplyRequest(BaseModel):
    user_id: str
    code: str


class ReferralApplyResponse(BaseModel):
    coin_state: CoinStateResponse
    applied: bool
    reason: Optional[Literal["self_referral", "already_referred"]] = None
