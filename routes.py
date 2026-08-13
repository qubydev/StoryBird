import json
import asyncio
import contextlib
import logging
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse, Response
from pydantic import BaseModel, Field
from utils.llm import generate_scenes, generate_image_prompt, detect_characters, smart_transcript
from utils.google_flow import generate_image, upload_image, open_flow_profile, GoogleFlowError
from utils.video import export_video_generator
from utils.helpers import error_response
from utils.famespeak import generate_voiceover, list_voices, FameSpeakError
from utils.align import align_sentences, format_srt, AlignmentError, is_available as alignment_available
from typing import Literal, Optional, List
from enum import Enum

router = APIRouter()
logger = logging.getLogger(__name__)
tts_jobs: dict[str, dict] = {}


# ─── Pydantic models ────────────────────────────────────────────────────────

class CharacterInput(BaseModel):
    name: str = Field(..., min_length=1, strip_whitespace=True)
    description: str = Field(..., min_length=1, strip_whitespace=True)

class Scene(BaseModel):
    scene_lines: str = Field(..., min_length=1, strip_whitespace=True)
    prompt: str = Field(..., min_length=1, strip_whitespace=True)

class ImagePromptRequest(BaseModel):
    title: str = Field(..., min_length=1, strip_whitespace=True)
    scene_lines: str = Field(..., min_length=1, strip_whitespace=True)
    previous_scenes: Optional[List[Scene]] = None
    characters: Optional[List[CharacterInput]] = None
    instructions: Optional[str] = None
    provider: Optional[Literal["openrouter", "groq"]] = None

class GenerateScenesRequest(BaseModel):
    title: str = Field(..., min_length=1, strip_whitespace=True)
    lines: list[dict]
    provider: Optional[Literal["openrouter", "groq"]] = None

class ImageAspectRatio(str, Enum):
    landscape = "IMAGE_ASPECT_RATIO_LANDSCAPE"
    portrait = "IMAGE_ASPECT_RATIO_PORTRAIT"
    square = "IMAGE_ASPECT_RATIO_SQUARE"

class GenerateImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, strip_whitespace=True)
    aspect_ratio: ImageAspectRatio | None = ImageAspectRatio.landscape
    # Matched against the labels in Flow's own model menu. Left empty, Flow
    # keeps whichever model it currently has selected.
    model: Optional[str] = Field(None, max_length=100)
    session_token: str = ""
    flow_project_url: Optional[str] = None

class CharacterMediaInput(BaseModel):
    name: str = Field(..., min_length=1, strip_whitespace=True)
    description: str = Field(..., min_length=1, strip_whitespace=True)
    mediaId: str = Field(..., min_length=1, strip_whitespace=True)
    image: Optional[str] = None

class GenerateImageCharsRequest(BaseModel):
    prompt: str = Field(..., min_length=1, strip_whitespace=True)
    characters: List[CharacterMediaInput]
    aspect_ratio: ImageAspectRatio | None = ImageAspectRatio.landscape
    model: Optional[str] = Field(None, max_length=100)
    session_token: str = ""
    flow_project_url: Optional[str] = None

class UploadImageRequest(BaseModel):
    rawBytes: str = Field(..., min_length=1, strip_whitespace=True)
    session_token: str = ""

class DetectedCharactersRequest(BaseModel):
    title: str
    lines: list[dict]
    provider: Optional[Literal["openrouter", "groq"]] = None

class SmartTranscriptRequest(BaseModel):
    transcript: str

class AlignmentSentence(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=5000)

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=60000, strip_whitespace=True)
    voice: Optional[str] = Field(None, max_length=200)
    emotion: Optional[str] = Field(None, max_length=50)
    rate: Optional[float] = Field(None, ge=0.5, le=2)
    pitch: Optional[float] = Field(None, ge=-10, le=10)
    # When present, the finished audio is force-aligned against these sentences
    # and the job returns real per-sentence timings.
    sentences: Optional[List[AlignmentSentence]] = None


