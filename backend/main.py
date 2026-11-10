from fastapi import FastAPI, File, UploadFile, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
import logging
import sqlite3
import uvicorn
import numpy as np
import tensorflow as tf
import os
import base64
from io import BytesIO
from PIL import Image, UnidentifiedImageError
import cv2
from urllib.parse import urlparse

from disease_info import DISEASE_INFO
from class_labels import CLASS_LABELS
from model_utils import preprocess_image, top_k_indices, validate_probabilities
from scan_history import InvalidScanId, ScanHistoryStore

app = FastAPI(title="AI Farming Assistant API")

logger = logging.getLogger(__name__)
logger.setLevel(os.getenv("PLANT_DISEASE_LOG_LEVEL", "INFO").upper())
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BODY_BYTES = MAX_UPLOAD_BYTES + 256 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MIN_IMAGE_SIDE = 64
SUPPORTED_IMAGE_FORMATS = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
SUPPORTED_IMAGE_MEDIA_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


class RequestBodyTooLarge(Exception):
    pass


class UploadSizeLimitMiddleware:
    def __init__(self, application, max_body_bytes):
        self.application = application
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") not in {"/predict", "/explain"}:
            await self.application(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                declared_length = int(content_length)
            except ValueError:
                declared_length = 0
            if declared_length > self.max_body_bytes:
                await self._send_too_large(scope, receive, send)
                return

        received_bytes = 0

        async def limited_receive():
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > self.max_body_bytes:
                    raise RequestBodyTooLarge()
            return message

        try:
            await self.application(scope, limited_receive, send)
        except RequestBodyTooLarge:
            await self._send_too_large(scope, receive, send)

    @staticmethod
    async def _send_too_large(scope, receive, send):
        from starlette.responses import JSONResponse

        response = JSONResponse(
            status_code=413,
            content={"detail": "Image exceeds the 8 MB upload limit."},
        )
        await response(scope, receive, send)


app.add_middleware(
    UploadSizeLimitMiddleware,
    max_body_bytes=MAX_REQUEST_BODY_BYTES,
)


def _environment_bool(name, default):
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized not in {"true", "false", "1", "0", "yes", "no"}:
        raise RuntimeError(f"{name} must be set to true or false.")
    return normalized in {"true", "1", "yes"}


SCAN_HISTORY_ENABLED = _environment_bool("PLANT_DISEASE_ENABLE_SCAN_HISTORY", True)
history_store = ScanHistoryStore() if SCAN_HISTORY_ENABLED else None


def _configured_origins():
    origins = [
        origin.strip()
        for origin in os.getenv(
            "PLANT_DISEASE_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ]
    for origin in origins:
        parsed = urlparse(origin)
        try:
            parsed.port
        except ValueError as exc:
            raise RuntimeError(
                "PLANT_DISEASE_ALLOWED_ORIGINS contains an invalid port."
            ) from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.params
            or parsed.query
            or parsed.fragment
            or origin == "*"
        ):
            raise RuntimeError(
                "PLANT_DISEASE_ALLOWED_ORIGINS must be a comma-separated list of HTTP(S) origins without paths."
            )
    return origins


allowed_origins = _configured_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(__file__),
    "model",
    "efficientnetv2_plant_model.h5",
)
MODEL_PATH = os.path.abspath(os.getenv("PLANT_DISEASE_MODEL_PATH", DEFAULT_MODEL_PATH))
CONFIDENCE_THRESHOLD = os.getenv("PLANT_DISEASE_CONFIDENCE_THRESHOLD")
if CONFIDENCE_THRESHOLD is not None:
    try:
        CONFIDENCE_THRESHOLD = float(CONFIDENCE_THRESHOLD)
    except ValueError as exc:
        raise RuntimeError(
            "PLANT_DISEASE_CONFIDENCE_THRESHOLD must be a number between 0 and 100."
        ) from exc
    if not 0.0 <= CONFIDENCE_THRESHOLD <= 100.0:
        raise RuntimeError(
            "PLANT_DISEASE_CONFIDENCE_THRESHOLD must be between 0 and 100."
        )

try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    if model.output_shape[-1] != len(CLASS_LABELS):
        raise ValueError(
            f"Model has {model.output_shape[-1]} outputs but {len(CLASS_LABELS)} class labels are configured."
        )
    logger.info("Plant disease model loaded.")
except Exception:
    logger.exception("Plant disease model could not be loaded; readiness will fail.")
    model = None


async def _read_validated_image(file):
    try:
        contents = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()

    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 8 MB upload limit.")
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")

    declared_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if declared_type and declared_type != "application/octet-stream" and declared_type not in SUPPORTED_IMAGE_MEDIA_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Unsupported image type. Upload a JPG, PNG, or WebP image.",
        )

    try:
        with Image.open(BytesIO(contents)) as image:
            image_format = image.format
            width, height = image.size
            if image_format not in SUPPORTED_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=415,
                    detail="Unsupported image type. Upload a JPG, PNG, or WebP image.",
                )
            expected_type = SUPPORTED_IMAGE_FORMATS[image_format]
            if declared_type in SUPPORTED_IMAGE_MEDIA_TYPES and declared_type != expected_type and not (
                image_format == "JPEG" and declared_type == "image/jpg"
            ):
                raise HTTPException(
                    status_code=415,
                    detail="The uploaded image content does not match its declared file type.",
                )
            if min(width, height) < MIN_IMAGE_SIDE:
                raise HTTPException(
                    status_code=400,
                    detail=f"Image dimensions must be at least {MIN_IMAGE_SIDE} x {MIN_IMAGE_SIDE} pixels.",
                )
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="Image dimensions exceed the supported pixel limit.",
                )
            image.verify()
    except HTTPException:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        EOFError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(status_code=400, detail="Invalid or unsafe image data.") from exc
    return contents


