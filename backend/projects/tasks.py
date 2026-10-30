import asyncio
import math
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
import urllib.request
from urllib.parse import urlparse

from celery import shared_task
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from playwright.async_api import async_playwright

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


async def _goto_render_page(page, url: str):
    last_error = None
    for attempt in range(1, 6):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
            return
        except Exception as exc:
            last_error = exc
            if attempt >= 5:
                break
            await asyncio.sleep(min(1.5 * attempt, 5.0))
    raise RuntimeError(f"Could not open frontend render page after retries: {last_error}")


def _preflight_frontend_runtime():
    base_url = os.getenv("FRONTEND_RENDER_URL", "http://frontend:3000").rstrip("/")
    checks = [
        ("CreateJS runtime", f"{base_url}/vendor/createjs"),
        ("Static render harness", f"{base_url}/render-harness.html"),
    ]
    failures = []
    for label, url in checks:
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                if response.status >= 400:
                    failures.append(f"{label}: HTTP {response.status}")
        except Exception as exc:
            failures.append(f"{label}: {exc}")
    if failures:
        raise RuntimeError("Render preflight failed - " + " | ".join(failures))


# MP4 sizes (landscape; a portrait project gets them turned): the long and short edge.
VIDEO_SIZES = {"hd": (1280, 720), "fullhd": (1920, 1080), "4k": (3840, 2160)}


def _video_target(width: int, height: int, resolution: str) -> tuple[int, int]:
    long_edge, short_edge = VIDEO_SIZES.get(resolution, VIDEO_SIZES["fullhd"])
    return (short_edge, long_edge) if height > width else (long_edge, short_edge)


def _capture_scale_for(width: int, height: int, target_width: int, target_height: int, sharp: bool) -> float:
    """Capture scale: at least the output size (4K needs it), supersampled up to 2x when `sharp`,
    capped near 4K pixels to keep memory use predictable inside Docker."""
    needed = max(target_width / max(1, width), target_height / max(1, height))
    requested = max(1.0, min(float(os.getenv("RENDER_SUPERSAMPLE", "2")), 4.0)) if sharp else 1.0
    memory_safe = math.sqrt((3840 * 2160) / max(1, width * height))
    return max(1.0, min(max(requested, needed), memory_safe))


