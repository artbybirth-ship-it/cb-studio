/** Icons for the tool rail groups and their panels (24×24 line art, currentColor). */

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const SelectIcon = () => (
  <svg viewBox="31.86 37.09 32 32" aria-hidden="true"><path d="M55.58,56.94l-5.3-.88c-.65-.11-1.58-.07-1.88.51l-2.22,5.03c-.72,1.37-2.79.92-2.87-.63l-.88-15.6c-.08-1.34,1.49-2.12,2.52-1.25l11.88,10.15c1.18,1,.28,2.92-1.24,2.67Z" fill="none" stroke="currentColor" strokeMiterlimit="10" /></svg>
);
export const ScaleIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" strokeMiterlimit="10"><rect x="7.5" y="13.5" width="11" height="11" /><path d="M12.5 8.5h11v11" strokeDasharray="2 1.6" /><path d="M15.5 16.5l9-9M19.5 7.5h5v5" /></g></svg>
);
export const ReflectIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v20" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.8" /><path d="M14 10l-7 12h7z" fill="currentColor" /><path d="M18 10l7 12h-7z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
);
// A selection frame: 8 hollow handles joined by lines, and the filled centre (as the Transform panel).
const FRAME = [8, 16, 24];
const HANDLE = 1.9;
const frameSegments = FRAME.slice(0, 2).flatMap((from, index) => {
  const a = from + HANDLE, b = FRAME[index + 1] - HANDLE;
  return [`M${a} 8H${b}`, `M${a} 24H${b}`, `M8 ${a}V${b}`, `M24 ${a}V${b}`];
}).join("");
export const TransformIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d={frameSegments} fill="none" stroke="currentColor" strokeWidth="1" />
    {FRAME.map((x) => FRAME.map((y) => (x === 16 && y === 16
      ? <rect key="centre" x={16 - HANDLE} y={16 - HANDLE} width={HANDLE * 2} height={HANDLE * 2} fill="currentColor" />
      : <rect key={`${x}-${y}`} x={x - HANDLE} y={y - HANDLE} width={HANDLE * 2} height={HANDLE * 2} fill="none" stroke="currentColor" strokeWidth="1" />)))}
  </svg>
);
export const TextIcon = () => (
  <svg viewBox="31.86 152.09 32 32" aria-hidden="true"><path d="M47.86,160.92v14.34M55.49,160.92h-15.25M55.49,160.92v1.8M40.24,160.92v1.8M49.66,175.26h-3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const FileIcon = () => <SaveAsIcon />;
// File menu (as the mockup): Save, Import, Export / Save As, Open file, New file.
export const SaveIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 8h10.5L24 11.5V22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" {...line} /><path d="M12 8v5h7V8M11.5 24v-6.5h9V24" {...line} /></svg>);
export const ImportIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M15 8.5h9v15h-9M15 8.5v3M15 23.5v-3" {...line} /><path d="M10 8.5v8.5h10.5M17.5 14l3 3-3 3" {...line} /></svg>);
export const ExportIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 9H8.5v15h15v-7" {...line} /><path d="M13.5 19.5v-3.5a4.5 4.5 0 0 1 4.5-4.5h6M21 8.5l3 3-3 3" {...line} /></svg>);
// Save As / the File group (mockup): a floppy disk in the middle, two arrows round it, clockwise, with
// solid tips (top → right, pointing down; bottom → left, pointing up).
export const SaveAsIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
      <path d="M11 10h8.8l2.2 2.2V21a1 1 0 0 1-1 1H11a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1z" />
      <path d="M12.6 10v3.4h6V10M12.6 22v-4.6h6.8V22" />
    </g>
    <path d="M16 4.5A11.5 11.5 0 0 1 27.25 13.6M16 27.5A11.5 11.5 0 0 1 4.75 18.4" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    <path d="M28.8 13.25L25.7 13.95L27.8 16.15zM3.2 18.75L6.3 18.05L4.2 15.85z" fill="currentColor" />
  </svg>
);
export const OpenFileIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 15l8-4 8 4v8.5l-8 4-8-4z" {...line} /><path d="M8 15l8 4 8-4M16 19v8.5" {...line} /><path d="M8 15l-2.5-3 8-4 2.5 3M24 15l2.5-3-8-4-2.5 3" {...line} /><path d="M16 11V4.5M13.5 7L16 4.5 18.5 7" {...line} strokeDasharray="0" /></svg>
);
export const NewFileIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M14 12.5h10.5V24H8V17" {...line} /><path d="M11 18h10.5M11 21h10.5" {...line} /><path d="M10.5 6.5v8M6.5 10.5h8" {...line} /></svg>
);
export const ColourIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="13" y="13" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" /><rect x="7.5" y="7.5" width="11" height="11" fill="currentColor" stroke="#2b2b2b" strokeWidth="1" /></svg>
);
export const FillIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="9" width="14" height="14" fill="currentColor" stroke="currentColor" strokeWidth="1" /></svg>);
export const StrokeIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="10" y="10" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" /></svg>);
export const SwapIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 12h14l-3.5-3.5M24 20H10l3.5 3.5" {...line} /></svg>);
export const RecolourIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="12" r="4" fill="#e0624f" /><circle cx="20" cy="11" r="4" fill="#e8c34d" /><circle cx="16" cy="19" r="4" fill="#4f8fe0" /><path d="M8 24h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
);
export const AlignIcon = () => (<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25.5h18" {...line} /><rect x="9.5" y="9" width="5" height="13.5" fill="currentColor" /><rect x="17.5" y="14" width="5" height="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>);

/** Align panel icons: a line on the aligned edge or centre, two boxes. */
const AlignGlyph = ({ axis, at }: { axis: "x" | "y"; at: "start" | "center" | "end" }) => {
  const pos = at === "start" ? 7 : at === "center" ? 16 : 25;
  const boxes = axis === "x"
    ? [{ w: 12, h: 5, y: 9 }, { w: 7, h: 5, y: 18 }].map((b) => ({ ...b, x: at === "start" ? 7 : at === "center" ? 16 - b.w / 2 : 25 - b.w }))
    : [{ w: 5, h: 12, x: 9 }, { w: 5, h: 7, x: 18 }].map((b) => ({ ...b, y: at === "start" ? 7 : at === "center" ? 16 - b.h / 2 : 25 - b.h }));
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {axis === "x" ? <path d={`M${pos} 5v22`} {...line} /> : <path d={`M5 ${pos}h22`} {...line} />}
      {boxes.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={i === 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />)}
    </svg>
  );
};
export const AlignLeftIcon = () => <AlignGlyph axis="x" at="start" />;
export const AlignHCenterIcon = () => <AlignGlyph axis="x" at="center" />;
export const AlignRightIcon = () => <AlignGlyph axis="x" at="end" />;
export const AlignTopIcon = () => <AlignGlyph axis="y" at="start" />;
export const AlignVCenterIcon = () => <AlignGlyph axis="y" at="center" />;
export const AlignBottomIcon = () => <AlignGlyph axis="y" at="end" />;
export const DistributeHIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">{[8, 16, 24].map((x) => <g key={x}><rect x={x - 2.5} y="10" width="5" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d={`M${x} 6v20`} stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" /></g>)}</svg>
);
export const DistributeVIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">{[8, 16, 24].map((y) => <g key={y}><rect x="10" y={y - 2.5} width="12" height="5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d={`M6 ${y}h20`} stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" /></g>)}</svg>
);