def _require_scan_history():
    if not SCAN_HISTORY_ENABLED or history_store is None:
        raise HTTPException(status_code=404, detail="Scan history is disabled.")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def readiness():
    if model is None:
        raise HTTPException(status_code=503, detail="Prediction model is not ready.")
    return {"status": "ready", "model_loaded": True}


def _plant_name_for_class(class_name):
    if class_name.startswith("Pepper__bell___"):
        return "Bell pepper"
    if class_name.startswith("Potato___"):
        return "Potato"
    if class_name.startswith("Tomato"):
        return "Tomato"
    return "Unknown plant"


class AlternativePrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    disease_name: str = Field(min_length=1, max_length=120)
    confidence: float = Field(ge=0, le=100)


class ScanHistoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original_filename: str = Field(min_length=1, max_length=255)
    disease_name: str = Field(min_length=1, max_length=120)
    confidence: float = Field(ge=0, le=100)
    top_alternatives: list[AlternativePrediction] = Field(default_factory=list, max_length=2)


@app.post("/scans", status_code=201)
async def create_scan(scan: ScanHistoryInput, response: Response):
    _require_scan_history()
    response.headers["Cache-Control"] = "no-store"
    if scan.disease_name not in CLASS_LABELS:
        raise HTTPException(status_code=422, detail="Disease class is not supported by this model.")
    if any(item.disease_name not in CLASS_LABELS for item in scan.top_alternatives):
        raise HTTPException(status_code=422, detail="An alternative disease class is not supported by this model.")
    alternative_names = [item.disease_name for item in scan.top_alternatives]
    if (
        scan.disease_name in alternative_names
        or len(set(alternative_names)) != len(alternative_names)
        or any(item.confidence > scan.confidence for item in scan.top_alternatives)
        or any(
            current.confidence < following.confidence
            for current, following in zip(
                scan.top_alternatives,
                scan.top_alternatives[1:],
            )
        )
    ):
        raise HTTPException(status_code=422, detail="Alternative predictions are inconsistent with the primary result.")

    try:
        scan_data = scan.model_dump()
        disease_info = DISEASE_INFO.get(scan.disease_name, {})
        scan_data["precautions"] = disease_info.get("precautions", [])
        scan_data["remedies"] = disease_info.get("remedies", [])
        scan_data["original_filename"] = os.path.basename(
            scan_data["original_filename"].replace("\\", "/")
        )
        if not scan_data["original_filename"]:
            raise HTTPException(status_code=422, detail="Original filename is invalid.")
        return history_store.create(scan_data)
    except HTTPException:
        raise
    except sqlite3.Error as exc:
        logger.exception("Could not save scan history record")
        raise HTTPException(status_code=500, detail="Scan history could not be saved.") from exc


