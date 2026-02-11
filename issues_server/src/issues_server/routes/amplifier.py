"""Amplifier session endpoints for the issues server API."""

from fastapi import APIRouter, Depends, HTTPException, Response

from ..amplifier import AmplifierManager
from ..deps import get_amplifier_manager, get_ws_manager
from ..models import AmplifierSessionInfo
from ..storage import ProjectStorage
from ..ws import WebSocketManager
from .projects import get_project_storage

router = APIRouter(tags=["amplifier"])


@router.post("/projects/{name}/issues/{number}/amplifier", status_code=202)
async def start_amplifier_session(
    name: str,
    number: int,
    storage: ProjectStorage = Depends(get_project_storage),
    amplifier_manager: AmplifierManager = Depends(get_amplifier_manager),
    ws_manager: WebSocketManager = Depends(get_ws_manager),
) -> dict[str, str]:
    """Start an Amplifier session for an issue."""
    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    try:
        await amplifier_manager.run(name, number, issue, storage, ws_manager)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"status": "started"}


@router.get("/projects/{name}/issues/{number}/amplifier")
async def get_amplifier_status(
    name: str,
    number: int,
    amplifier_manager: AmplifierManager = Depends(get_amplifier_manager),
) -> AmplifierSessionInfo:
    """Get the status of an Amplifier session for an issue."""
    info = amplifier_manager.get_status(name, number)
    if info is None:
        raise HTTPException(
            status_code=404,
            detail=f"No Amplifier session for issue #{number}",
        )
    return info


@router.delete("/projects/{name}/issues/{number}/amplifier", status_code=204)
async def cancel_amplifier_session(
    name: str,
    number: int,
    amplifier_manager: AmplifierManager = Depends(get_amplifier_manager),
) -> Response:
    """Cancel a running Amplifier session."""
    cancelled = amplifier_manager.cancel(name, number)
    if not cancelled:
        raise HTTPException(
            status_code=404,
            detail=f"No running Amplifier session for issue #{number}",
        )
    return Response(status_code=204)


@router.get("/amplifier/sessions")
async def list_amplifier_sessions(
    amplifier_manager: AmplifierManager = Depends(get_amplifier_manager),
) -> list[AmplifierSessionInfo]:
    """List all tracked Amplifier sessions."""
    return amplifier_manager.list_sessions()
