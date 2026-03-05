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

    Uses the prebuilt-read model which handles:
      - Typed PDFs
      - Scanned PDFs
      - Photos of handwritten notes
      - Images (PNG, JPG, TIFF, WEBP)

    Args:
        blob_url: The public (or SAS) URL of the blob to analyse.

    Returns:
        Extracted text as a single string (pages joined by newlines).
    """
    client = get_doc_intelligence_client()

    poller = client.begin_analyze_document(
        "prebuilt-read",
        AnalyzeDocumentRequest(url_source=blob_url),
    )
    result = poller.result()

    # Collect content from all pages
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