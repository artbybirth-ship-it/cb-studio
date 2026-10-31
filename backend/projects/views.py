from pathlib import Path
import re
import shutil
import time
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.db.models import Max
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .models import Asset, Project, RenderJob, Scene
from .serializers import AssetSerializer, ProjectSerializer, RenderJobSerializer, SceneSerializer
from .tasks import render_project
from .character_library import CHARACTER_BRIDGE_VERSION, FLA_TIMELINE_VERSION, POSE_LENGTH_VERSION, attach_fla_timelines, duplicate_character_package, install_character_library_zip, package_fingerprint, refresh_pose_lengths, upgrade_package_bridges, with_character_category
from .media_library import LIBRARY_ASSET_KIND, LIBRARY_TYPES, delete_media_library_files, install_media_library_zip
from .admin_auth import is_admin_authenticated


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.prefetch_related("scenes").all()
    serializer_class = ProjectSerializer

    def perform_create(self, serializer):
        project = serializer.save()
        Scene.objects.create(project=project, name="Scene 1", order=0)

    @action(detail=True, methods=["post"])
    def add_scene(self, request, pk=None):
        project = self.get_object()
        max_order = project.scenes.aggregate(m=Max("order"))["m"]
        next_order = 0 if max_order is None else max_order + 1
        scene = Scene.objects.create(project=project, name=f"Scene {next_order + 1}", order=next_order)
        return Response(SceneSerializer(scene).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def thumbnail(self, request, pk=None):
        """Small snapshot of the project's first frame for the editor's Open Project panel."""
        project = self.get_object()
        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > 2 * 1024 * 1024:
            return Response({"detail": "thumbnail is too large"}, status=status.HTTP_400_BAD_REQUEST)
        if (upload.content_type or "").lower() not in {"image/jpeg", "image/png", "image/webp"}:
            return Response({"detail": "thumbnail must be a JPEG, PNG or WebP image"}, status=status.HTTP_400_BAD_REQUEST)
        folder = Path(settings.MEDIA_ROOT) / "project_thumbnails"
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{project.id.hex}.jpg"
        with open(folder / name, "wb") as target:
            for chunk in upload.chunks():
                target.write(chunk)
        project.thumbnail_url = f"{settings.MEDIA_URL}project_thumbnails/{name}?v={int(time.time())}"
        project.save(update_fields=["thumbnail_url", "updated_at"])
        return Response(ProjectSerializer(project).data)

    @action(detail=True, methods=["post"])
    def render(self, request, pk=None):
        project = self.get_object()
        job = RenderJob.objects.create(project=project)
        project.status = "rendering"
        project.save(update_fields=["status", "updated_at"])
        # Export format (mp4 / gif / jpeg / png); a still is the frame at "time" of "scene".
        export_format = str(request.data.get("format") or "mp4").lower()
        try:
            still_time = float(request.data.get("time") or 0)
        except (TypeError, ValueError):
            still_time = 0.0
        resolution = str(request.data.get("resolution") or "fullhd").lower()  # MP4: hd / fullhd / 4k
        render_project.delay(str(job.id), export_format, still_time, request.data.get("scene") or None, resolution)
        return Response(RenderJobSerializer(job).data, status=status.HTTP_202_ACCEPTED)


class SceneViewSet(viewsets.ModelViewSet):
    queryset = Scene.objects.select_related("project").all()
    serializer_class = SceneSerializer

    def destroy(self, request, *args, **kwargs):
        """Delete a scene from the editor's scene tabs; a project always keeps at least one."""
        scene = self.get_object()
        if scene.project.scenes.count() <= 1:
            return Response({"detail": "A project needs at least one scene."}, status=status.HTTP_400_BAD_REQUEST)
        project = scene.project
        scene.delete()
        project.save(update_fields=["updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


_HEX_COLOR = re.compile(r"^#[0-9a-f]{6}$")


def _clean_color_rules(value) -> list[dict]:
    """Recolour rules for a My characters package (same shape as the desktop app stores)."""
    if not isinstance(value, list):
        raise ValueError("colorReplacements must be a list")
    rules = []
    for index, item in enumerate(value[:200]):
        item = item if isinstance(item, dict) else {}
        source, target_color = str(item.get("from") or "").lower(), str(item.get("to") or "").lower()
        if not _HEX_COLOR.match(source) or not _HEX_COLOR.match(target_color):
            raise ValueError("Colours must be #rrggbb")
        rules.append({
            "id": str(item.get("id") or f"lib-{index}")[:60],
            "from": source,
            "to": target_color,
            "target": item.get("target") if item.get("target") in ("fill", "stroke") else "both",
            "scope": "*",
            "match": "shades" if item.get("match") == "shades" else "exact",
        })
    return rules


FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}
FONT_FIELDS = ("family", "style", "weight", "italic", "postscriptName", "fullName")


class AssetViewSet(viewsets.ModelViewSet):
    queryset = Asset.objects.select_related("project").all()
    serializer_class = AssetSerializer

    @action(detail=False, methods=["get", "post", "delete", "patch"], parser_classes=[MultiPartParser, FormParser, JSONParser], url_path="character-library")
    def character_library(self, request):
        if request.method == "GET":
            packages = []
            characters = []
            for asset in Asset.objects.filter(kind="character", project__isnull=True).order_by("created_at"):
                metadata = asset.metadata or {}
                if not metadata.get("characterLibraryPackage"):
                    continue
                # One-time maintenance of older installs: move players to the shared bridge, and
                # fingerprint custom uploads so uploading the same export again is recognised.
                needs_bridge = int(metadata.get("bridgeVersion") or 0) < CHARACTER_BRIDGE_VERSION
                needs_fingerprint = metadata.get("scope") == "custom" and not metadata.get("fingerprint")
                needs_pose_lengths = int(metadata.get("poseLengthVersion") or 0) < POSE_LENGTH_VERSION
                needs_fla_timeline = int(metadata.get("flaTimelineVersion") or 0) < FLA_TIMELINE_VERSION
                if needs_bridge or needs_fingerprint or needs_pose_lengths or needs_fla_timeline:
                    try:
                        disk_root = Path(settings.MEDIA_ROOT) / "character_libraries" / uuid.UUID(str(metadata.get("packageId") or "")).hex
                        if needs_bridge:
                            upgrade_package_bridges(disk_root)
                        if needs_fingerprint and disk_root.is_dir():
                            metadata["fingerprint"] = package_fingerprint(disk_root)
                        if needs_pose_lengths and disk_root.is_dir():
                            refresh_pose_lengths(disk_root, metadata.get("characters") or [])
                        # Characters shipped with their .fla can be stepped into (layers and keyframes).
                        if needs_fla_timeline and disk_root.is_dir():
                            attach_fla_timelines(disk_root, Path("character_libraries") / disk_root.name, metadata.get("characters") or [])
                    except (ValueError, TypeError, OSError):
                        pass
                    metadata["bridgeVersion"] = CHARACTER_BRIDGE_VERSION
                    metadata["poseLengthVersion"] = POSE_LENGTH_VERSION
                    metadata["flaTimelineVersion"] = FLA_TIMELINE_VERSION
                    asset.metadata = metadata
                    asset.save(update_fields=["metadata"])
                catalog = metadata.get("characters") or []
                summary = {
                    "id": str(asset.id),
                    "name": asset.name,
                    "url": asset.url,
                    "created_at": asset.created_at,
                    "characterCount": len(catalog),
                    "actionCount": sum(len(item.get("actions") or []) for item in catalog if isinstance(item, dict)),
                }
                if metadata.get("scope") == "custom":
                    summary["scope"] = "custom"
                if metadata.get("duplicateOf"):
                    summary["userNamed"] = True
                packages.append(summary)
                # My characters recoloured in the library (Find and Replace) carry their colour rules.
                color_rules = metadata.get("colorReplacements") or []
                characters.extend(
                    {**with_character_category(item, asset.name), "libraryPackageId": str(asset.id), **({"colorReplacements": color_rules} if color_rules else {})}
                    for item in catalog if isinstance(item, dict)
                )
            return Response({"packages": packages, "characters": characters})

        # Editor "Upload custom" needs no admin login; everything else is the admin library.
        custom = str(request.query_params.get("scope") or request.data.get("scope") or "") == "custom"
        if not custom and not is_admin_authenticated(request):
            return Response({"detail": "Admin login required"}, status=status.HTTP_401_UNAUTHORIZED)

        if request.method == "PATCH":
            # My characters: save the recolour rules every future use of the character starts with.
            package_id = str(request.data.get("packageId") or "")
            asset = Asset.objects.filter(id=package_id, kind="character", project__isnull=True).first() if package_id else None
            metadata = (asset.metadata or {}) if asset else {}
            if not asset or not metadata.get("characterLibraryPackage"):
                return Response({"detail": "Character library package not found"}, status=status.HTTP_404_NOT_FOUND)
            if metadata.get("scope") != "custom":
                return Response({"detail": "Only My characters can be recoloured in the library"}, status=status.HTTP_403_FORBIDDEN)
            try:
                rules = _clean_color_rules(request.data.get("colorReplacements"))
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            metadata["colorReplacements"] = rules
            asset.metadata = metadata
            asset.save(update_fields=["metadata"])
            return Response({"packageId": str(asset.id), "colorReplacements": rules})

        if request.method == "DELETE":
            asset_id = str(request.query_params.get("packageId") or "").strip()
            if not asset_id:
                return Response({"detail": "packageId is required"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                asset = Asset.objects.get(pk=asset_id, kind="character", project__isnull=True)
            except (Asset.DoesNotExist, ValueError, ValidationError):
                return Response({"detail": "Character library package not found"}, status=status.HTTP_404_NOT_FOUND)

            metadata = asset.metadata or {}
            if not metadata.get("characterLibraryPackage"):
                return Response({"detail": "Character library package not found"}, status=status.HTTP_404_NOT_FOUND)
            # Editor users may only remove their own Upload custom packages, never the admin library.
            if custom and metadata.get("scope") != "custom":
                return Response({"detail": "Character library package not found"}, status=status.HTTP_404_NOT_FOUND)

            disk_package_id = str(metadata.get("packageId") or "").strip()
            asset.delete()
            try:
                safe_uuid = uuid.UUID(disk_package_id).hex  # folders are named with the hex form
                package_root = Path(settings.MEDIA_ROOT) / "character_libraries" / safe_uuid
                shutil.rmtree(package_root, ignore_errors=True)
            except (ValueError, TypeError):
                pass
            return Response(status=status.HTTP_204_NO_CONTENT)

        duplicate_of = str(request.data.get("duplicateOf") or "").strip()
        if duplicate_of:
            # My characters: a full copy under a new name (Find and Replace keeps the original as it is).
            if not custom:
                return Response({"detail": "Only My characters can be duplicated"}, status=status.HTTP_403_FORBIDDEN)
            try:
                source = Asset.objects.get(pk=duplicate_of, kind="character", project__isnull=True)
            except (Asset.DoesNotExist, ValueError, ValidationError):
                return Response({"detail": "Character library package not found"}, status=status.HTTP_404_NOT_FOUND)
            source_metadata = source.metadata or {}
            if not source_metadata.get("characterLibraryPackage") or source_metadata.get("scope") != "custom":
                return Response({"detail": "Character library package not found"}, status=status.HTTP_404_NOT_FOUND)
            name = re.sub(r"\s+", " ", str(request.data.get("name") or "")).strip()[:80]
            if not name:
                return Response({"detail": "Name the copy first"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                new_hex, characters = duplicate_character_package(
                    str(source_metadata.get("packageId") or ""), name, source_metadata.get("characters") or [],
                    str(request.data.get("characterId") or ""),
                )
            except (ValueError, TypeError, OSError) as exc:
                return Response({"detail": str(exc) or "Could not duplicate the character"}, status=status.HTTP_400_BAD_REQUEST)
            metadata = {
                **{key: value for key, value in source_metadata.items() if key not in ("characters", "packageId", "fingerprint")},
                "packageId": new_hex,
                # Its own fingerprint: uploading the original export again still finds the original.
                "fingerprint": f"copy:{new_hex}",
                "duplicateOf": str(source.id),
                "characters": characters,
            }
            asset = Asset.objects.create(project=None, kind="character", name=name, url=f"/media/character_libraries/{new_hex}/", metadata=metadata)
            package = {
                "id": str(asset.id),
                "name": asset.name,
                "url": asset.url,
                "created_at": asset.created_at,
                "characterCount": len(characters),
                "actionCount": sum(len(item.get("actions") or []) for item in characters if isinstance(item, dict)),
                "scope": "custom",
                "userNamed": True,
            }
            return Response({"package": package, "characters": characters}, status=status.HTTP_201_CREATED)

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            package_id, package_name, characters, fingerprint = install_character_library_zip(uploaded, custom=custom)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if custom:
            # The same export uploaded again reuses the saved copy; discard the new extraction.
            existing = next((
                item for item in Asset.objects.filter(kind="character", project__isnull=True).order_by("created_at")
                if (item.metadata or {}).get("scope") == "custom" and (item.metadata or {}).get("fingerprint") == fingerprint
            ), None)
            if existing:
                shutil.rmtree(Path(settings.MEDIA_ROOT) / "character_libraries" / package_id, ignore_errors=True)
                existing_catalog = (existing.metadata or {}).get("characters") or []
                return Response({
                    "package": {
                        "id": str(existing.id),
                        "name": existing.name,
                        "url": existing.url,
                        "created_at": existing.created_at,
                        "characterCount": len(existing_catalog),
                        "actionCount": sum(len(item.get("actions") or []) for item in existing_catalog if isinstance(item, dict)),
                        "scope": "custom",
                    },
                    "characters": existing_catalog,
                    "duplicate": True,
                }, status=status.HTTP_200_OK)

        root_url = f"/media/character_libraries/{package_id}/"
        metadata = {
            "characterLibraryPackage": True,
            "bridgeVersion": CHARACTER_BRIDGE_VERSION,
            "poseLengthVersion": POSE_LENGTH_VERSION,
            "flaTimelineVersion": FLA_TIMELINE_VERSION,
            "fingerprint": fingerprint,
            "packageId": package_id,
            "originalName": Path(uploaded.name).name,
            "size": uploaded.size,
            "characters": characters,
        }
        if custom:
            metadata["scope"] = "custom"
        asset = Asset.objects.create(
            project=None,
            kind="character",
            name=package_name[:200],
            url=root_url,
            metadata=metadata,
        )
        package = {
            "id": str(asset.id),
            "name": asset.name,
            "url": asset.url,
            "created_at": asset.created_at,
            "characterCount": len(characters),
            "actionCount": sum(len(item.get("actions") or []) for item in characters),
        }
        if custom:
            package["scope"] = "custom"
        return Response({"package": package, "characters": characters, "duplicate": False}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get", "post", "delete"], parser_classes=[MultiPartParser, FormParser], url_path="media-library")
    def media_library(self, request):
        library_type = str(request.query_params.get("type") or request.data.get("type") or "").strip()
        if library_type not in LIBRARY_TYPES:
            return Response({"detail": "type must be backgrounds, fx or sfx"}, status=status.HTTP_400_BAD_REQUEST)
        kind = LIBRARY_ASSET_KIND[library_type]

        def package_summary(asset):
            metadata = asset.metadata or {}
            return {
                "id": str(asset.id),
                "type": library_type,
                "name": asset.name,
                "url": asset.url,
                "created_at": asset.created_at,
                "itemCount": len(metadata.get("items") or []),
                "skipped": metadata.get("skipped") or [],
            }

        def library_assets():
            return [
                asset for asset in Asset.objects.filter(kind=kind, project__isnull=True).order_by("created_at")
                if (asset.metadata or {}).get("mediaLibraryType") == library_type
            ]

        if request.method == "GET":
            assets = library_assets()
            return Response({
                "packages": [package_summary(asset) for asset in assets],
                "items": [item for asset in assets for item in ((asset.metadata or {}).get("items") or [])],
            })

        if not is_admin_authenticated(request):
            return Response({"detail": "Admin login required"}, status=status.HTTP_401_UNAUTHORIZED)

        if request.method == "DELETE":
            asset_id = str(request.query_params.get("packageId") or "").strip()
            asset = next((item for item in library_assets() if str(item.id) == asset_id), None)
            if not asset:
                return Response({"detail": "Library package not found"}, status=status.HTTP_404_NOT_FOUND)
            disk_package_id = str((asset.metadata or {}).get("packageId") or "")
            asset.delete()
            delete_media_library_files(library_type, disk_package_id)
            return Response(status=status.HTTP_204_NO_CONTENT)

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            package_id, package_name, items, skipped = install_media_library_zip(library_type, uploaded)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        asset = Asset.objects.create(
            project=None,
            kind=kind,
            name=package_name[:200],
            url=f"/media/media_libraries/{library_type}/{package_id}/",
            metadata={
                "mediaLibraryType": library_type,
                "packageId": package_id,
                "originalName": Path(uploaded.name).name,
                "size": uploaded.size,
                "items": items,
                "skipped": skipped,
            },
        )
        return Response({"package": package_summary(asset), "items": items, "skipped": skipped}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        uploaded = request.FILES.get("file")
        kind = request.data.get("kind")
        project_id = request.data.get("project")

        if not uploaded:
            return Response({"detail": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        if kind not in {"background", "audio", "font"}:
            return Response({"detail": "kind must be background, audio or font"}, status=status.HTTP_400_BAD_REQUEST)

        project = None
        if project_id:
            try:
                project = Project.objects.get(pk=project_id)
            except Project.DoesNotExist:
                return Response({"detail": "project not found"}, status=status.HTTP_404_NOT_FOUND)

        content_type = (uploaded.content_type or "").lower()
        if kind == "background" and not content_type.startswith("image/"):
            return Response({"detail": "background upload must be an image"}, status=status.HTTP_400_BAD_REQUEST)
        if kind == "audio" and not content_type.startswith("audio/"):
            return Response({"detail": "voice upload must be an audio file"}, status=status.HTTP_400_BAD_REQUEST)
        # A font from the person's computer (Text panel), so exports and other computers draw the same text.
        if kind == "font" and Path(uploaded.name).suffix.lower() not in FONT_EXTENSIONS:
            return Response({"detail": "font upload must be a .ttf, .otf, .woff or .woff2 file"}, status=status.HTTP_400_BAD_REQUEST)

        max_size = 50 * 1024 * 1024 if kind == "background" else 30 * 1024 * 1024
        if uploaded.size > max_size:
            limit_mb = max_size // (1024 * 1024)
            return Response({"detail": f"file is too large; max {limit_mb} MB"}, status=status.HTTP_400_BAD_REQUEST)

        extension = Path(uploaded.name).suffix.lower()[:10]
        relative_path = f"assets/{kind}/{uuid.uuid4().hex}{extension}"
        saved_name = default_storage.save(relative_path, uploaded)
        public_url = default_storage.url(saved_name)

        asset = Asset.objects.create(
            project=project,
            kind=kind,
            name=Path(uploaded.name).name[:200],
            url=public_url,
            metadata={
                "mimeType": content_type,
                "size": uploaded.size,
                "originalName": Path(uploaded.name).name,
                **({key: str(request.data.get(key) or "")[:200] for key in FONT_FIELDS} if kind == "font" else {}),
            },
        )
        return Response(AssetSerializer(asset).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def fonts(self, request):
        """Fonts uploaded from people's computers (newest first, one per PostScript name): the Text
        panel's "Installed font" list, so the whole team can use them."""
        seen: set[str] = set()
        fonts = []
        for asset in Asset.objects.filter(kind="font").order_by("-created_at"):
            meta = asset.metadata or {}
            key = str(meta.get("postscriptName") or asset.url)
            if key in seen:
                continue
            seen.add(key)
            fonts.append({"url": asset.url, **{field: meta.get(field, "") for field in FONT_FIELDS}})
        return Response(fonts)


class RenderJobViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RenderJob.objects.select_related("project").all()
    serializer_class = RenderJobSerializer
