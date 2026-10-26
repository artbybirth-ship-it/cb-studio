import math
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from urllib.parse import urlparse

from celery import shared_task
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from playwright.sync_api import sync_playwright

from .models import RenderJob


def _run(cmd: list[str]):
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "FFmpeg failed")[-5000:])
    return result


def _set_progress(job: RenderJob, value: int):
    """Persist progress when no Playwright event loop is active in this thread."""
    job.progress = max(0, min(99, int(value)))
    job.save(update_fields=["progress", "updated_at"])


def _set_progress_from_playwright(job: RenderJob, value: int):
    """
    Persist RenderJob progress from a dedicated DB thread.

    Playwright's synchronous Python API runs an asyncio loop internally on the
    calling thread. Django deliberately blocks synchronous ORM access while an
    event loop is active in that thread and raises SynchronousOnlyOperation.
    Moving only the DB write to a short-lived worker thread keeps the render
    pipeline synchronous while ensuring Django ORM executes in a normal thread.
    """
    progress = max(0, min(99, int(value)))
    job.progress = progress  # keep the in-memory object current without touching the DB

    def write_progress():
        close_old_connections()
        try:
            updated = RenderJob.objects.filter(pk=job.pk).update(
                progress=progress,
                updated_at=timezone.now(),
            )
            if updated != 1:
                raise RuntimeError(f"Render job {job.pk} no longer exists while updating progress")
        finally:
            close_old_connections()

    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="cbs-render-db") as executor:
            executor.submit(write_progress).result(timeout=15)
    except FutureTimeoutError as exc:
        raise RuntimeError("Timed out while saving render progress") from exc


def _media_file_from_url(url: str) -> Path | None:
    if not url or url.startswith("data:"):
        return None
    path = urlparse(url).path
    prefix = settings.MEDIA_URL.rstrip("/") + "/"
    if not path.startswith(prefix):
        return None
    relative = path[len(prefix):].lstrip("/")
    candidate = (Path(settings.MEDIA_ROOT) / relative).resolve()
    media_root = Path(settings.MEDIA_ROOT).resolve()
    try:
        candidate.relative_to(media_root)
    except ValueError:
        return None
    return candidate if candidate.exists() else None


def _goto_render_page(page, url: str):
    last_error = None
    for attempt in range(1, 6):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=90_000)
            return
        except Exception as exc:
            last_error = exc
            if attempt >= 5:
                break
            time.sleep(min(1.5 * attempt, 5.0))
    raise RuntimeError(f"Could not open frontend render page after retries: {last_error}")




def _preflight_frontend_runtime(page):
    base_url = os.getenv("FRONTEND_RENDER_URL", "http://frontend:3000").rstrip("/")
    checks = [
        ("CreateJS runtime", f"{base_url}/vendor/createjs"),
        ("Static render harness", f"{base_url}/render-harness.html"),
    ]
    failures = []
    for label, url in checks:
        try:
            response = page.request.get(url, timeout=30_000)
            if not response.ok:
                failures.append(f"{label}: HTTP {response.status}")
        except Exception as exc:
            failures.append(f"{label}: {exc}")
    if failures:
        raise RuntimeError("Render preflight failed - " + " | ".join(failures))

def _full_hd_target(width: int, height: int) -> tuple[int, int]:
    """Return a standard Full-HD canvas without distorting the project orientation."""
    if height > width:
        return 1080, 1920
    return 1920, 1080


def _capture_scale(width: int, height: int) -> float:
    """
    Supersample up to 2x, but cap the Chromium capture surface near 4K pixels
    to keep memory use predictable inside Docker.
    """
    requested = max(1.0, min(float(os.getenv("RENDER_SUPERSAMPLE", "2")), 4.0))
    pixels = max(1, width * height)
    max_pixels = 3840 * 2160
    memory_safe = math.sqrt(max_pixels / pixels)
    return max(1.0, min(requested, memory_safe))


