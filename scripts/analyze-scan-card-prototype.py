#!/usr/bin/env python3
"""Leitura OMR de prova do cartão estático de descoberta.

É um verificador técnico do layout PTR1, não o pipeline de produção. Ele
localiza os quatro marcadores, retifica uma página objetiva e mede o centro das
bolhas A-E. O QR é validado separadamente pelo detector de código de barras;
este script assume que a página já foi identificada como página 1 do PTR1.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


A4_WIDTH_MM = 210
A4_HEIGHT_MM = 297
MARGIN_MM = 12
MARKER_MM = 7
FIRST_BUBBLE_X_MM = MARGIN_MM + 37
FIRST_ROW_TOP_MM = 137
ROW_STEP_MM = 13
BUBBLE_STEP_MM = 8.5
LETTERS = 'ABCDE'


def mm_to_px(value_mm: float, dpi: float) -> float:
    return value_mm * dpi / 25.4


def component_bbox(image: np.ndarray, start_x: int, start_y: int, threshold: int) -> tuple[float, float, float, float]:
    """Encontra o quadrado preto conectado que contém a janela mais escura."""
    height, width = image.shape
    queue = [(start_x, start_y)]
    visited: set[tuple[int, int]] = set()
    min_x = max_x = start_x
    min_y = max_y = start_y

    while queue:
        x, y = queue.pop()
        if (x, y) in visited or x < 0 or y < 0 or x >= width or y >= height or image[y, x] >= threshold:
            continue
        visited.add((x, y))
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)
        queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))

    if len(visited) < 300:
        raise ValueError('Marcador de canto não encontrado com contraste suficiente.')
    return float(min_x), float(min_y), float(max_x), float(max_y)


def find_marker(image: np.ndarray, region: tuple[int, int, int, int], dpi: float) -> tuple[float, float]:
    y0, y1, x0, x1 = region
    window = max(32, round(mm_to_px(4.5, dpi)))
    crop = image[y0:y1, x0:x1]
    dark = (crop < 90).astype(np.int32)
    integral = np.pad(dark.cumsum(axis=0).cumsum(axis=1), ((1, 0), (1, 0)))
    sums = integral[window:, window:] - integral[:-window, window:] - integral[window:, :-window] + integral[:-window, :-window]
    local_y, local_x = np.unravel_index(np.argmax(sums), sums.shape)
    bbox = component_bbox(image, x0 + int(local_x + window // 2), y0 + int(local_y + window // 2), threshold=100)
    min_x, min_y, max_x, max_y = bbox
    ratio = (max_x - min_x + 1) / (max_y - min_y + 1)
    if not 0.75 <= ratio <= 1.25:
        raise ValueError(f'Marcador de canto não é quadrado (proporção {ratio:.2f}).')
    return (min_x + max_x) / 2, (min_y + max_y) / 2


def solve_perspective(target: np.ndarray, source: np.ndarray) -> list[float]:
    """Retorna coeficientes Pillow que levam ponto do layout ao scan físico."""
    matrix: list[list[float]] = []
    values: list[float] = []
    for (x, y), (u, v) in zip(target, source, strict=True):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        values.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        values.append(v)
    coefficients = np.linalg.solve(np.asarray(matrix, dtype=float), np.asarray(values, dtype=float))
    return [float(value) for value in coefficients]


def rectify(image: Image.Image, dpi: float) -> tuple[Image.Image, dict[str, tuple[float, float]]]:
    gray = np.asarray(image.convert('L'))
    height, width = gray.shape
    corner_size = min(round(width * 0.24), round(height * 0.17))
    regions = {
        'top_left': (0, corner_size, 0, corner_size),
        'top_right': (0, corner_size, width - corner_size, width),
        'bottom_left': (height - corner_size, height, 0, corner_size),
        'bottom_right': (height - corner_size, height, width - corner_size, width),
    }
    markers = {name: find_marker(gray, region, dpi) for name, region in regions.items()}

    target = np.asarray([
        (mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi), mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi)),
        (width - mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi), mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi)),
        (mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi), height - mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi)),
        (width - mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi), height - mm_to_px(MARGIN_MM + MARKER_MM / 2, dpi)),
    ])
    source = np.asarray([markers['top_left'], markers['top_right'], markers['bottom_left'], markers['bottom_right']])
    normalized = image.convert('L').transform((width, height), Image.Transform.PERSPECTIVE, solve_perspective(target, source), Image.Resampling.BICUBIC)
    return normalized, markers


def disk_mean(image: np.ndarray, x: int, y: int, radius: int) -> float:
    yy, xx = np.ogrid[-radius:radius + 1, -radius:radius + 1]
    mask = xx * xx + yy * yy <= radius * radius
    patch = image[y - radius:y + radius + 1, x - radius:x + radius + 1]
    if patch.shape != mask.shape:
        raise ValueError('Bolha fora da área útil da página.')
    return float(patch[mask].mean())


def read_answers(normalized: Image.Image, dpi: float) -> list[tuple[int, str, float, float]]:
    pixels = np.asarray(normalized)
    radius = max(8, round(mm_to_px(1.45, dpi)))
    answers: list[tuple[int, str, float, float]] = []
    for number in range(1, 16):
        row = number - 1 if number <= 8 else number - 9
        base_x = MARGIN_MM if number <= 8 else 108
        y = round(mm_to_px(FIRST_ROW_TOP_MM + row * ROW_STEP_MM, dpi))
        means = [disk_mean(pixels, round(mm_to_px(base_x + 37 + index * BUBBLE_STEP_MM, dpi)), y, radius) for index in range(len(LETTERS))]
        order = sorted(range(len(means)), key=means.__getitem__)
        chosen, runner_up = order[0], order[1]
        answers.append((number, LETTERS[chosen], means[chosen], means[runner_up] - means[chosen]))
    return answers


def main() -> None:
    parser = argparse.ArgumentParser(description='Analisa uma página 1 PTR1 já identificada por QR.')
    parser.add_argument('scan', type=Path, help='JPEG/PNG da página objetiva a 300 dpi.')
    parser.add_argument('--dpi', type=float, default=300, help='DPI físico do scan.')
    parser.add_argument('--normalized-output', type=Path, help='Opcional: onde salvar a página retificada.')
    args = parser.parse_args()

    original = Image.open(args.scan)
    normalized, markers = rectify(original, args.dpi)
    if args.normalized_output:
        args.normalized_output.parent.mkdir(parents=True, exist_ok=True)
        normalized.save(args.normalized_output)
    print('Marcadores:', ' '.join(f'{name}=({x:.1f},{y:.1f})' for name, (x, y) in markers.items()))
    for number, letter, darkness, separation in read_answers(normalized, args.dpi):
        print(f'{number:02d}: {letter} (intensidade={darkness:.1f}; separação={separation:.1f})')


if __name__ == '__main__':
    main()
