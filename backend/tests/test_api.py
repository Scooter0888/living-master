"""
API endpoint tests using FastAPI TestClient.
These do NOT require external API keys.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock
import os

# Use in-memory SQLite for tests
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="module")
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_masters_empty(client):
    r = client.get("/masters/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_master(client):
    r = client.post("/masters/", json={"name": "Test Master", "description": "Test"})
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Test Master"
    assert "id" in data


def test_get_master(client):
    # Create first
    create_r = client.post("/masters/", json={"name": "Get Test", "description": None})
    master_id = create_r.json()["id"]

    r = client.get(f"/masters/{master_id}")
    assert r.status_code == 200
    assert r.json()["id"] == master_id
    assert r.json()["name"] == "Get Test"


def test_get_master_not_found(client):
    r = client.get("/masters/nonexistent-id")
    assert r.status_code == 404


def test_update_master(client):
    create_r = client.post("/masters/", json={"name": "Update Test"})
    master_id = create_r.json()["id"]

    r = client.patch(f"/masters/{master_id}", json={"name": "Updated Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated Name"


def test_delete_master(client):
    create_r = client.post("/masters/", json={"name": "Delete Test"})
    master_id = create_r.json()["id"]

    r = client.delete(f"/masters/{master_id}")
    assert r.status_code == 204

    get_r = client.get(f"/masters/{master_id}")
    assert get_r.status_code == 404


def test_ingest_url_invalid_master(client):
    r = client.post(
        "/masters/nonexistent/ingest/url",
        json={"url": "https://example.com"}
    )
    assert r.status_code == 404


def test_ingest_url_queues_job(client):
    create_r = client.post("/masters/", json={"name": "Ingest Test"})
    master_id = create_r.json()["id"]

    with patch("app.routers.ingest.ingest_url", new_callable=AsyncMock) as mock_ingest:
        from app.services.ingestion.base import IngestedContent
        mock_ingest.return_value = IngestedContent(
            text="Test content " * 100,
            title="Test Article",
            content_type="web",
            url="https://example.com",
        )
        with patch("app.services.embeddings.embed_texts", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [[0.1] * 1536]
            with patch("app.services.vector_store.add_documents", new_callable=AsyncMock):
                r = client.post(
                    f"/masters/{master_id}/ingest/url",
                    json={"url": "https://example.com/article"}
                )
                assert r.status_code == 202
                data = r.json()
                assert "source_id" in data
                assert data["status"] == "processing"


def test_ingest_unsupported_file_type(client):
    create_r = client.post("/masters/", json={"name": "File Test"})
    master_id = create_r.json()["id"]

    import io
    r = client.post(
        f"/masters/{master_id}/ingest/file",
        files={"file": ("test.xyz", io.BytesIO(b"content"), "application/octet-stream")},
    )
    assert r.status_code == 400


def test_discover_search_empty_name(client):
    r = client.post("/discover/search", json={"name": "   "})
    assert r.status_code == 400


def test_discover_search_returns_structure(client):
    with patch("app.routers.discover.discover_person", new_callable=AsyncMock) as mock_discover:
        mock_discover.return_value = {
            "name": "Test Person",
            "total_found": 3,
            "categories": [
                {"label": "Interviews", "items": [
                    {"title": "Test Interview", "url": "https://example.com/1", "content_type": "web"}
                ]}
            ]
        }
        r = client.post("/discover/search", json={"name": "Test Person"})
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Test Person"
        assert "categories" in data
