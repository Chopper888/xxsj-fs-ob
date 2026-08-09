#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import whisper


def parse_args():
    parser = argparse.ArgumentParser(description="Transcribe an audio/video file with OpenAI Whisper.")
    parser.add_argument("input", help="Input audio or video path")
    parser.add_argument("--model", default="base", help="Whisper model name or local path")
    parser.add_argument("--language", default="zh", help="Language code, or empty string for auto detection")
    parser.add_argument("--compute-type", default="", help="Accepted for queue compatibility; ignored by OpenAI Whisper")
    parser.add_argument("--output-dir", default="data/transcripts", help="Directory for transcript JSON")
    parser.add_argument("--output-name", default="", help="Optional output basename without extension")
    return parser.parse_args()


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_name = args.output_name or input_path.stem
    output_path = output_dir / f"{output_name}.json"

    model = whisper.load_model(args.model)
    result = model.transcribe(str(input_path), language=args.language or None, fp16=False)

    segments = []
    for segment in result.get("segments", []):
        text = str(segment.get("text", "")).strip()
        segments.append(
            {
                "id": segment.get("id"),
                "start": segment.get("start"),
                "end": segment.get("end"),
                "text": text,
                "avg_logprob": segment.get("avg_logprob"),
                "no_speech_prob": segment.get("no_speech_prob"),
            }
        )

    payload = {
        "source": str(input_path),
        "backend": "whisper",
        "model": args.model,
        "language": result.get("language"),
        "text": str(result.get("text", "")).strip(),
        "segments": segments,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"transcript_written:{output_path}")


if __name__ == "__main__":
    main()
