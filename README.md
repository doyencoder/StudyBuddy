# StudyBuddy

StudyBuddy is an AI-powered study companion built as a FastAPI backend plus a Vite/React frontend. It combines retrieval-augmented chat, document ingestion, quizzes, flashcards, study plans, diagrams, image generation, graphing, reminders, and gamified progress tracking in one full-stack app.

## What It Does

- Chat with uploaded study material using RAG and streamed responses.
- Generate quizzes, flashcards, study plans, diagrams, and study images.
- Translate answers and convert responses to speech.
- Track goals, daily study targets, streaks, coins, referrals, and store rewards.
- Support shared chats, multi-profile switching, and offline-friendly frontend behavior.
- Offer a Nova graph workspace for math plotting and AI-assisted equation parsing.

## Monorepo Layout

```text
StudyBuddy/
|-- Backend/
|   |-- app/
|   |   |-- main.py
|   |   |-- models/
|   |   |-- routers/
|   |   |-- services/
|   |   `-- utils/
|   |-- .env.example
|   |-- render.yaml
|   `-- requirements.txt
|-- Frontend/
|   |-- public/
|   |-- src/
|   |-- package.json
|   |-- vite.config.ts
|   |-- vercel.json
|   `-- staticwebapp.config.json
|-- .github/workflows/
`-- README.md
```

## Core Features

### Learning Assistant

- RAG chat over uploaded PDFs, images, and documents
- streaming responses with conversation history
- conversation rename, starring, deletion, and shared chat links
- optional web, image, and video search inside chat

### Study Workflows

- quiz generation, submission, scoring, and history
- flashcard generation per conversation
- structured study plan generation
- goals with progress tracking and reminders

### Visual and Math Tools

- Mermaid flowcharts and mind maps
- AI image generation with pluggable providers
- Nova graphing workspace with AI-assisted equation parsing

### Personalization

- multiple student profiles in the frontend
- curriculum-aware settings
- appearance, voice, billing, and connector settings
- translation and text-to-speech

### Engagement

- daily login rewards and streak tracking
- mission completion and referral codes
- coin wallet and store experience
- notification scheduling for goals, streaks, and flashcard review

### Offline Support

- service worker registration in production
- cached app shell and selected API responses
- offline mutation queue for supported actions like goals, settings, quizzes, flashcards, and chat cleanup flows

## Architecture

### Backend

The FastAPI app lives in `Backend/app` and mounts routers for:

- `upload`
- `chat`
- `quiz`
- `diagrams`
- `flashcards`
- `study_plans`
- `goals`
- `settings`
- `sessions`
- `graph`
- `notifications`
- `coins`

The backend coordinates:

- Azure Blob Storage for uploaded and generated files
- Azure Document Intelligence for extraction/OCR
- Azure AI Search for retrieval
- Azure Cosmos DB for app state and histories
- Gemini and Azure OpenAI text providers
- Hugging Face / Azure image generation providers
- Azure Translator and Azure Speech
- optional SerpAPI and YouTube Data API search
- optional SMTP email notifications

### Frontend

The frontend is a Vite + React + TypeScript SPA in `Frontend/src` with pages for:

- landing page
- dashboard
- chat
- quizzes
- flashcards
- goals
- images
- settings
- Nova graphing
- store
- shared chat view

It uses:

- React Router
- TanStack Query
- Tailwind CSS
- shadcn/ui + Radix primitives
- Vitest + Testing Library
- service worker caching for offline-friendly behavior

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Radix UI
- TanStack Query
- Mermaid
- KaTeX
- Vitest

### Backend

- FastAPI
- Uvicorn
- Pydantic v2
- Azure SDKs for Blob, Cosmos, Search, Translator, Speech, and Document Intelligence
- Google Gemini SDKs
- OpenAI Python SDK
- APScheduler

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- Azure resources for storage, search, document intelligence, Cosmos DB, translator, and speech
- credentials for at least one text model provider

Optional integrations:

- SerpAPI for web and image search
- YouTube Data API for video search
- SMTP credentials for reminder emails
- Hugging Face or Azure image-generation credentials depending on provider choice

## Quick Start

### 1. Backend Setup

```bash
cd Backend
python -m venv .venv
```

Activate the virtual environment:

