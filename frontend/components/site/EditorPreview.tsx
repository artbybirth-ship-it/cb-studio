export default function EditorPreview() {
  return (
    <div className="editor-preview-wrap" aria-label="CharacterBazaarStudio editor preview">
      <div className="editor-window">
        <div className="editor-topbar"><div className="editor-logo-mini">CB</div><div className="editor-title">Village Story • Scene 03</div><div className="editor-top-actions"><span>1080p</span><button>Export</button></div></div>
        <div className="editor-body">
          <aside className="editor-leftbar"><button className="active">✦<span>Characters</span></button><button>▧<span>Background</span></button><button>♫<span>Audio</span></button><button>T<span>Text</span></button><button>⬆<span>Upload</span></button></aside>
          <div className="editor-assets">
            <div className="editor-search">Search characters</div>
            <div className="asset-grid">
              {["Farmer","Student","Teacher","Woman","Boy","Elder"].map((name, i) => <div className="mini-character" key={name}><div className={`mini-avatar avatar-${i+1}`}><span className="mini-head"/><span className="mini-body"/></div><span>{name}</span></div>)}
            </div>
          </div>
          <div className="editor-canvas-area">
            <div className="editor-canvas">
              <div className="canvas-sun" />
              <div className="canvas-cloud cloud-a"/><div className="canvas-cloud cloud-b"/>
              <div className="canvas-hill hill-a"/><div className="canvas-hill hill-b"/>
              <div className="canvas-house"><span className="house-roof"/><span className="house-door"/></div>
              <div className="canvas-tree tree-one"><span/><i/></div><div className="canvas-tree tree-two"><span/><i/></div>
              <div className="hero-character"><div className="hero-hair"/><div className="hero-face"><i/><b/></div><div className="hero-shirt"/><div className="hero-leg left"/><div className="hero-leg right"/><div className="hero-arm left"/><div className="hero-arm right"/></div>
              <div className="selection-box"><span className="handle h1"/><span className="handle h2"/><span className="handle h3"/><span className="handle h4"/></div>
            </div>
            <div className="canvas-toolbar"><button>−</button><span>72%</span><button>+</button><span className="spacer"/><button>↶</button><button>↷</button></div>
          </div>
          <aside className="editor-properties"><h4>Character</h4><label>Animation<select><option>Talking 01</option></select></label><label>Expression<select><option>Happy</option></select></label><div className="property-row"><label>X<input value="512" readOnly/></label><label>Y<input value="324" readOnly/></label></div><button className="property-button">Add Lip Sync</button></aside>
        </div>
        <div className="editor-timeline"><div className="timeline-controls">▶ <span>00:03.4 / 00:12.0</span></div><div className="timeline-tracks"><div className="track-labels"><span>Character</span><span>Voiceover</span><span>Background</span></div><div className="track-lines"><div><b className="clip clip-purple">Talking 01</b><b className="clip clip-blue">Wave</b></div><div><b className="clip clip-audio">Voice • Scene 3</b></div><div><b className="clip clip-bg">Village Day</b></div><i className="playhead"/></div></div></div>
      </div>
    </div>
  );
}
