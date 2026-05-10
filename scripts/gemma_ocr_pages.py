from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from PIL import Image
from google import genai
from google.genai import errors


OCR_PROMPT = """You are doing high-fidelity OCR transcription for a Bangla primary school textbook page.

Task:
- Read every visible Bengali text line from this single page.
- Follow natural reading order: top-to-bottom, left-to-right.
- Ignore illustrations and decorative artwork.
- Preserve sentence flow and do not skip any line.
- Keep line breaks close to the printed lines when possible.
- Do not summarize.
- Do not explain.
- Do not translate.
- Do not add bullets, numbering, or markdown.
- If a word is unclear, still output your best reading instead of omitting the line.

Return only the transcription text."""

CLEANUP_PROMPT_TEMPLATE = """You are correcting OCR text from a Bangla primary school textbook page.

Rules:
- Keep the same reading order and same content as the OCR input.
- Fix obvious script mixups inside Bangla words, such as Cyrillic, Devanagari, or Latin letters that should be Bangla Unicode.
- Fix obvious OCR punctuation issues if the intended Bangla punctuation is clear.
- Preserve line breaks as much as possible.
- Do not summarize.
- Do not explain.
- Do not translate.
- Do not add bullets, numbering, or markdown.
- Do not invent new content that is not already strongly implied by the OCR text.
- Return only corrected Bangla text.

OCR input:
{ocr_text}
"""

MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 3
DEFAULT_MODEL_ID = "gemma-3-27b-it"


def detect_primary_text_columns(image: Image.Image) -> tuple[int, int]:
    gray = image.convert("L")
    width, height = gray.size
    threshold = 220
    min_dark_pixels = max(8, height // 60)
    active_cols: list[int] = []

    for x in range(width):
        dark_count = 0
        for y in range(height):
            if gray.getpixel((x, y)) < threshold:
                dark_count += 1
        if dark_count >= min_dark_pixels:
            active_cols.append(x)

    if not active_cols:
        return 0, width - 1

    clusters: list[list[int]] = [[active_cols[0]]]
    for col in active_cols[1:]:
        if col - clusters[-1][-1] <= 35:
            clusters[-1].append(col)
        else:
            clusters.append([col])

    best_cluster = max(
        clusters,
        key=lambda cluster: (
            cluster[-1] - cluster[0] + 1,
            len(cluster),
            -cluster[0],
        ),
    )
    left = max(0, best_cluster[0] - 20)
    right = min(width - 1, best_cluster[-1] + 20)
    return left, right


def crop_to_primary_text_lane(image: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    left, right = detect_primary_text_columns(image)
    crop_box = (left, 0, right + 1, image.height)
    return image.crop(crop_box), crop_box


def cleanup_text_for_prompt(text: str) -> str:
    text = text.replace("\ufeff", "").strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def write_outputs(
    output_dir: Path, model_id: str, page_outputs: list[dict[str, str]], failures: list[dict[str, str]]
) -> tuple[Path, Path, Path]:
    safe_model = model_id.replace("/", "-")
    json_path = output_dir / f"{safe_model}-ocr-results.json"
    json_path.write_text(
        json.dumps(
            {
                "model": model_id,
                "pages": page_outputs,
                "failures": failures,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    txt_parts: list[str] = []
    for item in page_outputs:
        txt_parts.append(f"===== PAGE {int(item['page'])} =====")
        txt_parts.append(item["text"])
        txt_parts.append("")

    if failures:
        txt_parts.append("===== FAILURES =====")
        for failure in failures:
            txt_parts.append(
                f"PAGE {failure['page']}: {failure['error_type']}: {failure['error_message']}"
            )

    txt_path = output_dir / f"{safe_model}-ocr-pages-35-39.txt"
    txt_path.write_text("\ufeff" + "\n".join(txt_parts), encoding="utf-8")

    prompt_path = output_dir / "prompt-used.txt"
    prompt_path.write_text(
        "\ufeffOCR PROMPT:\n"
        + OCR_PROMPT
        + "\n\nCLEANUP PROMPT TEMPLATE:\n"
        + CLEANUP_PROMPT_TEMPLATE,
        encoding="utf-8",
    )
    return txt_path, json_path, prompt_path


def generate_text(client: genai.Client, model_id: str, contents: object) -> str:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=model_id,
                contents=contents,
            )
            return (response.text or "").strip()
        except errors.ServerError as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(RETRY_DELAY_SECONDS * attempt)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(RETRY_DELAY_SECONDS * attempt)

    if last_error is None:
        raise RuntimeError("Unknown OCR failure")
    raise last_error


def transcribe_page(
    client: genai.Client,
    model_id: str,
    image_path: Path,
    crop_dir: Path,
) -> dict[str, str]:
    with Image.open(image_path) as image:
        rgb_image = image.convert("RGB")
        cropped_image, crop_box = crop_to_primary_text_lane(rgb_image)
        crop_path = crop_dir / f"{image_path.stem}-primary-text-lane.png"
        cropped_image.save(crop_path)

    raw_text = generate_text(client, model_id, [OCR_PROMPT, cropped_image])
    cleanup_prompt = CLEANUP_PROMPT_TEMPLATE.format(
        ocr_text=cleanup_text_for_prompt(raw_text)
    )
    cleaned_text = generate_text(client, model_id, cleanup_prompt)
    return {
        "crop_path": str(crop_path),
        "crop_box": ",".join(str(part) for part in crop_box),
        "raw_text": raw_text,
        "text": cleaned_text,
    }


def main() -> None:
    if len(sys.argv) not in {3, 4}:
        raise SystemExit(
            "Usage: python scripts/gemma_ocr_pages.py <input_dir> <output_dir> [model_id]"
        )

    input_dir = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    model_id = sys.argv[3] if len(sys.argv) == 4 else DEFAULT_MODEL_ID
    output_dir.mkdir(parents=True, exist_ok=True)
    crop_dir = output_dir / "debug-crops"
    crop_dir.mkdir(parents=True, exist_ok=True)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY was not found in the environment.")

    client = genai.Client(api_key=api_key)

    page_outputs: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    for image_path in sorted(input_dir.glob("page-*.png")):
        page = image_path.stem.split("-")[-1]
        try:
            transcription = transcribe_page(client, model_id, image_path, crop_dir)
            page_outputs.append(
                {
                    "model": model_id,
                    "image": str(image_path),
                    "page": page,
                    "crop_path": transcription["crop_path"],
                    "crop_box": transcription["crop_box"],
                    "raw_text": transcription["raw_text"],
                    "text": transcription["text"],
                }
            )
        except Exception as exc:  # noqa: BLE001
            failures.append(
                {
                    "model": model_id,
                    "image": str(image_path),
                    "page": page,
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                }
            )
        write_outputs(output_dir, model_id, page_outputs, failures)

    txt_path, json_path, _prompt_path = write_outputs(output_dir, model_id, page_outputs, failures)

    print(txt_path)
    print(json_path)


if __name__ == "__main__":
    main()
