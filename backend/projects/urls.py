from rest_framework.routers import DefaultRouter

from .views import AssetViewSet, ProjectViewSet, RenderJobViewSet, SceneViewSet

# Next.js normalizes browser URLs without a trailing slash by default.
# Expose DRF routes without trailing slashes too, so POST/PATCH requests never
# depend on Django APPEND_SLASH redirects (which cannot preserve POST bodies).
router = DefaultRouter(trailing_slash=False)
router.register("projects", ProjectViewSet)
router.register("scenes", SceneViewSet)
router.register("assets", AssetViewSet)
router.register("renders", RenderJobViewSet)

urlpatterns = router.urls
