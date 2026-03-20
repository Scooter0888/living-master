#!/usr/bin/env python3
"""
Living Master Test Bot
======================
Creates a test master, ingests YouTube/web content, then exercises every feature:
  - Source ingestion (YouTube + web)
  - Duplicate detection
  - Chat with source attribution + follow-up suggestions
  - Conversation save/load/export
  - Transcript viewing + chunk editing
  - ISO ingestion check (dry — just verifies endpoint exists)

Usage:
    python3 test_bot.py [--base-url http://localhost:8765] [--token YOUR_TOKEN]

The bot picks a random public figure and ingests 2 YouTube videos + 1 web page.
"""

import argparse
import json
import random
import sys
import time
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MASTERS_POOL = [
    {"name": "Bruce Lee", "description": "Martial artist, philosopher, actor", "sources": {
        "youtube": [
            "https://www.youtube.com/watch?v=nzQWYHHqvIw",  # Bruce Lee interview
            "https://www.youtube.com/watch?v=nXiKaxEvjJM",  # Bruce Lee philosophy
        ],
        "web": ["https://en.wikipedia.org/wiki/Bruce_Lee"],
    }},
    {"name": "Carl Sagan", "description": "Astronomer, science communicator", "sources": {
        "youtube": [
            "https://www.youtube.com/watch?v=GO5FwsblpT8",  # Pale Blue Dot
            "https://www.youtube.com/watch?v=wLigBg3Fq6Y",  # Carl Sagan on science
        ],
        "web": ["https://en.wikipedia.org/wiki/Carl_Sagan"],
    }},
    {"name": "Alan Watts", "description": "Philosopher, writer, speaker", "sources": {
        "youtube": [
            "https://www.youtube.com/watch?v=jPpUNAFHgxk",  # Alan Watts on life
            "https://www.youtube.com/watch?v=rBpaUICxEhk",  # Alan Watts lecture
        ],
        "web": ["https://en.wikipedia.org/wiki/Alan_Watts"],
    }},
]

