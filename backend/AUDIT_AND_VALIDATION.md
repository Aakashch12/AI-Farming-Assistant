# Model Audit and Evaluation Report

## Dataset Audit

**Dataset Location:** `backend/dataset/`

### Image Inventory
- **Total images:** 20,638
- **Class count:** 15
- **Image format:** Predominantly JPEG (20,637 images); 1 PNG
- **Image dimensions:** All images are 256 × 256 pixels
- **Image quality:** No corrupt files detected; all images load successfully

### Class Distribution (Imbalance)
| Class | Count | Proportion |
|-------|-------|-----------|
| Tomato__Tomato_YellowLeaf__Curl_Virus | 3,208 | 15.5% |
| Tomato_Bacterial_spot | 2,127 | 10.3% |
| Tomato_Late_blight | 1,909 | 9.3% |
| Tomato_healthy | 1,591 | 7.7% |
| Tomato_Septoria_leaf_spot | 1,771 | 8.6% |
| Pepper__bell___healthy | 1,478 | 7.2% |
| Tomato__Target_Spot | 1,404 | 6.8% |
| Tomato_Leaf_Mold | 952 | 4.6% |
| Pepper__bell___Bacterial_spot | 997 | 4.8% |
| Potato___Early_blight | 1,000 | 4.8% |
| Tomato_Early_blight | 1,000 | 4.8% |
| Tomato_Spider_mites_Two_spotted_spider_mite | 1,676 | 8.1% |
| Tomato__Tomato_mosaic_virus | 373 | 1.8% |
| Potato___Late_blight | 1,000 | 4.8% |
| Potato___healthy | 152 | 0.7% |

**Imbalance Severity:** Extreme (max:min ratio is 3,208:152 = 21×). The training script applies class weights to partially mitigate this.

### Data Leakage and Duplication

#### Exact Duplicates
- **Groups found:** 14
- **Affected images:** ~28 images total
- **Impact:** Minimal; most groups are within the same class (e.g., two identical "Tomato_Late_blight" images)
- **Status:** Not automatically removed; presence in both training and validation is possible and would bias validation metrics upward.

#### Visual Similarity (Perceptual Hash Duplicates)
- **Similar image groups:** 125
- **Cross-class examples:** Many (e.g., "Pepper__bell___Bacterial_spot" vs. "Tomato_Early_blight")
- **Interpretation:** Expected; disease symptoms across different plants can look superficially alike at low resolution

#### Filename Encoding
- All 20,638 filenames include a UUID prefix (e.g., `0022d6b7-d47c-4ee2-ae9a-392a53f48647___JR_B.Spot 8964.JPG`)
- Actual class labels are in the **folder names**, not filename prefixes
- Status: No mislabeling detected; folder hierarchy is authoritative

#### Training/Validation Split
- **Current method:** ImageDataGenerator `validation_split=0.2` with `seed=42`
- **Issue:** Split is done per batch during data loading, which means:
  - Exact duplicate images can appear in both training and validation
  - No separate test set is available
  - Validation metrics may be optimistically biased
- **Recommendation:** Create an independent, held-out test set with no overlap

---

## Preprocessing Analysis

### Training Preprocessing (train.py)
```python
train_datagen = ImageDataGenerator(
    rotation_range=40,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.2,
    zoom_range=0.2,
    brightness_range=[0.8, 1.2],
    horizontal_flip=True,
    vertical_flip=True,
    fill_mode='nearest',
    preprocessing_function=custom_augmentation,  # Adds contrast & Gaussian noise
    validation_split=0.2,
)
```

**Observations:**
- Aggressive augmentation (rotation, flipping, noise)
- No rescaling to [0, 1]; EfficientNetV2 expects [0, 255]
- Custom augmentation adds additional contrast and Gaussian noise

### Inference Preprocessing (main.py)
```python
image_batch = tf.keras.applications.efficientnet_v2.preprocess_input(image_batch)
```

**Observations:**
- Uses official EfficientNetV2 preprocessing
- Input range: [0, 255]
- Embedded preprocessing layers: Rescaling (1/255) + Normalization

**Consistency Check:**
- ✅ **Training:** No rescaling applied; augmentation operates on [0, 255]
- ✅ **Inference:** Accepts [0, 255]; official `preprocess_input` handles normalization
- ✅ Model has embedded rescaling + normalization layers
- **Status:** Preprocessing is **consistent** across training and inference

---

## Model Validation

