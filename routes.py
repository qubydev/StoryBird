import json
import asyncio
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from utils.llm import generate_scenes, generate_image_prompt, detect_characters, smart_transcript
from utils.whisk import generate_image, generate_image_with_chars, upload_image, WhiskError
from utils.video import export_video_generator
from typing import Literal, Optional, List
from enum import Enum

router = APIRouter()


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

class GenerateScenesRequest(BaseModel):
    title: str = Field(..., min_length=1, strip_whitespace=True)
    lines: list[dict]

class ImageAspectRatio(str, Enum):
    landscape = "IMAGE_ASPECT_RATIO_LANDSCAPE"
    portrait = "IMAGE_ASPECT_RATIO_PORTRAIT"
    square = "IMAGE_ASPECT_RATIO_SQUARE"

class GenerateImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, strip_whitespace=True)
    aspect_ratio: ImageAspectRatio | None = ImageAspectRatio.landscape
    model: Literal["IMAGEN_3_5"] = "IMAGEN_3_5"
    session_token: str = Field(..., min_length=1, strip_whitespace=True)

class CharacterMediaInput(BaseModel):
    name: str = Field(..., min_length=1, strip_whitespace=True)
    description: str = Field(..., min_length=1, strip_whitespace=True)
    mediaId: str = Field(..., min_length=1, strip_whitespace=True)

class GenerateImageCharsRequest(BaseModel):
    prompt: str = Field(..., min_length=1, strip_whitespace=True)
    characters: List[CharacterMediaInput]
    aspect_ratio: ImageAspectRatio | None = ImageAspectRatio.landscape
    session_token: str = Field(..., min_length=1, strip_whitespace=True)

class UploadImageRequest(BaseModel):
    rawBytes: str = Field(..., min_length=1, strip_whitespace=True)
    session_token: str = Field(..., min_length=1, strip_whitespace=True)

class DetectedCharactersRequest(BaseModel):
    title: str
    lines: list[dict]

class SmartTranscriptRequest(BaseModel):
    transcript: str


# ─── Routes ─────────────────────────────────────────────────────────────────

@router.post("/generate-image-prompt")
async def _generate_image_prompt(request: ImagePromptRequest):
    data = generate_image_prompt(
        title=request.title,
        scene_lines=request.scene_lines,
        previous_scenes=request.previous_scenes,
        characters=request.characters,
        instructions=request.instructions,
    )
    return JSONResponse(data)


@router.post("/generate-scenes")
async def _generate_scenes(request: GenerateScenesRequest):
    scenes = generate_scenes(request.title, request.lines)
    return JSONResponse({"scenes": scenes})


@router.post("/generate-image")
async def _generate_image(request: GenerateImageRequest):
    try:
        data = generate_image(
            prompt=request.prompt,
            aspect_ratio=request.aspect_ratio.value,
            model=request.model,
            session_token=request.session_token
        )
        return JSONResponse(data)
    except WhiskError as e:
        return JSONResponse({"error": e.message, "refresh": e.refresh}, status_code=e.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/generate-image-chars")
async def _generate_image_chars(request: GenerateImageCharsRequest):
    try:
        formatted_characters = []
        for chr in request.characters:
            formatted_characters.append({
                "caption": f"{chr.name}: {chr.description}",
                "mediaInput": {
                    "mediaCategory": "MEDIA_CATEGORY_SUBJECT",
                    "mediaGenerationId": chr.mediaId
                }
            })

        data = generate_image_with_chars(
            prompt=request.prompt,
            recipe_media_inputs=formatted_characters,
            aspect_ratio=request.aspect_ratio.value,
            session_token=request.session_token
        )
        return JSONResponse(data)
    except WhiskError as e:
        return JSONResponse({"error": e.message, "refresh": e.refresh}, status_code=e.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/upload-character-image")
async def _upload_character_image(request: UploadImageRequest):
    try:
        data = upload_image(
            raw_bytes=request.rawBytes,
            session_token=request.session_token
        )
        return JSONResponse(data)
    except WhiskError as e:
        return JSONResponse({"error": e.message, "refresh": e.refresh}, status_code=e.status_code)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/detect-characters")
async def _detect_characters(request: DetectedCharactersRequest):
    characters = detect_characters(request.title, request.lines)
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
        # Initialize the async generator
        gen = export_video_generator(
            project_json=project_json,
            audio_bytes=audio_bytes,
            audio_filename=audio_filename,
        )
        
        while True:
            try:
                # Wait for the next log message, but timeout every 15 seconds
                event = await asyncio.wait_for(gen.__anext__(), timeout=15.0)
                yield f"data: {json.dumps(event)}\n\n"
            except StopAsyncIteration:
                # The generator finished normally
                break
            except asyncio.TimeoutError:
                # FFMPEG is still working on a long scene, send a keep-alive ping!
                yield ": keep-alive\n\n"

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