async def _open_harness(context, scene, width: int, height: int, capture_scale: float):
    base_url = os.getenv("FRONTEND_RENDER_URL", "http://frontend:3000").rstrip("/")
    # v27 intentionally bypasses the Next.js/React render route. The dedicated static
    # harness has no hydration/build delay and talks directly to the saved scene API +
    # original CreateJS player iframe.
    url = f"{base_url}/render-harness.html?scene={scene.id}&width={width}&height={height}&scale={capture_scale:.6f}"
    page = await context.new_page()
    # Errors only: four tabs repeating every CreateJS deprecation warning drowned the log.
    page.on("console", lambda message: print(f"[render-browser] {message.text}") if message.type == "error" else None)
    page.on("pageerror", lambda error: print(f"[render-browser-pageerror] {error}"))
    await _goto_render_page(page, url)
    try:
        await page.wait_for_function("window.__CBS_RENDER_ERROR__ || window.__CBS_RENDER_READY__ === true", timeout=60_000, polling=100)
    except Exception as exc:
        try:
            diagnostic = await page.evaluate("""() => ({
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
    browser_error = await page.evaluate("window.__CBS_RENDER_ERROR__ || ''")
    if browser_error:
        raise RuntimeError(f"Browser render harness failed: {browser_error}")
    return page


async def _capture_frames(context, scene, width: int, height: int, capture_scale: float, times: list[float],
                          frames_dir: Path, start_number: int, image_type: str, on_frame, tabs: int):
    """Screenshots of the scene at `times`, numbered from start_number. The frames are split into
    `tabs` runs captured at the same time, each by its own tab (its own renderer process)."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    extension = "jpg" if image_type == "jpeg" else "png"
    count = len(times)
    tabs = max(1, min(tabs, count))
    runs = [range(count * index // tabs, count * (index + 1) // tabs) for index in range(tabs)]
    done = {"frames": 0}

    async def capture(run):
        page = await _open_harness(context, scene, width, height, capture_scale)
        try:
            for index in run:
                await page.evaluate("async t => { if (!window.__CBS_SET_TIME__) throw new Error('Render seek bridge missing'); await window.__CBS_SET_TIME__(t); }", times[index])
                frame_error = await page.evaluate("window.__CBS_RENDER_ERROR__ || ''")
                if frame_error:
                    raise RuntimeError(f"Browser frame seek failed: {frame_error}")
                path = str(frames_dir / f"frame-{start_number + index:06d}.{extension}")
                if image_type == "jpeg":
                    await page.screenshot(path=path, type="jpeg", quality=95, full_page=False)
                else:
                    await page.screenshot(path=path, type="png", full_page=False)
                done["frames"] += 1
                if on_frame:
                    on_frame(done["frames"], count)
        finally:
            await page.close()

    await asyncio.gather(*(capture(run) for run in runs))
    return extension


def _encode_frames(frames_dir: Path, output: Path, fps: int, duration: float, final_width: int, final_height: int, extension: str = "png"):
    # Frames are captured at up to 2x logical resolution. Lanczos downsamples them
    # to Full HD, which gives cleaner vector/text edges and preserves high-res imports.
    video_filter = (
        f"scale={final_width}:{final_height}:force_original_aspect_ratio=decrease:flags=lanczos:out_range=tv,"
        f"pad={final_width}:{final_height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
    )
    # JPEG frames are full-range: out_range=tv and the bt709 tags give standard video colour, so
    # every player shows the same colours as the editor.
    _run([
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / f"frame-%06d.{extension}"),
        "-t", f"{duration:.6f}",
        "-vf", video_filter,
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-r", str(fps), "-an",
        "-movflags", "+faststart",
        str(output),
    ])


def _fit_within(width: int, height: int, limit: int) -> tuple[int, int]:
    scale = min(1.0, limit / max(width, height))
    w, h = max(2, int(round(width * scale))), max(2, int(round(height * scale)))
    return w - w % 2, h - h % 2


def _encode_gif(frames_dir: Path, output: Path, fps: int, width: int, height: int, extension: str = "png"):
    # One palette for the whole animation (palettegen), dithered for smooth shading.
    _run([
        "ffmpeg", "-y", "-framerate", str(fps), "-i", str(frames_dir / f"frame-%06d.{extension}"),
        "-vf", f"scale={width}:{height}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
        "-loop", "0", str(output),
    ])


def _encode_still(frame: Path, output: Path, width: int, height: int, fmt: str):
    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    )
    quality = ["-q:v", "2"] if fmt == "jpeg" else []
    _run(["ffmpeg", "-y", "-i", str(frame), "-vf", video_filter, "-frames:v", "1", *quality, str(output)])


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


EXPORT_FORMATS = {"mp4": "mp4", "gif": "gif", "jpeg": "jpg", "png": "png"}
GIF_FPS = 15
GIF_MAX_EDGE = 960


@shared_task(bind=True)
def render_project(self, job_id: str, export_format: str = "mp4", still_time: float = 0.0, still_scene_id: str | None = None,
                   resolution: str = "fullhd"):
    """MP4 (video with sound), GIF (animation, no sound), or a JPEG / PNG of one frame (the
    playhead's frame of the scene being edited). Progress moves frame by frame.

    Speed: frames are captured by RENDER_TABS tabs at once (default 4) as JPEG (95%, invisible after
    the video encode). MP4 resolution: "hd" 1280x720 (captured at 1x, quickest), "fullhd"
    1920x1080 or "4k" 3840x2160 (captured at up to 2x for sharp edges). GIF is captured at 1x
    (960 px at most); a JPEG / PNG is Full HD, captured at up to 2x."""
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
        fmt = export_format if export_format in EXPORT_FORMATS else "mp4"
        resolution = resolution if fmt == "mp4" and resolution in VIDEO_SIZES else "fullhd"
        final_width, final_height = _video_target(width, height, resolution)
        sharp = fmt in ("jpeg", "png") or (fmt == "mp4" and resolution != "hd")
        capture_scale = _capture_scale_for(width, height, final_width, final_height, sharp) if fmt != "gif" else 1.0
        capture_width = max(2, int(round(width * capture_scale)))
        capture_height = max(2, int(round(height * capture_scale)))
        capture_width -= capture_width % 2
        capture_height -= capture_height % 2
        # Use the exact realized scale after even-pixel rounding.
        capture_scale = min(capture_width / width, capture_height / height)
        fps = max(8, min(int(os.getenv("RENDER_FPS", "30")), 30))
        still = fmt in ("jpeg", "png")
        if fmt == "gif":
            fps = GIF_FPS
        if still:
            scenes = [next((item for item in scenes if str(item.id) == str(still_scene_id)), scenes[0])]

        media_root = Path(settings.MEDIA_ROOT)
        media_root.mkdir(parents=True, exist_ok=True)
        filename = f"render-{job.id}.{EXPORT_FORMATS[fmt]}"
        output_path = media_root / filename
        work_dir = Path(tempfile.mkdtemp(prefix=f"cbs-render-{job.id}-"))
        scene_outputs: list[Path] = []

        _preflight_frontend_runtime()

        # Capture is 3% → 85% of the progress, frame by frame (saved at most once a percent).
        shown = {"value": 3}

        def frame_progress(scene_index: int):
            def report(done: int, total: int):
                value = 3 + int(82 * (scene_index + done / max(1, total)) / len(scenes))
                if value > shown["value"]:
                    shown["value"] = value
                    _set_progress_from_playwright(job, value)
            return report

        tabs = max(1, min(int(os.getenv("RENDER_TABS", "4")), 8))
        # A still keeps PNG frames (one frame, no speed to gain); video and GIF use JPEG.
        image_type = "png" if still else "jpeg"
        captured: list[tuple[Path, float, str]] = []

        async def capture_all():
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(
                    headless=True,
                    executable_path=os.getenv("CHROMIUM_PATH", "/usr/bin/chromium"),
                    args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
                )
                try:
                    context = await browser.new_context(
                        viewport={"width": capture_width, "height": capture_height},
                        screen={"width": capture_width, "height": capture_height},
                        device_scale_factor=1,
                    )
                    next_frame = 1
                    for scene_index, scene in enumerate(scenes):
                        duration = max(0.1, float(scene.duration_seconds or 0.1))
                        times = ([min(duration, max(0.0, float(still_time or 0)))] if still
                                 else [min(duration, index / fps) for index in range(max(1, math.ceil(duration * fps)))])
                        # GIF: every scene's frames in one numbered sequence (one GIF, one palette).
                        frames_dir = work_dir / ("gif-frames" if fmt == "gif" else f"scene-{scene_index:03d}/frames")
                        start = next_frame if fmt == "gif" else 1
                        extension = await _capture_frames(context, scene, width, height, capture_scale, times, frames_dir,
                                                          start, image_type, frame_progress(scene_index), tabs)
                        next_frame += len(times)
                        captured.append((frames_dir, duration, extension))
                    await context.close()
                finally:
                    await browser.close()

        asyncio.run(capture_all())

        if still:
            frames_dir, _, extension = captured[0]
            _set_progress(job, 90)
            _encode_still(frames_dir / f"frame-000001.{extension}", output_path, final_width, final_height, fmt)
        elif fmt == "mp4":
            for scene_index, (scene, (frames_dir, duration, extension)) in enumerate(zip(scenes, captured)):
                scene_dir = frames_dir.parent
                video_only = scene_dir / "video.mp4"
                audio_only = scene_dir / "audio.m4a"
                final_scene = scene_dir / "scene.mp4"
                _encode_frames(frames_dir, video_only, fps, duration, final_width, final_height, extension)
                _scene_audio(scene, audio_only, duration)
                _mux_scene(video_only, audio_only, final_scene, duration)
                scene_outputs.append(final_scene)
                _set_progress(job, 85 + int(5 * (scene_index + 1) / len(scenes)))

        _set_progress(job, 90)
        if fmt == "gif":
            gif_width, gif_height = _fit_within(final_width, final_height, GIF_MAX_EDGE)
            _encode_gif(work_dir / "gif-frames", output_path, fps, gif_width, gif_height, captured[0][2])
        elif fmt == "mp4":
            _concat_scenes(scene_outputs, output_path)
            _validate_mp4(output_path)
        if not output_path.exists() or output_path.stat().st_size < 100:
            raise RuntimeError(f"The {fmt.upper()} export was not created")

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
