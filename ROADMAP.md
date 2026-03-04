# Living Master — Product Roadmap

This document tracks planned features, enhancements, and research directions for the Living Master platform. Features are grouped by area and labelled with rough complexity.

---

## ✅ Already Live

- YouTube ingestion (auto-transcript + Whisper fallback)
- Web/Wikipedia/podcast URL ingestion
- File upload: MP3, WAV, M4A, MP4, MKV, MOV, PDF, DOCX
- Bulk discovery (auto-find all public material on a person)
- RAG-powered chat (question → vector search → Claude answer)
- Knowledge stats (word count, page estimate, per-source breakdown)
- Full transcript viewer per source
- Knowledge Book generator (AI compiles entire KB into structured book)
- Discover Topics (AI identifies themes, click-to-generate focused books)
- Auto-delete empty-content ingestion failures
- Already-added URL detection in discovery panel

---

## 🗂️ Feature Areas

---

### 📷 Photos & Print-Ready Book Export

**Goal:** Upload and associate photos/images with a master's knowledge base. Include them in generated books. Export as print-ready PDF suitable for print-on-demand (Lulu, IngramSpark, etc.).

**What's needed:**
- Backend: image upload endpoint, store images with master_id + optional caption/context
- Backend: PDF export endpoint using WeasyPrint or ReportLab — embeds text + photos, proper typography, page margins, ISBN-ready formatting
- Frontend: photo management tab (upload, caption, reorder, assign to chapters)
- Book generator: option to place photos at relevant chapter points based on caption context
- Export button: download as `.pdf` with embedded cover, chapters, and photos

**Complexity:** Medium — mostly plumbing, no new AI needed

---

### 🎬 Expanded Video & DVD Support

**Goal:** Accept more video formats including DVD source material without ballooning storage.

**What's already working:**
- MP4, MKV, MOV, M4A, MP3, WAV — full ingestion pipeline (audio extracted → Whisper transcription → embeddings)
- Raw video file is deleted immediately after transcription; only text is kept long-term