```bash
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create `Backend/.env` from `Backend/.env.example`, then start the API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend Setup

```bash
cd Frontend
npm install
npm run dev
```

By default the frontend dev server runs on `http://localhost:8080`.

### 3. Connect Frontend to Backend

The frontend reads its API base URL from `VITE_API_BASE` and falls back to `http://localhost:8000`.

Example:

```bash
# Frontend/.env.local
VITE_API_BASE=http://localhost:8000
```

### 4. Open the App

- Frontend: `http://localhost:8080`
- Backend health check: `http://localhost:8000/health`

## Environment Variables

The sample file at `Backend/.env.example` covers the main backend integrations.

### Common Core Variables

```env
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_NAME=
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
AZURE_SEARCH_ENDPOINT=
AZURE_SEARCH_KEY=
AZURE_SEARCH_INDEX_NAME=
AZURE_COSMOS_CONNECTION_STRING=
AZURE_COSMOS_DB_NAME=
AI_PROVIDER=
ENABLE_FIGURE_VISION=
```

### Text Model Providers

```env
GEMINI_API_KEY=

AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_CHAT_DEPLOYMENT=
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=
```

Important:

- `AI_PROVIDER` selects the default text model provider: `azure` or `gemini`.
- Embeddings are still handled through Azure OpenAI, so Azure OpenAI settings are needed for retrieval even when Gemini is the default chat provider.
- Parts of the app also rely on Azure deployments for helper flows such as title generation.

### Translation and Speech

```env
AZURE_TRANSLATOR_KEY=
AZURE_TRANSLATOR_REGION=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

### Web Search

```env
SERP_API_KEY=
YOUTUBE_API_KEY=
```

These are optional and only needed for chat-driven web, image, or video search.

### Image Generation

```env
IMAGE_GENERATION_PROVIDER=
HF_API_TOKEN=
AZURE_OPENAI_IMAGE_DEPLOYMENT=
AZURE_FLUX_ENDPOINT=
AZURE_FLUX_API_KEY=
```

Supported image provider values:

- `huggingface`
- `azure`
- `azure_flux`

### Email Notifications

```env
EMAIL_SENDER=
EMAIL_PASSWORD=
SMTP_HOST=
SMTP_PORT=
```

SMTP is required for reminder emails. Without valid SMTP settings, notification email flows will not send successfully.

### Useful Manual Additions

These variables are used by the app but are not currently listed in `Backend/.env.example`:

```env
FRONTEND_URL=http://localhost:8080
AZURE_FRONTEND_URL=
SITE_URL=
```

Use them for CORS and environment-specific frontend URLs.

## Scripts

### Frontend

```bash
npm run dev
npm run build
npm run build:dev
npm run preview
npm run lint
npm run test
npm run test:watch
```

### Backend

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Testing

Frontend tests are set up with Vitest and Testing Library.

```bash
cd Frontend
npm run test
```

Current setup files include:

- `Frontend/vitest.config.ts`
- `Frontend/src/test/setup.ts`

There are no backend automated tests in the repo yet.

## Deployment Notes

### Backend

- `Backend/render.yaml` includes a Render service definition for the FastAPI app.
- The backend expects environment variables to be configured in the deployment platform.

### Frontend

- `.github/workflows/azure-static-web-apps-white-mushroom-0b6df0c00.yml` deploys the frontend to Azure Static Web Apps.
- `Frontend/staticwebapp.config.json` and `Frontend/vercel.json` provide SPA rewrite rules.
- `Frontend/vite.config.ts` injects a build ID used by the service worker for cache versioning.

## Selected API Surface

High-level backend endpoints include:

- `/health`
- `/upload/*`
- `/chat/*`
- `/quiz/*`
- `/diagrams/*`
- `/flashcards/*`
- `/study_plans/*`
- `/goals/*`
- `/settings/*`
- `/sessions/*`
- `/graph/*`
- `/notifications/*`
- `/coins/*`

## Data and Startup Behavior

On startup, the backend attempts to:

- configure CORS from local and environment-defined frontend origins
- ensure settings, coins, sessions, and flashcards containers exist
- start the notification scheduler
- initialize the Azure AI Search index

## Notes for Contributors

- Keep new backend logic behind the existing router/service split.
- Add frontend tests for new UI behavior when practical.
- If you add new environment variables, update both `Backend/.env.example` and this README together.
- If you change the frontend dev port or deployment targets, update the local setup instructions here as part of the same change.
