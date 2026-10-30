from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI
from openai.types.live.live_create_response import LiveCreateResponse

from app.api.v1.routes.voice import get_live_service
from app.core.config import Settings
from app.main import create_app
from app.services.live_service import LiveService

SDP_OFFER = (
    "v=0\r\n"
    "o=- 123 1 IN IP4 127.0.0.1\r\n"
    "s=-\r\n"
    "t=0 0\r\n"
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    "a=rtpmap:111 opus/48000/2\r\n"
)
SDP_ANSWER = SDP_OFFER.replace("o=- 123", "o=- 456")


@pytest.fixture(autouse=True)
def isolate_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in Settings.model_fields:
        monkeypatch.delenv(key.upper(), raising=False)


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, openai_api_key=None)


@pytest.fixture
def sdk_client() -> MagicMock:
    client = MagicMock(spec=AsyncOpenAI)
    client.live = MagicMock()
    client.live.create = AsyncMock(
        return_value=LiveCreateResponse.model_validate(
            {
                "session": {"id": "live_test_123"},
                "transport": {"type": "webrtc", "sdp": SDP_ANSWER},
            }
        )
    )
    return client


@pytest.fixture
def service(sdk_client: MagicMock, settings: Settings) -> LiveService:
    return LiveService(sdk_client, settings)


@pytest.fixture
def client(settings: Settings, service: LiveService) -> Iterator[TestClient]:
    application = create_app(settings)
    application.dependency_overrides[get_live_service] = lambda: service
    with TestClient(application) as test_client:
        yield test_client
