from io import BytesIO

import numpy as np
import tensorflow as tf
from PIL import Image, UnidentifiedImageError


IMAGE_SIZE = (224, 224)
MIN_IMAGE_SIDE = 64


def preprocess_image(image_bytes):
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            if min(source.size) < MIN_IMAGE_SIDE:
                raise ValueError(
                    f"Image dimensions must be at least {MIN_IMAGE_SIDE} x {MIN_IMAGE_SIDE} pixels."
                )
            image = source.convert("RGB").resize(
                IMAGE_SIZE,
                Image.Resampling.NEAREST,
            )
            image_array = tf.keras.preprocessing.image.img_to_array(image)

        image_batch = np.expand_dims(image_array, axis=0)
        return tf.keras.applications.efficientnet_v2.preprocess_input(image_batch)
    except UnidentifiedImageError as exc:
        raise ValueError("Invalid image file. Could not read image data.") from exc
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Image processing failed: {exc}") from exc


def validate_probabilities(predictions, expected_class_count):
    values = np.asarray(predictions)
    if values.ndim == 2 and values.shape[0] == 1:
        values = values[0]
    if values.ndim != 1 or values.size != expected_class_count:
        raise ValueError(
            f"Model returned {values.size} class scores; expected {expected_class_count}."
        )
    if not np.all(np.isfinite(values)):
        raise ValueError("Model returned non-finite prediction scores.")
    if np.any(values < 0.0) or np.any(values > 1.0):
        raise ValueError("Model output is not a valid probability vector.")

    total = float(np.sum(values))
    if total <= 0.0:
        raise ValueError("Model returned an empty probability distribution.")
    return values.astype(np.float64) / total


def top_k_indices(probabilities, k=3):
    probabilities = np.asarray(probabilities)
    if probabilities.ndim != 1 or not np.all(np.isfinite(probabilities)):
        raise ValueError("Top-k ranking requires a finite one-dimensional score vector.")
    return np.argsort(-probabilities, kind="stable")[:min(k, probabilities.size)]
