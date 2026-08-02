#!/usr/bin/env bash
set -e
cd /c/Users/EDY/chuangliang_data/tools
export HF_ENDPOINT=https://hf-mirror.com

# ---- 1. ffmpeg 静态二进制 ----
if [ ! -f ffmpeg/bin/ffmpeg.exe ]; then
  echo "[1/4] downloading ffmpeg ..."
  curl -L -o ffmpeg.zip https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
  rm -rf ffmpeg_raw && mkdir -p ffmpeg_raw
  if command -v unzip >/dev/null 2>&1; then
    unzip -o ffmpeg.zip -d ffmpeg_raw >/dev/null
  else
    /c/Users/EDY/.workbuddy/binaries/python/versions/3.13.12/python.exe -c "import zipfile;zipfile.ZipFile('ffmpeg.zip').extractall('ffmpeg_raw')"
  fi
  SRC=$(ls -d ffmpeg_raw/ffmpeg-*/ | head -1)bin
  mkdir -p ffmpeg/bin
  cp "$SRC"/* ffmpeg/bin/ 2>/dev/null || cp -r "$SRC"/. ffmpeg/bin/
  echo "ffmpeg ready: $(ls ffmpeg/bin)"
fi
export PATH="$PWD/ffmpeg/bin:$PATH"
ffmpeg -version | head -1

# ---- 2. venv + 安装 faster-whisper ----
if [ ! -f venv/Scripts/python.exe ]; then
  echo "[2/4] creating venv ..."
  /c/Users/EDY/.workbuddy/binaries/python/versions/3.13.12/python.exe -m venv venv
fi
echo "[3/4] installing faster-whisper ..."
venv/Scripts/python.exe -m pip install -q --upgrade pip
venv/Scripts/python.exe -m pip install -q faster-whisper

# ---- 4. 转写 ----
echo "[4/4] transcribing ..."
venv/Scripts/python.exe transcribe.py
echo "ALL_DONE"
