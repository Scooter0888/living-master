"""
PDF and DOCX ingestion.
"""
import os
import asyncio
from app.services.ingestion.base import IngestedContent


async def ingest_pdf(file_path: str, original_filename: str) -> IngestedContent:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"PDF not found: {file_path}")

    loop = asyncio.get_event_loop()

    def _extract():
        import pdfplumber
        pages = []
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text.strip())
        return "\n\n".join(pages)

    text = await loop.run_in_executor(None, _extract)

    if not text.strip():
        raise ValueError(f"Could not extract text from PDF: {original_filename}")

    title = os.path.splitext(original_filename)[0]
    return IngestedContent(
        text=text,
        title=title,
        content_type="pdf",
        metadata={"filename": original_filename, "page_count": text.count("\n\n") + 1},
    )


async def ingest_docx(file_path: str, original_filename: str) -> IngestedContent:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"DOCX not found: {file_path}")

    loop = asyncio.get_event_loop()

    def _extract():
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)

    text = await loop.run_in_executor(None, _extract)

    if not text.strip():
        raise ValueError(f"Could not extract text from DOCX: {original_filename}")

    title = os.path.splitext(original_filename)[0]
    return IngestedContent(
        text=text,
        title=title,
        content_type="docx",
        metadata={"filename": original_filename},
    )
