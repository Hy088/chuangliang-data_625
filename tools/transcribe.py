# -*- coding: utf-8 -*-
"""用 faster-whisper 把视频/音频转写成中文文字，输出到 transcript.txt。"""
import os, sys

VIDEO = r"C:/Users/EDY/Downloads/ePs4HSANibZHRpEFjsjdnZSfKKr6Pzpm.mp4"
OUT = r"C:/Users/EDY/chuangliang_data/tools/transcript.txt"
MODEL = "base"  # tiny 对中文很差，base 明显更准

def main():
    from faster_whisper import WhisperModel
    print(f"[info] loading model {MODEL} ...")
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    print(f"[info] transcribing {VIDEO} (language=zh) ...")
    segments, info = model.transcribe(
        VIDEO, language="zh", beam_size=5,
        vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500)
    )
    print(f"[info] detected language: {info.language} (prob={info.language_probability:.2f})")
    lines = []
    for seg in segments:
        if not seg.text or not seg.text.strip():
            continue
        t = f"[{seg.start:06.1f}-{seg.end:06.1f}] {seg.text.strip()}"
        lines.append(t)
        print(t, flush=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[done] {len(lines)} segments -> {OUT}")

if __name__ == "__main__":
    main()
