from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="StudyBuddy API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        os.getenv("FRONTEND_URL", ""),
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ── Routers ────────────────────────────────────────────────────────────────────
from app.routers.upload import router as upload_router
app.include_router(upload_router)

# Phase 2 + 3 routers will be added here as we build them:
# from app.routers.chat import router as chat_router
# from app.routers.quiz import router as quiz_router
# app.include_router(chat_router)
# app.include_router(quiz_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0"}