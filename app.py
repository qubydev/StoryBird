import sys
import asyncio
from pathlib import Path

# --------------------------------------------------
# Windows Asyncio Subprocess Fix
# Must be called before the event loop starts
# --------------------------------------------------
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from routes import router
from utils.helpers import error_response
from utils.whisk import WhiskError


app = FastAPI(title="StoryBird API")


# --------------------------------------------------
# CORS
# --------------------------------------------------
frontend_ports = [4173, 5173, 3000]

origins = [f"http://localhost:{port}" for port in frontend_ports] + [
    f"http://127.0.0.1:{port}" for port in frontend_ports
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Validation Errors (422)
# --------------------------------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
):
    return error_response(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "Validation failed",
        errors=exc.errors(),
    )


# --------------------------------------------------
# HTTP Errors (404, 405, etc.)
# --------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
):
    return error_response(
        exc.status_code,
        str(exc.detail),
    )


# --------------------------------------------------
# Whisk Service Errors
# --------------------------------------------------
@app.exception_handler(WhiskError)
async def whisk_exception_handler(
    request: Request,
    exc: WhiskError,
):
    return error_response(
        exc.status_code,
        exc.message,
        errors=exc.errors,
        refresh=exc.refresh,
    )


# --------------------------------------------------
# Unexpected Server Errors (500)
# --------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(
    request: Request,
    exc: Exception,
):
    # Optional: add logging here later
    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "Internal server error",
    )


# --------------------------------------------------
# API Routes
# --------------------------------------------------
app.include_router(router, prefix="/api")


# --------------------------------------------------
# Static Files + SPA
# --------------------------------------------------
dist_path = Path(__file__).parent / "frontend" / "dist"

app.mount(
    "/assets",
    StaticFiles(directory=dist_path / "assets"),
    name="assets",
)


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):

    # Prevent SPA from swallowing API mistakes
    if full_path.startswith("api/"):
        return error_response(
            status.HTTP_404_NOT_FOUND,
            "API route not found",
        )

    # Serve root-level static files (logo.svg, favicon.ico, robots.txt, etc.)
    static_file = dist_path / full_path
    if static_file.is_file():
        return FileResponse(static_file)

    # Fall back to index.html for SPA routing
    index_file = dist_path / "index.html"

    if index_file.exists():
        return FileResponse(index_file)

    return error_response(
        status.HTTP_404_NOT_FOUND,
        "Frontend build not found",
    )


# --------------------------------------------------
# Local Dev Entry
# --------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="localhost", port=8000)