/**
 * Where a finished export goes. Chrome, Edge and the desktop app ask for the file and folder before
 * the export starts (the Save window); the file is written there once the export is done. Browsers
 * without that window (Safari, Firefox) download it to the Downloads folder, as Save does.
 */
type WritableHandle = { name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> };
type PickerWindow = Window & { showSaveFilePicker?: (options: unknown) => Promise<WritableHandle> };

export type ExportTarget = { name: string; handle?: WritableHandle };

const TYPES: Record<string, { description: string; accept: Record<string, string[]> }> = {
  mp4: { description: "MP4 video", accept: { "video/mp4": [".mp4"] } },
  gif: { description: "GIF animation", accept: { "image/gif": [".gif"] } },
  jpg: { description: "JPEG image", accept: { "image/jpeg": [".jpg", ".jpeg"] } },
  png: { description: "PNG image", accept: { "image/png": [".png"] } },
};

/** Ask where to save (must run straight from the click). null = the person cancelled. */
export async function pickExportTarget(fileName: string, extension: string): Promise<ExportTarget | null> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (!picker) return { name: fileName };
  try {
    const handle = await picker({ suggestedName: fileName, types: TYPES[extension] ? [TYPES[extension]] : undefined });
    return { name: handle.name, handle };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return null;
    throw cause;
  }
}

/** Write the finished export to the chosen file, or download it. */
export async function deliverExport(target: ExportTarget, url: string): Promise<{ status: "saved" | "downloaded"; name: string }> {
  if (target.handle) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch the export (HTTP ${response.status})`);
    const writable = await target.handle.createWritable();
    await writable.write(await response.blob());
    await writable.close();
    return { status: "saved", name: target.name };
  }
  const link = Object.assign(document.createElement("a"), { href: url, download: target.name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { status: "downloaded", name: target.name };
}
