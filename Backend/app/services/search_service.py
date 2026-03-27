"""
search_service.py
Manages the Azure AI Search index:
  - create_index_if_not_exists()  → sets up the vector index schema
  - store_chunks()                → saves embedded chunks to the index
  - retrieve_chunks()             → pure vector search (used by regenerate/quiz fallback)
  - retrieve_chunks_hybrid()      → BM25 + vector search (used by quiz generation)
  - retrieve_chunks_smart()       → smart retrieval with page filter + keyword boost (used by chat)
  - conversation_has_documents()  → checks if any docs exist for a conversation
"""

import os
import uuid
from typing import List

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    SearchableField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
)
from azure.search.documents.models import VectorizedQuery


# ── Cached config — read once from env ───────────────────────────────────────
_INDEX_NAME: str | None = None
_ENDPOINT: str | None = None
_CREDENTIAL: AzureKeyCredential | None = None
_SEARCH_CLIENT: SearchClient | None = None

def _get_index_name() -> str:
    global _INDEX_NAME
    if _INDEX_NAME is None:
        _INDEX_NAME = os.getenv("AZURE_SEARCH_INDEX_NAME", "studybuddy-index")
    return _INDEX_NAME


def _get_credential() -> AzureKeyCredential:
    global _CREDENTIAL
    if _CREDENTIAL is None:
        key = os.getenv("AZURE_SEARCH_KEY")
        if not key:
            raise ValueError("AZURE_SEARCH_KEY is not set in .env")
        _CREDENTIAL = AzureKeyCredential(key)
    return _CREDENTIAL


def _get_endpoint() -> str:
    global _ENDPOINT
    if _ENDPOINT is None:
        _ENDPOINT = os.getenv("AZURE_SEARCH_ENDPOINT")
        if not _ENDPOINT:
            raise ValueError("AZURE_SEARCH_ENDPOINT is not set in .env")
    return _ENDPOINT


def _get_search_client() -> SearchClient:
    """Singleton SearchClient — reused across all search/store calls."""
    global _SEARCH_CLIENT
    if _SEARCH_CLIENT is None:
        _SEARCH_CLIENT = SearchClient(
            endpoint=_get_endpoint(),
            index_name=_get_index_name(),
            credential=_get_credential(),
        )
        print("[search_service] Singleton SearchClient created")
    return _SEARCH_CLIENT


def create_index_if_not_exists():
    """
    Create the Azure AI Search index with the correct schema for vector search.
    Safe to call on every startup — does nothing if the index already exists.

    Schema:
      - id              (string, key)
      - user_id         (string, filterable)
      - conversation_id (string, filterable) ← scopes chunks to a single chat session
      - file_id         (string, filterable)
      - filename        (string)
      - page_number     (int32, filterable)  ← NEW: source page number for page filtering
      - chunk_text      (string, searchable)  ← searchable for BM25 keyword matching
      - embedding       (Collection(Single), 3072-dim, HNSW vector)
    """
    index_client = SearchIndexClient(
        endpoint=_get_endpoint(),
        credential=_get_credential(),
    )

    index_name = _get_index_name()

    existing = [idx.name for idx in index_client.list_indexes()]
    if index_name in existing:
        return

    vector_search = VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(name="hnsw-config"),
        ],
        profiles=[
            VectorSearchProfile(name="hnsw-profile", algorithm_configuration_name="hnsw-config"),
        ],
    )

    fields = [
        SimpleField(name="id",              type=SearchFieldDataType.String, key=True,  filterable=True),
        SimpleField(name="user_id",         type=SearchFieldDataType.String,            filterable=True),
        SimpleField(name="conversation_id", type=SearchFieldDataType.String,            filterable=True),
        SimpleField(name="file_id",         type=SearchFieldDataType.String,            filterable=True),
        SimpleField(name="filename",        type=SearchFieldDataType.String,            filterable=True,sortable=True),
        SimpleField(name="page_number",     type=SearchFieldDataType.Int32,             filterable=True,sortable=True),
        SearchableField(name="chunk_text",  type=SearchFieldDataType.String),
        SearchField(
            name="embedding",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=3072,
            vector_search_profile_name="hnsw-profile",
        ),
    ]

    index = SearchIndex(name=index_name, fields=fields, vector_search=vector_search)
    index_client.create_index(index)
    print(f"[Search] Created index: {index_name}")


def store_chunks(
    chunks: List[str],
    embeddings: List[List[float]],
    user_id: str,
    conversation_id: str,
    file_id: str,
    filename: str,
    page_numbers: List[int] = None,
):
    """
    Upload embedded chunks to Azure AI Search.

    Args:
        chunks:       List of text chunk strings.
        embeddings:   Corresponding embedding vectors (same length as chunks).
        user_id:      Scopes chunks to this user.
        conversation_id: Scopes chunks to this conversation.
        file_id:      Unique ID for this upload.
        filename:     Original filename for display.
        page_numbers: Optional list of source page numbers, one per chunk.
                      If None, all chunks get page_number=0.
    """
    search_client = _get_search_client()

    documents = []
    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        documents.append(
            {
                "id":              str(uuid.uuid4()),
                "user_id":         user_id,
                "conversation_id": conversation_id,
                "file_id":         file_id,
                "filename":        filename,
                "page_number":     page_numbers[i] if page_numbers else 0,
                "chunk_text":      chunk_text,
                "embedding":       embedding,
            }
        )

    batch_size = 100
    for i in range(0, len(documents), batch_size):
        batch = documents[i : i + batch_size]
        search_client.upload_documents(documents=batch)

    print(f"[Search] Stored {len(documents)} chunks for file_id={file_id}, conversation_id={conversation_id}")


