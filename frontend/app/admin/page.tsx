"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useCharacterLibrary } from "@/lib/characterLibrary";
import HeaderUserIcon from "@/components/HeaderUserIcon";
import MediaLibraryAdminSection from "@/components/admin/MediaLibraryAdminSection";
import type { MediaLibraryType } from "@/lib/mediaLibrary";

type AdminTab = "characters" | MediaLibraryType;
const ADMIN_TABS: [AdminTab, string][] = [["characters", "Characters"], ["backgrounds", "Backgrounds"], ["fx", "FX"], ["sfx", "SFX"]];

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("characters");
  const { characters, packages, loading, uploading, error, uploadLibrary, deletePackage, refresh } = useCharacterLibrary();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getAdminSession()
      .then((result) => setAuthenticated(Boolean(result.authenticated)))
      .catch(() => setAuthenticated(false));
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    try {
      const result = await api.adminLogin(loginId, password);
      setAuthenticated(Boolean(result.authenticated));
      setPassword("");
      await refresh();
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await api.adminLogout();
      setAuthenticated(false);
      setLoginId("");
      setPassword("");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setMessage("");
    try {
      await uploadLibrary(file);
      setMessage(`${file.name} uploaded. It is now available in Studio.`);
    } catch {
      // Provider exposes the detailed error below.
    }
  };

  const remove = async (packageId: string, name: string) => {
    if (!window.confirm(`Delete "${name}" from the universal Studio library?`)) return;
    setMessage("");
    try {
      await deletePackage(packageId);
      setMessage(`${name} removed from Studio.`);
    } catch {
      // Provider exposes the detailed error below.
    }
  };

  if (authenticated === null) {
    return <main className="cb-admin-shell"><div className="cb-admin-card">Checking admin session…</div></main>;
  }

  if (!authenticated) {
    return (
      <main className="cb-admin-shell">
        <section className="cb-admin-login-card">
          <div className="cb-admin-brand"><b>CB</b><span>Studio Admin</span></div>
          <h1>Admin Login</h1>
          <p>Only the admin can add or remove Studio libraries (Characters, Backgrounds, FX and SFX).</p>
          <form onSubmit={login}>
            <label><span>Admin ID</span><input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoFocus autoComplete="username" /></label>
            <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
            {loginError && <div className="cb-admin-error">{loginError}</div>}
            <button type="submit" disabled={busy || !loginId || !password}>{busy ? "Signing in…" : "Login"}</button>
          </form>
          <Link href="/dashboard">← Back to Studio</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="cb-admin-shell">
      <header className="cb-admin-topbar cb-global-topbar">
        <Link href="/dashboard" className="cb-global-home" aria-label="Home"><img src="/opening-screen/home-button.svg" alt="Home" /></Link>
        <div className="cb-opening-logo"><img src="/opening-screen/cb-studio-logo.svg" alt="Character Bazaar Studio" /></div>
        <div>
          <Link href="/dashboard">Open Studio</Link>
          <button onClick={logout} disabled={busy}>Logout</button>
          <HeaderUserIcon />
        </div>
      </header>

      <section className="cb-admin-content">
        <nav className="cb-admin-tabs" aria-label="Library type">
          {ADMIN_TABS.map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => { setTab(id); setMessage(""); }}>{label}</button>
          ))}
        </nav>

        {tab !== "characters" ? <MediaLibraryAdminSection key={tab} type={tab} /> : <>
        <div className="cb-admin-heading">
          <div>
            <span>UNIVERSAL CHARACTER LIBRARY</span>
            <h1>Character Library Management</h1>
            <p>Upload once here. Every Studio project reads the same dynamic library. There are no bundled hard-coded character assets in this build.</p>
          </div>
          <div className="cb-admin-stats">
            <div><b>{packages.length}</b><span>Packages</span></div>
            <div><b>{characters.length}</b><span>Characters</span></div>
            <div><b>{characters.reduce((sum, character) => sum + character.actions.length, 0)}</b><span>Actions</span></div>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = "";
          }}
        />

        <button className="cb-admin-upload-card" type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>
          <strong>{uploading ? "Uploading & indexing…" : "＋ Upload Character Library ZIP"}</strong>
          <span>Adobe Animate HTML5 Canvas exports are auto-split into separate stage characters; player.html and cb-library.json packs are also supported</span>
        </button>

        <section className="cb-admin-zip-guide">
          <strong>How to prepare the Characters ZIP</strong>
          <ul>
            <li><b>Supported:</b> Adobe Animate HTML5 Canvas exports (the <code>.html</code> + <code>.js</code> files Animate publishes, with their images folder).</li>
            <li><b>Several characters in one Animate file</b> are split automatically — each top-level symbol on the stage becomes its own character.</li>
            <li><b>Action packs:</b> folders containing a <code>player.html</code> per action are also supported.</li>
            <li><b>Optional <code>cb-library.json</code></b> for exact character / action grouping, previews and replacement parts.</li>
            <li><b>Tip:</b> give body parts meaningful instance names in Animate (head, torso, leftHand…) for precise part editing.</li>
            <li><b>Size limit:</b> 500 MB per ZIP (1 GB after unzipping), up to 10,000 files.</li>
          </ul>
        </section>

        {error && <div className="cb-admin-error">{error}</div>}
        {message && <div className="cb-admin-success">{message}</div>}

        <section className="cb-admin-library-list">
          <header><strong>Installed Libraries</strong><span>{loading ? "Loading…" : `${packages.length} installed`}</span></header>
          {!loading && packages.length === 0 ? (
            <div className="cb-admin-empty">No character library is installed. Upload the first ZIP above.</div>
          ) : packages.map((pkg) => (
            <article key={pkg.id} className="cb-admin-package">
              <div className="cb-admin-package-icon">ZIP</div>
              <div className="cb-admin-package-copy">
                <strong>{pkg.name}</strong>
                <span>{pkg.characterCount} characters · {pkg.actionCount} actions</span>
                <small>Uploaded {new Date(pkg.created_at).toLocaleString()}</small>
              </div>
              <button className="danger" onClick={() => void remove(pkg.id, pkg.name)}>Delete</button>
            </article>
          ))}
        </section>
        </>}
      </section>
    </main>
  );
}