def _capture_scene_frames(page, scene, width: int, height: int, fps: int, frames_dir: Path, capture_scale: float):
    base_url = os.getenv("FRONTEND_RENDER_URL", "http://frontend:3000").rstrip("/")
    # v27 intentionally bypasses the Next.js/React render route. The dedicated static
    # harness has no hydration/build delay and talks directly to the saved scene API +
    # original CreateJS player iframe.
    url = f"{base_url}/render-harness.html?scene={scene.id}&width={width}&height={height}&scale={capture_scale:.6f}"
    _goto_render_page(page, url)

    try:
        page.wait_for_function(
            "window.__CBS_RENDER_ERROR__ || window.__CBS_RENDER_READY__ === true",
            timeout=60_000,
            polling=100,
        )
    except Exception as exc:
        try:
            diagnostic = page.evaluate("""() => ({
                href: location.href,
                readyState: document.readyState,
                booted: !!window.__CBS_RENDER_BOOTED__,
                ready: !!window.__CBS_RENDER_READY__,
                error: window.__CBS_RENDER_ERROR__ || '',
                body: (document.body && document.body.innerText || '').slice(0, 800)
            })""")
        except Exception:
            diagnostic = {}
        raise RuntimeError(f"Static render harness did not become ready: {diagnostic} :: {exc}") from exc

    browser_error = page.evaluate("window.__CBS_RENDER_ERROR__ || ''")
    if browser_error:
        raise RuntimeError(f"Browser render harness failed: {browser_error}")

    duration = max(0.1, float(scene.duration_seconds or 0.1))
    frame_count = max(1, math.ceil(duration * fps))
    frames_dir.mkdir(parents=True, exist_ok=True)
    for index in range(frame_count):
        time_seconds = min(duration, index / fps)
        page.evaluate("async t => { if (!window.__CBS_SET_TIME__) throw new Error('Render seek bridge missing'); await window.__CBS_SET_TIME__(t); }", time_seconds)
        frame_error = page.evaluate("window.__CBS_RENDER_ERROR__ || ''")
        if frame_error:
            raise RuntimeError(f"Browser frame seek failed: {frame_error}")
        page.screenshot(path=str(frames_dir / f"frame-{index + 1:06d}.png"), full_page=False)
    return duration, frame_count


def _encode_frames(frames_dir: Path, output: Path, fps: int, duration: float, final_width: int, final_height: int):
    # Frames are captured at up to 2x logical resolution. Lanczos downsamples them
    # to Full HD, which gives cleaner vector/text edges and preserves high-res imports.
    video_filter = (
        f"scale={final_width}:{final_height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={final_width}:{final_height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    )
    _run([
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / "frame-%06d.png"),
        "-t", f"{duration:.6f}",
        "-vf", video_filter,
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-pix_fmt", "yuv420p", "-r", str(fps), "-an",
        "-movflags", "+faststart",
        str(output),
    ])


def _scene_audio(scene, output: Path, duration: float):
    audio_layers = [
        item for item in (scene.editor_data or {}).get("objects", [])
        if item.get("type") == "audio" and item.get("assetUrl")
    ]
    valid_layers: list[tuple[dict, Path]] = []
    for layer in audio_layers:
        source = _media_file_from_url(str(layer.get("assetUrl") or ""))
        if source:
            valid_layers.append((layer, source))

    cmd = ["ffmpeg", "-y", "-f", "lavfi", "-t", f"{duration:.6f}", "-i", "anullsrc=r=48000:cl=stereo"]
    for _, source in valid_layers:
        cmd += ["-i", str(source)]

    if not valid_layers:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.6f}", str(output)]
        _run(cmd)
        return

    filters: list[str] = []
    labels = ["[0:a]"]
    for input_index, (layer, _) in enumerate(valid_layers, start=1):
        start = max(0.0, float(layer.get("startTime") or 0.0))
        volume = max(0.0, min(4.0, float(layer.get("volume") if layer.get("volume") is not None else 1.0)))
        max_clip = max(0.05, duration - start)
        duration_ms = layer.get("actionDurationMs")
        if duration_ms:
            max_clip = min(max_clip, max(0.05, float(duration_ms) / 1000.0))
        delay = int(round(start * 1000))
        label = f"a{input_index}"
        filters.append(
            f"[{input_index}:a]atrim=0:{max_clip:.6f},asetpts=PTS-STARTPTS,"
            f"volume={volume:.4f},adelay={delay}|{delay}[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{duration:.6f}[mix]"
    )
    cmd += ["-filter_complex", ";".join(filters), "-map", "[mix]", "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.6f}", str(output)]
    _run(cmd)


def _mux_scene(video: Path, audio: Path, output: Path, duration: float):
    _run([
        "ffmpeg", "-y", "-i", str(video), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", "-t", f"{duration:.6f}",
        "-c:v", "copy", "-c:a", "copy", "-shortest", str(output),
    ])


