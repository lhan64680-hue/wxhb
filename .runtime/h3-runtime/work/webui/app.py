from __future__ import annotations

import base64
import binascii
import mimetypes
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import requests
from flask import Flask, Response, jsonify, render_template, request


ROOT = Path(__file__).resolve().parents[1]
COMFY_URL = os.getenv("H3_ENGINE_URL", "http://127.0.0.1:8188").rstrip("/")
MODEL_ROOT = ROOT / "ComfyUI" / "models"
REQUIRED_MODELS = {
    "扩散模型": MODEL_ROOT / "diffusion_models" / "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "文本编码器": MODEL_ROOT / "text_encoders" / "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "视频 VAE": MODEL_ROOT / "vae" / "minimax_h3_video_vae_fp16.safetensors",
    "音频 VAE": MODEL_ROOT / "vae" / "minimax_h3_audio_vae_fp32.safetensors",
}
REF2VA_MODEL = MODEL_ROOT / "diffusion_models" / "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
PROFILES = {
    "draft": {"label": "轻量草稿 · 736×416", "width": 736, "height": 416, "steps": 15},
    "standard": {"label": "标准 · 864×480", "width": 864, "height": 480, "steps": 20},
    "reference": {"label": "多参考 · 736×416", "width": 736, "height": 416, "steps": 20},
    "turbo": {"label": "4 步 Turbo · 864×480", "width": 864, "height": 480, "steps": 4},
}
TURBO_LORA_NAME = "minimax_h3_turbo_v4_step600_ema.safetensors"
TURBO_LORA_PATH = MODEL_ROOT / "loras" / TURBO_LORA_NAME
TURBO_NODE_TYPES = ("MiniMaxH3TurboLoRA", "MiniMaxH3TurboSampler")
H3_MODES = {
    "standard": {"label": "标准", "profile": "standard", "reference": False, "turbo": False},
    "multi-reference": {"label": "多参考", "profile": "reference", "reference": True, "turbo": False},
    "turbo-4step": {"label": "4 步 Turbo", "profile": "turbo", "reference": False, "turbo": True},
}
H3_PROGRESS_SECONDS = {
    "standard": 600,
    "multi-reference": 720,
    "turbo-4step": 180,
}
JOBS: dict[str, dict[str, Any]] = {}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024


@app.after_request
def add_cors_headers(response: Response) -> Response:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Client-Video-Task-ID, X-Video-Task-Source, X-Video-Task-Source-ID"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


def model_state() -> dict[str, bool]:
    return {name: path.is_file() and path.stat().st_size > 100_000_000 for name, path in REQUIRED_MODELS.items()}


def ref2va_model_ready() -> bool:
    # Ignore a partially downloaded checkpoint until ModelScope has completed its atomic rename.
    return REF2VA_MODEL.is_file() and REF2VA_MODEL.stat().st_size > 1_000_000_000


def turbo_lora_ready() -> bool:
    return TURBO_LORA_PATH.is_file() and TURBO_LORA_PATH.stat().st_size > 700_000_000


def turbo_runtime_ready() -> bool:
    if not turbo_lora_ready() or not engine_online():
        return False
    try:
        object_info = requests.get(f"{COMFY_URL}/object_info", timeout=3).json()
    except (requests.RequestException, ValueError):
        return False
    return all(node_type in object_info for node_type in TURBO_NODE_TYPES)


def engine_online() -> bool:
    try:
        return requests.get(f"{COMFY_URL}/system_stats", timeout=2).ok
    except requests.RequestException:
        return False


def frame_count(seconds: int) -> int:
    # H3 requires 17k+5 frames at 24 fps. 124 frames is approximately 5 seconds.
    frames = max(5, round(seconds * 24))
    return frames + (5 - frames % 17) % 17


def link(node: str, slot: int = 0) -> list[Any]:
    return [node, slot]


