# AI-3D-Creator Backend

Phase 4: AI Text-to-3D Generation Backend

This backend provides free, open-source AI Text-to-3D generation using MIT/Apache licensed models
(Shap-E for text-to-3D, TripoSR for image-to-3D) with local and free cloud deployment options.

## Architecture

Based on PHASE4_AI_PREPARATION_RESEARCH.txt:

1. **Local Execution**: Developer's PC with NVIDIA GPU
2. **Free Cloud**: Hugging Face Spaces, Google Colab T4 GPU
3. **No Paid Services**: All MIT/Apache models are free to use

## API Endpoints

- POST /api/generate-3d: Generate 3D models from text or image
- GET /health: Health check

## Technologies

- FastAPI: Modern Python web framework
- Uvicorn: High-performance ASGI server
- Pydantic: Data validation
- Hugging Face Transformers: Model loading (when GPU available)
- GLB format: Exported 3D model format (compatible with existing frontend)

## License Compliance

MIT Models:
- Shap-E (`openai/shap-e`): MIT License - Commercial use allowed
Apache 2.0 Models:
- TripoSR (`cvlab-st/TripoSR`): Apache 2.0 - Attribution required

## Integration with Frontend

- Returns GLB files (Binary GLTF)
- Frontend uses `GLBImporter` (`src/engine/export/glb-importer.ts`)
- No frontend changes required - fully compatible

## Development Status

Phase 4 research complete (2026-11-09). All free model options evaluated and approved.
Ready for implementation - local GPU availability determines performance characteristics.