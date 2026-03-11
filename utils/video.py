import base64
import os
import asyncio
import tempfile
import logging
import shutil
import uuid
import subprocess
from pathlib import Path
from typing import Optional, AsyncGenerator
from PIL import Image
import io

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

WIDTH         = 1920
HEIGHT        = 1080
FPS           = 25
VIDEO_CODEC   = "libx264"
AUDIO_CODEC   = "aac"
AUDIO_BITRATE = "128k"
CRF           = 23
PRESET        = "ultrafast"
JPEG_QUALITY  = 95
ZOOM_PER_SEC  = 0.01

def _parse_timestamp(ts: str) -> float:
    ts = ts.replace(',', '.')
    h, m, s = ts.split(':')
    return float(h) * 3600 + float(m) * 60 + float(s)

def _fit_image(pil_img: Image.Image) -> Image.Image:
    img_w, img_h = pil_img.size
    scale = max(WIDTH / img_w, HEIGHT / img_h)
    new_w, new_h = int(img_w * scale), int(img_h * scale)
    resized = pil_img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - WIDTH)  // 2
    top  = (new_h - HEIGHT) // 2
    return resized.crop((left, top, left + WIDTH, top + HEIGHT))

def _compute_scene_durations(scenes: list) -> list:
    raw = []
    for scene in scenes:
        sentences = scene.get("sentences", [])
        if sentences:
            try:
                t0 = _parse_timestamp(sentences[0]["start"])
                t1 = _parse_timestamp(sentences[-1]["end"])
                raw.append((t0, max(t1, t0 + 0.5)))
                continue
            except Exception:
                pass
        raw.append(None)

    for i, t in enumerate(raw):
        if t is not None:
            continue
        prev_end = raw[i - 1][1] if i > 0 and raw[i - 1] is not None else 0.0
        next_start = next((raw[j][0] for j in range(i + 1, len(raw)) if raw[j] is not None), None)
        raw[i] = (prev_end, next_start if next_start is not None else prev_end + 3.0)

    adjusted = list(raw)
    for i in range(len(adjusted) - 1):
        curr_end, next_start = adjusted[i][1], adjusted[i + 1][0]
        if next_start > curr_end:
            mid = (curr_end + next_start) / 2.0
            adjusted[i]     = (adjusted[i][0], mid)
            adjusted[i + 1] = (mid, adjusted[i + 1][1])

    return adjusted

def _make_kenburns_filter(duration: float, zoom_in: bool) -> str:
    n_frames   = max(1, round(duration * FPS))
    total_zoom = ZOOM_PER_SEC * duration
    zoom_step  = total_zoom / n_frames
    start_zoom = 1.0 + total_zoom

    if zoom_in:
        z_expr = f"zoom+{zoom_step:.6f}"
    else:
        z_expr = f"if(lte(zoom,1.0),{start_zoom:.6f},max(zoom-{zoom_step:.6f},1.0))"

    x_expr = "iw/2-(iw/zoom/2)"
    y_expr = "ih/2-(ih/zoom/2)"

    return (
        f"scale=8000:-1,zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':d={n_frames}:s={WIDTH}x{HEIGHT}:fps={FPS},trim=duration={duration:.3f},format=yuv420p"
    )

async def _run_ffmpeg_async(cmd: list, step_name: str) -> Optional[str]:
    """Runs ffmpeg synchronously in a background thread to avoid blocking the async loop."""
    def sync_run():
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    process = await asyncio.to_thread(sync_run)
    
    if process.returncode != 0:
        err_msg = process.stderr.decode("utf-8", errors="replace")
        logger.error(f"[{step_name}] FAILED:\n{err_msg}")
        return err_msg
    return None

