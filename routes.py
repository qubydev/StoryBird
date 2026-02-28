from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel  # Import Pydantic
from utils.llm import generate_scenes, generate_image_prompt

router = APIRouter()

# --- 1. Define Pydantic Model for Image Prompt ---
class ImagePromptRequest(BaseModel):
    scene_sentences: str
    previous_scene_context: str | None = None
    character_description: str | None = None
    style: str | None = None

# Accepts a List of Dictionaries as JSON Body
@router.post("/generate-scenes")
async def _generate_scenes(sentences: list[dict]):
    scenes = generate_scenes(sentences)
    return JSONResponse({"scenes": scenes})

# Accepts the Pydantic Model as JSON Body
@router.post("/generate-image-prompt")
async def _generate_image_prompt(request: ImagePromptRequest):
    prompt = generate_image_prompt(
        scene_sentences=request.scene_sentences,
        previous_scene_context=request.previous_scene_context,
        character_description=request.character_description,
        style=request.style
    )
    return JSONResponse({"prompt": prompt})