async def _run_tts_job(job_id: str, request: TTSRequest):
    job = tts_jobs[job_id]

    def update(progress: dict):
        # Never let FameSpeak's own "completed" state reach the job status: the
        # audio is still downloading at that point, and the client would race
        # ahead to /audio before the bytes exist.
        job.update({**progress, "status": "processing"})

    try:
        job.update({"status": "processing", "progress": 5, "message": "Starting FameSpeak generation"})
        audio, media_type = await generate_voiceover(
            text=request.text, voice=request.voice, emotion=request.emotion,
            rate=request.rate, pitch=request.pitch, progress_callback=update,
        )

        if request.sentences:
            job.update({"status": "processing", "progress": 96, "message": "Aligning script to the voiceover"})
            sentences = [sentence.model_dump() for sentence in request.sentences]
            try:
                # Alignment is CPU-bound and takes roughly a third of the audio
                # duration, so it must not block the event loop.
                timings = await asyncio.to_thread(align_sentences, audio, sentences)
                job.update({"timings": timings, "srt": format_srt(timings)})
            except AlignmentError as error:
                # Timings are recoverable: the client estimates them from the
                # audio duration instead, so never fail the voiceover for this.
                job.update({"timings": None, "alignment_error": str(error)})
            except Exception:
                logger.exception("Forced alignment crashed for job %s", job_id)
                job.update({"timings": None, "alignment_error": "Alignment failed unexpectedly."})

        job.update({"status": "completed", "progress": 100, "message": "Voiceover ready", "audio": audio, "media_type": media_type})
    except FameSpeakError as error:
        job.update({"status": "failed", "message": error.message, "status_code": error.status_code})
    except Exception:
        job.update({"status": "failed", "message": "Voiceover generation failed.", "status_code": 500})


# ─── Routes ─────────────────────────────────────────────────────────────────

@router.post("/open-flow-profile")
async def _open_flow_profile():
    opened = open_flow_profile()
    message = "Google Flow sign-in window opened." if opened else "Google Flow sign-in window is already open."
    return JSONResponse({"message": message, "opened": opened})


@router.post("/generate-image-prompt")
async def _generate_image_prompt(request: ImagePromptRequest):
    data = generate_image_prompt(
        title=request.title,
        scene_lines=request.scene_lines,
        previous_scenes=request.previous_scenes,
        characters=request.characters,
        instructions=request.instructions,
        provider=request.provider,
    )
    return JSONResponse(data)


@router.post("/generate-scenes")
async def _generate_scenes(request: GenerateScenesRequest):
    scenes = generate_scenes(request.title, request.lines, provider=request.provider)
    return JSONResponse({"scenes": scenes})


@router.post("/generate-image")
async def _generate_image(request: GenerateImageRequest):
    try:
        data = await generate_image(prompt=request.prompt, aspect_ratio=request.aspect_ratio.value, session_token=request.session_token, project_url=request.flow_project_url, model=request.model)
        return JSONResponse(data)
    except GoogleFlowError as e:
        return error_response(e.status_code, e.message, errors=e.errors, refresh=e.refresh)
    except Exception as e:
        return error_response(500, f"Google Flow automation failed: {type(e).__name__}: {e}")


@router.post("/generate-image-chars")
async def _generate_image_chars(request: GenerateImageCharsRequest):
    try:
        data = await generate_image(
            prompt=request.prompt,
            aspect_ratio=request.aspect_ratio.value,
            session_token=request.session_token,
            references=[character.model_dump() for character in request.characters],
            project_url=request.flow_project_url,
            model=request.model,
        )
        return JSONResponse(data)
    except GoogleFlowError as e:
        return error_response(e.status_code, e.message, errors=e.errors, refresh=e.refresh)
    except Exception as e:
        return error_response(500, f"Google Flow automation failed: {type(e).__name__}: {e}")


@router.post("/upload-character-image")
async def _upload_character_image(request: UploadImageRequest):
    try:
        data = upload_image(
            raw_bytes=request.rawBytes,
            session_token=request.session_token
        )
        return JSONResponse(data)
    except GoogleFlowError as e:
        return error_response(e.status_code, e.message, errors=e.errors, refresh=e.refresh)
    except Exception as e:
        return error_response(500, f"Google Flow automation failed: {type(e).__name__}: {e}")


