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


def get_doc_intelligence_client() -> DocumentIntelligenceClient:
    endpoint = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    key = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY")

    if not endpoint or not key:
        raise ValueError(
            "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY "
            "must be set in .env"
        )
    return DocumentIntelligenceClient(endpoint=endpoint, credential=AzureKeyCredential(key))


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

    # ── Download raw file bytes once (needed for figure cropping) ─────────────
    try:
        file_response = requests.get(blob_url, timeout=30)
        file_bytes    = file_response.content
        file_ext      = blob_url.split("?")[0].rsplit(".", 1)[-1].lower()
    except Exception as e:
        print(f"[doc_intelligence] Could not download file for figure cropping: {e}")
        file_bytes = None
        file_ext   = ""

    # ── Build per-page pixel images for figure cropping ───────────────────────
    # key = 1-based page number, value = PIL Image of that page
    page_images: dict = {}

    if file_bytes:
        try:
            if file_ext == "pdf":
                pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                for page_idx in range(len(pdf_doc)):
                    pix = pdf_doc[page_idx].get_pixmap(dpi=150)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    page_images[page_idx + 1] = img   # 1-based
            else:
                # Single-page image file (JPG, PNG, WEBP, TIFF)
                img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
                page_images[1] = img
        except Exception as e:
            print(f"[doc_intelligence] Page image render failed: {e}")

    # ── Build a map: page_number → list of figure bounding boxes ──────────────
    # prebuilt-layout returns result.figures with bounding_regions per figure.
    # Each region has page_number + polygon (normalised 0-1 coordinates).
    figure_map: dict = {}   # page_number → [polygon, polygon, ...]

    if result.figures:
        for figure in result.figures:
            if not figure.bounding_regions:
                continue
            for region in figure.bounding_regions:
                pg = region.page_number
                figure_map.setdefault(pg, []).append(region.polygon)

    print(f"[doc_intelligence] Pages with figures: {list(figure_map.keys())}")

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

            if ENABLE_FIGURE_VISION and file_ext in ("png", "jpg", "jpeg", "webp", "tiff") and pg_num in page_images:
                try:
                    full_page_img = page_images[pg_num]
                    buf = io.BytesIO()
                    full_page_img.save(buf, format="PNG")
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
            if ENABLE_FIGURE_VISION and pg_num in figure_map and pg_num in page_images:
                pg_img = page_images[pg_num]
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

            if page_text.strip():
                pages.append({
                    "page_number": pg_num,
                    "text":        page_text.strip(),
                })

    return pages