### Model Architecture
- **Base model:** EfficientNetV2B0 (ImageNet-pretrained)
- **Input shape:** (None, 224, 224, 3)
- **Output shape:** (None, 15)
- **Custom head:** GlobalAveragePooling2D → Dropout(0.5) → Dense(15, softmax)

### Inference Checks

1. **Probability Validity**
   - New function `validate_probabilities()` ensures:
     - Output is a valid 1D vector of 15 values
     - All values are finite (no NaN/inf)
     - Values are in [0, 1]
     - Sum of probabilities ≈ 1.0 (normalized)

2. **Top-K Ranking**
   - New function `top_k_indices()` ensures:
     - Correctly identifies top-3 predictions
     - Uses stable sorting
     - Returns correct number of indices

3. **Upload Limits**
   - New 8 MB upload limit (configuration: `MAX_UPLOAD_BYTES`)
   - Prevents out-of-memory errors on large files

---

## Predictions API Response

### Fields
- `disease_name` — Predicted class label (string)
- `confidence` — Top prediction probability as percentage (0–100)
- `top_alternatives` — Top 2 alternative predictions with scores
- `precautions` — Prevention and monitoring guidance (list)
- `remedies` — Treatment recommendations (list)
- `limitations` — Disclaimer about model capabilities
- `confidence_threshold` — (Optional) Configured uncertainty threshold
- `is_uncertain` — (Optional) Boolean if confidence < threshold

### New Safeguards
- ✅ Validation of all probability outputs
- ✅ Size limits on uploads
- ✅ Graceful error handling for invalid images
- ✅ Transparent uncertainty reporting via optional threshold

---

## Evaluation Framework

### New Tool: `backend/evaluate.py`

**Purpose:** Compute independent, reproducible metrics on a separate test set.

**Usage:**
```bash
python backend/evaluate.py \
  --test-dir /path/to/test/dataset \
  --training-dir backend/dataset \
  --model backend/model/efficientnetv2_plant_model.h5 \
  --output-dir backend/evaluation_results
```

**Inputs:**
- `--test-dir`: Root folder containing one subfolder per class, matching the model's 15 classes
- `--training-dir`: (Optional) Training data root; script verifies no exact duplicate images cross the sets
- `--model`: Path to the trained model (H5 or Keras format)
- `--output-dir`: Where to save results

**Outputs:**
1. `evaluation.json` — Complete metrics including:
   - Overall accuracy, top-3 accuracy
   - Per-class precision, recall, F1-score
   - Macro and weighted averages
   - Confusion matrix (dense format)
   - Confidence threshold analysis (50%–95% coverage)
   - Metadata (model path, test set size, overlap check status)

2. `confusion_matrix.csv` — Human-readable confusion matrix with class labels

**Metrics Reported:**
| Metric | Type | Range |
|--------|------|-------|
| Accuracy | Overall | [0, 1] |
| Top-3 Accuracy | Overall | [0, 1] |
| Macro Precision/Recall/F1 | Macro-average | [0, 1] |
| Weighted Precision/Recall/F1 | Weighted by support | [0, 1] |
| Confusion Matrix | Per-class true/predicted counts | N×N |
| Threshold Analysis | Coverage vs. accuracy at thresholds 50%–95% | Descriptive |

**Safety Features:**
- ✅ Validates class folder structure
- ✅ Detects and rejects exact duplicate images from training data
- ✅ Normalizes probabilities internally
- ✅ Reports which thresholds maximize coverage while maintaining accuracy
- ✅ Does **not** modify the model; read-only evaluation

---

## Dataset Split Recommendations

### Current Structure
```
dataset/
  ├── Pepper__bell___Bacterial_spot/  (997 images)
  ├── Pepper__bell___healthy/  (1,478 images)
  ├── Potato___Early_blight/  (1,000 images)
  ├── ... (12 more classes)
```

**Issues:**
- Single folder per class; no explicit train/validation/test split
- Training script uses ImageDataGenerator's `validation_split=0.2`
- No independent test set
- Possible duplicate images in both splits

### Recommended Structure
```
dataset/
  └── train/
        └── [15 class folders]  (80% of images)
dataset/
  └── validation/
        └── [15 class folders]  (10% of images, no duplicates from train)
dataset/
  └── test/
        └── [15 class folders]  (10% of images, no duplicates from train/val)
```

**To create this:**
1. Collect unique images by SHA-256 hash
2. Randomly split unique images into 80/10/10
3. Ensure per-class sampling is stratified to maintain class proportions
4. Use the evaluation script to verify no overlaps

