from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.schemas.voice import SessionRequest, SessionResponse
from app.services.live_service import LiveService, LiveServiceError

router = APIRouter()


def get_live_service(request: Request) -> LiveService:
    service: LiveService = request.app.state.live_service
    return service


@router.post(
    "/session",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        502: {"description": "OpenAI connection, request, or response failure"},
        503: {"description": "Missing configuration or personal story, model access, or upstream capacity"},
        504: {"description": "OpenAI timeout"},
    },
)
async def create_session(
    offer: SessionRequest,
    service: Annotated[LiveService, Depends(get_live_service)],
) -> SessionResponse:
    try:
        return await service.create_session(offer.sdp)
    except LiveServiceError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