@app.get("/scans")
async def list_scans(response: Response, search: str = ""):
    _require_scan_history()
    response.headers["Cache-Control"] = "no-store"
    if len(search) > 120:
        raise HTTPException(status_code=422, detail="Search text must be 120 characters or fewer.")
    try:
        return {"scans": history_store.list(search)}
    except (sqlite3.Error, ValueError) as exc:
        logger.exception("Could not load scan history")
        raise HTTPException(status_code=500, detail="Scan history could not be loaded.") from exc


@app.get("/scans/{scan_id}")
async def get_scan(scan_id: str, response: Response):
    _require_scan_history()
    response.headers["Cache-Control"] = "no-store"
    try:
        scan = history_store.get(scan_id)
    except InvalidScanId as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except sqlite3.Error as exc:
        logger.exception("Could not load scan history record")
        raise HTTPException(status_code=500, detail="Scan history could not be loaded.") from exc
    except ValueError as exc:
        logger.exception("Stored scan history record failed validation")
        raise HTTPException(status_code=500, detail="Stored scan history data is invalid.") from exc

    if scan is None:
        raise HTTPException(status_code=404, detail="Scan history record was not found.")
    return scan


@app.get("/disease-library")
async def disease_library():
    """Return educational information for the configured model classes."""
    entries = []
    for class_name in CLASS_LABELS:
        info = DISEASE_INFO.get(class_name, {})
        entries.append({
            "class_name": class_name,
            "plant": _plant_name_for_class(class_name),
            "precautions": info.get("precautions", []),
            "remedies": info.get("remedies", []),
            "symptoms": [],
            "causes": [],
        })
    return {"entries": entries}


def _find_gradcam_target_layer(model):
    preferred_names = [
        "top_activation",
        "block6h_add",
        "block6h_activation",
        "top_conv",
        "block6h_project_bn",
    ]
    layer_lookup = {layer.name: layer for layer in model.layers}
    for layer_name in preferred_names:
        if layer_name in layer_lookup:
            return layer_lookup[layer_name]

    for layer in reversed(model.layers):
        if hasattr(layer, "output") and hasattr(layer, "output_shape") and len(layer.output_shape) == 4:
            if any(keyword in getattr(layer, "name", "") for keyword in ("conv", "block", "top")):
                return layer

    return model.layers[-2] if len(model.layers) >= 2 else model.layers[-1]


