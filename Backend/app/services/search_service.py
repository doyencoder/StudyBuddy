"""
search_service.py
Manages the Azure AI Search index:
  - create_index_if_not_exists()  → sets up the vector index schema
  - store_chunks()                → saves embedded chunks to the index
  - retrieve_chunks()             → vector searches for top-k relevant chunks
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
      - id         (string, key)
      - user_id    (string, filterable)
      - file_id    (string, filterable)
      - filename   (string)
      - chunk_text (string, searchable)
      - embedding  (Collection(Single), 768-dim, HNSW vector)
    """
    index_client = SearchIndexClient(
        endpoint=_get_endpoint(),
        credential=_get_credential(),
    )

    index_name = _get_index_name()

    # Check if already exists
    existing = [idx.name for idx in index_client.list_indexes()]
    if index_name in existing:
        return  # Already created

    vector_search = VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(name="hnsw-config"),
        ],
        profiles=[
            VectorSearchProfile(name="hnsw-profile", algorithm_configuration_name="hnsw-config"),
        ],
    )

    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True, filterable=True),
        SimpleField(name="user_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="file_id", type=SearchFieldDataType.String, filterable=True),
        SimpleField(name="filename", type=SearchFieldDataType.String, filterable=False),
        SearchableField(name="chunk_text", type=SearchFieldDataType.String),
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
    file_id: str,
    filename: str,
):
    """
    Upload embedded chunks to Azure AI Search.

    Args:
        chunks:     List of text chunk strings.
        embeddings: Parallel list of 768-dim embedding vectors.
        user_id:    Owner of the document.
        file_id:    Unique ID of the uploaded file.
        filename:   Original file name.
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
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "file_id": file_id,
                "filename": filename,
                "chunk_text": chunk_text,
                "embedding": embedding,
            }
        )

    # Upload in batches of 100 (Azure Search limit per request)
    batch_size = 100
    for i in range(0, len(documents), batch_size):
        batch = documents[i : i + batch_size]
        search_client.upload_documents(documents=batch)

    print(f"[Search] Stored {len(documents)} chunks for file_id={file_id}")


def retrieve_chunks(query_embedding: List[float], user_id: str, top_k: int = 5) -> List[str]:
    """
    Vector search: find the top-k most relevant chunks for a user's query.

    Args:
        query_embedding: 768-dim embedding of the user's question.
        user_id:         Filter results to only this user's documents.
        top_k:           Number of chunks to return (default 5).

    Returns:
        List of chunk_text strings, most relevant first.
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
        filter=f"user_id eq '{user_id}'",
        select=["chunk_text"],
        top=top_k,
    )

    return [r["chunk_text"] for r in results]