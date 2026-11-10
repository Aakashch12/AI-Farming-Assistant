import './PredictionResult.css';
import { getGuidanceText, translate, translateApiError, translatePlantName } from '../i18n';

const cropNames = [
  { prefix: 'Pepper__bell___', name: 'Bell pepper' },
  { prefix: 'Potato___', name: 'Potato' },
  { prefix: 'Tomato', name: 'Tomato' },
];

const toDisplayName = (className) => {
  if (typeof className !== 'string' || !className.trim()) return '';

  const crop = cropNames.find(({ prefix }) => className.startsWith(prefix));
  const disease = crop
    ? className.slice(crop.prefix.length).replace(/^_+/, '').replace(/^Tomato_?/, '')
    : className;
  const readableDisease = disease.replace(/_+/g, ' ').trim();

  return readableDisease
    ? readableDisease.charAt(0).toUpperCase() + readableDisease.slice(1)
    : className;
};

const getConfidence = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 100
    ? confidence
    : null;
};

const getTextList = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : []
);

const PredictionResult = ({
  result,
  explanation,
  onAnalyzeAnother,
  onDownloadReport,
  reportLoading = false,
  scan = null,
  hasOriginalImage = false,
  language = 'en',
}) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return (
      <section className="card result-card result-unavailable" aria-live="polite">
        <div className="result-icon" aria-hidden="true">ⓘ</div>
        <h2>{translate('diagnosisUnavailable', language)}</h2>
        <p>{translate('unreadablePrediction', language)}</p>
        {typeof onAnalyzeAnother === 'function' && (
          <button type="button" className="result-action" onClick={onAnalyzeAnother}>
            {translate('analyzeAnother', language)}
          </button>
        )}
      </section>
    );
  }

  const diseaseName = typeof result.disease_name === 'string' ? result.disease_name.trim() : '';
  const confidence = getConfidence(result.confidence);
  const isHealthy = diseaseName.toLowerCase().includes('healthy');
  const crop = cropNames.find(({ prefix }) => diseaseName.startsWith(prefix));
  const precautions = getTextList(result.precautions);
  const remedies = getTextList(result.remedies);
  const localizedPrecautions = precautions.map((text) => getGuidanceText(diseaseName, 'precautions', text, language));
  const localizedRemedies = remedies.map((text) => getGuidanceText(diseaseName, 'remedies', text, language));
  const guidanceTranslationMissing = [...localizedPrecautions, ...localizedRemedies]
    .some((item) => item.missingTranslation);
  const alternatives = Array.isArray(result.top_alternatives)
    ? result.top_alternatives.filter((alternative) => (
      alternative &&
      typeof alternative === 'object' &&
      typeof alternative.disease_name === 'string' &&
      alternative.disease_name.trim() &&
      getConfidence(alternative.confidence) !== null
    ))
    : [];

  const explainError = explanation && typeof explanation === 'object' && 'error' in explanation ? explanation.error : null;
  const attentionMapData = explanation && typeof explanation === 'object' && !('error' in explanation) ? explanation : null;
  const heatmap = attentionMapData?.heatmap || '';
  const heatmapNote = language === 'hi'
    ? translate('gradcamNote', language)
    : attentionMapData?.note || translate('gradcamNote', language);

  if (!diseaseName) {
    return (
      <section className="card result-card result-unavailable" aria-live="polite">
        <div className="result-icon" aria-hidden="true">ⓘ</div>
        <h2>{translate('diagnosisUnavailable', language)}</h2>
        <p>{translate('missingDiseaseName', language)}</p>
        {typeof onAnalyzeAnother === 'function' && (
          <button type="button" className="result-action" onClick={onAnalyzeAnother}>
            {translate('analyzeAnother', language)}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="card result-card animate-fade-in" aria-labelledby="diagnosis-title">
      <header className="result-header">
        <div>
          <p className="result-kicker">{translate('aiDiagnosis', language)}</p>
          <h2 id="diagnosis-title">{toDisplayName(diseaseName)}</h2>
          <p className="result-class">{translate('modelClass', language)} <code>{diseaseName}</code></p>
        </div>
        <span className={`status-badge ${isHealthy ? 'status-healthy' : 'status-review'}`}>
          {isHealthy ? translate('healthyClass', language) : translate('reviewSuggested', language)}
        </span>
      </header>

      {crop && (
        <div className="plant-detail">
          <span aria-hidden="true">🌱</span>
          <span>{translate('plantIdentified', language)} <strong>{translatePlantName(crop.name, language)}</strong></span>
        </div>
      )}

      <section className="confidence-section" aria-label={translate('modelConfidence', language)}>
        <div className="confidence-header">
          <span>{translate('modelConfidence', language)}</span>
          {confidence === null
            ? <span className="confidence-value confidence-missing">{translate('notProvided', language)}</span>
            : <span className="confidence-value">{confidence.toFixed(2)}%</span>}
        </div>
        {confidence !== null && (
          <div
            className="progress-bar-bg"
            role="progressbar"
            aria-label={translate('modelConfidence', language)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={confidence}
          >
            <div
              className="progress-bar-fill"
              style={{ width: `${confidence}%` }}
            />
          </div>
        )}
        <p className="confidence-note">{translate('confidenceNote', language)}</p>
      </section>

      {alternatives.length > 0 && (
        <section className="alternatives-section" aria-labelledby="alternatives-title">
          <h3 id="alternatives-title">{translate('otherPredictions', language)}</h3>
          <ul className="alternatives-list">
            {alternatives.map((alternative, index) => {
              const alternativeConfidence = getConfidence(alternative.confidence);
              return (
                <li className="alternative-item" key={`${alternative.disease_name}-${index}`}>
                  <code className="alt-name">{alternative.disease_name}</code>
                  <div className="alt-confidence">
                    <span className="alt-value">{alternativeConfidence.toFixed(2)}%</span>
                    <div
                      className="alt-progress-bg"
                      role="progressbar"
                      aria-label={`${alternative.disease_name} ${translate('modelConfidence', language)}`}
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={alternativeConfidence}
                    >
                      <div
                        className="alt-progress-fill"
                        style={{ width: `${alternativeConfidence}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(heatmap || explainError) && (
        <section className="explainability-section" aria-labelledby="explainability-title">
          <div className="explainability-header">
            <h3 id="explainability-title">{translate('attentionMap', language)}</h3>
            <span className="explainability-badge">{translate('explainableAI', language)}</span>
          </div>

          {heatmap ? (
            <div className="heatmap-container">
              <img
                src={`data:image/png;base64,${heatmap}`}
                alt={translate('attentionMap', language)}
                className="heatmap-image"
              />
            </div>
          ) : (
            <p className="explainability-error">
              {explainError
                ? translateApiError(explainError, language)
                : translate('attentionUnavailable', language)}
            </p>
          )}

          <p className="explainability-note">{heatmapNote}</p>
        </section>
      )}

      {(precautions.length > 0 || remedies.length > 0) ? (
        <div className="action-plan">
          {precautions.length > 0 && (
            <section className="info-block" aria-labelledby="precautions-title">
              <h3 id="precautions-title"><span className="icon" aria-hidden="true">🛡️</span> {translate('precautionsNextSteps', language)}</h3>
              <ul>
                {localizedPrecautions.map((item, index) => <li key={`precaution-${index}`}>{item.text}</li>)}
              </ul>
            </section>
          )}

          {remedies.length > 0 && (
            <section className="info-block treatment-block" aria-labelledby="treatment-title">
              <h3 id="treatment-title"><span className="icon" aria-hidden="true">🧪</span> {translate('treatmentInfo', language)}</h3>
              <ul>
                {localizedRemedies.map((item, index) => <li key={`remedy-${index}`}>{item.text}</li>)}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <p className="result-data-note">{translate('noTreatmentInfo', language)}</p>
      )}

      <p className="result-data-note">{translate('unavailableSymptoms', language)}</p>
      {language === 'hi' && guidanceTranslationMissing && (
        <p className="result-data-note">{translate('hindiGuidanceFallback', language)}</p>
      )}

      <aside className="ai-warning" role="note">
        <span className="warning-icon" aria-hidden="true">!</span>
        <p><strong>{translate('diagnosisWarningTitle', language)}</strong> {translate('diagnosisWarning', language)}</p>
      </aside>

      {(!hasOriginalImage && scan) && (
        <p className="result-data-note">{translate('historicalImageMissing', language)}</p>
      )}

      {(typeof onAnalyzeAnother === 'function' || typeof onDownloadReport === 'function') && (
        <div className="result-actions">
          {typeof onDownloadReport === 'function' && (
            <button
              type="button"
              className="result-action result-action-secondary"
              onClick={onDownloadReport}
              disabled={reportLoading}
            >
              {reportLoading ? translate('preparingPdf', language) : translate('downloadReport', language)}
            </button>
          )}
          {scan && (
            <span className="result-saved-date">
              {scan.scanned_at
                ? `${translate('scanDate', language)} ${new Date(scan.scanned_at).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-US')}`
                : translate('historyTitle', language)}
            </span>
          )}
          <button type="button" className="result-action" onClick={onAnalyzeAnother}>
            {translate('analyzeAnother', language)}
          </button>
        </div>
      )}
    </section>
  );
};

export default PredictionResult;
