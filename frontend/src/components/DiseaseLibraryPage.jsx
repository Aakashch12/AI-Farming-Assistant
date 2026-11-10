import { useEffect, useMemo, useState } from 'react';
import { getDiseaseLibrary } from '../api';
import DiseaseCard from './DiseaseCard';
import { diseaseLabel } from './diseaseLabels';
import { translate, translateApiError, translatePlantName } from '../i18n';
import './DiseaseLibrary.css';

const DiseaseLibraryPage = ({ onStartDiagnosis, language = 'en' }) => {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedPlant, setSelectedPlant] = useState('All plants');
  const [selectedDisease, setSelectedDisease] = useState('All diseases');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    getDiseaseLibrary()
      .then((data) => {
        if (active) setEntries(data.entries);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'The disease library could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const plants = useMemo(
    () => ['All plants', ...new Set(entries.map((entry) => entry.plant))],
    [entries],
  );

  const diseases = useMemo(
    () => ['All diseases', ...new Set(entries.map((entry) => diseaseLabel(entry.class_name)))],
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();

    return entries.filter((entry) => {
      const matchesPlant = selectedPlant === 'All plants' || entry.plant === selectedPlant;
      const matchesDisease = selectedDisease === 'All diseases'
        || diseaseLabel(entry.class_name) === selectedDisease;
      const searchableText = [
        entry.class_name,
        diseaseLabel(entry.class_name),
        entry.plant,
        ...entry.precautions,
        ...entry.remedies,
      ].join(' ').toLowerCase();

      return matchesPlant && matchesDisease && (!query || searchableText.includes(query));
    });
  }, [entries, search, selectedPlant, selectedDisease]);

  const clearFilters = () => {
    setSearch('');
    setSelectedPlant('All plants');
    setSelectedDisease('All diseases');
  };

  const retryLoading = () => {
    setError('');
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  return (
    <section className="library-page" aria-labelledby="library-title">
      <header className="library-hero">
        <div className="library-hero-copy">
          <span className="eyebrow">{translate('libraryEyebrow', language)}</span>
          <h1 id="library-title">{translate('libraryTitle', language)}</h1>
          <p>{translate('libraryDescription', language)}</p>
        </div>
        <button type="button" className="primary-btn" onClick={onStartDiagnosis}>
          {translate('startDiagnosis', language)}
        </button>
      </header>

      <aside className="library-disclaimer" aria-label={translate('importantInfo', language)}>
        <span className="library-disclaimer-icon" aria-hidden="true">ⓘ</span>
        <p>
          <strong>{translate('referenceNotDiagnosisTitle', language)}</strong>{' '}
          {translate('referenceNotDiagnosis', language)}
        </p>
      </aside>

      <div className="library-toolbar" role="search">
        <label className="library-search-field">
          <span>{translate('searchLibrary', language)}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={translate('searchLibraryPlaceholder', language)}
          />
        </label>

        <label className="library-filter">
          <span>{translate('plant', language)}</span>
          <select value={selectedPlant} onChange={(event) => setSelectedPlant(event.target.value)}>
            {plants.map((plant) => (
              <option key={plant} value={plant}>
                {plant === 'All plants' ? translate('allPlants', language) : translatePlantName(plant, language)}
              </option>
            ))}
          </select>
        </label>

        <label className="library-filter">
          <span>{translate('disease', language)}</span>
          <select value={selectedDisease} onChange={(event) => setSelectedDisease(event.target.value)}>
            {diseases.map((disease) => (
              <option key={disease} value={disease}>
                {disease === 'All diseases' ? translate('allDiseases', language) : disease}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <div className="library-feedback card" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>{translate('loadingClasses', language)}</p>
        </div>
      )}

      {!loading && error && (
        <div className="library-feedback library-error" role="alert">
          <h2>{translate('libraryUnavailable', language)}</h2>
          <p>{translateApiError(error, language)}</p>
          <button type="button" className="secondary-btn" onClick={retryLoading}>
            {translate('retry', language)}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="library-results-heading" aria-live="polite">
            <h2>{translate('supportedClasses', language)}</h2>
            <span>{filteredEntries.length} {translate(filteredEntries.length === 1 ? 'result' : 'results', language)}</span>
          </div>

          {filteredEntries.length > 0 ? (
            <div className="disease-grid">
              {filteredEntries.map((entry) => (
                <DiseaseCard
                  key={entry.class_name}
                  entry={entry}
                  onStartDiagnosis={onStartDiagnosis}
                  language={language}
                />
              ))}
            </div>
          ) : (
            <div className="library-empty-state card">
              <span aria-hidden="true">⌕</span>
              <h2>{translate('noMatchingClasses', language)}</h2>
              <p>{translate('noMatchingClassesText', language)}</p>
              <button type="button" className="secondary-btn" onClick={clearFilters}>
                {translate('clearFilters', language)}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default DiseaseLibraryPage;
