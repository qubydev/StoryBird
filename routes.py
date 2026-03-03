from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from utils.llm import generate_scenes, generate_image_prompt, detect_characters
from utils.whisk import generate_image, generate_image_with_chars, upload_image, WhiskError
from typing import Literal, Optional, List
from enum import Enum

router = APIRouter()

class CharacterInput(BaseModel):
    mediaId: str
    description: str

class ImagePromptRequest(BaseModel):
    title: str
    scene_lines: str
    instructions: Optional[str] = None
    previous_prompt: Optional[str] = None
    characters: Optional[List[CharacterInput]] = None

class GenerateScenesRequest(BaseModel):
    title: str
    lines: list[dict]

class ImageAspectRatio(str, Enum):
    landscape = "IMAGE_ASPECT_RATIO_LANDSCAPE"
    portrait = "IMAGE_ASPECT_RATIO_PORTRAIT"
    square = "IMAGE_ASPECT_RATIO_SQUARE"

class GenerateImageRequest(BaseModel):
    prompt: str
    aspect_ratio: ImageAspectRatio | None = ImageAspectRatio.landscape
    model: Literal["IMAGEN_3_5"] = "IMAGEN_3_5"
    session_token: str

class GenerateImageCharsRequest(BaseModel):
    prompt: str
    characters: List[CharacterInput]
    aspect_ratio: ImageAspectRatio | None = ImageAspectRatio.landscape
    session_token: str

class UploadImageRequest(BaseModel):
    rawBytes: str
    session_token: str

class DetectedCharactersRequest(BaseModel):
    title: str
    lines: list[dict]

@router.post("/generate-image-prompt")
async def _generate_image_prompt(request: ImagePromptRequest):
    data = generate_image_prompt(
        title=request.title,
        scene_lines=request.scene_lines,
        instructions=request.instructions,
        previous_prompt=request.previous_prompt,
        characters=request.characters
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
        data = generate_image_with_chars(
            prompt=request.prompt,
            characters=[c.dict() for c in request.characters],
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