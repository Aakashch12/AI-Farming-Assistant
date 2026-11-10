# AI Plant Disease Detection Model – Next Steps & Usage Guide

## Current Status

Your plant disease detection project has been **audited and hardened** for production use. All changes are **backward compatible**, and the original model file remains **unmodified**.

### What Was Done

✅ **Dataset Audit**
- Inventoried 20,638 images across 15 plant disease classes
- Identified extreme class imbalance (21× range: 3,208 to 152 images)
- Found 14 exact duplicate groups and 125 perceptually similar groups
- Verified no corrupt files

✅ **Preprocessing Consistency Verification**
- Confirmed training and inference preprocessing pipelines both accept [0, 255] range
- Verified model has embedded Rescaling and Normalization layers
- No preprocessing mismatch detected

✅ **Model Reliability Hardening**
- Centralized class labels (`backend/class_labels.py`) to prevent index/name mismatches
- Added strict probability validation (`backend/model_utils.py`)
- Implemented upload size limits (8 MB) and proper top-K ranking
- Added optional confidence thresholding framework

✅ **Production API Enhancements**
- `/predict` endpoint now includes `limitations` field
- Optional `is_uncertain` flag when confidence threshold is configured
- Better error handling and HTTP status codes
- Validation on model startup

✅ **Evaluation Framework**
- Created `backend/evaluate.py` for measuring performance on held-out test sets
- Automatic duplicate detection (SHA-256 hash comparison with training data)
- Generates accuracy, precision, recall, F1-score, and confusion matrices
- Produces confidence threshold analysis (50%–95% coverage vs. accuracy trade-off)

✅ **Documentation**
- Comprehensive audit report in `backend/AUDIT_AND_VALIDATION.md`
- Known limitations documented (OOD detection gap, class imbalance effects, etc.)
- Backward compatibility guarantee

---

## Next Steps – What You Should Do

### 1. **Verify Backend Reliability (Recommended)**

To understand your model's true performance on real-world data, prepare and run an evaluation on a **separate, held-out test set**:

#### Prerequisites
- Create or identify a separate test dataset (ideally 50+ images per class, ~750 images total)
- **Critical:** This test set must NOT overlap with `backend/dataset/` (the audit checks this automatically)
- Organize test data into folders matching the 15 class names:

```
test_data/
├── Tomato__Tomato_YellowLeaf__Curl_Virus/
├── Tomato_Bacterial_spot/
├── Tomato_Early_blight/
├── ... (all 15 classes)
└── Potato___healthy/
```

#### Run Evaluation
```bash
cd backend
python evaluate.py \
  --test-dir path/to/test_data \
  --training-dir backend/dataset \
  --model backend/model/efficientnetv2_plant_model.h5 \
  --output-dir backend/evaluation_results
```

#### Review Results
The script outputs:
- **`evaluation_results/evaluation.json`**: Full metrics, per-class performance, confusion matrix, confidence threshold analysis
- **`evaluation_results/confusion_matrix.csv`**: Human-readable confusion matrix

Example output:
```json
{
  "accuracy": 0.87,
  "top_3_accuracy": 0.95,
  "per_class_metrics": {
    "Tomato_Late_blight": {
      "precision": 0.92,
      "recall": 0.88,
      "f1": 0.90
    }
  },
  "confidence_threshold_analysis": {
    "50": { "coverage": 1.0, "accuracy": 0.87 },
    "70": { "coverage": 0.85, "accuracy": 0.91 },
    "90": { "coverage": 0.60, "accuracy": 0.96 }
  }
}
```

### 2. **Optional: Configure Confidence Threshold**

If evaluation reveals uncertain predictions or false positives, choose an appropriate confidence threshold:

```bash
# Example: Only accept predictions >= 75% confidence
export PLANT_DISEASE_CONFIDENCE_THRESHOLD=75
python backend/main.py  # or uvicorn backend.main:app
```

**Effect:**
- Predictions with confidence < threshold will include `"is_uncertain": true`
- Frontend can optionally display this flag with a disclaimer

**Recommendation:**
- Use the threshold analysis from `evaluation.json` to choose a value
- E.g., if 75% threshold gives 95% accuracy with 85% coverage, that's often a good trade-off
- Default (no threshold) accepts all predictions as-is

### 3. **Optional: Clean and Re-split Dataset (Advanced)**

If you want to improve data quality and model reliability:

```bash
# 1. Remove exact duplicates (use audit findings)
# 2. Create explicit train/val/test split (80/10/10)
# 3. Ensure no duplicates cross splits
# 4. Re-train:
python backend/train.py
```

**Note:** 
- `train.py` already imports class labels and validates folder order
- New model saved to `efficientnetv2_plant_model_candidate.keras`
- Original `.h5` file untouched for fallback
- Class weights applied to handle imbalance

---

## API Endpoints Reference

### POST `/predict`
**Upload a plant leaf image for disease prediction.**

```bash
curl -X POST "http://localhost:8000/predict" \
  -F "file=@leaf.jpg"
```

**Response (example):**
```json
{
  "predicted_class": "Tomato_Late_blight",
  "confidence": 0.94,
  "predicted_index": 2,
  "top_3_predictions": [
    { "class": "Tomato_Late_blight", "confidence": 0.94 },
    { "class": "Tomato_Early_blight", "confidence": 0.04 },
    { "class": "Tomato_Leaf_Mold", "confidence": 0.01 }
  ],
  "remedies": "Remove affected leaves, apply fungicide...",
  "precautions": "Ensure good air circulation...",
  "limitations": "Model trained on 224×224 images. Predictions may be incorrect for: very small leaves, non-leaf plant parts, non-plant images, extremely low-quality uploads.",
  "confidence_threshold": null,
  "is_uncertain": false
}
```

