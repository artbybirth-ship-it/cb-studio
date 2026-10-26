"use client";

import { useMemo, useState } from "react";
import type { EditorData, EditorObject } from "@/types";

type Props = {
  background: string;
  selected: EditorObject | null;
  duration: number;
  layers: EditorObject[];
  aiPrompt: string;
  onBackground: (color: string) => void;
  onDuration: (value: number) => void;
  onScale: (value: number) => void;
  onRotation: (value: number) => void;
  onFlipX: (value: boolean) => void;
  onPosition: (x: number, y: number) => void;
  onOpacity: (value: number) => void;
  onVolume: (value: number) => void;
  onStartTime: (value: number) => void;
  onMoveLayer: (direction: "up" | "down") => void;
  onDelete: () => void;
  onAIBackground: (prompt: string) => void | Promise<void>;
  onSelectLayer: (id: string) => void;
  onApplyAssistantPreset: (preset: "center" | "fit" | "fade") => void;
};

type InspectorTab = "properties" | "assistant" | "library";

const cap = (value: string) => value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

export default function Inspector({
  background,
  selected,
  duration,
  layers,
  aiPrompt,
  onBackground,
  onDuration,
  onScale,
  onRotation,
  onFlipX,
  onPosition,
  onOpacity,
  onVolume,
  onStartTime,
  onMoveLayer,
  onDelete,
  onAIBackground,
  onSelectLayer,
  onApplyAssistantPreset,
}: Props) {
  const [tab, setTab] = useState<InspectorTab>("assistant");
  const [assistantPrompt, setAssistantPrompt] = useState(aiPrompt);
  const [refinedPrompt, setRefinedPrompt] = useState("");
  const [assistantStatus, setAssistantStatus] = useState("");
  const [generating, setGenerating] = useState(false);

  const durationSeconds = selected?.actionDurationMs ? selected.actionDurationMs / 1000 : null;
  const typeCounts = useMemo(() => layers.reduce<Record<string, number>>((acc, layer) => {
    acc[layer.type] = (acc[layer.type] || 0) + 1;
    return acc;
  }, {}), [layers]);

  const refinePrompt = () => {
    const raw = assistantPrompt.trim() || aiPrompt.trim() || "cinematic animation background";
    setRefinedPrompt(`Production-ready 2D animation scene: ${raw}. Keep clean composition, consistent perspective, cinematic lighting, strong foreground/background separation, no unwanted text or extra characters.`);
    setAssistantStatus("Prompt refined");
  };

  const generate = async (prompt: string) => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setAssistantStatus("Generating background…");
    try {
      await onAIBackground(prompt.trim());
      setAssistantStatus("Background added to scene");
    } catch {
      setAssistantStatus("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <aside className="smart-inspector">
      <div className="smart-inspector-tabs">
        {(["properties", "assistant", "library"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "assistant" ? "✦ AI Assistant" : cap(item)}</button>
        ))}
      </div>

      {tab === "assistant" && (
        <div className="smart-inspector-scroll">
          <section className="assistant-hero-card">
            <div className="assistant-heading"><span className="assistant-orb">✦</span><div><strong>AI Assistant</strong><small>BETA</small></div></div>
            <p>Your creative copilot for faster animation workflows.</p>
          </section>

          <section className="smart-inspector-card">
            <div className="inspector-section-head"><strong>Prompt Refinement</strong><span>⌃</span></div>
            <textarea value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} placeholder="Describe the scene you want..." />
            <button className="assistant-primary" onClick={refinePrompt}>✦ Refine Prompt</button>
            {refinedPrompt && (
              <div className="refined-prompt-box">
                <div className="inspector-section-head"><strong>Refined Prompt</strong><span>AI</span></div>
                <p>{refinedPrompt}</p>
                <button className="assistant-primary" disabled={generating} onClick={() => void generate(refinedPrompt)}>{generating ? "Generating…" : "Use Refined Prompt"}</button>
              </div>
            )}
            {assistantStatus && <div className="assistant-status">{assistantStatus}</div>}
          </section>

          <section className="smart-inspector-card">
            <div className="inspector-section-head"><strong>Recommended Assets</strong><button onClick={() => setTab("library")}>View all</button></div>
            <div className="recommended-assets">
              <button onClick={() => selected && onSelectLayer(selected.id)} className="recommended-character"><span>♙</span><small>Character</small></button>
              <button onClick={() => void generate(`${assistantPrompt}, cinematic sunset background, no characters`)} className="recommended-sunset"><span /><small>Background</small></button>
              <button onClick={() => setAssistantPrompt("ornate cinematic lantern prop, transparent background")} className="recommended-lantern"><span>♢</span><small>Lantern</small></button>
            </div>
          </section>

          <section className="smart-inspector-card">
            <div className="inspector-section-head"><strong>One-Click Actions</strong><span>✦</span></div>
            <div className="assistant-actions">
              <button onClick={() => { onApplyAssistantPreset("center"); setAssistantStatus("Selected layer centered"); }}><b>✥</b><span>Smart Center<small>Center selected layer on canvas</small></span></button>
              <button onClick={() => { onApplyAssistantPreset("fit"); setAssistantStatus("Selected layer fitted"); }}><b>⌗</b><span>Fit to Scene<small>Optimize object scale</small></span></button>
              <button onClick={() => { onApplyAssistantPreset("fade"); setAssistantStatus("Opacity preset applied"); }}><b>◐</b><span>Soft Fade<small>Apply a subtle opacity preset</small></span></button>
            </div>
          </section>
        </div>
      )}

      {tab === "properties" && (
        <div className="smart-inspector-scroll">
          <section className="selected-object-card">
            <div className="selected-object-icon">{selected?.type === "audio" ? "♫" : selected?.type === "background" ? "▧" : selected?.type === "text" ? "T" : selected?.type === "prop" ? "◇" : "♙"}</div>
            <div><small>Selected</small><strong>{selected?.name || "Scene"}</strong><span>{selected ? `${cap(selected.type)} layer` : "Global scene properties"}</span></div>
          </section>

          <section className="smart-inspector-card property-card">
            <div className="inspector-section-head"><strong>Scene</strong><span>⌃</span></div>
            <label className="property-row"><span>Background</span><div className="color-control"><input type="color" value={background || "#172033"} onChange={(e) => onBackground(e.target.value)} /><code>{background}</code></div></label>
            <label className="property-row"><span>Duration</span><div className="number-control"><input type="number" min={1} max={300} step={0.5} value={duration} onChange={(e) => onDuration(Math.max(1, Number(e.target.value)))} /><em>s</em></div></label>
          </section>

          {selected ? (
            <>
              {selected.type !== "audio" && selected.type !== "background" && (
                <section className="smart-inspector-card property-card">
                  <div className="inspector-section-head"><strong>Transform</strong><span>⌃</span></div>
                  <div className="xy-grid">
                    <label><span>X</span><input type="number" value={Math.round(selected.x)} onChange={(e) => onPosition(Number(e.target.value), selected.y)} /></label>
                    <label><span>Y</span><input type="number" value={Math.round(selected.y)} onChange={(e) => onPosition(selected.x, Number(e.target.value))} /></label>
                  </div>
                  <label className="slider-property"><div><span>Scale</span><b>{(selected.scale || 1).toFixed(2)}×</b></div><input type="range" min={selected.assetKind === "animate-createjs" ? 0.08 : 0.2} max={selected.assetKind === "animate-createjs" ? 0.9 : 3} step={0.01} value={selected.scale || 1} onChange={(e) => onScale(Number(e.target.value))} /></label>
                  <label className="slider-property"><div><span>Rotation</span><b>{Math.round(selected.rotation || 0)}°</b></div><input type="range" min={-180} max={180} step={1} value={selected.rotation || 0} onChange={(e) => onRotation(Number(e.target.value))} /></label>
                  <div className="flip-control"><span>Flip</span><button className={!selected.flipX ? "active" : ""} onClick={() => onFlipX(false)}>Left</button><button className={selected.flipX ? "active" : ""} onClick={() => onFlipX(true)}>Right</button></div>
                </section>
              )}

              {selected.type !== "audio" && (
                <section className="smart-inspector-card property-card">
                  <div className="inspector-section-head"><strong>Appearance</strong><span>⌃</span></div>
                  <label className="slider-property"><div><span>Opacity</span><b>{Math.round((selected.opacity ?? 1) * 100)}%</b></div><input type="range" min={0} max={1} step={0.01} value={selected.opacity ?? 1} onChange={(e) => onOpacity(Number(e.target.value))} /></label>
                </section>
              )}

              <section className="smart-inspector-card property-card">
                <div className="inspector-section-head"><strong>Timing</strong><span>⌃</span></div>
                <label className="property-row"><span>Start</span><div className="number-control"><input type="number" min={0} max={duration} step={0.1} value={selected.startTime ?? 0} onChange={(e) => onStartTime(Math.max(0, Number(e.target.value)))} /><em>s</em></div></label>
                {selected.type === "audio" && <label className="slider-property"><div><span>Volume</span><b>{Math.round((selected.volume ?? 1) * 100)}%</b></div><input type="range" min={0} max={1} step={0.01} value={selected.volume ?? 1} onChange={(e) => onVolume(Number(e.target.value))} /></label>}
                {durationSeconds !== null && <div className="property-hint">Source duration: {durationSeconds.toFixed(2)} sec</div>}
              </section>

              <section className="smart-inspector-card property-card">
                <div className="layer-order-grid"><button onClick={() => onMoveLayer("up")}>Move Up</button><button onClick={() => onMoveLayer("down")}>Move Down</button></div>
                <button className="danger-action" onClick={onDelete}>Delete Layer</button>
              </section>
            </>
          ) : <div className="empty-inspector">Select a layer on the canvas or timeline to edit it.</div>}
        </div>
      )}

      {tab === "library" && (
        <div className="smart-inspector-scroll">
          <section className="library-summary">
            <strong>Scene Library</strong><p>{layers.length} active layers · {duration.toFixed(1)} seconds</p>
            <div><span>♙ {typeCounts.character || 0}</span><span>◇ {typeCounts.prop || 0}</span><span>▧ {typeCounts.background || 0}</span><span>♫ {typeCounts.audio || 0}</span></div>
          </section>
          <div className="library-layer-list">
            {layers.map((layer) => <button key={layer.id} className={selected?.id === layer.id ? "active" : ""} onClick={() => onSelectLayer(layer.id)}><b>{layer.type === "audio" ? "♫" : layer.type === "background" ? "▧" : layer.type === "text" ? "T" : layer.type === "prop" ? "◇" : "♙"}</b><span><strong>{layer.name}</strong><small>{cap(layer.type)} · starts {(layer.startTime || 0).toFixed(1)}s</small></span><em>›</em></button>)}
            {!layers.length && <div className="empty-inspector">No layers yet.</div>}
          </div>
        </div>
      )}
    </aside>
  );
}
