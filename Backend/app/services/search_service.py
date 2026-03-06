"""
search_service.py
Manages the Azure AI Search index:
  - create_index_if_not_exists()  → sets up the vector index schema
  - store_chunks()                → saves embedded chunks to the index
  - retrieve_chunks()             → pure vector search (used by chat)
  - retrieve_chunks_hybrid()      → BM25 + vector search (used by quiz)
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


def _get_index_name() -> str:
    return os.getenv("AZURE_SEARCH_INDEX_NAME", "studybuddy-index")


def _get_credential() -> AzureKeyCredential:
    key = os.getenv("AZURE_SEARCH_KEY")
    if not key:
        raise ValueError("AZURE_SEARCH_KEY is not set in .env")
    return AzureKeyCredential(key)


def _get_endpoint() -> str:
    endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
    if not endpoint:
        raise ValueError("AZURE_SEARCH_ENDPOINT is not set in .env")
    return endpoint


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
        SimpleField(name="filename",        type=SearchFieldDataType.String,            filterable=False),
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
):
    """
    Upload embedded chunks to Azure AI Search.
    """
    search_client = SearchClient(
        endpoint=_get_endpoint(),
        index_name=_get_index_name(),
        credential=_get_credential(),
    )

    documents = []
    for chunk_text, embedding in zip(chunks, embeddings):
        documents.append(
            {
                "id":              str(uuid.uuid4()),
                "user_id":         user_id,
                "conversation_id": conversation_id,
                "file_id":         file_id,
                "filename":        filename,
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
    Pure vector search — used by the chat endpoint.
    Returns chunks above the cosine similarity threshold.
    """
    search_client = SearchClient(
        endpoint=_get_endpoint(),
        index_name=_get_index_name(),
        credential=_get_credential(),
    )

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

    Why this solves the basketball/skills problem:
      - "skills" in resume → BM25 finds keyword + vector finds meaning → high RRF → passes ✅
      - "basketball" not in resume → BM25 finds nothing → only weak vector → low RRF → fails ✅

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
                         Setting 0.016 means BOTH signals must contribute.

    Returns:
        List of chunk_text strings that passed the RRF threshold.
        Empty list if topic is unrelated to the documents → caller uses general knowledge.
    """
    search_client = SearchClient(
        endpoint=_get_endpoint(),
        index_name=_get_index_name(),
        credential=_get_credential(),
    )

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=top_k,
        fields="embedding",
    )

    results = search_client.search(
        search_text=topic,              # ← BM25 keyword search on chunk_text
        vector_queries=[vector_query],  # ← vector search on embedding
        filter=f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'",
        select=["chunk_text"],
        top=top_k,
    )

    return [
        r["chunk_text"]
        for r in results
        if r.get("@search.score", 0) >= rrf_threshold
    ]


def conversation_has_documents(user_id: str, conversation_id: str) -> bool:
    """
    Checks whether any document chunks exist for this conversation.
    Used as a hard gate before attempting any vector search.
    Zero embedding calls — pure metadata check.
    """
    search_client = SearchClient(
        endpoint=_get_endpoint(),
        index_name=_get_index_name(),
        credential=_get_credential(),
    )

    results = search_client.search(
        search_text="*",
        filter=f"user_id eq '{user_id}' and conversation_id eq '{conversation_id}'",
        select=["id"],
        top=1,
    )

    for _ in results:
        return True
    return False