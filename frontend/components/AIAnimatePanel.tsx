"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";
import type { AnimationPlan, AnimationPlanResponse, EditorObject } from "@/types";

type Props = {
  width: number;
  height: number;
  duration: number;
  characters: EditorObject[];
  onApply: (plan: AnimationPlan) => void;
  onClose: () => void;
};

const actionText = (action: AnimationPlan["actions"][number], characters: EditorObject[]) => {
  const actor = characters.find((item) => item.id === action.characterId)?.name || action.characterId;
  const target = action.targetCharacterId ? characters.find((item) => item.id === action.targetCharacterId)?.name || action.targetCharacterId : "";
  const preset = (action.preset || action.type).replaceAll("_", " ");
  return `${actor} · ${preset}${target ? ` → ${target}` : ""}`;
};

export default function AIAnimatePanel({ width, height, duration, characters, onApply, onClose }: Props) {
  useEscClose(true, onClose);
  const [prompt, setPrompt] = useState("Woman right hand wave kare, phir man ke paas jaye aur dono 5 second talk karein.");
  const [result, setResult] = useState<AnimationPlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const partsReady = useMemo(() => characters.filter((item) => (item.sourceParts || []).length > 0).length, [characters]);

  const generate = async () => {
    if (!prompt.trim() || characters.length === 0) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api.planAnimation(prompt.trim(), width, height, duration, characters));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Animation plan failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cb-ai-animate-overlay" role="dialog" aria-modal="true" aria-label="AI Animate">
      <div className="cb-ai-animate-panel">
        <header>
          <PanelClose onClose={onClose} label="Close AI Animate" />
          <div><b>✨ AI Animate</b><span>Prompt → validated action plan → editable timeline/keyframes</span></div>
        </header>

        <div className="cb-ai-animate-body">
          <section className="cb-ai-context-card">
            <strong>Scene characters</strong>
            <div className="cb-ai-character-chips">
              {characters.map((character) => (
                <span key={character.id}>{character.name}<small>{(character.sourceParts || []).length} parts</small></span>
              ))}
            </div>
            {partsReady < characters.length && <p>Body-part gestures can only be applied after that character’s CreateJS body parts finish loading. Whole-character move/talk planning still works.</p>}
          </section>

          <label className="cb-ai-prompt-field">
            <span>Describe the animation</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} placeholder="Example: Woman right hand wave kare, then man ke paas jaye, dono 5 second baat karein." />
          </label>

          <div className="cb-ai-example-row">
            {["Woman right hand wave kare", "Man left se enter kare aur woman ke paas jaye", "Dono 5 second talk karein", "Woman nod kare then right side move kare"].map((example) => <button key={example} onClick={() => setPrompt(example)}>{example}</button>)}
          </div>

          <button className="cb-ai-generate-button" disabled={busy || characters.length === 0 || !prompt.trim()} onClick={generate}>{busy ? "Generating plan…" : "Generate Animation Plan"}</button>
          {error && <div className="cb-ai-error">{error}</div>}

          {result && <section className="cb-ai-plan-card">
            <div className="cb-ai-plan-head"><strong>Plan Preview</strong><span>{result.provider} · {result.plan.duration.toFixed(1)}s</span></div>
            {result.plan.actions.length === 0 ? <div className="cb-ai-plan-empty">No supported actions were generated.</div> : (
              <div className="cb-ai-plan-list">
                {result.plan.actions.map((action, index) => (
                  <div key={`${action.characterId}-${action.start}-${index}`}>
                    <b>{action.start.toFixed(2)}s → {(action.start + action.duration).toFixed(2)}s</b>
                    <span>{actionText(action, characters)}</span>
                  </div>
                ))}
              </div>
            )}
            {result.plan.unsupported.length > 0 && <div className="cb-ai-unsupported"><strong>Not applied</strong>{result.plan.unsupported.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>}
            <div className="cb-ai-plan-actions">
              <button onClick={generate} disabled={busy}>Regenerate</button>
              <button className="primary" disabled={result.plan.actions.length === 0} onClick={() => onApply(result.plan)}>Apply to Timeline</button>
            </div>
          </section>}
        </div>
      </div>
    </div>
  );
}
