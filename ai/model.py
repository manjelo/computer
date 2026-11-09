"""The small network students watch learn."""

from __future__ import annotations

import torch
from torch import nn

from .shapes import CLASSES, IMAGE_SIZE


class ShapeNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 32, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
        self.head = nn.Sequential(nn.Flatten(), nn.Linear(32 * (IMAGE_SIZE // 8) ** 2, 64), nn.ReLU())
        self.output = nn.Linear(64, len(CLASSES))
        # Tiny output weights make a fresh model truly undecided, near 33% each,
        # rather than randomly confident, which would muddle the "before" moment.
        nn.init.normal_(self.output.weight, std=0.001)
        nn.init.zeros_(self.output.bias)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        return self.output(self.head(self.features(images)))


def to_batch(images) -> torch.Tensor:
    """Numpy images shaped (N, 28, 28) to a tensor shaped (N, 1, 28, 28)."""
    return torch.as_tensor(images, dtype=torch.float32).unsqueeze(1)
