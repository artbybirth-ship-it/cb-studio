"use client";

import { useRef, useState } from "react";
import { MEDIA_DISPLAY_EXTENSIONS, MEDIA_LIBRARY_COPY, MEDIA_VECTOR_EXTENSIONS, type MediaLibraryType } from "@/lib/mediaLibrary";
import { useMediaLibrary } from "@/lib/useMediaLibrary";

const extList = (exts: string[]) => exts.map((ext) => ext.slice(1).toUpperCase()).join(" · ");

/** Admin upload / instructions / installed packs for one Backgrounds, FX or SFX library. */
export default function MediaLibraryAdminSection({ type }: { type: MediaLibraryType }) {
  const { items, packages, loading, uploading, error, uploadLibrary, deletePackage } = useMediaLibrary(type);
  const [message, setMessage] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const copy = MEDIA_LIBRARY_COPY[type];
  const vectors = MEDIA_VECTOR_EXTENSIONS[type];
  const categories = new Set(items.map((item) => item.category)).size;

  const upload = async (file: File) => {
    setMessage("");
    setSkipped([]);
    try {
      const result = await uploadLibrary(file);
      setMessage(`${file.name} uploaded — ${result.items.length} ${copy.singular}${result.items.length === 1 ? "" : "s"} added. They are now available in Studio.`);
      setSkipped(result.skipped || []);
    } catch {
      // The hook exposes the detailed error below.
    }
  };

  const remove = async (packageId: string, name: string) => {
    if (!window.confirm(`Delete "${name}" from the ${copy.label} library?`)) return;
    setMessage("");
    setSkipped([]);
    try {
      await deletePackage(packageId);
      setMessage(`${name} removed from Studio.`);
    } catch {
      // The hook exposes the detailed error below.
    }
  };

  return (
    <>
      <div className="cb-admin-heading">
        <div>
          <span>UNIVERSAL {copy.label.toUpperCase()} LIBRARY</span>
          <h1>{copy.label} Library Management</h1>
          <p>Upload once here. Every Studio project reads the same {copy.label} library.</p>
        </div>
        <div className="cb-admin-stats">
          <div><b>{packages.length}</b><span>Packages</span></div>
          <div><b>{items.length}</b><span>{copy.label === "SFX" ? "Sounds" : "Items"}</span></div>
          <div><b>{categories}</b><span>Categories</span></div>
        </div>
      </div>

      <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void upload(file);
        event.currentTarget.value = "";
      }} />

      <button className="cb-admin-upload-card" type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>
        <strong>{uploading ? "Uploading & indexing…" : `＋ Upload ${copy.label} Library ZIP`}</strong>
        <span>Supported inside the ZIP: {extList([...MEDIA_DISPLAY_EXTENSIONS[type], ...vectors])}</span>
      </button>

      <section className="cb-admin-zip-guide">
        <strong>How to prepare the {copy.label} ZIP</strong>
        <ul>
          <li><b>Supported files:</b> {extList(MEDIA_DISPLAY_EXTENSIONS[type])}{vectors.length ? <> — plus vector originals {extList(vectors)}</> : null}.</li>
          {vectors.length > 0 && <li><b>Vector files ({extList(vectors)}):</b> browsers cannot display these, so put a preview image with the <em>same name</em> in the same folder (e.g. <code>street.ai</code> + <code>street.png</code>). The preview is used in Studio and the original is stored with it. Vector files without a preview are skipped.</li>}
          <li><b>Folders become categories:</b> <code>Village/day.jpg</code> appears under “Village” with the name “day”. Files in the top folder go to “General”.</li>
          <li><b>Optional <code>cb-library.json</code></b> to set exact names/categories: <code>{`{"items":[{"file":"Village/day.jpg","name":"Village Day","category":"Village"}]}`}</code></li>
          <li><b>Ignored automatically:</b> <code>__MACOSX</code>, <code>.DS_Store</code> and other files. Unsupported files are skipped and listed after upload.</li>
          <li><b>Size limit:</b> 500 MB per ZIP (1 GB after unzipping), up to 10,000 files.</li>
        </ul>
        <div className="cb-admin-zip-example"><span>Example ZIP</span>{copy.example.map((line) => <code key={line}>{line}</code>)}</div>
      </section>

      {error && <div className="cb-admin-error">{error}</div>}
      {message && <div className="cb-admin-success">{message}</div>}
      {skipped.length > 0 && <div className="cb-admin-skipped"><strong>Skipped {skipped.length} file{skipped.length === 1 ? "" : "s"}:</strong><ul>{skipped.slice(0, 50).map((line) => <li key={line}>{line}</li>)}</ul>{skipped.length > 50 && <small>…and {skipped.length - 50} more</small>}</div>}

      <section className="cb-admin-library-list">
        <header><strong>Installed {copy.label} Libraries</strong><span>{loading ? "Loading…" : `${packages.length} installed`}</span></header>
        {!loading && packages.length === 0 ? (
          <div className="cb-admin-empty">No {copy.label} library is installed. Upload the first ZIP above.</div>
        ) : packages.map((pkg) => (
          <article key={pkg.id} className="cb-admin-package">
            <div className="cb-admin-package-icon">ZIP</div>
            <div className="cb-admin-package-copy">
              <strong>{pkg.name}</strong>
              <span>{pkg.itemCount} {copy.singular}{pkg.itemCount === 1 ? "" : "s"}{pkg.skipped?.length ? ` · ${pkg.skipped.length} skipped` : ""}</span>
              <small>Uploaded {new Date(pkg.created_at).toLocaleString()}</small>
            </div>
            <button className="danger" onClick={() => void remove(pkg.id, pkg.name)}>Delete</button>
          </article>
        ))}
      </section>
    </>
  );
}
