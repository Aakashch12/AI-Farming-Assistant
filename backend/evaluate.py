import argparse
import csv
import hashlib
import json
import os
from collections import Counter

import numpy as np
import tensorflow as tf
from PIL import Image

from class_labels import CLASS_LABELS
from model_utils import preprocess_image, validate_probabilities


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
BATCH_SIZE = 32
CONFIDENCE_THRESHOLDS = (50, 60, 70, 80, 90, 95)


def collect_images(root):
    if not os.path.isdir(root):
        raise ValueError(f"Dataset directory does not exist: {root}")

    actual_classes = {
        name for name in os.listdir(root)
        if os.path.isdir(os.path.join(root, name))
    }
    expected_classes = set(CLASS_LABELS)
    if actual_classes != expected_classes:
        missing = sorted(expected_classes - actual_classes)
        unexpected = sorted(actual_classes - expected_classes)
        raise ValueError(
            f"Test class folders do not match the model labels. "
            f"Missing: {missing}; unexpected: {unexpected}."
        )

    samples = []
    for class_index, class_name in enumerate(CLASS_LABELS):
        class_dir = os.path.join(root, class_name)
        class_count = 0
        for current_dir, _, filenames in os.walk(class_dir):
            for filename in sorted(filenames):
                extension = os.path.splitext(filename)[1].lower()
                if extension not in IMAGE_EXTENSIONS:
                    continue
                path = os.path.join(current_dir, filename)
                samples.append((path, class_index))
                class_count += 1
        if class_count == 0:
            raise ValueError(f"Test class has no supported images: {class_name}")

    return samples


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as image_file:
        for chunk in iter(lambda: image_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def assert_no_exact_overlap(test_samples, training_dir):
    if not training_dir:
        return
    if not os.path.isdir(training_dir):
        raise ValueError(f"Training directory does not exist: {training_dir}")

    training_hashes = set()
    for current_dir, _, filenames in os.walk(training_dir):
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() in IMAGE_EXTENSIONS:
                training_hashes.add(sha256(os.path.join(current_dir, filename)))

    overlap = [
        path for path, _ in test_samples
        if sha256(path) in training_hashes
    ]
    if overlap:
        examples = ", ".join(overlap[:5])
        raise ValueError(
            f"Test data contains {len(overlap)} image(s) also present in the training directory. "
            f"Evaluation would be contaminated. Examples: {examples}"
        )


def calculate_metrics(targets, probabilities):
    targets = np.asarray(targets, dtype=np.int64)
    probabilities = np.asarray(probabilities, dtype=np.float64)
    predictions = np.argmax(probabilities, axis=1)
    class_count = len(CLASS_LABELS)
    confusion = np.zeros((class_count, class_count), dtype=np.int64)
    np.add.at(confusion, (targets, predictions), 1)

    per_class = []
    for index, name in enumerate(CLASS_LABELS):
        true_positive = int(confusion[index, index])
        support = int(confusion[index].sum())
        predicted_count = int(confusion[:, index].sum())
        precision = true_positive / predicted_count if predicted_count else 0.0
        recall = true_positive / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class.append({
            "class": name,
            "support": support,
            "precision": precision,
            "recall": recall,
            "f1_score": f1,
        })

    top_k = min(3, class_count)
    top_k_predictions = np.argsort(-probabilities, axis=1, kind="stable")[:, :top_k]
    top_k_accuracy = float(np.mean(np.any(top_k_predictions == targets[:, None], axis=1)))
    confidence = np.max(probabilities, axis=1)
    correct = predictions == targets
    threshold_analysis = []
    for threshold in CONFIDENCE_THRESHOLDS:
        accepted = confidence * 100 >= threshold
        accepted_count = int(accepted.sum())
        threshold_analysis.append({
            "threshold_percent": threshold,
            "coverage": accepted_count / len(targets),
            "accepted_count": accepted_count,
            "abstained_count": int(len(targets) - accepted_count),
            "accuracy_when_accepted": (
                float(np.mean(correct[accepted])) if accepted_count else None
            ),
        })

    total_support = len(targets)
    return {
        "sample_count": total_support,
        "accuracy": float(np.mean(correct)),
        "top_3_accuracy": top_k_accuracy,
        "macro_precision": float(np.mean([item["precision"] for item in per_class])),
        "macro_recall": float(np.mean([item["recall"] for item in per_class])),
        "macro_f1_score": float(np.mean([item["f1_score"] for item in per_class])),
        "weighted_precision": float(sum(item["precision"] * item["support"] for item in per_class) / total_support),
        "weighted_recall": float(sum(item["recall"] * item["support"] for item in per_class) / total_support),
        "weighted_f1_score": float(sum(item["f1_score"] * item["support"] for item in per_class) / total_support),
        "per_class": per_class,
        "confusion_matrix": confusion.tolist(),
        "confidence_threshold_analysis": threshold_analysis,
        "threshold_note": (
            "Threshold results are descriptive only. Choose a production threshold on a separate "
            "calibration set, then report it once on an untouched test set."
        ),
    }


def evaluate(model, samples):
    all_probabilities = []
    targets = []
    batch_images = []
    batch_targets = []

    def predict_batch():
        batch_predictions = model.predict(np.concatenate(batch_images), verbose=0)
        for prediction in batch_predictions:
            all_probabilities.append(
                validate_probabilities(prediction, len(CLASS_LABELS))
            )
        targets.extend(batch_targets)
        batch_images.clear()
        batch_targets.clear()

    for path, class_index in samples:
        try:
            with open(path, "rb") as image_file:
                batch_images.append(preprocess_image(image_file.read()))
        except (OSError, ValueError) as exc:
            raise ValueError(f"Could not preprocess test image {path}: {exc}") from exc
        batch_targets.append(class_index)
        if len(batch_images) == BATCH_SIZE:
            predict_batch()

    if batch_images:
        predict_batch()

    return calculate_metrics(targets, all_probabilities)


def save_results(results, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, "evaluation.json")
    matrix_path = os.path.join(output_dir, "confusion_matrix.csv")
    with open(json_path, "w", encoding="utf-8") as results_file:
        json.dump(results, results_file, indent=2)

    with open(matrix_path, "w", newline="", encoding="utf-8") as matrix_file:
        writer = csv.writer(matrix_file)
        writer.writerow(["true_label / predicted_label", *CLASS_LABELS])
        for label, row in zip(CLASS_LABELS, results["confusion_matrix"]):
            writer.writerow([label, *row])
    return json_path, matrix_path


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate the configured classifier on a separate labeled test set."
    )
    parser.add_argument("--test-dir", required=True, help="Root containing one folder per model class.")
    parser.add_argument(
        "--training-dir",
        help="Optional training data root; exact file-hash overlap with the test set is rejected.",
    )
    parser.add_argument(
        "--model",
        default=os.path.join(os.path.dirname(__file__), "model", "efficientnetv2_plant_model.h5"),
        help="Model file to evaluate.",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(__file__), "evaluation_results"),
        help="Directory for evaluation.json and confusion_matrix.csv.",
    )
    args = parser.parse_args()

    samples = collect_images(args.test_dir)
    assert_no_exact_overlap(samples, args.training_dir)
    model = tf.keras.models.load_model(args.model, compile=False)
    if model.output_shape[-1] != len(CLASS_LABELS):
        raise ValueError(
            f"Model output count {model.output_shape[-1]} does not match {len(CLASS_LABELS)} labels."
        )

    results = evaluate(model, samples)
    results["model_path"] = os.path.abspath(args.model)
    results["test_dir"] = os.path.abspath(args.test_dir)
    results["training_overlap_checked"] = bool(args.training_dir)
    results["training_dir"] = os.path.abspath(args.training_dir) if args.training_dir else None
    results["class_counts"] = dict(Counter(CLASS_LABELS[target] for _, target in samples))
    json_path, matrix_path = save_results(results, args.output_dir)
    print(json.dumps({
        key: results[key]
        for key in (
            "sample_count",
            "accuracy",
            "top_3_accuracy",
            "macro_precision",
            "macro_recall",
            "macro_f1_score",
            "weighted_f1_score",
        )
    }, indent=2))
    print(f"Saved metrics: {json_path}")
    print(f"Saved confusion matrix: {matrix_path}")


if __name__ == "__main__":
    main()
