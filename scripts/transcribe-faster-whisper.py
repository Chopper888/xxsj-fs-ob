#!/usr/bin/env python3
"""Run one real faster-whisper transcription and preserve its raw output."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe media with faster-whisper")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--initial-prompt", default="")
    parser.add_argument("--vad-filter", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--word-timestamps", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def gpu_memory_monitor(stop: threading.Event, peak: list[int]) -> None:
    pid = str(os.getpid())
    while not stop.wait(0.2):
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=2, check=False,
            )
            for line in result.stdout.splitlines():
                parts = [item.strip() for item in line.split(",")]
                if len(parts) == 2 and parts[0] == pid:
                    peak[0] = max(peak[0], int(parts[1]))
        except (OSError, ValueError, subprocess.SubprocessError):
            pass


def main() -> None:
    args = parse_args()
    if not args.input.is_file():
        raise SystemExit(f"input_missing:{args.input}")
    if args.output.exists() and not args.overwrite:
        raise SystemExit(f"output_exists:{args.output}")

    from faster_whisper import WhisperModel

    started_at = time.time()
    stop = threading.Event()
    peak = [0]
    monitor = threading.Thread(target=gpu_memory_monitor, args=(stop, peak), daemon=True)
    monitor.start()
    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segment_iter, info = model.transcribe(
            str(args.input), language=args.language, vad_filter=args.vad_filter,
            word_timestamps=args.word_timestamps, initial_prompt=args.initial_prompt or None,
        )
        segments = []
        text_parts = []
        for segment in segment_iter:
            text_parts.append(segment.text)
            segments.append({
                "id": segment.id, "start": segment.start, "end": segment.end, "text": segment.text,
                "words": [
                    {"start": word.start, "end": word.end, "word": word.word, "probability": word.probability}
                    for word in (segment.words or [])
                ],
            })
    finally:
        stop.set()
        monitor.join(timeout=3)

    finished_at = time.time()
    payload = {
        "provider": "faster-whisper", "model": args.model, "device": args.device,
        "compute_type": args.compute_type, "language_requested": args.language,
        "language_detected": info.language, "language_probability": info.language_probability,
        "duration_seconds": info.duration, "duration_after_vad_seconds": info.duration_after_vad,
        "vad_filter": args.vad_filter, "word_timestamps": args.word_timestamps,
        "initial_prompt_terms": [item.strip() for item in args.initial_prompt.split("、") if item.strip()],
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at)),
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_at)),
        "elapsed_seconds": finished_at - started_at, "gpu_memory_peak_mib": peak[0] or None,
        "text": "".join(text_parts).strip(), "segments": segments,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({key: payload[key] for key in ("provider", "model", "device", "compute_type", "elapsed_seconds", "gpu_memory_peak_mib")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