@router.post("/detect-characters")
async def _detect_characters(request: DetectedCharactersRequest):
    characters = detect_characters(request.title, request.lines, provider=request.provider)
    return {"characters": characters}


@router.post("/export-video")
async def _export_video(
    file: UploadFile = File(...),
    audio: Optional[UploadFile] = File(None),
):
    json_bytes = await file.read()
    try:
        project_json = json.loads(json_bytes)
    except json.JSONDecodeError as e:
        async def _err():
            yield f'data: {json.dumps({"status": "error", "error": f"Invalid JSON: {e}"})}\n\n'
        return StreamingResponse(_err(), media_type="text/event-stream")

    audio_bytes = None
    audio_filename = None
    if audio is not None:
        audio_bytes = await audio.read()
        audio_filename = audio.filename

    async def event_stream():
        gen = export_video_generator(
            project_json=project_json,
            audio_bytes=audio_bytes,
            audio_filename=audio_filename,
        )
        next_event = None
        try:
            while True:
                # Do not use asyncio.wait_for(gen.__anext__(), ...): when it
                # times out it cancels the generator, which also cancels an
                # in-progress ffmpeg export. Wait with a timeout instead and
                # retain the same task while sending SSE keep-alives.
                if next_event is None:
                    next_event = asyncio.create_task(gen.__anext__())

                done, _ = await asyncio.wait({next_event}, timeout=15.0)
                if not done:
                    yield ": keep-alive\n\n"
                    continue

                try:
                    event = next_event.result()
                except StopAsyncIteration:
                    break
                finally:
                    next_event = None

                yield f"data: {json.dumps(event)}\n\n"
        finally:
            # A real client disconnect should still stop the active export and
            # release ffmpeg file handles before its temporary folder is gone.
            if next_event is not None and not next_event.done():
                next_event.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await next_event
            await gen.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        },
    )

@router.post("/smart-transcript")
async def _smart_transcript(request: SmartTranscriptRequest):
    sentences = smart_transcript(request.transcript)
    return {"sentences": sentences}


@router.post("/tts")
async def _generate_tts(request: TTSRequest):
    """Generate a storyboard voiceover without exposing the FameSpeak key."""
    try:
        audio, media_type = await generate_voiceover(
            text=request.text,
            voice=request.voice,
            emotion=request.emotion,
            rate=request.rate,
            pitch=request.pitch,
        )
    except FameSpeakError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error

    extension = "wav" if media_type == "audio/wav" else "mp3"
    return Response(
        content=audio,
        media_type=media_type if media_type.startswith("audio/") else "audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="storyboard-voiceover.{extension}"'},
    )


@router.get("/tts/alignment")
async def _alignment_status():
    """Report whether local forced alignment can run, so the UI can warn early."""
    return {"available": alignment_available()}


@router.get("/tts/voices")
async def _list_tts_voices():
    try:
        return {"voices": await list_voices()}
    except FameSpeakError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error


@router.post("/tts/jobs", status_code=202)
async def _start_tts_job(request: TTSRequest):
    job_id = str(uuid.uuid4())
    tts_jobs[job_id] = {"status": "queued", "progress": 0, "message": "Preparing voiceover"}
    asyncio.create_task(_run_tts_job(job_id, request))
    return {"id": job_id}


@router.get("/tts/jobs/{job_id}")
async def _get_tts_job(job_id: str):
    job = tts_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Voiceover job not found.")
    return {key: value for key, value in job.items() if key not in {"audio", "media_type"}}


@router.get("/tts/jobs/{job_id}/audio")
async def _get_tts_job_audio(job_id: str):
    job = tts_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Voiceover job not found.")
    if job.get("status") == "failed":
        raise HTTPException(status_code=job.get("status_code", 502), detail=job.get("message", "Voiceover generation failed."))
    if not job.get("audio"):
        raise HTTPException(status_code=409, detail="Voiceover audio is not ready yet.")
    return Response(content=job["audio"], media_type=job.get("media_type") or "audio/mpeg")
