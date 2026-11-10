from io import BytesIO

import numpy as np
import httpx
import pytest
from PIL import Image

import main


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as test_client:
        yield test_client


def image_upload():
    buffer = BytesIO()
    Image.new("RGB", (64, 64), color=(45, 120, 70)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.anyio
async def test_health_endpoint_is_live(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_readiness_reports_missing_model(client, monkeypatch):
    monkeypatch.setattr(main, "model", None)

    response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json()["detail"] == "Prediction model is not ready."


@pytest.mark.anyio
async def test_readiness_reports_loaded_model(client, monkeypatch):
    monkeypatch.setattr(main, "model", object())

    response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "model_loaded": True}


@pytest.mark.anyio
async def test_predict_accepts_supported_image_and_returns_compatible_response(client, monkeypatch):
    class StubModel:
        @staticmethod
        def predict(_image, verbose=0):
            probabilities = np.zeros(len(main.CLASS_LABELS), dtype=np.float32)
            probabilities[0] = 0.8
            probabilities[1] = 0.15
            probabilities[2] = 0.05
            return np.expand_dims(probabilities, axis=0)

    monkeypatch.setattr(main, "model", StubModel())
    monkeypatch.setattr(main, "preprocess_image", lambda _contents: np.zeros((1, 224, 224, 3)))

    response = await client.post(
        "/predict",
        files={"file": ("leaf.png", image_upload(), "image/png")},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["disease_name"] == main.CLASS_LABELS[0]
    assert result["confidence"] == 80.0
    assert result["top_alternatives"] == [
        {"disease_name": main.CLASS_LABELS[1], "confidence": 15.0},
        {"disease_name": main.CLASS_LABELS[2], "confidence": 5.0},
    ]
    assert isinstance(result["precautions"], list)
    assert isinstance(result["remedies"], list)


@pytest.mark.anyio
async def test_predict_rejects_unsupported_media_type(client):
    response = await client.post(
        "/predict",
        files={"file": ("leaf.gif", b"not an image", "image/gif")},
    )

    assert response.status_code == 415


@pytest.mark.anyio
async def test_predict_rejects_invalid_image_bytes(client):
    response = await client.post(
        "/predict",
        files={"file": ("leaf.png", b"not a valid image", "image/png")},
    )

    assert response.status_code == 400


@pytest.mark.anyio
async def test_predict_rejects_oversized_image(client):
    response = await client.post(
        "/predict",
        files={"file": ("leaf.png", b"x" * (main.MAX_UPLOAD_BYTES + 1), "image/png")},
    )

    assert response.status_code == 413


@pytest.mark.anyio
async def test_predict_rejects_oversized_http_body_before_upload_parsing(client):
    response = await client.post(
        "/predict",
        files={
            "file": (
                "leaf.png",
                b"x" * (main.MAX_REQUEST_BODY_BYTES + 1),
                "image/png",
            )
        },
    )

    assert response.status_code == 413


@pytest.mark.anyio
async def test_scan_history_can_be_disabled(client, monkeypatch):
    monkeypatch.setattr(main, "SCAN_HISTORY_ENABLED", False)

    response = await client.get("/scans")

    assert response.status_code == 404
