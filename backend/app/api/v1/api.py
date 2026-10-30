from fastapi import APIRouter

from app.api.v1.routes.voice import router as voice_router

api_router = APIRouter()
api_router.include_router(voice_router, prefix="/voice", tags=["voice"])
