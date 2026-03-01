from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from utils.llm import generate_scenes, generate_image_prompt
from utils.whisk import generate_image
from typing import Literal
from enum import Enum

router = APIRouter()

class ImagePromptRequest(BaseModel):
    scene_lines: str
    character_description: str | None = None
    animation_style: str | None = None

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

@router.post("/generate-image-prompt")
async def _generate_image_prompt(request: ImagePromptRequest):
    prompt = generate_image_prompt(
        scene_lines=request.scene_lines,
        character_description=request.character_description,
        animation_style=request.animation_style
    )
    return JSONResponse({"prompt": prompt})

@router.post("/generate-scenes")
async def _generate_scenes(request: GenerateScenesRequest):
    scenes = generate_scenes(request.title, request.lines)
    return JSONResponse({"scenes": scenes})

@router.post("/generate-image")
async def _generate_image(request: GenerateImageRequest):
    data = generate_image(
        prompt=request.prompt,
        aspect_ratio=request.aspect_ratio.value,
        model=request.model,
        session_token=request.session_token
    )
    return JSONResponse(data)

@router.post("/err-check")
async def _err_check(body: dict):
    return JSONResponse({"received": body})