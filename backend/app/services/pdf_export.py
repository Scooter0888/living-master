"""
ReportLab-based PDF book export.
Parses Markdown headings, paragraphs, blockquotes → ReportLab Flowables.
Optionally embeds photos at chapter boundaries.
"""
import io
import re
from typing import Optional


# Page size: 6×9 inch trade paperback
PAGE_WIDTH = 6 * 72   # 432 pts
PAGE_HEIGHT = 9 * 72  # 648 pts

# Margins (in points)
MARGIN_TOP = 72
MARGIN_BOTTOM = 72
MARGIN_INNER = 1.0625 * 72   # ~76.5 pts (binding side)
MARGIN_OUTER = 0.875 * 72    # ~63 pts


def generate_pdf(
    title: str,
    author: str,
    content_md: str,
    photo_paths: Optional[list[dict]] = None,
) -> bytes:
    """
    Generate a print-ready PDF from Markdown content.
    photo_paths: list of {path: str, caption: str}
    Returns raw PDF bytes.
    """
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Image,
        PageBreak, HRFlowable, KeepTogether,
    )
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate
    from reportlab.lib.pagesizes import portrait

    buf = io.BytesIO()

    doc = SimpleDocTemplate(
        buf,
        pagesize=(PAGE_WIDTH, PAGE_HEIGHT),
        leftMargin=MARGIN_INNER,
        rightMargin=MARGIN_OUTER,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title=title,
        author=author,
    )

    styles = getSampleStyleSheet()
    accent = HexColor("#6366f1")
    dark = HexColor("#1a1a2e")

    # Custom styles
    h1_style = ParagraphStyle(
        "BookH1",
        fontName="Times-Bold",
        fontSize=22,
        leading=28,
        textColor=dark,
        spaceAfter=16,
        spaceBefore=24,
        alignment=TA_LEFT,
    )
    h2_style = ParagraphStyle(
        "BookH2",
        fontName="Times-Bold",
        fontSize=16,
        leading=22,
        textColor=dark,
        spaceAfter=10,
        spaceBefore=28,
        borderPadding=(0, 0, 6, 0),
    )
    h3_style = ParagraphStyle(
        "BookH3",
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=dark,
        spaceAfter=8,
        spaceBefore=16,
    )
    body_style = ParagraphStyle(
        "BookBody",
        fontName="Times-Roman",
        fontSize=11,
        leading=17,
        textColor=HexColor("#1f1f1f"),
        spaceAfter=8,
        alignment=TA_JUSTIFY,
        firstLineIndent=18,
    )
    quote_style = ParagraphStyle(
        "BookQuote",
        fontName="Times-Italic",
        fontSize=11,
        leading=17,
        textColor=HexColor("#444466"),
        leftIndent=24,
        rightIndent=12,
        spaceAfter=10,
        spaceBefore=10,
        borderWidth=2,
        borderColor=accent,
        borderPadding=(0, 0, 0, 12),
        borderRadius=2,
    )
    caption_style = ParagraphStyle(
        "PhotoCaption",
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=HexColor("#666666"),
        alignment=TA_CENTER,
        spaceAfter=12,
    )

    flowables = []

    # ─── Title page ───
    flowables.append(Spacer(1, 80))
    flowables.append(Paragraph(_escape(title), ParagraphStyle(
        "TitlePage",
        fontName="Times-Bold",
        fontSize=28,
        leading=36,
        textColor=dark,
        alignment=TA_CENTER,
        spaceAfter=20,
    )))
    if author:
        flowables.append(Paragraph(f"by {_escape(author)}", ParagraphStyle(
            "AuthorPage",
            fontName="Times-Italic",
            fontSize=14,
            leading=20,
            textColor=HexColor("#555555"),
            alignment=TA_CENTER,
        )))
    flowables.append(PageBreak())

    # ─── Parse markdown content ───
    photo_index = 0
    photo_paths = photo_paths or []
    lines = content_md.split("\n")
    i = 0
    chapter_count = 0

    while i < len(lines):
        line = lines[i]

        if line.startswith("# "):
            text = _inline_md(_escape(line[2:].strip()))
            flowables.append(Paragraph(text, h1_style))

        elif line.startswith("## "):
            text = _inline_md(_escape(line[3:].strip()))
            chapter_count += 1
            # Insert photo before new chapter (if available)
            if chapter_count > 1 and photo_index < len(photo_paths):
                ph = photo_paths[photo_index]
                photo_index += 1
                try:
                    from reportlab.platypus import Image as RLImage
                    img = _make_image(ph["path"])
                    if img:
                        flowables.append(Spacer(1, 12))
                        flowables.append(img)
                        if ph.get("caption"):
                            flowables.append(Paragraph(_escape(ph["caption"]), caption_style))
                        flowables.append(Spacer(1, 8))
                except Exception:
                    pass
            flowables.append(Paragraph(text, h2_style))
            flowables.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#ddddee")))

        elif line.startswith("### "):
            text = _inline_md(_escape(line[4:].strip()))
            flowables.append(Paragraph(text, h3_style))

        elif line.startswith("> "):
            text = _inline_md(_escape(line[2:].strip()))
            flowables.append(Paragraph(text, quote_style))

        elif line.startswith("- ") or line.startswith("* "):
            text = "• " + _inline_md(_escape(line[2:].strip()))
            bullet_style = ParagraphStyle(
                "Bullet",
                parent=body_style,
                leftIndent=18,
                firstLineIndent=0,
            )
            flowables.append(Paragraph(text, bullet_style))

        elif line.strip() == "":
            flowables.append(Spacer(1, 4))

        elif line.strip() == "---":
            flowables.append(HRFlowable(width="60%", thickness=1, color=HexColor("#ccccdd"), spaceAfter=12, spaceBefore=12))

        else:
            text = _inline_md(_escape(line.strip()))
            if text:
                flowables.append(Paragraph(text, body_style))

        i += 1

    # Append any remaining photos at the end
    while photo_index < len(photo_paths):
        ph = photo_paths[photo_index]
        photo_index += 1
        try:
            img = _make_image(ph["path"])
            if img:
                flowables.append(Spacer(1, 16))
                flowables.append(img)
                if ph.get("caption"):
                    flowables.append(Paragraph(_escape(ph["caption"]), caption_style))
        except Exception:
            pass

    doc.build(flowables)
    return buf.getvalue()


def _escape(text: str) -> str:
    """Escape ReportLab special chars."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _inline_md(text: str) -> str:
    """Convert **bold** and *italic* to ReportLab XML tags."""
    # Bold: **text**
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    # Italic: *text*
    text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
    return text


def _make_image(path: str):
    """Return a ReportLab Image flowable scaled to fit page width."""
    from reportlab.platypus import Image as RLImage
    import os

    if not os.path.exists(path):
        return None

    max_w = PAGE_WIDTH - MARGIN_INNER - MARGIN_OUTER - 12
    max_h = PAGE_HEIGHT * 0.45

    img = RLImage(path)
    orig_w, orig_h = img.imageWidth, img.imageHeight
    if orig_w == 0 or orig_h == 0:
        return None

    scale = min(max_w / orig_w, max_h / orig_h, 1.0)
    img.drawWidth = orig_w * scale
    img.drawHeight = orig_h * scale
    img.hAlign = "CENTER"
    return img
