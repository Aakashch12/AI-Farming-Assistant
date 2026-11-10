import json
import os

import numpy as np
import tensorflow as tf
from tensorflow import keras

from class_labels import CLASS_LABELS


ImageDataGenerator = keras.preprocessing.image.ImageDataGenerator
EfficientNetV2B0 = keras.applications.EfficientNetV2B0
Model = keras.models.Model
GlobalAveragePooling2D = keras.layers.GlobalAveragePooling2D
Dense = keras.layers.Dense
Dropout = keras.layers.Dropout
ModelCheckpoint = keras.callbacks.ModelCheckpoint
EarlyStopping = keras.callbacks.EarlyStopping
ReduceLROnPlateau = keras.callbacks.ReduceLROnPlateau

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(BACKEND_DIR, "dataset")
MODEL_SAVE_DIR = os.path.join(BACKEND_DIR, "model")
MODEL_SAVE_PATH = os.path.join(
    MODEL_SAVE_DIR,
    "efficientnetv2_plant_model_candidate.keras",
)
CLASS_METADATA_PATH = os.path.join(
    MODEL_SAVE_DIR,
    "efficientnetv2_plant_model_candidate.classes.json",
)
IMG_HEIGHT = 224
IMG_WIDTH = 224
BATCH_SIZE = 32
EPOCHS = 40
SEED = 42


def custom_augmentation(image):
    image = tf.convert_to_tensor(image, dtype=tf.float32)
    image = tf.image.random_contrast(image, lower=0.8, upper=1.2)
    noise = tf.random.normal(
        shape=tf.shape(image),
        mean=0.0,
        stddev=5.0,
        dtype=tf.float32,
    )
    image = tf.add(image, noise)
    image = tf.clip_by_value(image, 0.0, 255.0)
    return image.numpy()


def main():
    os.makedirs(MODEL_SAVE_DIR, exist_ok=True)
    tf.keras.utils.set_random_seed(SEED)

    train_datagen = ImageDataGenerator(
        rotation_range=40,
        width_shift_range=0.2,
        height_shift_range=0.2,
        shear_range=0.2,
        zoom_range=0.2,
        brightness_range=[0.8, 1.2],
        horizontal_flip=True,
        vertical_flip=True,
        fill_mode="nearest",
        preprocessing_function=custom_augmentation,
        validation_split=0.2,
    )
    val_datagen = ImageDataGenerator(validation_split=0.2)

    print("Loading training data...")
    train_data = train_datagen.flow_from_directory(
        DATASET_PATH,
        target_size=(IMG_HEIGHT, IMG_WIDTH),
        batch_size=BATCH_SIZE,
        class_mode="categorical",
        subset="training",
        seed=SEED,
        interpolation="nearest",
    )
    print("Loading validation data...")
    val_data = val_datagen.flow_from_directory(
        DATASET_PATH,
        target_size=(IMG_HEIGHT, IMG_WIDTH),
        batch_size=BATCH_SIZE,
        class_mode="categorical",
        subset="validation",
        shuffle=False,
        seed=SEED,
        interpolation="nearest",
    )

    num_classes = train_data.num_classes
    class_names = list(train_data.class_indices.keys())
    print(f"Found {num_classes} classes: {class_names}")
    if tuple(class_names) != CLASS_LABELS:
        raise ValueError(
            "Dataset folder order does not match the class mapping used by inference. "
            f"Expected {list(CLASS_LABELS)}, got {class_names}."
        )

    class_counts = np.bincount(train_data.classes, minlength=num_classes)
    if np.any(class_counts == 0):
        raise ValueError("Every model class must have at least one training image.")
    class_weights = len(train_data.classes) / (num_classes * class_counts)
    class_weights_dict = {
        index: float(weight) for index, weight in enumerate(class_weights)
    }
    print("Computed class weights:", class_weights_dict)
    print(
        "Note: this legacy directory layout only provides an 80/20 train/validation "
        "split. It does not provide an independent test set or prevent duplicate "
        "images from crossing the split."
    )

    base_model = EfficientNetV2B0(
        weights="imagenet",
        include_top=False,
        input_shape=(IMG_HEIGHT, IMG_WIDTH, 3),
    )
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    x = Dropout(0.5)(x)
    predictions = Dense(num_classes, activation="softmax")(x)
    model = Model(inputs=base_model.input, outputs=predictions)

    checkpoint = ModelCheckpoint(
        MODEL_SAVE_PATH,
        monitor="val_accuracy",
        save_best_only=True,
        mode="max",
        verbose=1,
    )
    early_stopping = EarlyStopping(
        monitor="val_loss",
        patience=8,
        restore_best_weights=True,
        verbose=1,
    )
    reduce_lr = ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.2,
        patience=3,
        min_lr=1e-6,
        verbose=1,
    )

    warmup_epochs = 3
    base_model.trainable = False
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="categorical_crossentropy",
        metrics=[
            "accuracy",
            tf.keras.metrics.TopKCategoricalAccuracy(k=3, name="top_3_accuracy"),
        ],
    )
    model.summary()
    model.fit(
        train_data,
        epochs=warmup_epochs,
        validation_data=val_data,
        class_weight=class_weights_dict,
    )

    base_model.trainable = True
    for layer in base_model.layers[:-20]:
        layer.trainable = False
    for layer in base_model.layers[-20:]:
        if isinstance(layer, keras.layers.BatchNormalization):
            layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
        loss="categorical_crossentropy",
        metrics=[
            "accuracy",
            tf.keras.metrics.TopKCategoricalAccuracy(k=3, name="top_3_accuracy"),
        ],
    )
    history = model.fit(
        train_data,
        epochs=max(1, EPOCHS - warmup_epochs),
        validation_data=val_data,
        class_weight=class_weights_dict,
        callbacks=[checkpoint, early_stopping, reduce_lr],
    )

    metadata = {
        "class_labels": class_names,
        "input_size": [IMG_HEIGHT, IMG_WIDTH],
        "resize_interpolation": "nearest",
        "input_range": [0, 255],
        "model_artifact": os.path.basename(MODEL_SAVE_PATH),
    }
    with open(CLASS_METADATA_PATH, "w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, indent=2)

    final_epoch = len(history.history["accuracy"]) - 1
    print(f"\nCandidate model saved at '{MODEL_SAVE_PATH}'.")
    print(f"Class/preprocessing metadata saved at '{CLASS_METADATA_PATH}'.")
    print("The production model file was not modified.")
    print(
        "Final training accuracy: "
        f"{history.history['accuracy'][final_epoch] * 100:.2f}%"
    )
    print(
        "Final validation accuracy: "
        f"{history.history['val_accuracy'][final_epoch] * 100:.2f}%"
    )
    print(
        "Final validation top-3 accuracy: "
        f"{history.history['val_top_3_accuracy'][final_epoch] * 100:.2f}%"
    )
    print("These are training/validation metrics, not independent test metrics.")


if __name__ == "__main__":
    main()
