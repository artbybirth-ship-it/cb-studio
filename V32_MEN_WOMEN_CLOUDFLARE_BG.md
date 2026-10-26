# v32 – Men Talk + Women Talk + Cloudflare Prompt Backgrounds

- Replaced the one-card talking library with the supplied **Men Talk** and **Women Talk** HTML5 Canvas assets.
- Added per-source manifests so body-part selection and source animation continue to work.
- Character creation is catalog-driven instead of hard-coded to one `Talking.zip` path.
- Cloudflare Workers AI remains server-side and generates prompt backgrounds through `/ai-api/v1/generate/background`.
- FLUX.1 Schnell output is decoded and fit to the project canvas, then persisted through the existing background upload path.
- Cloudflare token and account ID are read only from root `.env`.
