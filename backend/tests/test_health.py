import pytest
from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Voice AI backend is running!"}


def test_docs_and_registered_routes(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert set(schema["paths"]) == {"/", "/health", "/api/v1/voice/session"}
    operation = schema["paths"]["/api/v1/voice/session"]["post"]
    assert "201" in operation["responses"]
    assert operation["requestBody"]["required"] is True


@pytest.mark.parametrize(
    "origin",
    [
        "https://voiceaiassiantant.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
)
def test_frontend_cors(client: TestClient, origin: str) -> None:
    response = client.options(
        "/api/v1/voice/session",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert {"POST", "OPTIONS"} <= set(
        response.headers["access-control-allow-methods"].split(", ")
    )
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers


def test_unlisted_origin_is_not_allowed(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "https://untrusted.example"})
    assert "access-control-allow-origin" not in response.headers
