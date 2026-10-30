import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx2
import pytest
from fastapi.testclient import TestClient
from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
)
from openai.types.live.live_create_response import LiveCreateResponse

from app.core.config import ENV_FILE, Settings
from app.main import create_app
from app.services import live_service
from app.services.live_service import LiveService, LiveServiceError
from conftest import SDP_ANSWER, SDP_OFFER


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"sdp": None},
        {"sdp": 123},
        {"sdp": ""},
        {"sdp": " \r\n "},
        {"sdp": "not an SDP offer"},
        {"sdp": "v=0\r\n"},
        {"sdp": SDP_OFFER.replace("m=audio", "m=video")},
        {"sdp": "x" * 65537},
        {"sdp": SDP_OFFER, "model": "untrusted-model"},
    ],
)
def test_invalid_sdp(
    client: TestClient, sdk_client: MagicMock, body: dict[str, object]
) -> None:
    response = client.post("/api/v1/voice/session", json=body)
    assert response.status_code == 422
    assert all("input" not in error for error in response.json()["detail"])
    sdk_client.live.create.assert_not_called()


def test_missing_body_and_malformed_json(
    client: TestClient, sdk_client: MagicMock
) -> None:
    assert client.post("/api/v1/voice/session").status_code == 422
    response = client.post(
        "/api/v1/voice/session",
        content='{"sdp":',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    sdk_client.live.create.assert_not_called()


def test_success_and_official_sdk_arguments(
    client: TestClient, sdk_client: MagicMock, settings: Settings
) -> None:
    response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == 201
    assert response.json() == {
        "session": {"id": "live_test_123"},
        "transport": {"type": "webrtc", "sdp": SDP_ANSWER},
    }
    sdk_client.live.create.assert_awaited_once()
    kwargs = sdk_client.live.create.call_args.kwargs
    assert set(kwargs) == {"session", "transport"}
    assert kwargs["transport"] == {"type": "webrtc", "sdp": SDP_OFFER}
    assert kwargs["session"]["model"] == settings.openai_live_model
    session = kwargs["session"]
    assert session["input"] == []
    assert session["delegation"]["type"] == "responses"
    delegated = session["delegation"]["responses"]
    assert delegated["model"] == settings.openai_responses_model
    assert delegated["max_output_tokens"] == 150
    assert delegated["reasoning"] == {"effort": "low"}
    assert delegated["text"] == {"verbosity": "low"}
    assert delegated["tools"] == []
    assert delegated["tool_choice"] == "none"
    assert delegated["service_tier"] == "default"
    assert "Answer simple interview" in session["instructions"]
    story = live_service.STORY_FILE.read_text(encoding="utf-8").strip()
    for instructions in (session["instructions"], delegated["instructions"]):
        assert f"<personal_story>\n{story}\n</personal_story>" in instructions
        assert "first person as the user" in instructions
        assert "Never invent personal facts" in instructions
        assert "Bracketed TO FILL entries" in instructions
        assert "this same call" in instructions
        assert "Do not claim to remember other calls" in instructions
        assert instructions.count(story) == 1


def test_delegated_limit_is_configurable(sdk_client: MagicMock) -> None:
    settings = Settings(_env_file=None, openai_responses_max_output_tokens=220)
    asyncio.run(LiveService(sdk_client, settings).create_session(SDP_OFFER))
    assert sdk_client.live.create.call_args.kwargs["session"]["delegation"]["responses"]["max_output_tokens"] == 220


def test_story_is_project_relative() -> None:
    assert live_service.STORY_FILE == (
        Path(live_service.__file__).resolve().parents[1] / "data" / "my_story.md"
    )


def test_story_reloads_for_each_call_without_shared_history(
    client: TestClient,
    sdk_client: MagicMock,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    story = tmp_path / "my_story.md"
    monkeypatch.setattr(live_service, "STORY_FILE", story)
    monkeypatch.chdir(tmp_path)
    for personal_fact in ("first-call-story-private", "second-call-story-private"):
        story.write_text(personal_fact, encoding="utf-8")
        response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
        assert response.status_code == 201
        assert personal_fact not in response.text + caplog.text

    calls = sdk_client.live.create.call_args_list
    assert len(calls) == 2
    for index, personal_fact in enumerate(
        ("first-call-story-private", "second-call-story-private")
    ):
        session = calls[index].kwargs["session"]
        assert session["input"] == []
        assert personal_fact in session["instructions"]
        assert personal_fact in session["delegation"]["responses"]["instructions"]
    assert "first-call-story-private" not in calls[1].kwargs["session"]["instructions"]
    assert calls[0].kwargs["session"]["input"] is not calls[1].kwargs["session"]["input"]


@pytest.mark.parametrize("contents", [None, b"", b" \r\n ", b"\xff"])
def test_invalid_story_is_controlled_before_upstream_creation(
    client: TestClient,
    sdk_client: MagicMock,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    contents: bytes | None,
) -> None:
    story = tmp_path / "my_story.md"
    if contents is not None:
        story.write_bytes(contents)
    monkeypatch.setattr(live_service, "STORY_FILE", story)
    response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == 503
    assert "Personal story" in response.json()["detail"]
    assert str(tmp_path) not in response.text + caplog.text
    sdk_client.live.create.assert_not_called()


def test_unreadable_story_error_is_sanitized(
    client: TestClient,
    sdk_client: MagicMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with patch.object(Path, "read_text", side_effect=PermissionError("private-path-or-content")):
        response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == 503
    assert "private-path-or-content" not in response.text + caplog.text
    sdk_client.live.create.assert_not_called()


@pytest.mark.parametrize("key", [None, "", "   "])
def test_missing_api_key_is_controlled(key: str | None) -> None:
    configuration = Settings(_env_file=None, openai_api_key=key)
    with patch("app.main.AsyncOpenAI") as sdk:
        with TestClient(create_app(configuration)) as client:
            assert client.get("/health").status_code == 200
            response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == 503
    assert response.json() == {"detail": "Voice service is not configured"}
    sdk.assert_not_called()


@pytest.mark.parametrize(
    ("upstream_status", "expected_status"),
    [(400, 502), (401, 503), (403, 503), (404, 503), (429, 503), (500, 502), (503, 502)],
)
def test_upstream_http_failure_is_sanitized(
    client: TestClient,
    sdk_client: MagicMock,
    upstream_status: int,
    expected_status: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sdk_client.live.create.side_effect = APIStatusError(
        "sensitive-upstream-content",
        response=httpx2.Response(
            upstream_status, request=httpx2.Request("POST", "https://api.openai.com")
        ),
        body={"secret": "sensitive-upstream-content"},
    )
    response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == expected_status
    assert "sensitive-upstream-content" not in response.text + caplog.text
    assert SDP_OFFER not in caplog.text
    assert "upstream HTTP" in caplog.text


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (APITimeoutError(request=httpx2.Request("POST", "https://api.openai.com")), 504),
        (APIConnectionError(request=httpx2.Request("POST", "https://api.openai.com")), 502),
        (
            APIError(
                "sensitive-upstream-content",
                request=httpx2.Request("POST", "https://api.openai.com"),
                body=None,
            ),
            502,
        ),
    ],
)
def test_upstream_sdk_failure(
    client: TestClient,
    sdk_client: MagicMock,
    error: APIError,
    expected_status: int,
) -> None:
    sdk_client.live.create.side_effect = error
    response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == expected_status
    assert "sensitive-upstream-content" not in response.text


def test_malformed_upstream_response(client: TestClient, sdk_client: MagicMock) -> None:
    sdk_client.live.create.return_value = LiveCreateResponse.model_construct(
        session={"id": ""}, transport={"type": "webrtc", "sdp": ""}
    )
    response = client.post("/api/v1/voice/session", json={"sdp": SDP_OFFER})
    assert response.status_code == 502
    assert response.json() == {"detail": "Invalid response from voice service"}


def test_service_can_be_used_without_http(settings: Settings) -> None:
    with pytest.raises(LiveServiceError, match="not configured") as error:
        asyncio.run(LiveService(None, settings).create_session(SDP_OFFER))
    assert error.value.status_code == 503


def test_application_manages_client_lifecycle() -> None:
    configured = Settings(_env_file=None, openai_api_key="test-key-not-real")
    with patch("app.main.AsyncOpenAI") as factory:
        client = MagicMock(spec=AsyncOpenAI)
        factory.return_value.__aenter__ = AsyncMock(return_value=client)
        factory.return_value.__aexit__ = AsyncMock(return_value=None)
        with TestClient(create_app(configured)) as test_client:
            assert test_client.get("/health").status_code == 200
        factory.assert_called_once_with(
            api_key="test-key-not-real", timeout=30.0, max_retries=0
        )
        factory.return_value.__aexit__.assert_awaited_once()


def test_settings_are_environment_based_and_secrets_are_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    monkeypatch.setenv("OPENAI_RESPONSES_MODEL", "project-enabled-model")
    configuration = Settings(_env_file=None)
    assert configuration.openai_responses_model == "project-enabled-model"
    assert "test-key-not-real" not in repr(configuration)
    assert ENV_FILE.name == ".env"
    assert ENV_FILE.parent.name == "backend"


def test_real_sdk_serialization_with_mock_transport(settings: Settings) -> None:
    requests: list[httpx2.Request] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(
            201,
            json={
                "session": {"id": "live_mock_transport"},
                "transport": {"type": "webrtc", "sdp": SDP_ANSWER},
            },
        )

    async def create() -> None:
        async with AsyncOpenAI(
            api_key="test-key-not-real",
            base_url="https://openai.invalid/v1",
            max_retries=0,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handle)),
        ) as sdk:
            response = await LiveService(sdk, settings).create_session(SDP_OFFER)
        assert response.session.id == "live_mock_transport"
        assert response.transport.sdp == SDP_ANSWER

    asyncio.run(create())
    assert len(requests) == 1
    assert requests[0].method == "POST"
    assert requests[0].url.path == "/v1/live/sessions"
    body = json.loads(requests[0].content)
    assert body["transport"] == {"type": "webrtc", "sdp": SDP_OFFER}
    assert body["session"]["delegation"]["responses"]["model"] == "gpt-6-luna"
    assert body["session"]["input"] == []
    story = live_service.STORY_FILE.read_text(encoding="utf-8").strip()
    assert story in body["session"]["instructions"]
    assert story in body["session"]["delegation"]["responses"]["instructions"]
    assert body["session"]["delegation"]["responses"]["reasoning"] == {"effort": "low"}
    assert body["session"]["delegation"]["responses"]["max_output_tokens"] == 150
    assert body["session"]["delegation"]["responses"]["tools"] == []
