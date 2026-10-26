"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import StageCanvas from "@/components/StageCanvas";
import type { Project, Scene } from "@/types";

declare global {
  interface Window {
    __CBS_RENDER_READY__?: boolean;
    __CBS_RENDER_ERROR__?: string;
    __CBS_SET_TIME__?: (seconds: number) => Promise<void>;
  }
}

type PendingSeek = {
  targetMs: number;
  sources: Set<MessageEventSource>;
  resolve: () => void;
  timer: number;
};

export default function RenderScenePage() {
  const params = useParams<{ id: string }>();
  const sceneId = params?.id || null;
  const [scene, setScene] = useState<Scene | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [error, setError] = useState("");
  const pendingSeekRef = useRef<PendingSeek | null>(null);

  useEffect(() => {
    if (!sceneId) return;
    let cancelled = false;
    window.__CBS_RENDER_READY__ = false;
    window.__CBS_RENDER_ERROR__ = "";

    const load = async () => {
      try {
        const sceneResponse = await fetch(`/api/scenes/${sceneId}`, { cache: "no-store" });
        if (!sceneResponse.ok) throw new Error(`Scene request failed (${sceneResponse.status})`);
        const loadedScene = await sceneResponse.json() as Scene;
        const projectResponse = await fetch(`/api/projects/${loadedScene.project}`, { cache: "no-store" });
        if (!projectResponse.ok) throw new Error(`Project request failed (${projectResponse.status})`);
        const loadedProject = await projectResponse.json() as Project;
        if (cancelled) return;
        setScene(loadedScene);
        setProject(loadedProject);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        window.__CBS_RENDER_ERROR__ = message;
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [sceneId]);

  const animatedCount = useMemo(
    () => (scene?.editor_data.objects || []).filter((object) => object.type === "character" && object.assetKind === "animate-createjs").length,
    [scene],
  );

  useEffect(() => {
    if (!scene || !project) return;

    const readySources = new Set<MessageEventSource>();
    let finished = false;

    const setRenderError = (message: string) => {
      const safe = message || "Character render failed";
      setError(safe);
      window.__CBS_RENDER_ERROR__ = safe;
      const pending = pendingSeekRef.current;
      if (pending) {
        window.clearTimeout(pending.timer);
        pending.resolve();
        pendingSeekRef.current = null;
      }
    };

    const markReady = () => {
      if (finished) return;
      finished = true;
      // One short paint window after every character has confirmed its CreateJS runtime is ready.
      window.setTimeout(() => { window.__CBS_RENDER_READY__ = true; }, 120);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.source !== "characterbazaarstudio-animate") return;
      if (event.data?.type === "ERROR") {
        setRenderError(String(event.data.message || "Talking player failed during render"));
        return;
      }
      if (event.data?.type === "READY") {
        if (event.source) readySources.add(event.source);
        if (readySources.size >= animatedCount) markReady();
        return;
      }
      if (event.data?.type === "SEEK_DONE") {
        const pending = pendingSeekRef.current;
        if (!pending) return;
        const seekMs = Number(event.data.seekMs || 0);
        if (Math.abs(seekMs - pending.targetMs) > 2) return;
        if (event.source) pending.sources.add(event.source);
        if (pending.sources.size >= animatedCount) {
          window.clearTimeout(pending.timer);
          pendingSeekRef.current = null;
          // Resolve after the browser has had one animation frame to composite the iframe canvas.
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => pending.resolve()));
        }
      }
    };

    window.addEventListener("message", handleMessage);

    window.__CBS_SET_TIME__ = (seconds: number) => new Promise<void>((resolve) => {
      const safeSeconds = Math.max(0, Number(seconds) || 0);
      const targetMs = safeSeconds * 1000;

      const previous = pendingSeekRef.current;
      if (previous) {
        window.clearTimeout(previous.timer);
        previous.resolve();
        pendingSeekRef.current = null;
      }

      if (animatedCount === 0) {
        setPlayhead(safeSeconds);
        setSeekRevision((value) => value + 1);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
        return;
      }

      const timer = window.setTimeout(() => {
        if (pendingSeekRef.current?.targetMs === targetMs) {
          pendingSeekRef.current = null;
          setRenderError(`Timed out seeking Talking source to ${targetMs.toFixed(0)} ms`);
          resolve();
        }
      }, 2500);

      pendingSeekRef.current = { targetMs, sources: new Set<MessageEventSource>(), resolve, timer };
      setPlayhead(safeSeconds);
      // Force StageCanvas to send SEEK even when the numeric time is unchanged (important for frame 0).
      setSeekRevision((value) => value + 1);
    });

    const readyTimeout = window.setTimeout(() => {
      if (animatedCount === 0) markReady();
      else if (readySources.size < animatedCount) setRenderError(`Only ${readySources.size}/${animatedCount} character runtimes became ready`);
    }, animatedCount ? 12_000 : 800);

    if (animatedCount === 0) markReady();

    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(readyTimeout);
      const pending = pendingSeekRef.current;
      if (pending) window.clearTimeout(pending.timer);
      pendingSeekRef.current = null;
      delete window.__CBS_SET_TIME__;
    };
  }, [scene, project, animatedCount]);

  if (error) return <main style={{ width: "100vw", height: "100vh", display: "grid", placeItems: "center", background: "#ffffff", color: "#b91c1c", fontFamily: "sans-serif", padding: 24, textAlign: "center" }}>{error}</main>;
  if (!scene || !project) return <main style={{ width: "100vw", height: "100vh", background: "#ffffff" }} />;

  return (
    <main style={{ width: "100vw", height: "100vh", margin: 0, overflow: "hidden", background: scene.editor_data.background || "#ffffff" }}>
      <StageCanvas
        data={scene.editor_data}
        width={project.width}
        height={project.height}
        selectedObjectId={null}
        isPlaying={false}
        playhead={playhead}
        onSelect={() => undefined}
        onMove={() => undefined}
        renderMode
        renderSeekRevision={seekRevision}
      />
    </main>
  );
}
