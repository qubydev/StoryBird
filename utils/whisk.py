from utils.redis_client import client as r_client
import requests
from fastapi import status


WHISK_SESSION_TOKEN_KEY = "whisk:session_token"
SESSION_URL = "https://labs.google/fx/api/auth/session"
IMAGE_GENERATION_URL = "https://aisandbox-pa.googleapis.com/v1/whisk:generateImage"
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
# Image Generation
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

            message = (
                error_data
                .get("error", {})
                .get("message", "Unknown error occurred")
            )

        except ValueError:
            message = response.text or "Unknown error occurred"

        raise WhiskError(
            response.status_code,
            message,
            refresh=response.status_code in REFRESH_STATUSES
        )

    return response.json()