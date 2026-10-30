from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI

from app.api.health import router as health_router
from app.api.v1.api import api_router
from app.core.config import Settings
from app.services.live_service import LiveService


def create_app(settings: Settings | None = None) -> FastAPI:
    configuration = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncGenerator[None]:
        if configuration.openai_api_key is None:
            application.state.live_service = LiveService(None, configuration)
            yield
        else:
            # Share the connection pool per application; never retry billed creation.
            async with AsyncOpenAI(
                api_key=configuration.openai_api_key.get_secret_value(),
                timeout=configuration.openai_timeout_seconds,
                max_retries=0,
            ) as client:
                application.state.live_service = LiveService(client, configuration)
                yield

    application = FastAPI(
        title="Voice AI Bot API",
        description="Backend for our GPT-Live voice assistant",
        version="1.0.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[configuration.frontend_origin],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, error: RequestValidationError
    ) -> JSONResponse:
        # FastAPI's default validation response includes the submitted SDP.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {"loc": item["loc"], "msg": item["msg"], "type": item["type"]}
                    for item in error.errors()
                ]
            },
        )

    application.include_router(health_router)
    application.include_router(api_router, prefix="/api/v1")
    return application


app = create_app()
