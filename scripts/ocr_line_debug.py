from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


@dataclass
class LineResult:
    page: int
    line_number: int
    bbox: tuple[int, int, int, int]
    crop_path: str
    line_ocr: str
    best_full_page_line_number: int | None
    best_full_page_line: str | None
    similarity: float
    verdict: str


def clean_ocr_text(text: str) -> str:
    return (
        text.replace("\r", "")
        .replace("¦", "।")
        .replace("|", "।")
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
        .strip()
    )


def normalize_for_compare(text: str) -> str:
    text = clean_ocr_text(text)
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[^\u0980-\u09FFA-Za-z0-9]", "", text)
    return text.lower()


def run_tesseract(
    image_path: Path,
    tesseract_path: Path,
    tessdata_dir: Path,
    psm: int,
) -> str:
    completed = subprocess.run(
        [
            str(tesseract_path),
            str(image_path),
            "stdout",
            "-l",
            "ben+eng",
            "--psm",
            str(psm),
            "--tessdata-dir",
            str(tessdata_dir),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    return clean_ocr_text(completed.stdout)


def score_line_quality(text: str) -> tuple[int, int]:
    bangla_chars = sum(1 for char in text if "\u0980" <= char <= "\u09FF")
    return bangla_chars, len(text.strip())


def run_best_line_ocr(
    image_path: Path,
    tesseract_path: Path,
    tessdata_dir: Path,
) -> str:
    psm7 = run_tesseract(image_path, tesseract_path, tessdata_dir, 7)
    psm13 = run_tesseract(image_path, tesseract_path, tessdata_dir, 13)
    return max([psm7, psm13], key=score_line_quality)


def detect_line_bands(image: Image.Image) -> list[tuple[int, int]]:
    gray = image.convert("L")
    width, height = gray.size
    analysis_width = max(1, int(width * 0.62))
    threshold = 215
    min_dark_pixels = max(10, analysis_width // 110)
    dark_counts: list[int] = []

    for y in range(height):
        count = 0
        for x in range(analysis_width):
            if gray.getpixel((x, y)) < threshold:
                count += 1
        dark_counts.append(count)

    active_rows = [count >= min_dark_pixels for count in dark_counts]
    bands: list[tuple[int, int]] = []
    start: int | None = None

    for y, active in enumerate(active_rows):
        if active and start is None:
            start = y
        elif not active and start is not None:
            bands.append((start, y - 1))
            start = None

    if start is not None:
        bands.append((start, height - 1))

    merged: list[tuple[int, int]] = []
    for start, end in bands:
        if end - start < 4:
            continue
        if not merged:
            merged.append((start, end))
            continue
        last_start, last_end = merged[-1]
        if start - last_end <= 2:
            merged[-1] = (last_start, end)
        else:
            merged.append((start, end))

    expanded: list[tuple[int, int]] = []
    for start, end in merged:
        expanded.append((max(0, start - 6), min(height - 1, end + 6)))

    return expanded


def detect_content_columns(gray_crop: Image.Image) -> tuple[int, int]:
    width, height = gray_crop.size
    threshold = 215
    min_dark_pixels = max(3, height // 10)
    active_cols: list[int] = []

    for x in range(width):
        count = 0
        for y in range(height):
            if gray_crop.getpixel((x, y)) < threshold:
                count += 1
        if count >= min_dark_pixels:
            active_cols.append(x)

    if not active_cols:
        return 0, width - 1

    clusters: list[list[int]] = [[active_cols[0]]]
    for col in active_cols[1:]:
        if col - clusters[-1][-1] <= 70:
            clusters[-1].append(col)
        else:
            clusters.append([col])

    left_cluster = clusters[0]
    return max(0, min(left_cluster) - 8), min(width - 1, max(left_cluster) + 8)


def similarity(a: str, b: str) -> float:
    na = normalize_for_compare(a)
    nb = normalize_for_compare(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def classify(sim: float) -> str:
    if sim >= 0.72:
        return "matched"
    if sim >= 0.42:
        return "weak"
    return "missing_or_merged"


def build_report(
    output_dir: Path,
    page_results: dict[int, dict],
) -> None:
    report_lines: list[str] = [
        "# OCR Line Debug",
        "",
        "This report compares full-page Tesseract OCR with line-by-line OCR from visual line crops.",
        "",
        "Verdicts:",
        "- `matched`: the visual line has a strong equivalent in full-page OCR",
        "- `weak`: the line exists, but coherence or characters are degraded",
        "- `missing_or_merged`: the visual line is absent or badly merged in full-page OCR",
        "",
    ]

    for page_number, payload in sorted(page_results.items()):
        report_lines.extend(
            [
                f"## Page {page_number}",
                "",
                f"Annotated page: `{payload['annotated_path']}`",
                "",
                "### Full-page OCR",
                "",
                "```text",
                payload["full_page_ocr"],
                "```",
                "",
                "### Visual Lines",
                "",
            ]
        )

        for item in payload["lines"]:
            report_lines.extend(
                [
                    f"#### Line {item['line_number']} [{item['verdict']}]",
                    "",
                    f"- Crop: `{item['crop_path']}`",
                    f"- Similarity to full-page OCR: `{item['similarity']:.2f}`",
                    f"- Best full-page line: `{item['best_full_page_line_number']}`",
                    f"- Full-page text: `{item['best_full_page_line'] or ''}`",
                    "",
                    "```text",
                    item["line_ocr"],
                    "```",
                    "",
                ]
            )

    report_path = output_dir / "report.md"
    report_path.write_text("\n".join(report_lines), encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit(
            "Usage: python scripts/ocr_line_debug.py <inputDir> <outputDir> <tessdataDir> <tesseractPath>"
        )

    input_dir = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    tessdata_dir = Path(sys.argv[3]).resolve()
    tesseract_path = Path(sys.argv[4]).resolve()

    output_dir.mkdir(parents=True, exist_ok=True)
    line_dir = output_dir / "line-crops"
    annotated_dir = output_dir / "annotated-pages"
    line_dir.mkdir(parents=True, exist_ok=True)
    annotated_dir.mkdir(parents=True, exist_ok=True)

    page_results: dict[int, dict] = {}

    for image_path in sorted(input_dir.glob("page-*.png")):
        page_number = int(image_path.stem.split("-")[-1])
        image = Image.open(image_path).convert("RGB")
        gray = image.convert("L")
        bands = detect_line_bands(image)
        page_line_dir = line_dir / f"page-{page_number:03d}"
        page_line_dir.mkdir(parents=True, exist_ok=True)

        annotated = image.copy()
        drawer = ImageDraw.Draw(annotated)
        full_page_ocr = run_tesseract(image_path, tesseract_path, tessdata_dir, 6)
        full_page_lines = [
            line.strip()
            for line in full_page_ocr.splitlines()
            if line.strip()
        ]

        line_results: list[LineResult] = []

        for idx, (top, bottom) in enumerate(bands, start=1):
            gray_crop = gray.crop((0, top, gray.width, bottom + 1))
            left, right = detect_content_columns(gray_crop)
            crop_box = (left, top, right + 1, bottom + 1)
            crop = image.crop(crop_box)
            crop_path = page_line_dir / f"line-{idx:02d}.png"
            crop.save(crop_path)
            drawer.rectangle(crop_box, outline=(210, 55, 55), width=2)
            line_ocr = run_best_line_ocr(crop_path, tesseract_path, tessdata_dir)

            best_index = None
            best_line = None
            best_score = 0.0
            for full_index, full_line in enumerate(full_page_lines, start=1):
                score = similarity(line_ocr, full_line)
                if score > best_score:
                    best_score = score
                    best_index = full_index
                    best_line = full_line

            line_results.append(
                LineResult(
                    page=page_number,
                    line_number=idx,
                    bbox=(left, top, right, bottom),
                    crop_path=str(crop_path),
                    line_ocr=line_ocr,
                    best_full_page_line_number=best_index,
                    best_full_page_line=best_line,
                    similarity=best_score,
                    verdict=classify(best_score),
                )
            )

        annotated_path = annotated_dir / f"page-{page_number:03d}-annotated.png"
        annotated.save(annotated_path)

        page_results[page_number] = {
            "page": page_number,
            "source_image": str(image_path),
            "annotated_path": str(annotated_path),
            "full_page_ocr": full_page_ocr,
            "full_page_lines": full_page_lines,
            "lines": [asdict(item) for item in line_results],
        }

    results_path = output_dir / "results.json"
    results_path.write_text(
        json.dumps(page_results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    build_report(output_dir, page_results)


if __name__ == "__main__":
    main()
