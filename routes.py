from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from nanoid import generate
import os
import shutil
from utils.transcript import transcribe_audio_file, format_data

router = APIRouter()

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