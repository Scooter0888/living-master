# Living Master

**Preserve any mind. Build a Living Master.**

Feed it interviews, books, talks, and videos. Ask anything. Get answers grounded in their real words — in their own voice.

---

## What it does

Living Master turns a public figure's complete body of work into a searchable, conversational AI intelligence:

- **Ingest anything** — YouTube videos, podcasts, PDFs, articles, web pages, MP4/MP3/WAV files, DVDs/ISOs
- **RAG-powered chat** — ask questions and get answers sourced directly from the knowledge base
- **Voice cloning** — responses in the master's own voice (ElevenLabs or free Edge TTS)
- **Speaker diarization** — automatically identifies who is speaking in multi-person recordings
- **Auto-translation** — non-English content is automatically transcribed in English
- **AI book generation** — compile the entire knowledge base into a beautifully written, structured book
- **PDF export** — download the generated book as a print-ready PDF with photos
- **Web discovery** — search for and bulk-import all publicly available content on any person

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (React 19) |
| Backend | FastAPI (Python 3.11+) |
| Vector Store | ChromaDB |
| Embeddings | OpenAI text-embedding-3-small |
| RAG Chat | Claude Haiku (fast, grounded) |
| Book Writing | Claude Sonnet (high quality) |
| Transcription | faster-whisper (local, offline) |
| Speaker ID | pyannote.audio 3.1 |
| Voice TTS | ElevenLabs + Edge TTS fallback |

---

## Quick start (local)

### Prerequisites

- Python 3.11+ with Anaconda (or a venv with all packages)
- Node.js 18+
- API keys (see `.env.example`)

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/living-master.git
cd living-master
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys
```

### 2. Start

```bash
./start.sh
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

---

## Deploy to production (Railway + Vercel)

This is the recommended zero-localhost deployment. Your app will be live at a real URL.

### Backend → Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repo
4. Railway auto-detects `railway.toml` and builds the Docker image
5. Add all env vars from `backend/.env.example` in Railway's Variables tab
6. Add a **Volume** mounted at `/app/chroma_db`, `/app/uploads`, `/app/photos`
7. Copy your Railway backend URL (e.g. `https://living-master-production.up.railway.app`)

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Set root directory to `frontend`
3. Add environment variable: `NEXT_PUBLIC_API_URL=https://your-railway-url`
4. Deploy — Vercel gives you a permanent URL instantly

---

## Required API keys

| Key | Required | Where to get |
|-----|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | Yes | [platform.openai.com](https://platform.openai.com) |
| `SERPER_API_KEY` | Recommended | [serper.dev](https://serper.dev) — free 2.5k/month |
| `YOUTUBE_API_KEY` | Optional | Google Cloud Console |
| `ELEVENLABS_API_KEY` | Optional | [elevenlabs.io](https://elevenlabs.io) — falls back to Edge TTS |
| `HUGGINGFACE_TOKEN` | Optional | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) — for speaker diarization |

---

## Architecture

```
frontend/          Next.js 14 app
  app/             Pages
  components/      UI components
  lib/api.ts       Type-safe API client

backend/
  app/
    main.py        FastAPI app + middleware
    config.py      Settings (all via env vars)
    models.py      SQLAlchemy models
    routers/       API endpoints
      masters.py   Master CRUD
      ingest.py    URL + file ingestion
      query.py     RAG chat
      export.py    Book generation + PDF
      discover.py  Web discovery
      voice.py     TTS + voice cloning
      media.py     Photo management
    services/
      ingestion/   Content extraction (YouTube, web, audio, video, PDF, ISO)
      rag.py       Retrieval-augmented generation
      embeddings.py OpenAI embeddings
      vector_store.py ChromaDB interface
      transcription.py faster-whisper
      diarization.py  pyannote speaker ID
      voice.py     ElevenLabs / Edge TTS
      pdf_export.py   ReportLab PDF generation
      movement.py  Claude Vision movement analysis
```

---

## License

MIT
