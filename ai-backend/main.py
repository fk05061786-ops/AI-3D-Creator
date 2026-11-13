"""Local AI-3D-Creator backend.

Text-to-3D is still a demo box. Image-to-3D runs a dependency-free luminance
relief fallback unless a neural model is supplied separately. No paid API,
cloud GPU or automatic model download is used.
"""

import asyncio
import base64
import logging
import time
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from geometry import box_glb, heightmap_glb

try:
    import torch
except ImportError:  # CPU-only installs are supported.
    torch = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI-3D-Creator Backend", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerationRequest(BaseModel):
    prompt: str = ""
    pipeline: str = "text-to-3d"
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    image_pixels: Optional[list[int]] = None
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    max_vertices: int = 3000
    gpu_fallback: bool = True


class GenerationResponse(BaseModel):
    success: bool
    format: str = "glb"
    data: str
    filename: str
    model_used: str
    processing_time: float
    gpu_available: bool
    model_info: Optional[Dict[str, Any]] = None


def _gpu_available() -> bool:
    return bool(torch is not None and torch.cuda.is_available())


def _safe_name(value: str, fallback: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in "-_" else "_" for c in value.strip())
    return (cleaned[:50] or fallback)


def _pixels_from_base64(image_base64: str):
    try:
        from PIL import Image
    except ImportError as exc:
        raise HTTPException(
            status_code=400,
            detail="image_base64 needs Pillow for decoding; send image_pixels instead.",
        ) from exc

    raw = image_base64.split(",", 1)[-1]
    from io import BytesIO

    try:
        image = Image.open(BytesIO(base64.b64decode(raw))).convert("L")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid image_base64") from exc
    width, height = image.size
    return list(image.getdata()), width, height


async def generate_text_to_3d(prompt: str, max_vertices: int):
    await asyncio.sleep(0.05)
    data = box_glb(1.0)
    name = _safe_name(prompt, "model")
    return {
        "data": base64.b64encode(data).decode("ascii"),
        "filename": f"generated_{name}.glb",
        "model_used": "Local demo box",
        "model_info": {
            "model": "demo-box",
            "license": "n/a",
            "prompt": prompt,
            "max_vertices": max_vertices,
            "note": "Placeholder demo geometry; no text-to-3D neural model is installed.",
        },
    }


async def generate_image_to_3d(request: GenerationRequest):
    await asyncio.sleep(0.05)
    pixels = request.image_pixels
    width = request.image_width
    height = request.image_height

    if not pixels or not width or not height:
        if request.image_base64:
            pixels, width, height = _pixels_from_base64(request.image_base64)
        else:
            raise HTTPException(
                status_code=400,
                detail="image_pixels with image_width/image_height is required.",
            )

    try:
        data = heightmap_glb(pixels, width, height, request.max_vertices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "data": base64.b64encode(data).decode("ascii"),
        "filename": "generated_from_image.glb",
        "model_used": "Local luminance relief (CPU)",
        "model_info": {
            "model": "local-heightmap",
            "license": "n/a",
            "image_width": width,
            "image_height": height,
            "max_vertices": request.max_vertices,
            "note": "Local CPU relief fallback from image luminance; TripoSR neural weights are not installed.",
        },
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "gpu_available": _gpu_available(),
        "version": "1.1.0",
    }


@app.post("/api/generate-3d", response_model=GenerationResponse)
async def generate_3d_model(request: GenerationRequest):
    started = time.time()
    try:
        if request.pipeline == "text-to-3d":
            result = await generate_text_to_3d(request.prompt, request.max_vertices)
        elif request.pipeline == "image-to-3d":
            result = await generate_image_to_3d(request)
        else:
            raise HTTPException(status_code=400, detail="Invalid pipeline specified")

        return GenerationResponse(
            success=True,
            data=result["data"],
            filename=result["filename"],
            model_used=result["model_used"],
            processing_time=time.time() - started,
            gpu_available=_gpu_available(),
            model_info=result.get("model_info"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Generation failed")
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
