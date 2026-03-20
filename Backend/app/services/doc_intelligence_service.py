"""
doc_intelligence_service.py
Extracts text from documents (PDFs, images, handwriting) using
Azure Document Intelligence prebuilt-read model.
"""

import os
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential


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

    Uses polygon coordinate gaps between lines to detect paragraph boundaries
    within each page. Returns a list of dicts so downstream chunking can
    respect page borders and tag each chunk with its source page number.

    Args:
        blob_url: The public (or SAS) URL of the blob to analyse.

    Returns:
        List of dicts: [{"page_number": 1, "text": "..."}, ...]
        Pages with no extractable text are omitted.
    """
    client = get_doc_intelligence_client()

    poller = client.begin_analyze_document(
        "prebuilt-read",
        AnalyzeDocumentRequest(url_source=blob_url),
    )
    result = poller.result()

    pages = []
    if result.pages:
        for page in result.pages:
            paragraphs = []
            current_paragraph = []

            if page.lines:
                for i, line in enumerate(page.lines):
                    current_paragraph.append(line.content)
                    next_line = page.lines[i + 1] if i + 1 < len(page.lines) else None
                    if next_line is None:
                        paragraphs.append(" ".join(current_paragraph))
                        current_paragraph = []
                    elif (next_line.polygon and line.polygon and
                          next_line.polygon[1] - line.polygon[5] > 5):
                        # gap between lines is large → new paragraph
                        paragraphs.append(" ".join(current_paragraph))
                        current_paragraph = []

            page_text = "\n\n".join(p for p in paragraphs if p.strip())
            if page_text.strip():
                pages.append({
                    "page_number": page.page_number,
                    "text": page_text.strip(),
                })

    return pages