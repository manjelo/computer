"""Live training session: one model, trained pass by pass, in a background thread."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from .model import ShapeNet, to_batch
from .shapes import CLASSES, generate_dataset, load_team_drawings

# Sized so a full run is slow enough to talk over and the climb is easy to see.
PASSES = 20
EXAMPLES_PER_PASS = 240
BATCH_SIZE = 32
START_RATE = 0.00012
PEAK_RATE = 0.002
END_RATE = 0.0002
PEAK_AT = 0.6
TRAIN_POOL = 4800
TEST_POOL = 450
SAMPLES_SHOWN = 8


def learning_rate(number: int) -> float:
    """Start gently so the climb is visible, peak to learn, then cool down to finish steady."""
    progress = (number - 1) / (PASSES - 1)
    if progress < PEAK_AT:
        return START_RATE + (PEAK_RATE - START_RATE) * progress / PEAK_AT
    return PEAK_RATE + (END_RATE - PEAK_RATE) * (progress - PEAK_AT) / (1 - PEAK_AT)


class Trainer:
    """Holds the model. Every public method is safe to call from the web server's threads."""

    def __init__(self, team_dir: Path | None = None, seed: int = 7, pass_delay: float = 1.0) -> None:
        self.pass_delay = pass_delay
        self._lock = threading.Lock()
        self._state_changed = threading.Condition(self._lock)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._version = 0
        self._generation = 0

        rng = np.random.default_rng(seed)
        self._train_images, self._train_labels = generate_dataset(TRAIN_POOL, rng)
        self._test_images, self._test_labels = generate_dataset(TEST_POOL, rng)
        if team_dir is not None:
            team_images, team_labels = load_team_drawings(team_dir, "train")
            if len(team_images):
                # Repeat so a handful of real drawings still matter among thousands generated.
                copies = max(1, TRAIN_POOL // (4 * len(team_images)))
                self._train_images = np.concatenate([self._train_images, np.repeat(team_images, copies, axis=0)])
                self._train_labels = np.concatenate([self._train_labels, np.repeat(team_labels, copies, axis=0)])

        self._shuffle = np.random.default_rng(seed + 1)
        self._drawing: np.ndarray | None = None
        with self._lock:
            self._reset_locked()

    def _reset_locked(self) -> None:
        # A new random start each time, so no group ever sees a part-trained model.
        self._generation += 1
        torch.manual_seed(int(time.time_ns() % 2**31))
        self.model = ShapeNet()
        self._optimizer = torch.optim.Adam(self.model.parameters(), lr=START_RATE)
        self._status = "untrained"
        self._current_pass = 0
        self._history: list[float] = []
        self._samples: list[dict] = []
        self._accuracy = self._evaluate_locked()
        self._start_accuracy = self._accuracy
        self._probs = self._predict_locked(self._drawing)
        self._version += 1
        self._state_changed.notify_all()

    def _predict_locked(self, image: np.ndarray | None) -> list[float] | None:
        if image is None:
            return None
        self.model.eval()
        with torch.no_grad():
            probs = torch.softmax(self.model(to_batch(image[None])), dim=1)[0]
        return [float(p) for p in probs]

    def _evaluate_locked(self) -> float:
        self.model.eval()
        with torch.no_grad():
            guesses = self.model(to_batch(self._test_images)).argmax(dim=1).numpy()
        return float((guesses == self._test_labels).mean())

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_locked()

    def _snapshot_locked(self) -> dict:
        return {
            "version": self._version,
            "status": self._status,
            "pass": self._current_pass,
            "passes": PASSES,
            "examples_per_pass": EXAMPLES_PER_PASS,
            "examples_seen": self._current_pass * EXAMPLES_PER_PASS,
            "accuracy": self._accuracy,
            "start_accuracy": self._start_accuracy,
            "history": list(self._history),
            "classes": list(CLASSES),
            "probs": self._probs,
            "samples": self._samples,
        }

    def wait_for_change(self, after_version: int, timeout: float = 15.0) -> dict:
        """Block until the state is newer than ``after_version``, or the timeout passes."""
        with self._state_changed:
            self._state_changed.wait_for(lambda: self._version > after_version, timeout)
            return self._snapshot_locked()

    def set_drawing(self, image: np.ndarray | None) -> dict:
        with self._lock:
            self._drawing = image
            self._probs = self._predict_locked(image)
            self._version += 1
            self._state_changed.notify_all()
            return self._snapshot_locked()

    def start(self) -> bool:
        """Begin training. Returns False if it is already running or already finished."""
        with self._lock:
            if self._status != "untrained":
                return False
            self._status = "training"
            self._version += 1
            self._state_changed.notify_all()
            generation = self._generation
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, args=(generation,), daemon=True)
        self._thread.start()
        return True

    def reset(self) -> dict:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=10)
        self._thread = None
        with self._lock:
            self._reset_locked()
            return self._snapshot_locked()

    def _run(self, generation: int) -> None:
        for number in range(1, PASSES + 1):
            if self._stop.is_set():
                return
            started = time.monotonic()
            self._train_one_pass(number, generation)
            # Keep an even rhythm however fast the laptop trained this pass.
            remaining = self.pass_delay - (time.monotonic() - started)
            if remaining > 0 and self._stop.wait(remaining):
                return
        with self._lock:
            if generation == self._generation:
                self._status = "trained"
                self._version += 1
                self._state_changed.notify_all()

    def _train_one_pass(self, number: int, generation: int) -> None:
        indices = self._shuffle.choice(len(self._train_images), EXAMPLES_PER_PASS, replace=False)
        loss_function = nn.CrossEntropyLoss()
        with self._lock:
            if generation != self._generation:
                return
            self.model.train()
            for group in self._optimizer.param_groups:
                group["lr"] = learning_rate(number)
            for start in range(0, EXAMPLES_PER_PASS, BATCH_SIZE):
                batch = indices[start : start + BATCH_SIZE]
                self._optimizer.zero_grad()
                loss = loss_function(
                    self.model(to_batch(self._train_images[batch])),
                    torch.as_tensor(self._train_labels[batch]),
                )
                loss.backward()
                self._optimizer.step()

            self._current_pass = number
            self._accuracy = self._evaluate_locked()
            self._history.append(self._accuracy)
            self._probs = self._predict_locked(self._drawing)
            self._samples = [
                {
                    "label": CLASSES[self._train_labels[i]],
                    "pixels": np.round(self._train_images[i] * 9).astype(int).ravel().tolist(),
                }
                for i in indices[:SAMPLES_SHOWN]
            ]
            self._version += 1
            self._state_changed.notify_all()