def _validate_mp4(path: Path):
    if not path.exists() or path.stat().st_size < 1024:
        raise RuntimeError("Render output MP4 was not created or is empty")
    probe = _run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ])
    try:
        duration = float((probe.stdout or "0").strip())
    except ValueError:
        duration = 0.0
    if duration <= 0:
        raise RuntimeError("Rendered MP4 has invalid duration")
    return duration


def _concat_scenes(scene_files: list[Path], output_path: Path):
    if not scene_files:
        raise RuntimeError("Project has no scenes to render")
    concat_file = output_path.parent / f"concat-{output_path.stem}.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in scene_files))
    _run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-c", "copy", "-movflags", "+faststart", str(output_path),
    ])
    concat_file.unlink(missing_ok=True)


@shared_task(bind=True)
def render_project(self, job_id: str):
    job = RenderJob.objects.select_related("project").get(id=job_id)
    project = job.project
    work_dir: Path | None = None
    try:
        job.status, job.progress, job.error = "running", 3, ""
        job.save(update_fields=["status", "progress", "error", "updated_at"])

        scenes = list(project.scenes.all().order_by("order", "created_at"))
        if not scenes:
            raise RuntimeError("Project has no scenes to render")

        # Keep the project's logical coordinate system unchanged so all saved object
        # and body-part positions remain exact. Capture is supersampled separately.
        width = max(320, int(project.width))
        height = max(240, int(project.height))
        width, height = width - width % 2, height - height % 2
        final_width, final_height = _full_hd_target(width, height)
        capture_scale = _capture_scale(width, height)
        capture_width = max(2, int(round(width * capture_scale)))
        capture_height = max(2, int(round(height * capture_scale)))
        capture_width -= capture_width % 2
        capture_height -= capture_height % 2
        # Use the exact realized scale after even-pixel rounding.
        capture_scale = min(capture_width / width, capture_height / height)
        fps = max(8, min(int(os.getenv("RENDER_FPS", "30")), 30))

        media_root = Path(settings.MEDIA_ROOT)
        media_root.mkdir(parents=True, exist_ok=True)
        filename = f"render-{job.id}.mp4"
        output_path = media_root / filename
        work_dir = Path(tempfile.mkdtemp(prefix=f"cbs-render-{job.id}-"))
        scene_outputs: list[Path] = []

        chromium_path = os.getenv("CHROMIUM_PATH", "/usr/bin/chromium")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=chromium_path,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            )
            try:
                context = browser.new_context(
                    viewport={"width": capture_width, "height": capture_height},
                    screen={"width": capture_width, "height": capture_height},
                    device_scale_factor=1,
                )
                page = context.new_page()
                page.on("console", lambda message: print(f"[render-browser] {message.type}: {message.text}"))
                page.on("pageerror", lambda error: print(f"[render-browser-pageerror] {error}"))
                page.on("requestfailed", lambda request: print(f"[render-browser-requestfailed] {request.url} :: {request.failure}"))

                _preflight_frontend_runtime(page)

                for scene_index, scene in enumerate(scenes):
                    scene_dir = work_dir / f"scene-{scene_index:03d}"
                    frames_dir = scene_dir / "frames"
                    scene_dir.mkdir(parents=True, exist_ok=True)
                    duration, _ = _capture_scene_frames(page, scene, width, height, fps, frames_dir, capture_scale)
                    video_only = scene_dir / "video.mp4"
                    audio_only = scene_dir / "audio.m4a"
                    final_scene = scene_dir / "scene.mp4"
                    _encode_frames(frames_dir, video_only, fps, duration, final_width, final_height)
                    _scene_audio(scene, audio_only, duration)
                    _mux_scene(video_only, audio_only, final_scene, duration)
                    scene_outputs.append(final_scene)
                    _set_progress_from_playwright(job, 8 + int(((scene_index + 1) / len(scenes)) * 78))
                context.close()
            finally:
                browser.close()

        _set_progress(job, 90)
        _concat_scenes(scene_outputs, output_path)
        _validate_mp4(output_path)

        job.status, job.progress, job.output_url, job.error = "complete", 100, f"{settings.MEDIA_URL}{filename}", ""
        job.save(update_fields=["status", "progress", "output_url", "error", "updated_at"])
        project.status = "complete"
        project.save(update_fields=["status", "updated_at"])
        return job.output_url
    except Exception as exc:
        detail = str(exc).strip() or exc.__class__.__name__
        job.status, job.error = "failed", detail[-5000:]
        job.save(update_fields=["status", "error", "updated_at"])
        project.status = "draft"
        project.save(update_fields=["status", "updated_at"])
        raise
    finally:
        if work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
