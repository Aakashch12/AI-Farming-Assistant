import { diseaseLabel } from './diseaseLabels';
import { getGuidanceText, translate, translatePlantName } from '../i18n';

const GuidanceList = ({ title, items, emptyMessage, entry, field, language }) => (
  <section className="disease-card-section">
    <h4>{translate(title, language)}</h4>
    {items.length > 0 ? (
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>
            {getGuidanceText(entry.class_name, field, item, language).text}
          </li>
        ))}
      </ul>
    ) : (
      <p className="disease-card-muted">{translate(emptyMessage, language)}</p>
    )}
  </section>
);

const DiseaseCard = ({ entry, onStartDiagnosis, language = 'en' }) => {
  const isHealthy = entry.class_name.toLowerCase().includes('healthy');
  const missingGuidanceTranslation = language === 'hi'
    && [...entry.precautions, ...entry.remedies].some(
      (text, index) => getGuidanceText(
        entry.class_name,
        index < entry.precautions.length ? 'precautions' : 'remedies',
        text,
        language,
      ).missingTranslation,
    );

  return (
    <article className="disease-card">
      <header className="disease-card-header">
        <div>
          <span className="disease-plant-label">{translatePlantName(entry.plant, language)}</span>
          <h3>{diseaseLabel(entry.class_name)}</h3>
        </div>
        <span className={`disease-status ${isHealthy ? 'disease-status-healthy' : ''}`}>
          {isHealthy ? translate('healthyClass', language) : translate('diseaseClasses', language)}
        </span>
      </header>

      <p className="disease-card-class">{translate('modelClass', language)} <code>{entry.class_name}</code></p>

      <div className="disease-facts">
        <section className="disease-card-section">
          <h4>{translate('symptoms', language)}</h4>
          <p className="disease-card-muted">
            {translate('symptomsUnavailable', language)}
          </p>
        </section>
        <section className="disease-card-section">
          <h4>{translate('possibleCauses', language)}</h4>
          <p className="disease-card-muted">
            {translate('causesUnavailable', language)}
          </p>
        </section>
      </div>

      <GuidanceList
        title="prevention"
        items={entry.precautions}
        emptyMessage="preventionUnavailable"
        entry={entry}
        field="precautions"
        language={language}
      />
      <GuidanceList
        title="nextSteps"
        items={entry.remedies}
        emptyMessage="nextStepsUnavailable"
        entry={entry}
        field="remedies"
        language={language}
      />
      {missingGuidanceTranslation && (
        <p className="disease-card-muted disease-translation-note">
          {translate('hindiGuidanceFallback', language)}
        </p>
      )}

      <footer className="disease-card-footer">
        <span>{translate('educationalNotDiagnosis', language)}</span>
        <button type="button" className="disease-card-action" onClick={onStartDiagnosis}>
          {translate('analyzeALeaf', language)} <span aria-hidden="true">→</span>
        </button>
      </footer>
    </article>
  );
};

export default DiseaseCard;