async def export_video_generator(
    project_json: dict,
    audio_bytes: Optional[bytes] = None,
    audio_filename: Optional[str] = None,
) -> AsyncGenerator[dict, None]:
    try:
        scenes = [s for s in project_json.get("items", []) if s.get("type") == "scene"]
        if not scenes:
            yield {"status": "error", "error": "No scenes found in project file."}
            return
        
        # Every scene should have a image
        yield {"status": "processing", "message": f"Validating project data..."}
        for idx, scene in enumerate(scenes):
            if "image" not in scene:
                yield {"status": "error", "error": f"Scene {idx} is missing an image."}
                return

        total = len(scenes)
        scene_times = _compute_scene_durations(scenes)
        
        yield {"status": "processing", "message": f"Starting video export: {total} scenes total."}

        with tempfile.TemporaryDirectory() as tmpdir:
            clip_paths = []
            
            # 1. Render scenes
            for idx, scene in enumerate(scenes):
                yield {"status": "processing", "message": f"Processing Scene {idx + 1}/{total}..."}

                t0, t1   = scene_times[idx]
                duration = max(t1 - t0, 0.5)
                zoom_in  = (idx % 2 == 0)

                img_data = scene.get("image", "")
                img_path = os.path.join(tmpdir, f"scene_{idx:04d}.jpg")

                if not img_data:
                    Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0)).save(img_path, "JPEG")
                else:
                    if ',' in img_data:
                        img_data = img_data.split(',', 1)[1]
                    pil = Image.open(io.BytesIO(base64.b64decode(img_data))).convert("RGB")
                    pil = _fit_image(pil)
                    pil.save(img_path, "JPEG", quality=JPEG_QUALITY)

                clip_path = os.path.join(tmpdir, f"clip_{idx:04d}.mp4")

                if ZOOM_PER_SEC > 0:
                    vf = _make_kenburns_filter(duration, zoom_in)
                    cmd = ["ffmpeg", "-y", "-loop", "1", "-framerate", str(FPS), "-i", img_path, "-vf", vf, "-t", f"{duration:.3f}", "-c:v", VIDEO_CODEC, "-preset", PRESET, "-crf", str(CRF), "-an", clip_path]
                else:
                    cmd = ["ffmpeg", "-y", "-loop", "1", "-framerate", str(FPS), "-i", img_path, "-vf", f"scale={WIDTH}:{HEIGHT}:flags=lanczos,format=yuv420p", "-t", f"{duration:.3f}", "-c:v", VIDEO_CODEC, "-preset", PRESET, "-crf", str(CRF), "-an", clip_path]
                
                err = await _run_ffmpeg_async(cmd, f"Scene {idx}")
                if err:
                    yield {"status": "error", "error": f"ffmpeg scene {idx} failed"}
                    return

                clip_paths.append(clip_path)

            # 2. Concat list
            yield {"status": "processing", "message": "Generating concat file..."}
            concat_path = os.path.join(tmpdir, "concat.txt")
            with open(concat_path, "w") as f:
                for cp in clip_paths:
                    f.write(f"file '{cp}'\n")

            # 3. Save audio
            audio_path = None
            if audio_bytes:
                yield {"status": "processing", "message": "Saving audio track..."}
                ext = Path(audio_filename).suffix if audio_filename else ".mp3"
                audio_path = os.path.join(tmpdir, f"audio{ext}")
                with open(audio_path, "wb") as f:
                    f.write(audio_bytes)

            # 4. Final concat + mux
            yield {"status": "processing", "message": "Running final concatenation and muxing..."}
            output_path = os.path.join(tmpdir, "output.mp4")
            cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_path]
            if audio_path:
                cmd += ["-i", audio_path, "-shortest"]
            cmd += ["-c:v", "copy"]
            if audio_path:
                cmd += ["-c:a", AUDIO_CODEC, "-b:a", AUDIO_BITRATE]
            cmd.append(output_path)

            err = await _run_ffmpeg_async(cmd, "Final Concat/Mux")
            if err:
                yield {"status": "error", "error": "ffmpeg concat failed"}
                return

            # 5. Move to persistent exports folder
            yield {"status": "processing", "message": "Saving final video to server..."}
            
            # --- CREATING EXPORTS FOLDER HERE ---
            os.makedirs("exports", exist_ok=True)
            
            unique_filename = f"export_{uuid.uuid4().hex[:8]}.mp4"
            final_save_path = os.path.join("exports", unique_filename)
            
            shutil.copy(output_path, final_save_path)
            
            video_url = f"/exports/{unique_filename}"

        yield {"status": "done", "message": "Export completed successfully!", "video_url": video_url}

    except Exception as e:
        import traceback
        err_trace = traceback.format_exc()
        logger.error(f"Export crashed: {e}\n{err_trace}")
        yield {"status": "error", "error": f"{type(e).__name__}: {e}"}