"""Train once and report how well the model reads real drawings kept out of training.

Run from the booth folder:  .venv/bin/python -m ai.evaluate
"""

from __future__ import annotations

import time
from pathlib import Path

import torch

from .model import to_batch
from .shapes import CLASSES, load_team_drawings
from .train import Trainer

TEAM_DIR = Path(__file__).resolve().parent.parent / "data" / "team"


def main() -> None:
    started = time.monotonic()
    trainer = Trainer(team_dir=TEAM_DIR, pass_delay=0)
    setup = time.monotonic() - started
    start_accuracy = trainer.snapshot()["accuracy"]

    started = time.monotonic()
    trainer.start()
    trainer._thread.join()
    state = trainer.snapshot()
    print(f"setup {setup:.1f}s, training {time.monotonic() - started:.1f}s")
    print(f"generated test shapes: {start_accuracy:.0%} before, {state['accuracy']:.0%} after")
    print("by pass:", " ".join(f"{value:.0%}" for value in state["history"]))

    images, labels = load_team_drawings(TEAM_DIR, "holdout")
    if not len(images):
        print("No team drawings held out yet. Collect some at /collect first.")
        return

    trainer.model.eval()
    with torch.no_grad():
        guesses = trainer.model(to_batch(images)).argmax(dim=1).numpy()
    print(f"team drawings held out: {(guesses == labels).mean():.0%} of {len(labels)}")
    for index, name in enumerate(CLASSES):
        chosen = labels == index
        if chosen.any():
            print(f"  {name}: {(guesses[chosen] == index).mean():.0%} of {chosen.sum()}")


if __name__ == "__main__":
    main()