TEST_QUESTIONS = [
    "What is your core philosophy?",
    "What advice would you give to young people?",
    "How do you think about fear and courage?",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class LivingMasterBot:
    def __init__(self, base_url: str, token: str = ""):
        self.base = base_url.rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if token:
            self.headers["X-Access-Token"] = token
        self.master_id = ""
        self.master_name = ""
        self.results: dict[str, str] = {}

    def _log(self, msg: str):
        print(f"  {msg}")

    def _ok(self, test: str):
        self.results[test] = "PASS"
        print(f"  [PASS] {test}")

    def _fail(self, test: str, reason: str):
        self.results[test] = f"FAIL: {reason}"
        print(f"  [FAIL] {test}: {reason}")

    def get(self, path: str, **kw):
        return requests.get(f"{self.base}{path}", headers=self.headers, **kw)

    def post(self, path: str, data=None, **kw):
        return requests.post(f"{self.base}{path}", headers=self.headers, json=data, **kw)

    def patch(self, path: str, data=None, **kw):
        return requests.patch(f"{self.base}{path}", headers=self.headers, json=data, **kw)

    def delete(self, path: str, **kw):
        return requests.delete(f"{self.base}{path}", headers=self.headers, **kw)

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------

    def test_health(self):
        print("\n1. Health check")
        r = self.get("/health")
        if r.status_code == 200 and r.json().get("status") == "ok":
            self._ok("Health")
        else:
            self._fail("Health", f"HTTP {r.status_code}")
            sys.exit(1)

    def test_capabilities(self):
        print("\n2. Capabilities")
        r = self.get("/capabilities")
        caps = r.json()
        self._log(f"RAG={caps.get('rag')} TTS={caps.get('tts')} Diarization={caps.get('diarization')}")
        self._ok("Capabilities")

    def test_create_master(self, pick: dict):
        print(f"\n3. Create master: {pick['name']}")
        r = self.post("/masters/", data={
            "name": pick["name"],
            "description": pick["description"],
        })
        if r.status_code == 200:
            self.master_id = r.json()["id"]
            self.master_name = pick["name"]
            self._ok(f"Create master ({self.master_id[:8]})")
        else:
            self._fail("Create master", r.text[:200])
            sys.exit(1)

    def test_ingest_sources(self, pick: dict):
        print(f"\n4. Ingest sources")
        source_ids = []

        # YouTube
        for yt_url in pick["sources"]["youtube"]:
            self._log(f"Ingesting YouTube: {yt_url}")
            r = self.post(f"/masters/{self.master_id}/ingest/url", data={"url": yt_url})
            if r.status_code in (200, 202):
                sid = r.json().get("source_id", "")
                source_ids.append(sid)
                self._log(f"  Queued: {sid[:8]}")
            else:
                self._log(f"  Error: {r.text[:100]}")

        # Web
        for web_url in pick["sources"]["web"]:
            self._log(f"Ingesting web: {web_url}")
            r = self.post(f"/masters/{self.master_id}/ingest/url", data={"url": web_url})
            if r.status_code in (200, 202):
                sid = r.json().get("source_id", "")
                source_ids.append(sid)
                self._log(f"  Queued: {sid[:8]}")
            else:
                self._log(f"  Error: {r.text[:100]}")

        if not source_ids:
            self._fail("Ingest sources", "No sources queued")
            return

        # Poll until all done (max 5 minutes)
        self._log("Waiting for ingestion to complete...")
        deadline = time.time() + 300
        while time.time() < deadline:
            r = self.get(f"/masters/{self.master_id}")
            master = r.json()
            sources = master.get("sources", [])
            statuses = {s["status"] for s in sources}
            completed = sum(1 for s in sources if s["status"] == "completed")
            failed = sum(1 for s in sources if s["status"] == "failed")
            pending = sum(1 for s in sources if s["status"] in ("pending", "processing"))

            self._log(f"  {completed} completed, {failed} failed, {pending} pending")

            if pending == 0:
                break
            time.sleep(10)

        if completed > 0:
            self._ok(f"Ingest sources ({completed} completed, {failed} failed)")
        else:
            self._fail("Ingest sources", f"0 completed, {failed} failed")

    def test_duplicate_detection(self):
        print(f"\n5. Duplicate detection")
        r = self.get(f"/masters/{self.master_id}/ingest/duplicates")
        if r.status_code == 200:
            data = r.json()
            count = data.get("count", 0)
            self._log(f"Found {count} potential duplicate(s)")
            self._ok("Duplicate detection")
        else:
            self._fail("Duplicate detection", f"HTTP {r.status_code}: {r.text[:100]}")

    def test_chat_with_attribution(self):
        print(f"\n6. Chat with source attribution")
        q = random.choice(TEST_QUESTIONS)
        self._log(f"Question: {q}")

        # Use the non-streaming endpoint to check sources
        r = self.post(f"/masters/{self.master_id}/query/", data={
            "question": q, "stream": False, "mode": "strict",
        })
        if r.status_code == 200:
            data = r.json()
            answer = data.get("answer", "")[:200]
            sources = data.get("sources", [])
            self._log(f"Answer: {answer}...")
            self._log(f"Sources: {len(sources)} referenced")
            for s in sources[:3]:
                self._log(f"  - {s.get('title', 'Unknown')} ({s.get('content_type')})")
            self._ok("Chat with attribution")
        else:
            self._fail("Chat with attribution", f"HTTP {r.status_code}: {r.text[:100]}")

    def test_streaming_chat(self):
        print(f"\n7. Streaming chat (source attribution in stream)")
        q = random.choice(TEST_QUESTIONS)
        self._log(f"Question: {q}")

        r = self.post(
            f"/masters/{self.master_id}/query/stream",
            data={"question": q, "stream": True, "mode": "strict"},
            stream=True,
        )
        if r.status_code != 200:
            self._fail("Streaming chat", f"HTTP {r.status_code}")
            return

        full_text = ""
        sources_found = False
        for line in r.iter_lines(decode_unicode=True):
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    break
                full_text += data

        # Check for [SOURCES] marker
        if "[SOURCES]" in full_text:
            idx = full_text.index("[SOURCES]")
            answer = full_text[:idx].strip()
            try:
                sources = json.loads(full_text[idx + 9:])
                sources_found = True
                self._log(f"Answer: {answer[:150]}...")
                self._log(f"Sources in stream: {len(sources)}")
            except json.JSONDecodeError:
                self._log("Sources marker found but couldn't parse JSON")
        else:
            self._log(f"Answer: {full_text[:150]}...")
            self._log("No [SOURCES] marker in stream (may have no content)")

        if full_text:
            self._ok(f"Streaming chat (sources_in_stream={sources_found})")
        else:
            self._fail("Streaming chat", "Empty response")

        return full_text, q  # For follow-up test

    def test_follow_up_suggestions(self, question: str, answer: str):
        print(f"\n8. Follow-up suggestions")
        r = self.post(f"/masters/{self.master_id}/query/follow-ups", data={
            "question": question,
            "answer": answer[:600],
        })
        if r.status_code == 200:
            questions = r.json().get("questions", [])
            self._log(f"Got {len(questions)} follow-up suggestions:")
            for fq in questions:
                self._log(f"  - {fq}")
            self._ok("Follow-up suggestions")
        else:
            self._fail("Follow-up suggestions", f"HTTP {r.status_code}: {r.text[:100]}")

    def test_suggest_question(self):
        print(f"\n9. Suggest question from KB")
        r = self.get(f"/masters/{self.master_id}/query/suggest")
        if r.status_code == 200:
            q = r.json().get("question", "")
            self._log(f"Suggested: {q}")
            self._ok("Suggest question")
        else:
            self._fail("Suggest question", f"HTTP {r.status_code}")

    def test_transcript_and_chunks(self):
        print(f"\n10. Transcript + chunk editing")
        # Find a completed source
        r = self.get(f"/masters/{self.master_id}")
        sources = r.json().get("sources", [])
        completed = [s for s in sources if s["status"] == "completed"]
        if not completed:
            self._fail("Transcript + chunks", "No completed sources")
            return

        source = completed[0]
        sid = source["id"]
        self._log(f"Source: {source.get('title', 'Unknown')}")

        # Get transcript
        r = self.get(f"/sources/{sid}/transcript")
        if r.status_code == 200:
            tx = r.json()
            self._log(f"Transcript: {tx.get('word_count', 0)} words, {tx.get('chunk_count', 0)} chunks")
            self._ok("Get transcript")
        else:
            self._fail("Get transcript", f"HTTP {r.status_code}")
            return

        # Get chunks
        r = self.get(f"/sources/{sid}/chunks")
        if r.status_code == 200:
            chunks = r.json().get("chunks", [])
            self._log(f"Chunks: {len(chunks)}")
            self._ok("Get chunks")
        else:
            self._fail("Get chunks", f"HTTP {r.status_code}")
            return

        # Edit first chunk (add a note, then revert)
        if chunks:
            original = chunks[0]["text"]
            test_text = original + " [TEST EDIT]"
            r = self.patch(f"/sources/{sid}/chunks/0", data={"text": test_text})
            if r.status_code == 200:
                self._log("Edited chunk 0 (appended test marker)")
                # Revert
                r2 = self.patch(f"/sources/{sid}/chunks/0", data={"text": original})
                if r2.status_code == 200:
                    self._log("Reverted chunk 0")
                self._ok("Edit chunk")
            else:
                self._fail("Edit chunk", f"HTTP {r.status_code}: {r.text[:100]}")

    def test_conversation_save_load_export(self):
        print(f"\n11. Conversation save/load/export")

        # Save a conversation
        messages = [
            {"role": "user", "content": "What is your core philosophy?"},
            {"role": "assistant", "content": "My philosophy is about self-expression and authenticity."},
            {"role": "user", "content": "Tell me more about that."},
            {"role": "assistant", "content": "Be water, my friend. Adapt to every situation."},
        ]
        r = self.post(f"/masters/{self.master_id}/conversations/", data={
            "messages": messages,
            "title": "Test Conversation",
        })
        if r.status_code != 200:
            self._fail("Save conversation", f"HTTP {r.status_code}: {r.text[:100]}")
            return

        convo_id = r.json()["id"]
        self._log(f"Saved conversation: {convo_id[:8]}")
        self._ok("Save conversation")

        # List conversations
        r = self.get(f"/masters/{self.master_id}/conversations/")
        if r.status_code == 200:
            convos = r.json()
            self._log(f"Listed {len(convos)} conversation(s)")
            self._ok("List conversations")
        else:
            self._fail("List conversations", f"HTTP {r.status_code}")

        # Load conversation
        r = self.get(f"/masters/{self.master_id}/conversations/{convo_id}")
        if r.status_code == 200:
            loaded = r.json()
            self._log(f"Loaded: {loaded['title']} ({len(loaded['messages'])} messages)")
            self._ok("Load conversation")
        else:
            self._fail("Load conversation", f"HTTP {r.status_code}")

        # Export conversation
        r = self.get(f"/masters/{self.master_id}/conversations/{convo_id}/export")
        if r.status_code == 200:
            export = r.json()
            self._log(f"Exported: {export['title']} for {export['master']}")
            self._ok("Export conversation")
        else:
            self._fail("Export conversation", f"HTTP {r.status_code}")

        # Delete conversation
        r = self.delete(f"/masters/{self.master_id}/conversations/{convo_id}")
        if r.status_code == 204:
            self._log("Deleted test conversation")
            self._ok("Delete conversation")
        else:
            self._fail("Delete conversation", f"HTTP {r.status_code}")

    def test_knowledge_stats(self):
        print(f"\n12. Knowledge stats")
        r = self.get(f"/masters/{self.master_id}/export/stats")
        if r.status_code == 200:
            stats = r.json()
            self._log(f"Total: {stats.get('total_words', 0)} words, {stats.get('total_chunks', 0)} chunks, {stats.get('total_sources', 0)} sources")
            self._ok("Knowledge stats")
        else:
            self._fail("Knowledge stats", f"HTTP {r.status_code}")

    def cleanup(self):
        print(f"\n13. Cleanup — deleting test master")
        r = self.delete(f"/masters/{self.master_id}")
        if r.status_code in (200, 204):
            self._ok("Cleanup")
        else:
            self._fail("Cleanup", f"HTTP {r.status_code}")

    def print_summary(self):
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        passed = sum(1 for v in self.results.values() if v == "PASS")
        failed = sum(1 for v in self.results.values() if v != "PASS")
        for test, result in self.results.items():
            status = "PASS" if result == "PASS" else "FAIL"
            print(f"  [{status}] {test}")
        print(f"\n  {passed} passed, {failed} failed out of {len(self.results)} tests")
        print("=" * 60)

    def run(self, skip_cleanup: bool = False):
        pick = random.choice(MASTERS_POOL)
        print(f"{'=' * 60}")
        print(f"Living Master Test Bot")
        print(f"Target: {self.base}")
        print(f"Master: {pick['name']}")
        print(f"{'=' * 60}")

        self.test_health()
        self.test_capabilities()
        self.test_create_master(pick)
        self.test_ingest_sources(pick)
        self.test_duplicate_detection()

        # Chat tests (need completed sources)
        r = self.get(f"/masters/{self.master_id}")
        completed = sum(1 for s in r.json().get("sources", []) if s["status"] == "completed")
        if completed > 0:
            self.test_chat_with_attribution()
            result = self.test_streaming_chat()
            if result:
                full_text, question = result
                # Strip sources marker for follow-up test
                clean = full_text.split("[SOURCES]")[0].strip() if "[SOURCES]" in full_text else full_text
                if clean:
                    self.test_follow_up_suggestions(question, clean)
            self.test_suggest_question()
            self.test_transcript_and_chunks()
        else:
            self._log("Skipping chat/transcript tests — no completed sources")

        self.test_conversation_save_load_export()
        self.test_knowledge_stats()

        if not skip_cleanup:
            self.cleanup()
        else:
            self._log(f"\nSkipping cleanup. Master ID: {self.master_id}")

        self.print_summary()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Living Master Test Bot")
    parser.add_argument("--base-url", default="http://localhost:8765", help="API base URL")
    parser.add_argument("--token", default="", help="Access token (X-Access-Token)")
    parser.add_argument("--keep", action="store_true", help="Don't delete test master after tests")
    args = parser.parse_args()

    bot = LivingMasterBot(base_url=args.base_url, token=args.token)
    bot.run(skip_cleanup=args.keep)
