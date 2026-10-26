from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from projects.admin_auth import admin_session


def health(_request):
    return JsonResponse({"status": "ok", "service": "django"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health),
    # Browser admin panel uses /api/admin/session. Keep it outside the DRF
    # router because it is a tiny hard-coded local-admin session endpoint.
    path("api/admin/session", admin_session),
    path("api/", include("projects.urls")),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
