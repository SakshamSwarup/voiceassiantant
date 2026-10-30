from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    sdp: str = Field(
        strict=True,
        min_length=1,
        max_length=65536,
        description="Browser WebRTC SDP offer, including an audio media section.",
    )

    @field_validator("sdp")
    @classmethod
    def validate_sdp(cls, value: str) -> str:
        lines = value.splitlines()
        if (
            not lines
            or lines[0] != "v=0"
            or not all(
                any(line.startswith(prefix) and line[len(prefix):].strip() for line in lines)
                for prefix in ("o=", "s=", "t=", "m=audio ")
            )
        ):
            raise ValueError("A WebRTC audio SDP offer is required")
        return value


class SessionMetadata(BaseModel):
    id: str = Field(strict=True, min_length=1)


class WebRTCAnswer(BaseModel):
    type: Literal["webrtc"]
    sdp: str = Field(strict=True, min_length=1)


class SessionResponse(BaseModel):
    session: SessionMetadata
    transport: WebRTCAnswer