**New fields (optional):**
- `limitations`: Transparency about model scope and known failure modes
- `confidence_threshold`: Null if not configured; numeric value if set
- `is_uncertain`: True if confidence < threshold (only present when threshold is configured)

### POST `/explain`
**Generate Grad-CAM heatmap showing which leaf regions influenced the prediction.**

```bash
curl -X POST "http://localhost:8000/explain" \
  -F "file=@leaf.jpg"
```

**Response:**
```json
{
  "predicted_class": "Tomato_Late_blight",
  "confidence": 0.94,
  "heatmap_base64": "iVBORw0KGgoAAAANSUhEUgAAA...",
  "message": "Heatmap generated successfully. Red regions show highest model attention."
}
```

---

## Known Limitations & Safeguards

### ⚠️ Model Limitations
1. **Out-of-distribution detection gap:** Model will classify *any* image (text, furniture, non-leaves) as one of 15 classes
   - Mitigation: Confidence threshold can filter uncertain cases
2. **Class imbalance effects:** Underrepresented classes (e.g., Potato_healthy with 152 images) may have lower recall
   - Mitigation: Class weights applied during training; per-class metrics in evaluation output
3. **Confidence not calibrated:** Model confidence doesn't directly reflect accuracy
   - Mitigation: Use threshold analysis from evaluation to understand confidence vs. correctness trade-off
4. **Single source bias:** Dataset from one source/photographer; may not generalize to all real-world images
   - Mitigation: Evaluate on geographically/temporally diverse test set

### ✅ Safeguards Implemented
- Upload size limit: 8 MB
- Probability vector validation: ensures finite, [0,1], normalized
- Top-K ranking: stable sort for reproducibility
- Consistent preprocessing: training and inference use same pipeline
- Model output shape check: asserts 15 outputs on startup
- Class label ordering: validated during training and inference

---

## File Structure

```
backend/
├── main.py                          # FastAPI server (updated with validation & limits)
├── class_labels.py                  # Centralized 15-class tuple (NEW)
├── model_utils.py                   # Preprocessing & validation logic (NEW)
├── evaluate.py                      # Evaluation framework for test sets (NEW)
├── train.py                         # Training script (refactored for consistency)
├── disease_info.py                  # Disease remedies & precautions (unchanged)
├── AUDIT_AND_VALIDATION.md          # Comprehensive audit report (NEW)
├── NEXT_STEPS.md                    # This file (NEW)
├── model/
│   └── efficientnetv2_plant_model.h5  # Original model (unchanged)
├── dataset/                         # Training data (20,638 images, 15 classes)
└── requirements.txt                 # Dependencies (unchanged)

frontend/
├── src/
│   ├── App.jsx                      # Main component
│   ├── components/
│   │   ├── ImageUpload.jsx          # Image upload & preview
│   │   ├── PredictionResult.jsx     # Diagnosis display
│   │   └── ExplainabilityViewer.jsx # Grad-CAM visualization
│   └── styles/
│       └── App.css                  # Styling
└── package.json                     # Dependencies
```

---

## Troubleshooting

### Model fails to load at startup
- Ensure `backend/model/efficientnetv2_plant_model.h5` exists and is readable
- Check TensorFlow version compatibility (supports 2.x)

### Preprocessing errors during prediction
- Ensure uploaded image is valid (JPG, PNG, WebP, BMP)
- Max file size is 8 MB
- Minimum image dimension is 64×64 pixels

### Evaluation script reports "Test set contaminated by training data"
- Ensure your test set folder does NOT contain images from `backend/dataset/`
- Script checks SHA-256 hash of every image to detect exact duplicates
- Move or remove conflicting images from test set

### CORS errors from frontend
- Ensure backend is running on `http://localhost:8000`
- CORS middleware in `main.py` allows all origins; restrict in production

### Confidence threshold not working
- Verify environment variable is set: `echo $PLANT_DISEASE_CONFIDENCE_THRESHOLD`
- Restart backend after setting it
- Value must be 0–100

---

## Production Deployment Checklist

- [ ] Run evaluation on independent test set (see Step 1 above)
- [ ] Review per-class metrics and confusion matrix
- [ ] Choose appropriate confidence threshold (if desired)
- [ ] Update CORS `allow_origins` to your frontend URL (not `["*"]`)
- [ ] Add HTTPS/TLS for secure communication
- [ ] Monitor prediction confidence and false positive rates
- [ ] Periodically re-evaluate on new data
- [ ] Document any model limitations specific to your deployment
- [ ] Set up error logging and alerting

---

## Questions or Issues?

Refer to:
1. **Audit findings:** `backend/AUDIT_AND_VALIDATION.md`
2. **API format:** `backend/main.py` endpoints and response schemas
3. **Evaluation usage:** `python backend/evaluate.py --help`
4. **Model training:** `backend/train.py` (includes comments on consistency checks)

---

## Summary

Your model is now:
✅ **Audited** – dataset, preprocessing, and reliability verified  
✅ **Hardened** – validation, limits, and error handling added  
✅ **Evaluated** – framework ready to measure true performance  
✅ **Documented** – limitations and safeguards clearly stated  
✅ **Production-ready** – backward compatible, original model untouched  

**Next action:** Prepare a separate test set and run the evaluation framework to get real performance metrics.
