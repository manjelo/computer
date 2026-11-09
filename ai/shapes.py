"""Hand-drawn-looking shapes for training, and the one pipeline every image goes through.

Training images and student drawings both pass through ``normalize`` so the
model sees them the same way: cropped to the ink, centred, scaled to 28x28.
"""

from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

CLASSES = ("circle", "square", "triangle")
IMAGE_SIZE = 28
_CANVAS = 256
_INK_THRESHOLD = 40


def normalize(image: Image.Image) -> np.ndarray:
    """Return a 28x28 float array in [0, 1], ink bright on black, centred on the ink."""
    pixels = np.asarray(image.convert("L"), dtype=np.uint8)
    rows = np.any(pixels > _INK_THRESHOLD, axis=1)
    cols = np.any(pixels > _INK_THRESHOLD, axis=0)
    if not rows.any():
        return np.zeros((IMAGE_SIZE, IMAGE_SIZE), dtype=np.float32)

    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]
    crop = Image.fromarray(pixels[top : bottom + 1, left : right + 1])

    # Keep proportions: a tall thin triangle must stay tall and thin.
    inner = IMAGE_SIZE - 6
    scale = inner / max(crop.size)
    width = max(1, round(crop.width * scale))
    height = max(1, round(crop.height * scale))
    crop = crop.resize((width, height), Image.Resampling.BILINEAR)

    out = Image.new("L", (IMAGE_SIZE, IMAGE_SIZE), 0)
    out.paste(crop, ((IMAGE_SIZE - width) // 2, (IMAGE_SIZE - height) // 2))
    return np.asarray(out, dtype=np.float32) / 255.0


def has_ink(image: Image.Image) -> bool:
    return bool((np.asarray(image.convert("L")) > _INK_THRESHOLD).any())


def decode_drawing(png_bytes: bytes) -> Image.Image:
    """Turn a canvas PNG (dark ink on a transparent or light page) into bright ink on black."""
    source = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    page = Image.new("RGBA", source.size, (255, 255, 255, 255))
    page.alpha_composite(source)
    grey = np.asarray(page.convert("L"), dtype=np.uint8)
    return Image.fromarray(255 - grey)


def _corners(shape: str, rng: np.random.Generator) -> list[tuple[float, float]]:
    """Corner points for a straight-edged shape, unevenly proportioned like real sketches."""
    if shape == "square":
        # Anything from a neat square to a clearly stretched one.
        half_w, half_h = 1.0, rng.choice([1.0, rng.uniform(0.55, 1.0)])
        if rng.random() < 0.5:
            half_w, half_h = half_h, half_w
        points = [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]
        jitter = rng.uniform(0.0, 0.12)  # From ruler-neat to clearly crooked.
    else:
        apex_x = rng.uniform(-0.45, 0.45)
        half_base = rng.uniform(0.75, 1.0)
        height = rng.uniform(0.75, 1.0)
        points = [(apex_x, -height), (half_base, height), (-half_base, height)]
        jitter = rng.uniform(0.0, 0.09)
    return [(x + rng.normal(0, jitter), y + rng.normal(0, jitter)) for x, y in points]


def _outline(shape: str, rng: np.random.Generator) -> list[tuple[float, float]]:
    """A single wobbly pen stroke around the shape, in roughly -1..1 coordinates."""
    points: list[tuple[float, float]] = []
    if shape == "circle":
        squash = rng.uniform(0.72, 1.0)
        tilt = rng.uniform(0, math.pi)
        start = rng.uniform(0, 2 * math.pi)
        # Mouse circles rarely close neatly: leave a gap or overlap the start.
        sweep = 2 * math.pi * rng.uniform(0.94, 1.08)
        phase_a, phase_b = rng.uniform(0, 2 * math.pi, 2)
        for t in np.linspace(0, 1, 90):
            angle = start + sweep * t
            radius = 1 + 0.05 * math.sin(2 * angle + phase_a) + 0.03 * math.sin(3 * angle + phase_b)
            x, y = radius * math.cos(angle), radius * squash * math.sin(angle)
            points.append(
                (x * math.cos(tilt) - y * math.sin(tilt), x * math.sin(tilt) + y * math.cos(tilt))
            )
        return points

    corners = _corners(shape, rng)
    first = int(rng.integers(len(corners)))
    corners = corners[first:] + corners[:first]
    closed = corners + [corners[0]]
    for (x0, y0), (x1, y1) in zip(closed, closed[1:]):
        steps = 28
        bow = rng.normal(0, 0.035)
        for t in np.linspace(0, 1, steps, endpoint=False):
            normal = math.sin(math.pi * t) * bow
            points.append(
                (x0 + (x1 - x0) * t + (y1 - y0) * normal, y0 + (y1 - y0) * t - (x1 - x0) * normal)
            )
    # The pen usually stops a little short of, or just past, where it began.
    end_x, end_y = closed[-1]
    points.append((end_x + rng.normal(0, 0.05), end_y + rng.normal(0, 0.05)))
    return points


def generate(shape: str, rng: np.random.Generator) -> np.ndarray:
    """One random sketch of ``shape`` as a normalized 28x28 array."""
    if shape not in CLASSES:
        raise ValueError(f"unknown shape: {shape}")
    points = _outline(shape, rng)

    # Slow pen drift plus a little hand tremor.
    drift = np.cumsum(rng.normal(0, 0.006, (len(points), 2)), axis=0)
    drift -= drift.mean(axis=0)
    tremor = rng.normal(0, 0.006, (len(points), 2))
    coords = np.asarray(points) + drift + tremor

    rotation = rng.normal(0, math.radians(rng.choice([1.5, 14])))
    if shape == "circle":
        rotation = rng.uniform(0, 2 * math.pi)
    cos_r, sin_r = math.cos(rotation), math.sin(rotation)
    coords = coords @ np.array([[cos_r, sin_r], [-sin_r, cos_r]])

    scale = rng.uniform(0.45, 0.9) * _CANVAS / 2
    centre = rng.uniform(_CANVAS * 0.42, _CANVAS * 0.58, 2)
    pixels = coords * scale + centre

    image = Image.new("L", (_CANVAS, _CANVAS), 0)
    # Same scale as the student's pen relative to the size of their shape.
    width = max(2, round(scale * rng.uniform(0.05, 0.16)))
    ImageDraw.Draw(image).line([tuple(p) for p in pixels], fill=255, width=width, joint="curve")
    return normalize(image)


def generate_dataset(count: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """``count`` images shuffled and balanced across the three shapes."""
    labels = np.arange(count) % len(CLASSES)
    rng.shuffle(labels)
    images = np.stack([generate(CLASSES[label], rng) for label in labels])
    return images.astype(np.float32), labels.astype(np.int64)


def _is_holdout(path: Path) -> bool:
    # Stable across runs: the same drawing is always train or always holdout.
    return sum(path.name.encode()) % 5 == 0


def load_team_drawings(root: Path, split: str = "train") -> tuple[np.ndarray, np.ndarray]:
    """Team drawings saved under ``root/<shape>/``. ``split`` is 'train', 'holdout' or 'all'."""
    images: list[np.ndarray] = []
    labels: list[int] = []
    for label, shape in enumerate(CLASSES):
        for path in sorted((root / shape).glob("*.png")):
            holdout = _is_holdout(path)
            if split == "all" or (split == "holdout") == holdout:
                images.append(normalize(Image.open(path)))
                labels.append(label)
    if not images:
        empty = np.zeros((0, IMAGE_SIZE, IMAGE_SIZE), dtype=np.float32)
        return empty, np.zeros(0, dtype=np.int64)
    return np.stack(images), np.asarray(labels, dtype=np.int64)
