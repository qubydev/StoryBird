from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel  # Import Pydantic
from nanoid import generate
import os
import shutil
from utils.transcript import transcribe_audio_file, format_data
from utils.llm import generate_scenes, generate_image_prompt

router = APIRouter()

# --- 1. Define Pydantic Model for Image Prompt ---
class ImagePromptRequest(BaseModel):
    scene_sentences: str
    previous_scene_context: str | None = None
    character_description: str | None = None
    style: str | None = None

@router.post("/upload-audio")
async def _upload_audio(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1]
    random_name = generate(size=10) + ext
    upload_dir = os.path.join(os.path.dirname(__file__), "../uploads")
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, random_name)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return JSONResponse({"filename": random_name})

@router.get("/transcribe")
async def _transcribe(filename: str):
    upload_dir = os.path.join(os.path.dirname(__file__), "../uploads")
    file_path = os.path.join(upload_dir, filename)
    if not os.path.exists(file_path):
        return JSONResponse({"error": "File not found"}, status_code=404)
    
    transcription_data = transcribe_audio_file(file_path)
    return JSONResponse({"transcription": format_data(transcription_data)})

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