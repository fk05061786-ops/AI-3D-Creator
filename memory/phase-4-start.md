---
name: phase-4-start
description: Phase 4 AI Text-to-3D generation startup
metadata:
  type: project
---

Phase 4: AI Text-to-3D Generator initiated.

## Confirmed Research Decisions (from PHASE4_AI_PREPARATION_RESEARCH.txt)

**Recommended Stack:**
- **Text-to-3D Pipeline:** Shap-E (lightweight, direct text conditioning)
- **Image-to-3D Pipeline:** TripoSR (high quality, fast inference)
- **Backend Service:** Python FastAPI wrapper exposed via HTTPS

**Installation Plan (Future):**
1. Set up Python FastAPI backend in separate folder (`ai-backend/`)
2. Install PyTorch, TripoSR, and Shap-E dependencies
3. Verify inference script outputs valid `.glb` files
4. Connect frontend API client in AI-3D-Creator

**Backend Verification Plan:**
- Send test curl request with prompt "red cube" and verify returned `.glb` file imports correctly into SceneGraph

**Risks & Unresolved:**
- Mobile offline limitation: local AI generation on Android impractical due to VRAM limits; online cloud microservice required
- Hosting cost: free cloud tiers have rate limits; sustained usage requires low-cost cloud GPU instance

## Current Project State
- Phase 3 Advanced Modeling Tools: COMPLETE (95% verified)
- Phase 4 AI Text-to-3D: RESEARCH COMPLETE, awaiting architecture approval and backend setup
- Platform storage abstraction: INTENTIONALLY DELETED (keep original localStorage ProjectManager)
- Ponytail: OFF

## Next Action Required
Proceed with Phase 4 backend setup per approved research, or await user approval decision.