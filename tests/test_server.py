import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from ai.train import Trainer
from server import create_app


def png(draw=True) -> bytes:
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    if draw:
        ImageDraw.Draw(canvas).ellipse((40, 40, 216, 216), outline=(20, 38, 63, 255), width=12)
    buffer = io.BytesIO()
    canvas.save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture(scope="module")
def trainer():
    return Trainer(pass_delay=0)


@pytest.fixture
def client(trainer, tmp_path):
    trainer.reset()
    return TestClient(create_app(trainer, team_dir=tmp_path))


@pytest.mark.parametrize(
    "path", ["/", "/collect", "/web/style.css", "/web/app.js", "/web/dev-core.mjs", "/web/race-worker.js", "/web/adding.js", "/web/machine.js", "/web/machine-core.mjs"]
)
def test_pages_and_assets_are_served(client, path):
    assert client.get(path).status_code == 200


def test_drawing_returns_three_percentages(client):
    state = client.post("/api/ai/drawing", content=png()).json()
    assert len(state["probs"]) == 3
    assert abs(sum(state["probs"]) - 1) < 1e-5


@pytest.mark.parametrize("body", [b"", png(draw=False)])
def test_empty_drawing_clears_the_guess(client, body):
    client.post("/api/ai/drawing", content=png())
    assert client.post("/api/ai/drawing", content=body).json()["probs"] is None


def test_bad_image_is_rejected(client):
    assert client.post("/api/ai/drawing", content=b"not a picture").status_code == 400


def test_student_drawing_is_not_saved(client, tmp_path):
    client.post("/api/ai/drawing", content=png())
    assert list(tmp_path.rglob("*.png")) == []


def test_train_then_reset(client, trainer):
    assert client.post("/api/ai/train").json()["status"] in ("training", "trained")
    trainer._thread.join()
    assert client.get("/api/collect/counts").status_code == 200
    state = client.post("/api/ai/reset").json()
    assert state["status"] == "untrained" and state["pass"] == 0


def test_collect_saves_only_valid_team_drawings(client, tmp_path):
    assert client.post("/api/collect/circle", content=png()).json()["circle"] == 1
    assert len(list((tmp_path / "circle").glob("*.png"))) == 1
    assert client.post("/api/collect/circle", content=png(draw=False)).status_code == 400
    assert client.post("/api/collect/star", content=png()).status_code == 404
    assert client.get("/api/collect/counts").json() == {"circle": 1, "square": 0, "triangle": 0}


@pytest.mark.parametrize("path", ["/", "/web/computer.js", "/api/collect/counts"])
def test_browser_always_checks_for_a_newer_copy(client, path):
    response = client.get(path)
    assert response.headers["cache-control"] == "no-cache"


def test_unchanged_files_come_back_as_not_modified(client):
    first = client.get("/web/computer.js")
    again = client.get("/web/computer.js", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