def _generate_gradcam_heatmap(model, image_array, predicted_class_index):
    if model is None:
        raise ValueError("Model is not available for Grad-CAM generation.")

    target_layer = _find_gradcam_target_layer(model)
    grad_model = tf.keras.models.Model(
        inputs=model.input,
        outputs=[target_layer.output, model.output],
    )

    with tf.GradientTape() as tape:
        target_conv, outputs = grad_model(image_array)
        class_score = outputs[:, predicted_class_index]

    grads = tape.gradient(class_score, target_conv)
    if grads is None:
        raise ValueError("Gradients were not produced for the selected class; Grad-CAM is unsupported for this model.")

    pooled_grads = tf.reduce_mean(grads, axis=(1, 2), keepdims=True)
    heatmap = tf.reduce_sum(tf.cast(target_conv, tf.float32) * pooled_grads, axis=-1)
    heatmap = tf.maximum(heatmap, 0.0)
    heatmap = heatmap / (tf.reduce_max(heatmap) + 1e-8)

    heatmap_np = heatmap[0].numpy()
    return heatmap_np


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """
    Endpoint to receive an uploaded image and return a prediction.
    """
    try:
        contents = await _read_validated_image(file)
        if model is None:
            raise HTTPException(
                status_code=503,
                detail="Prediction model is not ready. Check the service readiness endpoint.",
            )
        try:
            processed_image = preprocess_image(contents)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        try:
            predictions = validate_probabilities(
                model.predict(processed_image, verbose=0),
                len(CLASS_LABELS),
            )
        except ValueError as exc:
            logger.exception("Prediction model returned invalid output.")
            raise HTTPException(
                status_code=500,
                detail="Prediction model returned an invalid result.",
            ) from exc

        top_3_indices = top_k_indices(predictions, k=3)
        primary_index = top_3_indices[0]
        disease_name = CLASS_LABELS[primary_index]
        confidence = float(predictions[primary_index]) * 100
        info = DISEASE_INFO.get(disease_name, {"precautions": [], "remedies": []})

        top_alternatives = []
        for idx in top_3_indices[1:]:
            alt_name = CLASS_LABELS[idx]
            alt_conf = float(predictions[idx]) * 100
            if alt_conf > 0.01:
                top_alternatives.append({
                    "disease_name": alt_name,
                    "confidence": round(alt_conf, 2)
                })

        response = {
            "disease_name": disease_name,
            "confidence": round(confidence, 2),
            "precautions": info.get("precautions", []),
            "remedies": info.get("remedies", []),
            "top_alternatives": top_alternatives,
            "limitations": (
                "This classifier only distinguishes its configured plant disease classes. "
                "It is not an out-of-distribution detector and may assign unsupported plants, "
                "non-leaf images, or poor-quality images to a known class."
            ),
        }
        if CONFIDENCE_THRESHOLD is not None:
            response["confidence_threshold"] = CONFIDENCE_THRESHOLD
            response["is_uncertain"] = confidence < CONFIDENCE_THRESHOLD
        return response

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Prediction failed.")
        raise HTTPException(status_code=500, detail="Prediction failed due to an internal server error.") from exc


@app.post("/explain")
async def explain(file: UploadFile = File(...)):
    try:
        contents = await _read_validated_image(file)
        if model is None:
            raise HTTPException(
                status_code=503,
                detail="Prediction model is not ready. Check the service readiness endpoint.",
            )
        try:
            processed_image = preprocess_image(contents)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            predictions = validate_probabilities(
                model.predict(processed_image, verbose=0),
                len(CLASS_LABELS),
            )
        except ValueError as exc:
            logger.exception("Prediction model returned invalid output for Grad-CAM.")
            raise HTTPException(
                status_code=500,
                detail="Prediction model returned an invalid result.",
            ) from exc
        predicted_index = int(np.argmax(predictions))

        heatmap = _generate_gradcam_heatmap(model, processed_image, predicted_index)

        original_image = Image.open(BytesIO(contents)).convert('RGB')
        original_array = np.array(original_image)
        original_bgr = cv2.cvtColor(original_array, cv2.COLOR_RGB2BGR)
        resized_heatmap = cv2.resize(heatmap, (original_array.shape[1], original_array.shape[0]), interpolation=cv2.INTER_LINEAR)
        heatmap_rgb = cv2.applyColorMap(np.uint8(255 * resized_heatmap), cv2.COLORMAP_JET)
        overlay = cv2.addWeighted(original_bgr, 0.7, heatmap_rgb, 0.3, 0)

        _, buffer = cv2.imencode('.png', overlay)
        encoded = base64.b64encode(buffer.tobytes()).decode('utf-8')

        return {
            "predicted_class": CLASS_LABELS[predicted_index],
            "confidence": round(float(predictions[predicted_index]) * 100, 2),
            "heatmap": encoded,
            "heatmap_type": "gradcam",
            "note": "Grad-CAM highlights areas the model focused on for the prediction; this is model attention, not definitive proof of disease location."
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Grad-CAM generation failed.")
        raise HTTPException(status_code=500, detail="Grad-CAM generation failed due to an internal server error.") from exc

if __name__ == "__main__":
    try:
        port = int(os.getenv("PLANT_DISEASE_PORT", "8000"))
    except ValueError as exc:
        raise RuntimeError("PLANT_DISEASE_PORT must be an integer.") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError("PLANT_DISEASE_PORT must be between 1 and 65535.")
    uvicorn.run(
        app,
        host=os.getenv("PLANT_DISEASE_HOST", "127.0.0.1"),
        port=port,
    )
