from utils.redis_client import client as r_client
import requests
from fastapi import status

WHISK_SESSION_TOKEN_KEY = "whisk:session_token"
SESSION_URL = "https://labs.google/fx/api/auth/session"
IMAGE_GENERATION_URL = "https://aisandbox-pa.googleapis.com/v1/whisk:generateImage"
IMAGE_RECIPE_URL = "https://aisandbox-pa.googleapis.com/v1/whisk:runImageRecipe"
UPLOAD_IMAGE_URL = "https://labs.google/fx/api/trpc/backbone.uploadImage"
REFRESH_STATUSES = [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]


# --------------------------------
# Custom Service Exception
# --------------------------------
class WhiskError(Exception):
    def __init__(self, status_code, message, refresh=False, errors=None):
        self.status_code = status_code
        self.message = message
        self.refresh = refresh
        self.errors = errors
        super().__init__(message)


# --------------------------------
# Access Token Fetch
# --------------------------------
def fetch_access_token(session_token):
    resp = requests.get(
        SESSION_URL,
        headers={"Cookie": f"__Secure-next-auth.session-token={session_token}"}
    )

    if not resp.ok:
        raise WhiskError(
            resp.status_code,
            f"Failed to fetch access token: {resp.text}",
        )

    data = resp.json()
    access_token = data.get("access_token")

    if not access_token:
        raise WhiskError(
            status.HTTP_401_UNAUTHORIZED,
            "Access token not found in response",
        )

    return access_token


# --------------------------------
# Standard Image Generation
# --------------------------------
def generate_image(
    prompt,
    aspect_ratio="IMAGE_ASPECT_RATIO_LANDSCAPE",
    model="IMAGEN_3_5",
    session_token=None,
):
    if not session_token:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Session token is required to generate image",
        )

    if not prompt:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Prompt is required to generate image",
        )

    access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)

    if isinstance(access_token, bytes):
        access_token = access_token.decode("utf-8")

    if not access_token:
        access_token = fetch_access_token(session_token)
        r_client.set(WHISK_SESSION_TOKEN_KEY, access_token)

        access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)
        if isinstance(access_token, bytes):
            access_token = access_token.decode("utf-8")

    if not access_token:
        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Failed to update access token",
        )

    payload = {
        "imageModelSettings": {
            "imageModel": model,
            "aspectRatio": aspect_ratio,
        },
        "prompt": prompt,
    }

    response = requests.post(
        IMAGE_GENERATION_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json=payload,
    )

    if not response.ok:
        try:
            error_data = response.json()
            message = error_data.get("error", {}).get("message", "Unknown error occurred")
        except ValueError:
            message = response.text or "Unknown error occurred"
        
        should_refresh = response.status_code in REFRESH_STATUSES
        if should_refresh:
            r_client.delete(WHISK_SESSION_TOKEN_KEY)

        raise WhiskError(
            response.status_code,
            message,
            refresh=should_refresh,
            errors=error_data.get("error", {}).get("details", []) if 'error_data' in locals() else []
        )

    return response.json()


# --------------------------------
# Image Generation with Characters
# --------------------------------
def generate_image_with_chars(
    prompt,
    characters,
    aspect_ratio="IMAGE_ASPECT_RATIO_LANDSCAPE",
    session_token=None,
):
    if not session_token:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Session token is required to generate image",
        )

    if not prompt:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Prompt is required to generate image",
        )

    access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)

    if isinstance(access_token, bytes):
        access_token = access_token.decode("utf-8")

    if not access_token:
        access_token = fetch_access_token(session_token)
        r_client.set(WHISK_SESSION_TOKEN_KEY, access_token)

        access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)
        if isinstance(access_token, bytes):
            access_token = access_token.decode("utf-8")

    if not access_token:
        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Failed to update access token",
        )

    recipe_media_inputs = []
    for char in characters:
        recipe_media_inputs.append({
            "caption": char.get("description", "Character"),
            "mediaInput": {
                "mediaCategory": "MEDIA_CATEGORY_SUBJECT",
                "mediaGenerationId": char.get("mediaId")
            }
        })

    payload = {
        "imageModelSettings": {
            "imageModel": "GEM_PIX",
            "aspectRatio": aspect_ratio
        },
        "userInstruction": prompt,
        "recipeMediaInputs": recipe_media_inputs
    }

    response = requests.post(
        IMAGE_RECIPE_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json=payload,
    )

    if not response.ok:
        try:
            error_data = response.json()
            message = error_data.get("error", {}).get("message", "Unknown error occurred")
        except ValueError:
            message = response.text or "Unknown error occurred"
        
        should_refresh = response.status_code in REFRESH_STATUSES
        if should_refresh:
            r_client.delete(WHISK_SESSION_TOKEN_KEY)

        raise WhiskError(
            response.status_code,
            message,
            refresh=should_refresh,
            errors=error_data.get("error", {}).get("details", []) if 'error_data' in locals() else []
        )

    return response.json()


# --------------------------------
# Image Upload
# --------------------------------
def upload_image(raw_bytes, session_token):
    if not session_token:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Session token is required to upload image"
        )
    
    if not raw_bytes:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Raw bytes are required to upload image"
        )

    headers = {
        "Cookie": f"__Secure-next-auth.session-token={session_token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "json": {
            "uploadMediaInput": {
                "mediaCategory": "MEDIA_CATEGORY_SUBJECT",
                "rawBytes": raw_bytes
            }
        }
    }
    
    try:
        res = requests.post(UPLOAD_IMAGE_URL, json=payload, headers=headers)
        res.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Upload request failed: {str(e)}"
        )

    try:
        data = res.json()
        media_id = data.get("result", {}).get("data", {}).get("json", {}).get("result", {}).get("uploadMediaGenerationId")
        
        if not media_id:
            raise WhiskError(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Failed to retrieve uploadMediaGenerationId from external API"
            )
        
        return {"uploadMediaGenerationId": media_id}
    except ValueError:
        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Invalid JSON response from upload API"
        )