import hashlib
import hmac
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

ADMIN_LOGIN_ID = "admin"
ADMIN_PASSWORD = "CBStudio@2026"
COOKIE_NAME = "cb_admin_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7

# Keep this salt aligned with the built-in Next/Electron admin route so the
# same hard-coded admin session works in both Docker/server and desktop modes.
_SESSION_TOKEN = hashlib.sha256(
    f"{ADMIN_LOGIN_ID}:{ADMIN_PASSWORD}:characterbazaar-studio-v104-admin".encode("utf-8")
).hexdigest()


def _digest(value: str) -> bytes:
    return hashlib.sha256(str(value or "").encode("utf-8")).digest()


def verify_admin_credentials(login_id: str, password: str) -> bool:
    return hmac.compare_digest(_digest(login_id), _digest(ADMIN_LOGIN_ID)) and hmac.compare_digest(
        _digest(password), _digest(ADMIN_PASSWORD)
    )


def is_admin_authenticated(request) -> bool:
    supplied = request.COOKIES.get(COOKIE_NAME, "")
    return hmac.compare_digest(_digest(supplied), _digest(_SESSION_TOKEN))


def _set_session_cookie(response: JsonResponse) -> JsonResponse:
    response.set_cookie(
        COOKIE_NAME,
        _SESSION_TOKEN,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="Strict",
        secure=False,
        path="/",
    )
    return response


def _clear_session_cookie(response: JsonResponse) -> JsonResponse:
    response.delete_cookie(COOKIE_NAME, path="/", samesite="Strict")
    return response


@csrf_exempt
@require_http_methods(["GET", "POST", "DELETE"])
def admin_session(request):
    if request.method == "GET":
        return JsonResponse({"authenticated": is_admin_authenticated(request)})

    if request.method == "DELETE":
        return _clear_session_cookie(JsonResponse({}, status=204))

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}

    if not verify_admin_credentials(str(payload.get("loginId", "")), str(payload.get("password", ""))):
        return JsonResponse({"detail": "Invalid admin ID or password"}, status=401)

    return _set_session_cookie(JsonResponse({"authenticated": True}))
