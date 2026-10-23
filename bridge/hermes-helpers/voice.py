"""Speak and transcribe through Hermes' configured TTS and STT providers.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
"""

import json
import os
import sys

sys.path.insert(0, os.getcwd())

from tools.transcription_tools import transcribe_audio  # noqa: E402
from tools.tts_tool import text_to_speech_tool  # noqa: E402


def speak(text, output_path):
    result = json.loads(text_to_speech_tool(text, output_path=output_path))
    if not result.get("success"):
        return {"success": False, "error": result.get("error") or "speech synthesis failed"}
    return {"success": True, "file_path": result.get("file_path") or output_path, "provider": result.get("provider") or "hermes"}


def transcribe(file_path):
    result = transcribe_audio(file_path)
    if not result.get("success"):
        return {"success": False, "error": result.get("error") or "transcription failed"}
    return {"success": True, "text": result.get("transcript") or "", "provider": result.get("provider") or "hermes"}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    if action == "speak":
        result = speak(str(request.get("text") or ""), str(request.get("output_path")))
    elif action == "transcribe":
        result = transcribe(str(request.get("file_path")))
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
