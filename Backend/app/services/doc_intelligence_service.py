"""
doc_intelligence_service.py
Extracts text from documents (PDFs, images, handwriting) using
Azure Document Intelligence prebuilt-read model.
"""

import os
import io
import requests
import fitz          # PyMuPDF
from PIL import Image
from app.services.azure_openai_service import describe_figure
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential

# Feature flag — set ENABLE_FIGURE_VISION=true in .env to activate vision
# descriptions for figures and math images. Set false (or omit) to skip
# all vision API calls and use OCR text only. Zero extra cost when false.
ENABLE_FIGURE_VISION = os.getenv("ENABLE_FIGURE_VISION", "false").strip().lower() == "true"
print(f"[doc_intelligence] Figure vision: {'ENABLED' if ENABLE_FIGURE_VISION else 'DISABLED'}")


_DOC_CLIENT: DocumentIntelligenceClient | None = None

def get_doc_intelligence_client() -> DocumentIntelligenceClient:
    global _DOC_CLIENT
    if _DOC_CLIENT is not None:
        return _DOC_CLIENT
    endpoint = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    key = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY")

    if not endpoint or not key:
        raise ValueError(
            "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY "
            "must be set in .env"
        )
    _DOC_CLIENT = DocumentIntelligenceClient(endpoint=endpoint, credential=AzureKeyCredential(key))
    print("[doc_intelligence] Singleton DocumentIntelligenceClient created")
    return _DOC_CLIENT


def extract_text_from_url(blob_url: str) -> str:
    """
    Extract all text from a document stored in Azure Blob Storage.
    Legacy function kept for backward compatibility.

    Returns:
        Extracted text as a single string (pages joined by newlines).
    """
    client = get_doc_intelligence_client()

    poller = client.begin_analyze_document(
        "prebuilt-read",
        AnalyzeDocumentRequest(url_source=blob_url),
    )
    result = poller.result()

    extracted_pages = []
    if result.pages:
        for page in result.pages:
            page_lines = []
            if page.lines:
                for line in page.lines:
                    page_lines.append(line.content)
            extracted_pages.append("\n".join(page_lines))

    full_text = "\n\n".join(extracted_pages)
    return full_text.strip()


