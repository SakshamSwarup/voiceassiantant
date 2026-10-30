from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/")
async def root() -> dict[str, str]:
    return {"message": "Voice AI backend is running!"}


@router.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
