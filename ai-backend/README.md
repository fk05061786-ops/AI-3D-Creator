# AI-3D-Creator Phase 4 Backend

This is the Python backend for Phase 4 AI Text-to-3D generation.

## Approved Architecture (from PHASE4_AI_PREPARATION_RESEARCH.txt)

**Target Pipeline:**
- Text-to-3D: Shap-E (MIT licensed, lightweight, direct text conditioning)
- Image-to-3D: TripoSR (MIT/Apache licensed, high quality, fast inference)
- Backend: Python FastAPI service for local execution

**Deployment Options (no paid services):**
1. **Local Development:** Run on developer's PC with NVIDIA GPU
2. **Free Cloud:** Use Hugging Face Spaces (free tier) or Google Colab (free GPU)
3. **No Cost:** All research uses MIT/Apache licensed models

## Technical Requirements

### Local Execution (Default)
- Python 3.10+ on Windows/macOS/Linux
- PyTorch with CUDA support (optional, falls back to CPU)
- ~6GB–8GB VRAM (NVIDIA RTX 3060/4060+ recommended)

### Free Cloud Options
- **Hugging Face Spaces**: Free GPU, instant deployment
- **Google Colab**: Free T4 GPU (limited session time)
- **No Payment Required**: MIT/Apache license allows free usage

## API Endpoints

### POST /api/generate-3d
Request body:
```json
{
  "prompt": "red cube",
  "pipeline": "text-to-3d",  // or "image-to-3d"
  "imageUrl": "https://example.com/image.jpg"  // for image-to-3d
}
```

Response:
```json
{
  "success": true,
  "format": "glb",
  "data": "base64-encoded-glb-file",
  "filename": "generated_3d_model.glb"
}
```

### GET /health
Health check endpoint.

## Installation

### Local Development
```bash
python -m venv venv
. venv/bin/activate
pip install -r requirements.txt

# When local GPU is available:
# pip install torch transformers
# Configure local model loading

python -m ai_backend.server
```

### Hugging Face Spaces
```yaml
# .github/workflows/hf-spaces.yml
name: Build and deploy to Hugging Face Spaces

on:
  push:
    branches: [main]
```

## Model License Compliance

### MIT Models
- **Shap-E** (`openai/shap-e`): MIT License - Free for any use
- Allows local deployment, inference, commercial use

### Apache 2.0 Models  
- **TripoSR** (`cvlab-st/TripoSR`): Apache 2.0 - Free for any use
- Requires attribution in documentation

## Hardware Integration

From `src/engine/export/glb-importer.ts`:
- Backend returns GLB files (Binary GLTF)
- Frontend uses `GLBImporter` to add SceneObjects to EditorEngine and SceneGraph
- Supported by existing export infrastructure

## Backend Development Status

Based on PHASE4_AI_PREPARATION_RESEARCH.txt:
- **Research Complete**: All model options and architectures evaluated
- **GO/NO-GO**: APPROVED (research confirms free MIT/Apache models available)
- **Implementation**: Ready to proceed with local-only backend

## Local GPU Check
```python
# In server initialization
import torch
if torch.cuda.is_available():
    print(f"CUDA available: {torch.cuda.get_device_name()}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
else:
    print("CUDA not available - using CPU fallback")
```

## Next Steps

1. Set up local GPU and install PyTorch/transformers
2. Implement local model loading for Shap-E/TripoSR
3. Add image handling for TripoSR pipeline
4. Test GLB output compatibility with frontend importer
5. Set up free cloud deployment (Hugging Face Spaces)

## Monitoring and Logging

- All responses logged for debugging
- Error handling for GPU/CPU fallbacks
- Model loading progress tracking
- Request/response size limits

## Security Considerations

- Input sanitization for prompts
- Size limits on generated files (max 100MB per request)
- Rate limiting (100 requests/minute default)
- No external API keys required

## Performance Targets

- **Local GPU**: <30 seconds for small models (<= 1000 polygons)
- **CPU Fallback**: 2-5 minutes for larger models
- **Cloud Free**: 10-30 seconds on Hugging Face Spaces
- **Mobile**: Requires cloud fallback (see research)

## Summary

This backend provides free, open-source AI Text-to-3D generation using:
- **MIT/Apache licensed models** (no paid API keys)
- **Local or free cloud deployment** (no billing required)
- **Existing GLB format compatibility** (no frontend changes needed)
- **GPU/CPU fallback** (works on any hardware)

Ready for Phase 4 implementation.