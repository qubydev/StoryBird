from fastapi.responses import JSONResponse

# -----------------------------
# Unified Error Response Helper
# -----------------------------
def error_response(status_code: int, message: str, errors=None, refresh=False):
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "message": message,
            "errors": errors,
            "refresh": refresh
        },
    )