import re
from utils.redis_client import client as r_client
import requests
from fastapi import status
from utils.helpers import number_to_position

WHISK_SESSION_TOKEN_KEY = "whisk:session_token"
SESSION_URL = "https://labs.google/fx/api/auth/session"
IMAGE_GENERATION_URL = "https://aisandbox-pa.googleapis.com/v1/whisk:generateImage"
IMAGE_RECIPE_URL = "https://aisandbox-pa.googleapis.com/v1/whisk:runImageRecipe"
UPLOAD_IMAGE_URL = "https://labs.google/fx/api/trpc/backbone.uploadImage"
REFRESH_STATUSES = [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]
REFRESH_ERROR_CODES = ["ACCESS_TOKEN_REFRESH_NEEDED"]

# --------------------------------
# Custom Service Exception
# --------------------------------
class WhiskError(Exception):
    def __init__(self, status_code, message):
        self.status_code = status_code

        if status_code in REFRESH_STATUSES:
            r_client.delete(WHISK_SESSION_TOKEN_KEY)
            self.message = "Session expired, please set a new session key and try again"
            self.refresh = True
        else:
            self.message = message
            self.refresh = False

        self._message = message
        super().__init__(self.message)


# --------------------------------
# Access Token Fetch
# --------------------------------
def fetch_access_token(session_token):
    resp = requests.get(
        SESSION_URL,
        headers={"Cookie": f"__Secure-next-auth.session-token={session_token}"}
    )

    if not resp.ok:
        # NOTE: This API always returns a 200 status code,
        # even for errors,
        # and includes an error message in the response body.
        message = resp.text or "Unknown error occurred while fetching access token"
        raise WhiskError(
            resp.status_code,
            f"Failed to fetch access token: {message}",
        )

    data = resp.json()
    access_token = data.get("access_token")

    if data.get("error"):
        if data["error"] in REFRESH_ERROR_CODES:
            raise WhiskError(
                status.HTTP_401_UNAUTHORIZED,
                "Session expired, please set a new session key and try again",
            )

        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Error fetching access token: {data['error']}",
        )
    
    if not access_token:
        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
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
    # get access token from redis
    access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)
    if isinstance(access_token, bytes):
        access_token = access_token.decode("utf-8")
    
    # access token was not found in redis,
    # fetch a new one and update redis
    if not access_token:
        access_token = fetch_access_token(session_token)
        r_client.set(WHISK_SESSION_TOKEN_KEY, access_token)

        access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)
        if isinstance(access_token, bytes):
            access_token = access_token.decode("utf-8")
    
    # If still not found, raise an error
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

        raise WhiskError(
            response.status_code,
            message=message
        )

    return response.json()


# --------------------------------
# Image Generation with Characters
# --------------------------------
def generate_image_with_chars(
    prompt,
    recipe_media_inputs,
    aspect_ratio="IMAGE_ASPECT_RATIO_LANDSCAPE",
    session_token=None,
):
    if "[CHX]" in prompt:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Unlinked character placeholder is not allowed",
        )
    
    matches = re.findall(r'\[CH(\d+)\]', prompt)

    unique_chars = []
    for m in matches:
        if m not in unique_chars:
            unique_chars.append(m)

    if len(unique_chars) > 10:
        raise WhiskError(
            status.HTTP_400_BAD_REQUEST,
            "Maximum 10 different characters are allowed",
        )

    char_mapping = {
        ch: f"{number_to_position(index + 1)} Character"
        for index, ch in enumerate(unique_chars)
    }

    def replace_character(match):
        ch_number = match.group(1)
        return char_mapping.get(ch_number, "Character")

    prompt = re.sub(r'\[CH(\d+)\]', replace_character, prompt)

    # get access token from redis
    access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)
    if isinstance(access_token, bytes):
        access_token = access_token.decode("utf-8")
    
    # access token was not found in redis,
    # fetch a new one and update redis
    if not access_token:
        access_token = fetch_access_token(session_token)
        r_client.set(WHISK_SESSION_TOKEN_KEY, access_token)

        access_token = r_client.get(WHISK_SESSION_TOKEN_KEY)
        if isinstance(access_token, bytes):
            access_token = access_token.decode("utf-8")
    
    # If still not found, raise an error
    if not access_token:
        raise WhiskError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Failed to update access token",
        )

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

        raise WhiskError(
            response.status_code,
            message=message
        )

    return response.json()

# --------------------------------
# Image Upload
# --------------------------------
def upload_image(raw_bytes, session_token):
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

    response = requests.post(UPLOAD_IMAGE_URL, json=payload, headers=headers)

    if not response.ok:
        try:
            error_data = response.json()
            message = error_data.get("error", {}).get("message", "Unknown error occurred")
        except ValueError:
            message = response.text or "Unknown error occurred"

        raise WhiskError(
            response.status_code,
            message=message
        )
    
    try:
        data = response.json()
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