**What's still needed:**
- `.VOB` files (DVD video tracks) — ffmpeg handles natively, just needs adding to accepted types
- `.ISO` disc images — need to mount the ISO, extract VOB tracks, then process as video; doable with `isoinfo` or `7z` on the server
- Large file handling — chunked upload for files >500MB, progress indicator in UI
- Option to specify which audio track to use (DVDs often have multiple: commentary, director's cut, etc.)

**On storage:** Files are already temp-only. We process, transcribe, and delete. The only permanent storage is the text transcript + vector embeddings, which are tiny by comparison.

**Complexity:** Low (VOB) → Medium (ISO mounting)

---

### 🔊 Voice Responses & Voice Cloning

**Goal:** Chat answers can optionally be spoken aloud in the master's own cloned voice.

**Workflow:**
1. During ingestion, flag audio sources as "voice samples"
2. Extract 1–5 minutes of clean speech from ingested audio/video
3. Create a voice clone via ElevenLabs Voice Cloning API — store `voice_id` on the master record
4. In chat, user toggles "Voice" mode — responses are sent to ElevenLabs TTS with the master's voice_id and streamed back as audio
5. Audio plays inline in the chat interface with a waveform visualiser

**API options:**
- **ElevenLabs** (recommended) — best quality cloning, ~$0.30/1k chars, supports instant cloning from 1 min of audio
- **OpenAI TTS** — cheaper but no custom voice cloning
- **Coqui XTTS v2** — open source, self-hosted, good quality (good for offline/private use)

**Complexity:** Medium — requires ElevenLabs API key, audio extraction helper, frontend audio player

---

### 🎤 Speaker Diarization (Isolating the Master's Voice)

**Goal:** When transcribing audio/video with multiple speakers (e.g. a class, interview, seminar), identify which speaker is the master and only index their words as authoritative knowledge. Students, interviewers, and others are captured as conversational context only — their words do not get mixed into the master's knowledge base.

**How it works:**
- Replace current `faster-whisper` with **WhisperX** — a drop-in upgrade that adds speaker diarization via `pyannote.audio`
- Each transcript segment is labelled: `SPEAKER_00`, `SPEAKER_01`, etc. with timestamps
- First time a new source is transcribed with multiple speakers: UI shows a short audio clip per speaker and asks "which of these is the master?"
- That speaker label is locked for the session; only their segments are indexed into the master's vector store
- Other speakers are stored as `role: student/interviewer/other` — still searchable but with a different context flag
- Chunks from non-master speakers are tagged so Claude knows: "this is what a student asked, not what the master said"

**Additional benefit:** Fixes the current problem where student questions, audience laughter, or interviewer interjections get mixed into the master's knowledge

**Complexity:** Medium-High — WhisperX requires pyannote.audio + HuggingFace token; diarization adds ~2–3× processing time but dramatically improves knowledge quality

---

### 🥋 Physical Movement & Body Language Analysis

**Goal:** For masters whose knowledge is primarily physical (martial arts, dance, bodywork, yoga, sports), capture the *what the body is doing* alongside the *what is being said*. Store movement descriptions as searchable knowledge chunks.

**Two-tier approach:**

**Tier 1 — Claude Vision on Keyframes** *(buildable now)*
- Extract one video frame every 3–5 seconds using ffmpeg
- Send each frame to Claude Vision with context: "Describe the body position, movement, and technique being demonstrated by the main practitioner. Note specific joints, limbs, contact points, and direction of force. Be precise."
- Store the movement description as a chunk alongside the corresponding transcript timestamp
- Result: *"00:02:34 — Practitioner releases opponent's wrist grip by rotating the forearm internally while simultaneously stepping offline. The shoulder remains relaxed, the elbow leads the spiral. Contact with opponent maintained through soft palm contact on their forearm."*

**Tier 2 — Pose Estimation** *(medium term)*
- Use **MediaPipe Pose** or **OpenPose** to detect skeletal landmarks (33 joint positions) on each keyframe
- Feed joint coordinate data into Claude with the transcript context to generate biomechanically precise descriptions
- Can detect: stance width, weight distribution, centre of gravity, arm angles, spine alignment, footwork patterns
- Useful for detecting techniques that are not verbally described but visually demonstrated

**What this enables:**
- Search: "Show me how he releases a grip" → finds both verbal explanation AND visual demonstrations
- Book chapters on techniques can include movement descriptions, not just verbal quotes
- Training guides that describe what to do physically, not just philosophy

**Note on identifying the master's movements:** Combined with speaker diarization, we can flag which on-screen person corresponds to the master's voice, focusing pose analysis on them specifically.

**Complexity:**
- Tier 1 (Vision): Medium — ffmpeg keyframe extraction + Claude Vision API calls (adds cost per video ~$0.10–0.50/hour of video)
- Tier 2 (Pose): High — requires MediaPipe Python library, biomechanical interpretation layer

---

### 📖 Print-on-Demand Pipeline

**Goal:** End-to-end workflow from knowledge base → print-ready book.

**Steps:**
1. Generate book via AI (existing feature)
2. Upload/assign photos to chapters
3. Choose book format (A5/B5/6×9 — standard POD sizes)
4. Export as PDF with:
   - Proper typographic margins (bleed, gutter, header/footer)
   - Embedded photos at assigned positions
   - Table of contents with page numbers
   - Chapter headers and page breaks
   - ISBN placeholder block
5. Upload directly to Lulu.com or IngramSpark API, or download PDF for manual upload

**Complexity:** Medium-High — PDF generation with proper typesetting is the hard part (WeasyPrint + custom CSS templates)

---

### 💬 Enhanced Chat Features

**What's been requested:**
- [ ] Voice response toggle — answers spoken aloud (see Voice Cloning above)
- [ ] Response in master's cloned voice
- [ ] Text + voice simultaneously (read along while hearing)
- [ ] Save/export conversation as Q&A document
- [ ] Cite which source each answer comes from (source attribution)
- [ ] "Ask a follow-up" button to continue a thread

---

### 🔬 Knowledge Quality Features

**What's been requested:**
- [ ] Speaker diarization on all multi-speaker content (see above)
- [ ] Mark which chunks came from the master vs others
- [ ] Confidence scoring — flag chunks where transcription quality was poor
- [ ] Manual transcript correction — edit a transcribed chunk directly in the UI
- [ ] Duplicate detection — flag if two sources cover identical content

---

## 📊 Priority Summary

| Feature | Value | Complexity | Priority |
|---|---|---|---|
| Speaker diarization (master voice isolation) | Very High | Medium-High | 🔴 High |
| Voice responses + voice cloning | High | Medium | 🔴 High |
| Photo uploads | Medium | Low-Medium | 🟡 Medium |
| Physical movement analysis — Tier 1 (Vision) | High | Medium | 🟡 Medium |
| DVD/VOB file support | Medium | Low | 🟡 Medium |
| Print-ready PDF export | Medium | Medium-High | 🟡 Medium |
| Print-on-demand integration | Medium | High | 🟢 Later |
| Physical movement analysis — Tier 2 (Pose) | High | High | 🟢 Later |
| ISO disc image support | Low | Medium | 🟢 Later |

---

*Last updated: March 2026*