def retrieve_chunks(
    query_embedding: List[float],
    user_id: str,
    conversation_id: str,
    top_k: int = 5,
    score_threshold: float = 0.75,
) -> List[str]:
    """
    Pure vector search — used by regenerate endpoint and quiz fallback.
    Returns plain chunk text strings above the cosine similarity threshold.
    """
    search_client = _get_search_client()

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="embedding",
    )

    results = search_client.search(
        search_text=None,
        vector_queries=[vector_query],
        filter=f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'",
        select=["chunk_text"],
        top=top_k,
    )

    return [
        r["chunk_text"]
        for r in results
        if r.get("@search.score", 0) >= score_threshold
    ]


def retrieve_chunks_hybrid(
    topic: str,
    query_embedding: List[float],
    user_id: str,
    conversation_id: str,
    top_k: int = 10,
    rrf_threshold: float = 0.016,
) -> List[str]:
    """
    Hybrid search — BM25 keyword + vector, combined via Reciprocal Rank Fusion (RRF).
    Used exclusively by quiz generation.

    How it works:
      - BM25 scores keyword relevance (does the topic word literally appear?)
      - Vector scores semantic relevance (is the meaning related?)
      - Azure fuses both via RRF into a single score (range: ~0.010 to 0.030)

    Args:
        topic:           The quiz topic — used as the BM25 keyword search text.
        query_embedding: 3072-dim embedding of the topic for vector search.
        user_id:         Filter to this user only.
        conversation_id: Filter to this chat session only.
        top_k:           Number of results to fetch.
        rrf_threshold:   Minimum RRF score to keep. Default 0.016 is well-calibrated:
                         - Pure keyword match scores ~0.013
                         - Pure vector match scores ~0.013
                         - Both matching scores ~0.020+

    Returns:
        List of chunk_text strings that passed the RRF threshold.
    """
    search_client = _get_search_client()

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="embedding",
    )

    results = search_client.search(
        search_text=topic,
        vector_queries=[vector_query],
        filter=f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'",
        select=["chunk_text"],
        top=top_k,
    )

    return [
        r["chunk_text"]
        for r in results
        if r.get("@search.score", 0) >= rrf_threshold
    ]


def retrieve_chunks_smart(
    query_embedding: List[float],
    user_id: str,
    conversation_id: str,
    keywords: List[str] = None,
    page_numbers: List[int] = None,
    top_k: int = 7,
    use_hybrid: bool = False,
    filename_filter: str = None, 
) -> list:
    """
    Smart retrieval supporting page filtering and keyword boosting.
    Used by the main chat endpoint.

    - If page_numbers provided: adds OData filter to restrict to those pages only
    - If use_hybrid=True and keywords provided: uses BM25+vector hybrid search
    - Otherwise: pure vector search

    Returns:
        List of (chunk_text, page_number) tuples — NOT plain strings.
        Callers must use _tag_chunks_with_pages() to convert before sending to Gemini.
    """
    search_client = _get_search_client()

    # Build filter — always scope to user + conversation, optionally add page filter
    base_filter = f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'"
    if filename_filter:
        base_filter += f" and filename eq '{filename_filter}'"
    if page_numbers:
        page_filter = " or ".join([f"page_number eq {p}" for p in page_numbers])
        combined_filter = f"({base_filter}) and ({page_filter})"
    else:
        combined_filter = base_filter

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="embedding",
    )

    # Use hybrid if keywords provided, else pure vector
    search_text = " ".join(keywords) if (use_hybrid and keywords) else None

    results = search_client.search(
        search_text=search_text,
        vector_queries=[vector_query],
        filter=combined_filter,
        select=["chunk_text", "page_number", "filename"],
        top=top_k,
    )

    return [(r["chunk_text"], r.get("page_number", 0), r.get("filename", ""), r.get("@search.score", 0)) for r in results]


def conversation_has_documents(user_id: str, conversation_id: str) -> bool:
    """
    Checks whether any document chunks exist for this conversation.
    Used as a hard gate before attempting any vector search.
    Zero embedding calls — pure metadata check.
    """
    search_client = _get_search_client()

    results = search_client.search(
        search_text="*",
        filter=f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'",
        select=["id"],
        top=1,
    )

    for _ in results:
        return True
    return False

def get_conversation_filenames(user_id: str, conversation_id: str) -> list:
    """
    Returns ordered list of unique filenames uploaded to this conversation.
    Order matches upload sequence — used to resolve 'document 1', 'document 2'.
    """
    search_client = _get_search_client()
    results = search_client.search(
        search_text="*",
        filter=f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'",
        select=["filename"],
        top=100,
    )
    seen = []
    for r in results:
        fname = r.get("filename", "")
        if fname and fname not in seen:
            seen.append(fname)
    return seen

def retrieve_all_chunks_ordered(
    user_id: str,
    conversation_id: str,
    filename_filter: str = None,
) -> list:
    """
    Fetches ALL chunks for a conversation sorted by filename then page_number.
    Used when scope=document — no vector search, no embedding, no top_k cap.
    Returns list of (chunk_text, page_number, filename) tuples — same shape
    as retrieve_chunks_smart() so callers don't need to change anything.
    """
    search_client = _get_search_client()

    base_filter = f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'"
    if filename_filter:
        base_filter += f" and filename eq '{filename_filter}'"

    results = search_client.search(
        search_text="*",
        filter=base_filter,
        select=["chunk_text", "page_number", "filename"],
        top=1000,
    )

    chunks = [
        (r["chunk_text"], r.get("page_number", 0), r.get("filename", ""))
        for r in results
    ]

    # Sort by filename then page_number in Python — no Azure sortable field needed
    chunks.sort(key=lambda x: (x[2], x[1]))
    return chunks