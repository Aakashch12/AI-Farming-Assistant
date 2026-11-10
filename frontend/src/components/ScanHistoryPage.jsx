import { useEffect, useState } from 'react';
import { getScans } from '../api';
import { diseaseLabel } from './diseaseLabels';
import { translate, translateApiError } from '../i18n';
import './ScanHistoryPage.css';

const formatDate = (value, language) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? translate('dateUnavailable', language)
    : date.toLocaleString(language === 'hi' ? 'hi-IN' : 'en-US');
};

const ScanHistoryPage = ({ refreshKey, onOpenScan, onStartDiagnosis, language = 'en' }) => {
  const [search, setSearch] = useState('');
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState('');
  const [openError, setOpenError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    getScans(search)
      .then((history) => {
        if (active) setScans(history);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Scan history could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [search, refreshKey, reloadKey]);

  const openScan = async (id) => {
    setOpeningId(id);
    setOpenError('');
    try {
      await onOpenScan(id);
    } catch (openFailure) {
      setOpenError(openFailure.message || 'Saved scan could not be opened.');
    } finally {
      setOpeningId('');
    }
  };

  return (
    <section className="scan-history-page" aria-labelledby="scan-history-title">
      <header className="history-hero">
        <div>
          <span className="eyebrow">{translate('historyEyebrow', language)}</span>
          <h1 id="scan-history-title">{translate('historyTitle', language)}</h1>
          <p>{translate('historyDescription', language)}</p>
        </div>
        <button type="button" className="primary-btn" onClick={onStartDiagnosis}>
          {translate('analyzeNewImage', language)}
        </button>
      </header>

      <aside className="history-privacy-note">
        {translate('historyPrivacy', language)}
      </aside>

      <label className="history-search">
        <span>{translate('historySearchLabel', language)}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setLoading(true);
            setError('');
            setSearch(event.target.value);
          }}
          placeholder={translate('historySearchPlaceholder', language)}
        />
      </label>

      {openError && <p className="history-error" role="alert">{translateApiError(openError, language)}</p>}
      {error && <p className="history-error" role="alert">{translateApiError(error, language)}</p>}

      {loading ? (
        <div className="history-empty card" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>{translate('loadingHistory', language)}</p>
        </div>
      ) : error ? (
        <div className="history-empty card">
          <h2>{translate('historyUnavailable', language)}</h2>
          <p>{translate('historyBackendHelp', language)}</p>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setError('');
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            {translate('retry', language)}
          </button>
        </div>
      ) : scans.length === 0 ? (
        <div className="history-empty card">
          <span aria-hidden="true">◷</span>
          <h2>{translate(search ? 'noMatchingScans' : 'noSavedScans', language)}</h2>
          <p>{translate(search ? 'tryAnotherSearch' : 'completedScansAppear', language)}</p>
          {search ? (
            <button type="button" className="secondary-btn" onClick={() => setSearch('')}>
              {translate('clearSearch', language)}
            </button>
          ) : (
            <button type="button" className="primary-btn" onClick={onStartDiagnosis}>
              {translate('startDiagnosis', language)}
            </button>
          )}
        </div>
      ) : (
        <div className="history-list" aria-live="polite">
          {scans.map((scan) => (
            <article className="history-item" key={scan.id}>
              <div className="history-item-main">
                <span className="history-plant">{scan.original_filename}</span>
                <h2>{diseaseLabel(scan.disease_name)}</h2>
                <code>{scan.disease_name}</code>
                <time dateTime={scan.scanned_at}>{formatDate(scan.scanned_at, language)}</time>
              </div>
              <div className="history-item-score">
                <strong>{scan.confidence.toFixed(2)}%</strong>
                <span>{translate('modelConfidence', language)}</span>
              </div>
              <button
                type="button"
                className="history-open-btn"
                onClick={() => openScan(scan.id)}
                disabled={openingId === scan.id}
              >
                {openingId === scan.id ? translate('opening', language) : translate('openResult', language)}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default ScanHistoryPage;
