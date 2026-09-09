#!/usr/bin/env python3
"""Exporta os recortes visuais verificáveis dos cadernos oficiais do ENEM.

O resultado contém somente imagens embutidas que pertencem fisicamente à área
de uma questão. Não publica nada nem toca no banco; o importador TypeScript
faz o upload para o Drive e cria o vínculo depois desse recorte ser produzido.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

import pdfplumber
from PIL import Image


def load_extractor() -> Any:
    path = Path(__file__).with_name("extract-enem-official-pdfs.py")
    spec = importlib.util.spec_from_file_location("enem_pdf_extractor", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Não foi possível carregar o extrator oficial.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_pdfs(root: Path, year: int) -> list[Path]:
    proofs = root / str(year) / "provas-gabaritos-regular"
    files = [
        proofs / f"{year}_PV_impresso_D1_CD1.pdf",
        proofs / f"{year}_PV_impresso_D2_CD5.pdf",
    ]
    missing = [str(path) for path in files if not path.exists()]
    if missing:
        raise FileNotFoundError("Cadernos oficiais ausentes: " + ", ".join(missing))
    return files


def visual_boxes(page: pdfplumber.page.Page, left: float, right: float, top: float, bottom: float) -> list[tuple[float, float, float, float]]:
    boxes: list[tuple[float, float, float, float]] = []
    for image in page.images:
        if image.get("imagemask") or image["width"] < 30 or image["height"] < 30:
            continue
        if image["x1"] < left or image["x0"] > right or image["bottom"] < top or image["top"] > bottom:
            continue
        boxes.append((max(left, image["x0"] - 3), max(top, image["top"] - 3), min(right, image["x1"] + 3), min(bottom, image["bottom"] + 3)))
    return sorted(boxes, key=lambda box: (box[1], box[0]))


def save_stacked_crops(page: pdfplumber.page.Page, boxes: list[tuple[float, float, float, float]], output: Path) -> None:
    """Empilha trechos que continuam da coluna esquerda para a direita."""
    images = [page.crop(box).to_image(resolution=180).original.convert("RGB") for box in boxes]
    width = max(image.width for image in images)
    height = sum(image.height for image in images)
    composite = Image.new("RGB", (width, height), "white")
    offset = 0
    for image in images:
        composite.paste(image, (0, offset))
        offset += image.height
    composite.save(output, format="PNG")


def export_year(root: Path, output: Path, year: int, full_question_numbers: set[int]) -> dict[str, Any]:
    extractor = load_extractor()
    target = output / str(year)
    target.mkdir(parents=True, exist_ok=True)
    exported: dict[int, list[str]] = {}
    seen: set[int] = set()

    for pdf_path in source_pdfs(root, year):
        with pdfplumber.open(pdf_path) as pdf:
            for page_number, page in enumerate(pdf.pages[1:], start=2):
                positions = extractor.question_positions(page)
                midpoint = page.width / 2
                for left, right, in_column in [
                    (0, midpoint, [item for item in positions if item[1] < midpoint]),
                    (midpoint, page.width, [item for item in positions if item[1] >= midpoint]),
                ]:
                    ordered = sorted(in_column, key=lambda item: item[2])
                    for index, (number, _x0, top) in enumerate(ordered):
                        if number in seen:
                            continue  # inglês é a versão escolhida antes do espanhol para 1-5
                        bottom = ordered[index + 1][2] if index + 1 < len(ordered) else page.height - 35
                        boxes = visual_boxes(page, left + 20, right - 20, top, bottom)
                        seen.add(number)
                        if not boxes:
                            continue
                        filenames: list[str] = []
                        for image_index, box in enumerate(boxes, start=1):
                            filename = f"q{number:03d}-{image_index:02d}.png"
                            page.crop(box).to_image(resolution=180).save(target / filename, format="PNG")
                            filenames.append(str((target / filename).resolve()))
                        full_question_file = None
                        if number in full_question_numbers:
                            full_filename = f"q{number:03d}-questao-completa.png"
                            full_path = target / full_filename
                            # Quando uma questão começa na coluna esquerda e
                            # não existe novo cabeçalho na direita, o caderno
                            # usa a metade direita como continuação (caso dos
                            # gráficos A-E). Preservamos as duas metades no
                            # recorte integral para não perder alternativas.
                            opposite_positions = [
                                item for item in positions
                                if ((item[1] >= midpoint) if left < midpoint else (item[1] < midpoint))
                            ]
                            has_opposite_question = bool(opposite_positions)
                            crop_left, crop_right = (left + 8, right - 8)
                            if left < midpoint and not has_opposite_question:
                                crop_left, crop_right = (8, page.width - 8)
                                page.crop((crop_left, top, crop_right, bottom)).to_image(resolution=180).save(full_path, format="PNG")
                            elif left < midpoint and index == len(ordered) - 1 and opposite_positions:
                                # A questão acaba a coluna esquerda e continua
                                # no topo da direita, antes do próximo cabeçalho.
                                right_end = min(item[2] for item in opposite_positions)
                                save_stacked_crops(page, [
                                    (left + 8, top, right - 8, page.height - 35),
                                    (midpoint + 8, 90, page.width - 8, right_end),
                                ], full_path)
                            else:
                                page.crop((crop_left, top, crop_right, bottom)).to_image(resolution=180).save(full_path, format="PNG")
                            full_question_file = str(full_path.resolve())
                        exported[number] = {"files": filenames, "fullQuestionFile": full_question_file}

    return {
        "year": year,
        "questions": [
            {"questionIndex": number, **files}
            for number, files in sorted(exported.items())
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--years", required=True)
    parser.add_argument("--full-question-numbers", default="")
    args = parser.parse_args()
    years = [int(value.strip()) for value in args.years.split(",") if value.strip()]
    full_question_numbers = {int(value.strip()) for value in args.full_question_numbers.split(",") if value.strip()}
    print(json.dumps({"years": [export_year(args.root, args.output, year, full_question_numbers) for year in years]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
