import Link from "next/link";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import EditorPreview from "@/components/site/EditorPreview";

const creatorCards = [
  ["StoryVerse", "12M", "Moral stories"], ["Night Tales", "8M", "Horror stories"], ["Toon Junction", "6M", "Comedy shorts"], ["Kids Kahani", "18M", "Kids stories"], ["Folk Studio", "4.5M", "Folk tales"], ["Tiny Adventures", "9M", "Family stories"],
];

const faq = [
  ["What is CharacterBazaarStudio?", "CharacterBazaarStudio is a browser-based 2D animation workspace for building scenes with production-ready characters, backgrounds, voiceovers, actions and AI-assisted creative tools."],
  ["Can I start without animation experience?", "Yes. The workflow is designed around drag-and-drop scene building, ready-made actions, templates and simple timeline controls."],
  ["Can I use CharacterBazaar characters inside the studio?", "The project is designed so the CharacterBazaar library can become a native asset source for characters, poses, expressions and action packs."],
  ["Will projects remain editable?", "Yes. Scene composition is saved as structured project data so you can reopen and edit positions, assets, timing and scene properties."],
  ["Does this build already include AI generation?", "The MVP includes an AI-service integration layer and local mock endpoints. Production providers can be connected later without redesigning the editor."],
];

export default function HomePage() {
  return (
    <main className="marketing-page">
      <SiteHeader />
      <section className="hero-section">
        <div className="hero-glow hero-glow-a"/><div className="hero-glow hero-glow-b"/>
        <div className="site-shell hero-grid">
          <div className="hero-copy">
            <div className="eyebrow-pill"><span>⚡</span> Faster animation workflow</div>
            <h1>Build <span>2D animated stories</span> with AI-powered creative tools</h1>
            <p>Create characters, backgrounds, voiceovers and complete scenes from one browser-based studio built for storytellers.</p>
            <div className="hero-actions"><Link href="/dashboard" className="primary-button big-button">Start Creating Free <span>→</span></Link><Link href="/features" className="secondary-button big-button">Explore Features</Link></div>
            <div className="hero-trust"><span>✓ No credit card required</span><span>✓ Browser based</span><span>✓ Editable scenes</span></div>
          </div>
          <div className="hero-visual"><div className="floating-badge badge-one">✦ AI Characters</div><div className="floating-badge badge-two">♫ Voice + Lip Sync</div><div className="floating-badge badge-three">1000+ Actions</div><div className="hero-card-stack"><div className="hero-card back-card"/><div className="hero-card mid-card"/><div className="hero-illustration-card"><div className="illustration-sky"><span className="illustration-sun"/><span className="illustration-cloud c1"/><span className="illustration-cloud c2"/></div><div className="illustration-ground"/><div className="illustration-character"><span className="ic-head"/><span className="ic-hair"/><span className="ic-body"/><span className="ic-leg l1"/><span className="ic-leg l2"/><span className="ic-arm a1"/><span className="ic-arm a2"/></div><div className="illustration-house"><span/></div></div></div></div>
        </div>
      </section>

      <section className="creator-strip-section">
        <div className="site-shell"><p className="section-kicker centered">Built for creators growing animation channels</p><div className="creator-marquee">{creatorCards.map(([name, views, genre], i) => <div className="creator-card" key={name}><div className={`creator-thumb creator-thumb-${i+1}`}><span>▶</span></div><div><strong>{name}</strong><small>{genre}</small></div><div className="creator-meta"><b>{views}</b><small>Views</small></div><span className="monetized">● Growing</span></div>)}</div></div>
      </section>

      <section className="stats-section"><div className="site-shell stats-grid"><div><span className="stat-icon">◎</span><strong>Built for</strong><b>Creators & Studios</b></div><div><span className="stat-icon">↓</span><strong>Export-ready</strong><b>Animation Workflow</b></div><div><span className="stat-icon">▦</span><strong>Connected</strong><b>Asset Library</b></div></div></section>

      <section className="section section-light" id="tools"><div className="site-shell"><div className="section-heading"><div><span className="section-kicker">Built for Storytellers</span><h2>Advanced AI tools with <span>creative control</span></h2></div><p>Generate assets quickly, then refine the result inside a scene-based animation studio instead of jumping between disconnected tools.</p></div><div className="feature-bento">
        <article className="bento-card bento-wide purple-card" id="voice"><div className="bento-copy"><span className="feature-icon">♫</span><h3>Generate AI Voiceovers</h3><p>Create natural voice tracks, place them on the timeline and prepare dialogue for lip-sync workflows.</p><Link href="/features#voice">Explore Voice Tools →</Link></div><div className="voice-visual"><div className="waveform">{Array.from({length:24}).map((_,i)=><i key={i} style={{height:`${18 + ((i*17)%54)}%`}}/>)}</div><div className="voice-card"><span className="voice-avatar">A</span><div><b>Warm Storyteller</b><small>Hindi • Female</small></div><button>▶</button></div></div></article>
        <article className="bento-card cyan-card" id="backgrounds"><div className="bento-copy"><span className="feature-icon">▧</span><h3>AI Backgrounds</h3><p>Turn prompts, sketches and references into consistent scene backgrounds.</p></div><div className="background-visual"><div className="bg-mountain m1"/><div className="bg-mountain m2"/><div className="bg-sun"/><div className="prompt-pill">“Indian village at sunset…” <span>✦</span></div></div></article>
        <article className="bento-card orange-card" id="characters"><div className="bento-copy"><span className="feature-icon">✦</span><h3>AI + Library Characters</h3><p>Use production-ready characters or generate custom visual directions for your story.</p></div><div className="characters-visual">{[1,2,3].map((x)=><div key={x} className={`feature-person fp-${x}`}><span className="fp-head"/><span className="fp-body"/></div>)}</div></article>
        <article className="bento-card bento-wide dark-card" id="editing"><div className="bento-copy"><span className="feature-icon">⌘</span><h3>Advanced Editing Tools</h3><p>Layer management, transform controls, scene timing, effects and reusable actions give creators control after generation.</p><Link href="/features#studio">See Studio Animation →</Link></div><div className="layers-visual"><div className="layer-card l-back">Background <span>⋮</span></div><div className="layer-card l-mid">Character • Farmer <span>⋮</span></div><div className="layer-card l-front">Voiceover • Scene 03 <span>⋮</span></div></div></article>
      </div></div></section>

      <section className="section studio-showcase" id="studio"><div className="site-shell"><div className="center-heading"><span className="section-kicker">All-in-one animation workspace</span><h2>From asset to animation <span>without leaving the studio</span></h2><p>Build scenes visually, add actions and dialogue, control timing and send the finished project to the render pipeline.</p></div><EditorPreview/><div className="control-grid"><article><span>01</span><h3>1000+ Action-ready controls</h3><p>Walk, talk, sit, run, wave and extend the library with reusable action packs.</p></article><article><span>02</span><h3>Expressions & Lip Sync</h3><p>Pair facial states, dialogue and mouth timing for story-driven character performances.</p></article><article><span>03</span><h3>Props & Layer System</h3><p>Keep backgrounds, characters, props, text and audio independently editable.</p></article><article><span>04</span><h3>Multi-device Workflow</h3><p>A responsive web application with a desktop-first professional editor experience.</p></article></div></div></section>

      <section className="section workflow-section"><div className="site-shell"><div className="section-heading"><div><span className="section-kicker">How it works</span><h2>A simpler path from <span>idea to final video</span></h2></div><Link href="/dashboard" className="secondary-button">Open Studio →</Link></div><div className="workflow-grid"><div className="workflow-line"/>{[["01","Create a project","Choose size, template or a blank scene."],["02","Add story assets","Pick characters, backgrounds, props and audio."],["03","Animate the scene","Set actions, expressions, transforms and timing."],["04","Render & export","Queue your project and generate the final video."]].map(([n,t,d])=><article key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></article>)}</div></div></section>

      <section className="section templates-preview"><div className="site-shell"><div className="section-heading"><div><span className="section-kicker">Start faster</span><h2>Animation templates for <span>every story style</span></h2></div><Link href="/templates" className="text-link">Browse all templates →</Link></div><div className="template-grid">{["Village Story","Horror Night","School Comedy","Kids Adventure"].map((name,i)=><Link href="/dashboard" className={`template-card template-${i+1}`} key={name}><div className="template-art"><span className="template-moon"/><span className="template-land land-1"/><span className="template-land land-2"/><span className="template-person"/></div><div><strong>{name}</strong><small>16:9 • 2D Animation</small></div><span className="template-arrow">↗</span></Link>)}</div></div></section>

      <section className="section faq-section" id="faq"><div className="site-shell faq-grid"><div className="faq-intro"><span className="section-kicker">Your questions answered</span><h2>Frequently asked <span>questions</span></h2><p>Everything you need to know before starting your first CharacterBazaarStudio project.</p><Link href="mailto:hello@characterbazaarstudio.com" className="secondary-button">Contact Support</Link></div><div className="faq-list">{faq.map(([q,a],i)=><details key={q} open={i===0}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></div></section>

      <section className="final-cta"><div className="site-shell final-cta-inner"><div className="final-cta-glow"/><div><span className="eyebrow-pill light-pill">No credit card required</span><h2>Ready to create your next animated story?</h2><p>Start with a blank scene, use a template, or build directly from the CharacterBazaar asset ecosystem.</p><Link href="/dashboard" className="white-button">Create Animations <span>→</span></Link></div><div className="cta-device"><div className="cta-device-screen"><div className="device-sidebar"/><div className="device-scene"><span className="device-sun"/><span className="device-person"/></div><div className="device-timeline"/></div></div></div></section>
      <SiteFooter />
    </main>
  );
}
