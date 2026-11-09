"""Local booth app. Run with ./start.sh. Listens on this laptop only and needs no internet."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from ai.shapes import CLASSES, decode_drawing, has_ink, normalize
from ai.train import Trainer

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
TEAM_DIR = ROOT / "data" / "team"


def create_app(trainer: Trainer, team_dir: Path = TEAM_DIR) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/")
    def home() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/collect")
    def collect_page() -> FileResponse:
        return FileResponse(WEB_DIR / "collect.html")

    @app.get("/api/ai/events")
    def events() -> StreamingResponse:
        def stream():
            version = -1
            while True:
                state = trainer.wait_for_change(version)
                if state["version"] > version:
                    version = state["version"]
                    yield f"data: {json.dumps(state)}\n\n"
                else:
                    yield ": still here\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.post("/api/ai/drawing")
    async def drawing(request: Request) -> dict:
        # Held in memory only. Student drawings are never written to disk.
        body = await request.body()
        if not body:
            return trainer.set_drawing(None)
        image = _read_png(body)
        return trainer.set_drawing(normalize(image) if has_ink(image) else None)

    @app.post("/api/ai/train")
    def train() -> dict:
        trainer.start()
        return trainer.snapshot()

    @app.post("/api/ai/reset")
    def reset() -> dict:
        return trainer.reset()

    @app.get("/api/collect/counts")
    def collect_counts() -> dict:
        return _counts(team_dir)

    @app.post("/api/collect/{shape}")
    async def collect(shape: str, request: Request) -> dict:
        if shape not in CLASSES:
            raise HTTPException(404, "Unknown shape")
        image = _read_png(await request.body())
        if not has_ink(image):
            raise HTTPException(400, "The drawing is empty")
        folder = team_dir / shape
        folder.mkdir(parents=True, exist_ok=True)
        image.save(folder / f"{uuid.uuid4().hex}.png")
        return _counts(team_dir)

    app.mount("/web", StaticFiles(directory=WEB_DIR), name="web")
    return app


def _read_png(body: bytes):
    try:
        return decode_drawing(body)
    except OSError as error:
        raise HTTPException(400, "Not a readable image") from error


def _counts(team_dir: Path) -> dict:
    return {shape: len(list((team_dir / shape).glob("*.png"))) for shape in CLASSES}


def build_app() -> FastAPI:
    return create_app(Trainer(team_dir=TEAM_DIR))
