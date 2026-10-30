from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
        hide_input_in_errors=True,
    )

    openai_api_key: SecretStr | None = None
    openai_live_model: str = Field(default="gpt-live-1", min_length=1)
    openai_responses_model: str = Field(default="gpt-6-luna", min_length=1)
    openai_responses_max_output_tokens: int = Field(default=150, ge=16, le=4096)
    openai_timeout_seconds: float = Field(default=30.0, gt=0, le=120)
    frontend_origin: str = "http://localhost:5173"

    @field_validator("openai_api_key", mode="before")
    @classmethod
    def normalize_api_key(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("openai_live_model", "openai_responses_model", "frontend_origin")
    @classmethod
    def reject_blank_configuration(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Configuration must not be blank")
        return value
