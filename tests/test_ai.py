import io

import numpy as np
import pytest
import torch
from PIL import Image, ImageDraw

from ai.model import ShapeNet, to_batch
from ai.shapes import CLASSES, IMAGE_SIZE, decode_drawing, generate, generate_dataset, has_ink, load_team_drawings, normalize
from ai.train import END_RATE, PASSES, PEAK_RATE, START_RATE, Trainer, learning_rate


@pytest.mark.parametrize("shape", CLASSES)
def test_generated_shape_is_normalized_and_has_ink(shape):
    image = generate(shape, np.random.default_rng(1))
    assert image.shape == (IMAGE_SIZE, IMAGE_SIZE)
    assert 0 <= image.min() and image.max() <= 1
    assert image.max() > 0.5


def test_generate_rejects_unknown_shape():
    with pytest.raises(ValueError):
        generate("star", np.random.default_rng(1))


def test_dataset_is_balanced():
    _, labels = generate_dataset(30, np.random.default_rng(1))
    assert np.bincount(labels).tolist() == [10, 10, 10]


def test_normalize_centres_a_shape_drawn_in_a_corner():
    image = Image.new("L", (200, 200), 0)
    ImageDraw.Draw(image).rectangle((5, 5, 40, 40), outline=255, width=4)
    rows, cols = np.nonzero(normalize(image))
    assert abs(rows.mean() - (IMAGE_SIZE - 1) / 2) < 1.5
    assert abs(cols.mean() - (IMAGE_SIZE - 1) / 2) < 1.5


def test_normalize_blank_image_is_all_zero():
    assert normalize(Image.new("L", (64, 64), 0)).sum() == 0


def test_decode_drawing_turns_dark_ink_on_transparent_into_bright_ink():
    canvas = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).line((10, 10, 50, 50), fill=(20, 30, 60, 255), width=5)
    buffer = io.BytesIO()
    canvas.save(buffer, "PNG")
    decoded = decode_drawing(buffer.getvalue())
    assert has_ink(decoded)
    assert np.asarray(decoded)[0, 63] == 0
    assert np.asarray(decoded)[30, 30] > 150


def test_team_drawings_split_without_overlap(tmp_path):
    (tmp_path / "circle").mkdir()
    for number in range(20):
        Image.new("L", (32, 32), 255).save(tmp_path / "circle" / f"{number}.png")
    train, _ = load_team_drawings(tmp_path, "train")
    holdout, _ = load_team_drawings(tmp_path, "holdout")
    everything, _ = load_team_drawings(tmp_path, "all")
    assert len(train) + len(holdout) == len(everything) == 20
    assert len(holdout) > 0


def test_model_output_shape():
    output = ShapeNet()(to_batch(np.zeros((4, IMAGE_SIZE, IMAGE_SIZE))))
    assert output.shape == (4, len(CLASSES))


@pytest.fixture(scope="module")
def trainer():
    return Trainer(pass_delay=0)


def test_untrained_model_is_undecided(trainer):
    trainer.reset()
    state = trainer.set_drawing(generate("circle", np.random.default_rng(3)))
    assert all(abs(p - 1 / 3) < 0.03 for p in state["probs"])
    assert state["status"] == "untrained"


def test_training_lifts_accuracy_and_the_drawings_percentage(trainer):
    trainer.reset()
    page = Image.new("L", (256, 256), 0)
    ImageDraw.Draw(page).ellipse((40, 40, 216, 216), outline=255, width=12)
    before = trainer.set_drawing(normalize(page))
    assert trainer.start()
    trainer._thread.join()
    after = trainer.snapshot()
    assert after["status"] == "trained"
    assert after["pass"] == PASSES
    assert len(after["history"]) == PASSES
    assert after["accuracy"] > 0.9
    assert after["probs"][0] > before["probs"][0] and after["probs"][0] > 0.8
    assert after["samples"]


def test_start_twice_does_not_restart(trainer):
    trainer.reset()
    assert trainer.start()
    assert not trainer.start()
    trainer._thread.join()
    assert not trainer.start()


def test_reset_always_returns_an_untrained_model(trainer):
    trainer.set_drawing(generate("square", np.random.default_rng(5)))
    for _ in range(20):
        trainer.start()
        state = trainer.reset()
        assert state["status"] == "untrained"
        assert state["pass"] == 0
        assert state["history"] == []
        # Accuracy can land above 33% by chance, so check the model is actually undecided.
        assert all(abs(p - 1 / 3) < 0.03 for p in state["probs"])


def test_reset_gives_different_weights(trainer):
    trainer.reset()
    first = next(trainer.model.parameters()).detach().clone()
    trainer.reset()
    assert not torch.equal(first, next(trainer.model.parameters()))


def test_wait_for_change_returns_after_a_new_drawing(trainer):
    version = trainer.snapshot()["version"]
    trainer.set_drawing(None)
    assert trainer.wait_for_change(version, timeout=1)["version"] > version


def test_learning_rate_starts_low_peaks_then_cools():
    rates = [learning_rate(number) for number in range(1, PASSES + 1)]
    assert abs(rates[0] - START_RATE) < 1e-9
    assert abs(rates[-1] - END_RATE) < 1e-9
    assert START_RATE < max(rates) <= PEAK_RATE
    peak = rates.index(max(rates))
    assert 0 < peak < PASSES - 1