def h3_prompt(
    text: str,
    profile: str,
    duration: int,
    seed: int,
    first_image: str | None,
    last_image: str | None,
    references: dict[str, list[str]] | None = None,
    turbo: bool = False,
) -> dict[str, Any]:
    settings = PROFILES[profile]
    inputs: dict[str, Any] = {
        "clip": link("clip"),
        "vae": link("video_vae"),
        "prompt": text,
        "width": settings["width"],
        "height": settings["height"],
        "length": frame_count(duration),
    }
    graph: dict[str, Any] = {
        "unet": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default"}},
        "video_vae": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"}},
        "audio_vae": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"}},
        "condition": {"class_type": "MiniMaxH3ImageToVideo", "inputs": inputs},
        "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "schedule": {"class_type": "BasicScheduler", "inputs": {
            "model": link("unet"), "scheduler": "simple", "steps": settings["steps"], "denoise": 1.0}},
        "guider": {"class_type": "BasicGuider", "inputs": {
            "model": link("unet"), "conditioning": link("condition")}},
        "sample": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": link("noise"), "guider": link("guider"), "sampler": link("sampler"),
            "sigmas": link("schedule"), "latent_image": link("condition", 1)}},
        "decode_video": {"class_type": "VAEDecode", "inputs": {"samples": link("sample"), "vae": link("video_vae")}},
        "decode_audio": {"class_type": "VAEDecodeAudio", "inputs": {"samples": link("sample"), "vae": link("audio_vae")}},
        "make_video": {"class_type": "CreateVideo", "inputs": {
            "images": link("decode_video"), "fps": 24.0, "audio": link("decode_audio"), "bit_depth": 8}},
        "save": {"class_type": "SaveVideo", "inputs": {
            "video": link("make_video"), "filename_prefix": "H3-WebUI/H3", "format": "auto", "codec": "auto"}},
    }
    if turbo:
        graph["turbo_lora"] = {"class_type": "MiniMaxH3TurboLoRA", "inputs": {
            "model": link("unet"), "lora_name": TURBO_LORA_NAME, "strength": 1.0, "low_vram": True}}
        graph["turbo_sampler"] = {"class_type": "MiniMaxH3TurboSampler", "inputs": {}}
        graph["schedule"]["inputs"]["model"] = link("turbo_lora")
        graph["guider"]["inputs"]["model"] = link("turbo_lora")
        graph["sample"]["inputs"]["sampler"] = link("turbo_sampler")
    if references:
        graph["unet"]["inputs"]["unet_name"] = REF2VA_MODEL.name
        ref_inputs: dict[str, Any] = {
            "clip": link("clip"),
            "vae": link("video_vae"),
            "audio_vae": link("audio_vae"),
            "prompt": text,
            "width": settings["width"],
            "height": settings["height"],
            "length": frame_count(duration),
            "ref_image_size": "match",
        }
        image_refs: dict[str, Any] = {}
        for index, filename in enumerate(references.get("images", [])):
            node_id = f"reference_image_{index}"
            graph[node_id] = {"class_type": "LoadImage", "inputs": {"image": filename}}
            image_refs[f"ref_image_{index}"] = link(node_id)
        if image_refs:
            ref_inputs["ref_images"] = image_refs

        video_refs: dict[str, Any] = {}
        video_audio_refs: dict[str, Any] = {}
        for index, filename in enumerate(references.get("videos", [])):
            load_id = f"reference_video_load_{index}"
            components_id = f"reference_video_components_{index}"
            graph[load_id] = {"class_type": "LoadVideo", "inputs": {"file": filename}}
            graph[components_id] = {"class_type": "GetVideoComponents", "inputs": {"video": link(load_id)}}
            video_refs[f"ref_video_{index}"] = link(components_id, 0)
            video_audio_refs[f"ref_video_audio_{index}"] = link(components_id, 1)
        if video_refs:
            ref_inputs["ref_videos"] = video_refs
            ref_inputs["ref_video_audios"] = video_audio_refs

        audio_refs: dict[str, Any] = {}
        for index, filename in enumerate(references.get("audios", [])):
            node_id = f"reference_audio_{index}"
            graph[node_id] = {"class_type": "LoadAudio", "inputs": {"audio": filename}}
            audio_refs[f"ref_audio_{index}"] = link(node_id)
        if audio_refs:
            ref_inputs["ref_audios"] = audio_refs
        graph["condition"] = {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": ref_inputs}
        return graph

    if first_image:
        graph["first_image"] = {"class_type": "LoadImage", "inputs": {"image": first_image}}
        inputs["first_frame"] = link("first_image")
    if last_image:
        graph["last_image"] = {"class_type": "LoadImage", "inputs": {"image": last_image}}
        inputs["last_frame"] = link("last_image")
    return graph


def h3_generation_mode(data: dict[str, Any]) -> str:
    requested = str(data.get("h3_mode") or data.get("h3_generation_mode") or "").strip().lower()
    if requested in H3_MODES:
        return requested
    if str(data.get("task") or "").strip().lower() == "ref2va":
        return "multi-reference"
    return "standard"


def find_files(value: Any) -> list[dict[str, str]]:
    if isinstance(value, dict):
        if "filename" in value:
            return [{
                "filename": str(value["filename"]),
                "subfolder": str(value.get("subfolder", "")),
                "type": str(value.get("type", "output")),
            }]
        found: list[dict[str, str]] = []
        for child in value.values():
            found.extend(find_files(child))
        return found
    if isinstance(value, list):
        return [item for child in value for item in find_files(child)]
    return []


def allowed_options() -> Response:
    return Response(status=204)


def parse_int(value: Any, fallback: int) -> int:
    try:
        return int(str(value).strip().rstrip("s"))
    except (TypeError, ValueError):
        return fallback


def upload_reference_uri(uri: str, fallback_name: str) -> str:
    text = uri.strip()
    if not text:
        return ""
    if text.startswith("data:"):
        header, _, encoded = text.partition(",")
        if not encoded:
            raise ValueError("Invalid data URI")
        mime = header[5:].split(";", 1)[0] or "image/png"
        try:
            data = base64.b64decode(encoded, validate=True)
        except binascii.Error as exc:
            raise ValueError("Invalid base64 reference image") from exc
        suffix = mimetypes.guess_extension(mime) or ".png"
        filename = f"{fallback_name}{suffix}"
        files = {"image": (filename, data, mime)}
    elif text.startswith("http://") or text.startswith("https://"):
        remote = requests.get(text, timeout=120)
        remote.raise_for_status()
        mime = remote.headers.get("content-type", "image/png").split(";", 1)[0]
        suffix = Path(urlparse(text).path).suffix or mimetypes.guess_extension(mime) or ".png"
        filename = f"{fallback_name}{suffix}"
        files = {"image": (filename, remote.content, mime)}
    else:
        return text
    response = requests.post(
        f"{COMFY_URL}/upload/image",
        files=files,
        data={"overwrite": "false", "type": "input"},
        timeout=120,
    )
    response.raise_for_status()
    name = response.json().get("name")
    if not name:
        raise ValueError("ComfyUI did not return an uploaded image name")
    return str(name)


def h3_keyframe_images(data: dict[str, Any]) -> tuple[str | None, str | None]:
    first = str(data.get("first_image") or data.get("first_frame") or data.get("first_frame_url") or "").strip()
    last = str(data.get("last_image") or data.get("last_frame") or data.get("last_frame_url") or "").strip()
    conditions = data.get("conditions")
    if isinstance(conditions, list):
        image_refs: list[tuple[int, str]] = []
        unsupported: list[str] = []
        for item in conditions:
            if not isinstance(item, dict):
                continue
            kind = str(item.get("type") or "").strip().lower()
            uri = str(item.get("uri") or item.get("url") or "").strip()
            if not uri:
                continue
            if kind in {"video", "audio"}:
                unsupported.append(kind)
                continue
            if kind and kind != "image":
                continue
            role = str(item.get("role") or "").strip().lower()
            if role not in {"", "keyframe", "reference"}:
                continue
            frame_index = parse_int(item.get("frame_index"), 0)
            image_refs.append((frame_index, uri))
        if unsupported:
            raise ValueError("This local H3 backend supports text-to-video and image keyframes, not video/audio references yet.")
        for frame_index, uri in image_refs:
            if frame_index < 0:
                last = last or uri
            else:
                first = first or uri
        if not first and image_refs:
            first = image_refs[0][1]
        if not last and len(image_refs) > 1:
            last = image_refs[1][1]
    return (
        upload_reference_uri(first, "h3_first") if first else None,
        upload_reference_uri(last, "h3_last") if last else None,
    )


def h3_full_references(data: dict[str, Any]) -> dict[str, list[str]]:
    conditions = data.get("conditions")
    if not isinstance(conditions, list):
        raise ValueError("H3 full-reference mode requires image, video, or audio references")
    raw: dict[str, list[str]] = {"images": [], "videos": [], "audios": []}
    limits = {"image": 9, "video": 3, "audio": 3}
    names = {"image": "images", "video": "videos", "audio": "audios"}
    for item in conditions:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        role = str(item.get("role") or "reference").strip().lower()
        uri = str(item.get("uri") or item.get("url") or "").strip()
        if kind not in limits or role not in {"", "reference"} or not uri:
            continue
        target = names[kind]
        if len(raw[target]) >= limits[kind]:
            raise ValueError(f"H3 full-reference mode supports at most {limits[kind]} {kind} references")
        raw[target].append(uri)
    total = sum(len(items) for items in raw.values())
    if not total:
        raise ValueError("H3 full-reference mode requires at least one image, video, or audio reference")
    if total > 12:
        raise ValueError("H3 full-reference mode supports at most 12 files in total")
    uploaded = {"images": [], "videos": [], "audios": []}
    for index, uri in enumerate(raw["images"]):
        uploaded["images"].append(upload_reference_uri(uri, f"h3_ref_image_{index + 1}"))
    for index, uri in enumerate(raw["videos"]):
        uploaded["videos"].append(upload_reference_uri(uri, f"h3_ref_video_{index + 1}"))
    for index, uri in enumerate(raw["audios"]):
        uploaded["audios"].append(upload_reference_uri(uri, f"h3_ref_audio_{index + 1}"))
    return uploaded


def submit_h3_job(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    text = str(data.get("prompt", "")).strip()
    if not text:
        raise ValueError("Missing prompt")
    if not engine_online():
        raise RuntimeError("H3 engine is not running")
    missing = [name for name, ok in model_state().items() if not ok]
    if missing:
        raise RuntimeError("H3 models are not ready: " + ", ".join(missing))
    target = data.get("target") if isinstance(data.get("target"), dict) else {}
    duration = parse_int(data.get("seconds") or data.get("duration") or target.get("duration_seconds"), 5)
    duration = min(max(duration, 5), 8)
    raw_seed = str(data.get("seed", "")).strip()
    seed = parse_int(raw_seed, int.from_bytes(os.urandom(8), "big")) if raw_seed else int.from_bytes(os.urandom(8), "big")
    mode = h3_generation_mode(data)
    mode_settings = H3_MODES[mode]
    requested_task = str(data.get("task") or "").strip().lower()
    if mode == "turbo-4step" and requested_task == "ref2va":
        raise ValueError("4 步 Turbo 当前仅支持文生视频与首尾帧，不支持多参考 Ref2VA。")
    is_ref2va = bool(mode_settings["reference"])
    if is_ref2va and not ref2va_model_ready():
        raise RuntimeError("H3 full-reference model is not ready: minimax_h3_ref2va_pruned_int8_convrot.safetensors")
    if bool(mode_settings["turbo"]) and not turbo_runtime_ready():
        raise RuntimeError("H3 4-step Turbo is not ready: verify the Turbo LoRA and ComfyUI Turbo nodes, then restart the local H3 engine.")
    references = h3_full_references(data) if is_ref2va else None
    first_image, last_image = (None, None) if is_ref2va else h3_keyframe_images(data)
    profile = str(mode_settings["profile"])
    graph = h3_prompt(text, profile, duration, seed, first_image, last_image, references, turbo=bool(mode_settings["turbo"]))
    client_id = str(uuid.uuid4())
    response = requests.post(f"{COMFY_URL}/prompt", json={"prompt": graph, "client_id": client_id}, timeout=30)
    response.raise_for_status()
    prompt_id = response.json().get("prompt_id")
    if not prompt_id:
        raise ValueError(response.text)
    job_id = str(uuid.uuid4())
    settings = PROFILES[profile]
    JOBS[job_id] = {
        "prompt_id": prompt_id,
        "started_at": time.time(),
        "seed": seed,
        "profile": profile,
        "duration": duration,
        "width": settings["width"],
        "height": settings["height"],
        "h3_mode": mode,
        "model": str(data.get("model") or "MiniMaxAI/MiniMax-H3"),
    }
    return job_id, JOBS[job_id]


def job_record(job_id: str) -> dict[str, Any] | None:
    record = JOBS.get(job_id)
    if isinstance(record, str):
        return {"prompt_id": record}
    return record


def estimated_progress(record: dict[str, Any]) -> int:
    mode = str(record.get("h3_mode") or "standard")
    expected_seconds = H3_PROGRESS_SECONDS.get(mode, H3_PROGRESS_SECONDS["standard"])
    duration = max(5, parse_int(record.get("duration"), 5))
    elapsed = max(0.0, time.time() - float(record.get("started_at") or time.time()))
    return min(95, max(1, round(elapsed / (expected_seconds * duration / 5) * 95)))


def job_status_data(job_id: str) -> dict[str, Any]:
    record = job_record(job_id)
    if not record:
        return {"state": "missing", "error": "Job not found"}
    prompt_id = str(record.get("prompt_id") or "")
    history = requests.get(f"{COMFY_URL}/history/{prompt_id}", timeout=10).json()
    item = history.get(prompt_id)
    if not item:
        return {"state": "running", "record": record}
    status = item.get("status", {})
    if status.get("status_str") == "error":
        messages = status.get("messages", [])
        detail = str(messages[-1] if messages else "Engine execution failed")
        match = re.search(r"exception_message.{0,40}?([A-Za-z][^\\']{0,240})", detail)
        return {"state": "error", "error": match.group(1) if match else detail[-500:], "record": record}
    if not status.get("completed"):
        return {"state": "running", "record": record}
    return {"state": "done", "files": find_files(item.get("outputs", {})), "record": record}


def v1_video_payload(job_id: str, status: dict[str, Any]) -> dict[str, Any]:
    record = status.get("record") or {}
    payload = {
        "id": job_id,
        "task_id": job_id,
        "model": record.get("model") or "MiniMaxAI/MiniMax-H3",
        "seconds": str(record.get("duration") or ""),
        "size": f"{record.get('width') or 736}x{record.get('height') or 416}",
    }
    if status["state"] == "done":
        url = request.host_url.rstrip("/") + f"/v1/videos/{job_id}/content"
        payload.update({"status": "completed", "progress": 100, "url": url, "video_url": url, "data": [{"url": url}]})
    elif status["state"] == "error":
        payload.update({"status": "failed", "progress": 0, "error": {"message": status.get("error") or "H3 generation failed"}})
    else:
        payload.update({"status": "processing", "progress": estimated_progress(record), "progress_mode": "estimated"})
    return payload


def stream_result_file(info: dict[str, str]) -> Response:
    remote = requests.get(
        f"{COMFY_URL}/view?{urlencode({'filename': info['filename'], 'subfolder': info.get('subfolder', ''), 'type': info.get('type', 'output')})}",
        timeout=120,
    )
    remote.raise_for_status()
    return Response(remote.content, content_type=remote.headers.get("content-type", "video/mp4"))


@app.get("/")
def home() -> str:
    return render_template("index.html")


@app.get("/api/health")
def health() -> Response:
    models = model_state()
    return jsonify({
        "engine_online": engine_online(),
        "models": models,
        "ready": all(models.values()),
        "ref2va_ready": ref2va_model_ready(),
        "turbo_lora_ready": turbo_lora_ready(),
        "turbo_ready": turbo_runtime_ready(),
        "modes": {key: {"label": value["label"], "ready": (ref2va_model_ready() if value["reference"] else turbo_runtime_ready() if value["turbo"] else True)} for key, value in H3_MODES.items()},
    })


@app.post("/api/upload")
def upload() -> Response:
    image = request.files.get("image")
    if image is None or not image.filename:
        return jsonify({"error": "请选择图片文件。"}), 400
    if not engine_online():
        return jsonify({"error": "H3 推理引擎尚未启动。请运行启动脚本并稍候。"}), 503
    try:
        response = requests.post(
            f"{COMFY_URL}/upload/image",
            files={"image": (image.filename, image.stream, image.mimetype)},
            data={"overwrite": "false", "type": "input"},
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
        name = data.get("name")
        if not name:
            raise ValueError("引擎未返回文件名")
        return jsonify({"name": name, "subfolder": data.get("subfolder", "")})
    except (requests.RequestException, ValueError) as exc:
        return jsonify({"error": f"上传失败：{exc}"}), 502


@app.post("/api/generate")
def generate() -> Response:
    data = request.get_json(silent=True) or {}
    text = str(data.get("prompt", "")).strip()
    profile = str(data.get("profile", "draft"))
    if not text:
        return jsonify({"error": "请填写视频提示词。"}), 400
    if profile not in PROFILES:
        return jsonify({"error": "无效的画质档位。"}), 400
    try:
        job_id, record = submit_h3_job({**data, "profile": profile})
        duration = int(record["duration"])
        seed = int(record["seed"])
        return jsonify({"job_id": job_id, "seed": seed, "profile": PROFILES[profile], "frames": frame_count(duration)})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    except (ValueError, requests.RequestException) as exc:
        return jsonify({"error": f"提交生成任务失败：{exc}"}), 502


@app.get("/api/jobs/<job_id>")
def job(job_id: str) -> Response:
    if not job_record(job_id):
        return jsonify({"error": "任务不存在或页面已重启。"}), 404
    try:
        status = job_status_data(job_id)
        if status["state"] == "missing":
            return jsonify({"error": "任务不存在或页面已重启。"}), 404
        if status["state"] == "running":
            return jsonify({"state": "running", "progress": estimated_progress(status["record"]), "progress_mode": "estimated"})
        if status["state"] == "error":
            return jsonify({"state": "error", "error": f"推理引擎错误：{status.get('error')}"})
        return jsonify({"state": "done", "files": status.get("files", []), "elapsed": time.time()})
    except requests.RequestException as exc:
        return jsonify({"state": "running", "detail": f"正在等待引擎：{exc}"})


@app.get("/v1/models")
def v1_models() -> Response:
    models = [
        {"id": "minimax-h3/text-to-video", "object": "model"},
        {"id": "minimax-h3/image-to-video", "object": "model"},
    ]
    if ref2va_model_ready():
        models.append({"id": "minimax-h3/reference-to-video", "object": "model"})
    return jsonify({
        "object": "list",
        "data": models,
    })


@app.post("/v1/videos")
def v1_create_video() -> Response:
    data = request.get_json(silent=True) or {}
    try:
        job_id, _ = submit_h3_job(data)
        return jsonify(v1_video_payload(job_id, {"state": "running", "record": job_record(job_id)}))
    except RuntimeError as exc:
        return jsonify({"error": {"message": str(exc)}}), 503
    except (ValueError, requests.RequestException) as exc:
        return jsonify({"error": {"message": str(exc)}}), 400


@app.get("/v1/videos/<job_id>")
def v1_video_status(job_id: str) -> Response:
    try:
        status = job_status_data(job_id)
        if status["state"] == "missing":
            return jsonify({"error": {"message": "Job not found"}}), 404
        return jsonify(v1_video_payload(job_id, status))
    except requests.RequestException as exc:
        return jsonify({"id": job_id, "task_id": job_id, "status": "processing", "progress": 0, "detail": str(exc)})


@app.get("/v1/videos/<job_id>/content")
def v1_video_content(job_id: str) -> Response:
    try:
        status = job_status_data(job_id)
        if status["state"] == "missing":
            return jsonify({"error": {"message": "Job not found"}}), 404
        if status["state"] != "done":
            return jsonify({"error": {"message": "Video is not ready"}}), 409
        files = status.get("files") or []
        if not files:
            return jsonify({"error": {"message": "No output video found"}}), 404
        return stream_result_file(files[0])
    except requests.RequestException as exc:
        return jsonify({"error": {"message": str(exc)}}), 502


@app.get("/api/result")
def result() -> Response:
    filename = request.args.get("filename", "")
    subfolder = request.args.get("subfolder", "")
    kind = request.args.get("type", "output")
    if not filename or ".." in filename or ".." in subfolder:
        return jsonify({"error": "无效的输出文件。"}), 400
    try:
        remote = requests.get(f"{COMFY_URL}/view?{urlencode({'filename': filename, 'subfolder': subfolder, 'type': kind})}", timeout=120)
        remote.raise_for_status()
        return Response(remote.content, content_type=remote.headers.get("content-type", "application/octet-stream"))
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=7860, debug=False, threaded=True)