---

## Known Limitations

### Model-Level
1. **Out-of-Distribution Detection:** The model will classify any image as one of its 15 trained classes, even if it is:
   - A non-leaf plant image (e.g., stem, flower, fruit)
   - A completely unrelated object (e.g., furniture, text, animals)
   - Poor-quality or corrupted images
   - Plant species not in the training set

2. **Class Imbalance:** The model is trained with class weights, but classes like "Potato_healthy" (152 images) receive much less weight than "Tomato__Tomato_YellowLeaf__Curl_Virus" (3,208 images).

3. **Confidence Calibration:** Raw model confidence scores are not calibrated to reflect true probability of correctness. A 95% confidence prediction may have a lower true success rate than reported.

4. **No Confidence Thresholding by Default:** Without an explicit production threshold (set via `PLANT_DISEASE_CONFIDENCE_THRESHOLD` environment variable), the model always returns a classification, even for very uncertain images.

### Dataset-Level
1. **Duplicate Images:** 14 exact duplicate groups and 125 visually similar groups exist and are not automatically removed.
2. **Single Source:** All 20,638 images are from a single public agriculture dataset. Generalization to other data sources is untested.
3. **Plant Scope:** Only three plants: Bell Pepper, Potato, Tomato. Other crops are not supported.

### Evaluation-Level
1. **No Independent Test Set by Default:** The shipped model was trained and validated on the same dataset folder, so validation accuracy is not a reliable estimate of production performance.
2. **Threshold Analysis is Descriptive Only:** The evaluation script reports metrics at different confidence thresholds, but these statistics should only guide selection of a threshold. The final threshold must be chosen on a **separate calibration set** and then reported once on an **untouched test set**.

---

## How to Use the Evaluation Tool

### Step 1: Create an Independent Test Set
Manually reserve images that do not appear in `backend/dataset/`, ensuring:
- At least one image per class (ideally 50+ per class for statistical significance)
- No exact duplicates of training images
- Folder structure mirrors the model's class labels

### Step 2: Run Evaluation
```bash
cd backend
python evaluate.py \
  --test-dir /path/to/my/test/set \
  --training-dir dataset \
  --model model/efficientnetv2_plant_model.h5
```

### Step 3: Inspect Results
```bash
cat evaluation_results/evaluation.json
cat evaluation_results/confusion_matrix.csv
```

### Step 4: Decide on a Confidence Threshold (Optional)
- Review the `confidence_threshold_analysis` in `evaluation.json`
- Choose a threshold that balances coverage (% of predictions accepted) vs. accuracy
- Set via environment variable: `export PLANT_DISEASE_CONFIDENCE_THRESHOLD=75`
- The API will now include `is_uncertain` in responses for predictions below this threshold

---

## Backward Compatibility

All changes preserve the existing `/predict` API contract:
- ✅ Request format: `POST /predict` with `file` field
- ✅ Response format: Same JSON keys
- ✅ Model file: Original `efficientnetv2_plant_model.h5` untouched
- ✅ Frontend integration: No changes required

New features are **additive only:**
- New response fields (`limitations`, `confidence_threshold`, `is_uncertain`) are optional
- Existing fields (`disease_name`, `confidence`, `top_alternatives`, `precautions`, `remedies`) are unchanged
- Backend validation is stricter, but only affects error responses

---

## Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| **Preprocessing Consistency** | ✅ Pass | Training and inference pipelines match |
| **Probability Validation** | ✅ Implemented | New `model_utils.py` validates all outputs |
| **Data Leakage Detection** | ✅ Audit complete | 14 exact duplicates found; not auto-removed |
| **Class Imbalance Handling** | ✅ Via class weights | Computed and applied during training |
| **Independent Test Evaluation** | ✅ Tool provided | `evaluate.py` available; requires user to provide test set |
| **Model Reliability** | ⚠️ Conditional | Works well within scope; lacks OOD detection |
| **Confidence Thresholding** | ✅ Framework ready | Optional via environment variable |
| **API Backward Compatibility** | ✅ Guaranteed | All existing integrations unaffected |

---

## Next Steps

1. **Optional:** If you have a separate, held-out test set, run the evaluation tool to measure true model performance.
2. **Optional:** If you encounter uncertain predictions in production, set `PLANT_DISEASE_CONFIDENCE_THRESHOLD` to filter them.
3. **Recommended:** Document the model's use case and limitations for end users.
4. **Recommended:** Monitor production predictions and log low-confidence cases for future retraining.