def extract_pages_from_url(blob_url: str) -> list:
    """
    Extract text per page from a document, preserving page boundaries.
    Now uses prebuilt-layout to also detect figures per page.
    For each detected figure, crops the region and sends to GPT-4o-mini
    Vision to generate a text description injected into the page text.

    Memory optimization: instead of rendering ALL pages into PIL images
    upfront (~6.5 MB each = ~228 MB for 35 pages), pages are rendered
    one at a time inside the loop and freed immediately after processing.
    Peak memory: ONE page image (~6.5 MB) instead of all pages (~228 MB).

    Returns:
        List of dicts: [{"page_number": 1, "text": "..."}, ...]
        Pages with no extractable text are omitted.
    """
    client = get_doc_intelligence_client()

    poller = client.begin_analyze_document(
        "prebuilt-layout",                          # ← switched from prebuilt-read
        AnalyzeDocumentRequest(url_source=blob_url),
    )
    result = poller.result()

    # ── Build figure map FIRST ────────────────────────────────────────────────
    # Moved above file download so we know which pages have figures before
    # deciding what to render. Uses only the DI result (already in memory).
    figure_map: dict = {}   # page_number → [polygon, polygon, ...]

    if result.figures:
        for figure in result.figures:
            if not figure.bounding_regions:
                continue
            for region in figure.bounding_regions:
                pg = region.page_number
                figure_map.setdefault(pg, []).append(region.polygon)

    print(f"[doc_intelligence] Pages with figures: {list(figure_map.keys())}")

    # ── Prepare file handle for on-demand page rendering ──────────────────────
    # When ENABLE_FIGURE_VISION=false: skip download entirely (~5-20 MB saved).
    # When ENABLE_FIGURE_VISION=true:  download file, open PDF handle, but
    #   do NOT pre-render pages. Pages are rendered one at a time inside the
    #   per-page loop and freed immediately — peak = ~6.5 MB (one page)
    #   instead of ~228 MB (all 35 pages).
    _pdf_doc = None               # kept open through the loop for on-demand rendering
    _file_ext = ""
    _single_page_img = None       # for image files (only 1 page — always small)

    if ENABLE_FIGURE_VISION:
        try:
            file_response = requests.get(blob_url, timeout=30)
            file_bytes    = file_response.content
            _file_ext     = blob_url.split("?")[0].rsplit(".", 1)[-1].lower()
        except Exception as e:
            print(f"[doc_intelligence] Could not download file for figure cropping: {e}")
            file_bytes = None

        if file_bytes:
            try:
                if _file_ext == "pdf":
                    # Open but do NOT render pages yet — rendering happens lazily below
                    _pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                else:
                    # Single-page image file (JPG, PNG, WEBP, TIFF) — always small
                    _single_page_img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            except Exception as e:
                print(f"[doc_intelligence] File open failed: {e}")

            # Free raw bytes — PyMuPDF copies data internally on fitz.open(),
            # and _single_page_img is already a decoded PIL Image.
            del file_bytes

    def _render_pdf_page(page_num: int) -> Image.Image | None:
        """Render a single PDF page to PIL Image on demand. Returns None if unavailable."""
        if _pdf_doc is None:
            return None
        page_idx = page_num - 1  # 0-based index
        if 0 <= page_idx < len(_pdf_doc):
            pix = _pdf_doc[page_idx].get_pixmap(dpi=150)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            return img
        return None

    # ── Extract text and inject figure descriptions per page ──────────────────
    pages = []

    if result.pages:
        for page in result.pages:
            pg_num = page.page_number
            paragraphs     = []
            current_para   = []

            if page.lines:
                for i, line in enumerate(page.lines):
                    current_para.append(line.content)
                    next_line = page.lines[i + 1] if i + 1 < len(page.lines) else None
                    if next_line is None:
                        paragraphs.append(" ".join(current_para))
                        current_para = []
                    elif (next_line.polygon and line.polygon and
                          next_line.polygon[1] - line.polygon[5] > 5):
                        paragraphs.append(" ".join(current_para))
                        current_para = []

            page_text = "\n\n".join(p for p in paragraphs if p.strip())

            # ── Image file: full-page vision description ─────────────────────
            # Only for image uploads (not PDFs). Uses _single_page_img (page 1).
            if ENABLE_FIGURE_VISION and _file_ext in ("png", "jpg", "jpeg", "webp", "tiff") and _single_page_img and pg_num == 1:
                try:
                    buf = io.BytesIO()
                    _single_page_img.save(buf, format="PNG")
                    full_image_bytes = buf.getvalue()

                    vision_description = describe_figure(full_image_bytes)

                    if vision_description:
                        # Vision description is the PRIMARY text — OCR is supplementary
                        # because OCR garbles math symbols
                        ocr_supplement = f"\n\n[OCR text (may be incomplete for math/diagrams): {page_text}]" if page_text.strip() else ""
                        page_text = f"[Image Content: {vision_description}]{ocr_supplement}"
                        print(f"[doc_intelligence] Image file page {pg_num}: vision description applied ({len(vision_description)} chars)")
                except Exception as e:
                    print(f"[doc_intelligence] Full image vision call failed on page {pg_num}: {e}")
                    # Fall through — use whatever OCR text was extracted

            # ── Figure descriptions for this page ─────────────────────────────
            # Render page on-demand ONLY if it has figures — then free immediately.
            if ENABLE_FIGURE_VISION and pg_num in figure_map:
                # Get the page image: render from PDF on demand, or use _single_page_img for images
                if _pdf_doc:
                    pg_img = _render_pdf_page(pg_num)
                elif _single_page_img and pg_num == 1:
                    pg_img = _single_page_img
                else:
                    pg_img = None

                if pg_img:
                    w, h   = pg_img.size

                    for polygon in figure_map[pg_num]:
                        try:
                            # polygon is a flat list: [x0,y0, x1,y1, x2,y2, x3,y3]
                            # coordinates are in inches — convert using page dimensions
                            # Doc Intelligence gives page width/height in inches too
                            page_w_in = page.width   if page.width  else 8.5
                            page_h_in = page.height  if page.height else 11.0

                            xs = [polygon[i]     * (w / page_w_in) for i in range(0, len(polygon), 2)]
                            ys = [polygon[i + 1] * (h / page_h_in) for i in range(0, len(polygon), 2)]

                            left   = max(0, int(min(xs)) - 8)
                            top    = max(0, int(min(ys)) - 8)
                            right  = min(w, int(max(xs)) + 8)
                            bottom = min(h, int(max(ys)) + 8)

                            if right <= left or bottom <= top:
                                continue

                            cropped = pg_img.crop((left, top, right, bottom))

                            # Convert crop to PNG bytes
                            buf = io.BytesIO()
                            cropped.save(buf, format="PNG")
                            figure_bytes = buf.getvalue()

                            description = describe_figure(figure_bytes)

                            if description:
                                page_text += f"\n\n[Figure: {description}]"
                                print(f"[doc_intelligence] Page {pg_num}: figure described ({len(description)} chars)")

                        except Exception as e:
                            print(f"[doc_intelligence] Figure crop/describe failed on page {pg_num}: {e}")
                            continue

                    # Free this page's rendered image immediately — never accumulate
                    if pg_img is not _single_page_img:
                        del pg_img

            if page_text.strip():
                pages.append({
                    "page_number": pg_num,
                    "text":        page_text.strip(),
                })

    # ── Cleanup ───────────────────────────────────────────────────────────────
    if _pdf_doc:
        _pdf_doc.close()

    return pages