import { useEffect, useState } from 'react';
import './App.css';
import ImageUpload from './components/ImageUpload';
import PredictionResult from './components/PredictionResult';
import DiseaseLibraryPage from './components/DiseaseLibraryPage';
import ScanHistoryPage from './components/ScanHistoryPage';
import {
  predictDisease,
  explainDisease,
  getScan,
  saveScan,
  isScanHistoryEnabled,
} from './api';
import { LANGUAGE_STORAGE_KEY, translate, translateApiError } from './i18n';

function App() {
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'hi' ? 'hi' : 'en';
    } catch {
      return 'en';
    }
  });
  const [selectedImage, setSelectedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [error, setError] = useState(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [activePage, setActivePage] = useState('home');
  const [currentScan, setCurrentScan] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [historySaveError, setHistorySaveError] = useState('');

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (storageError) {
      console.warn('Could not persist the selected language:', storageError);
    }
  }, [language]);

  const startDiagnosis = () => {
    setActivePage('home');
    requestAnimationFrame(() => {
      document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const showHomeSection = (sectionId) => {
    if (sectionId === 'scan-history') {
      setActivePage('history');
      return;
    }
    setActivePage('home');
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const handleImageSelect = (file) => {
    setSelectedImage(file);
    setResult(null);
    setExplanation(null);
    setCurrentScan(null);
    setReportError('');
    setHistorySaveError('');
    setError(null);
  };

  const handleAnalyzeAnother = () => {
    setSelectedImage(null);
    setResult(null);
    setExplanation(null);
    setCurrentScan(null);
    setError(null);
    setReportError('');
    setHistorySaveError('');
    setUploadKey((key) => key + 1);
    setActivePage('home');
    document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleOpenScan = async (scanId) => {
    const scan = await getScan(scanId);
    setCurrentScan(scan);
    setSelectedImage(null);
    setUploadKey((key) => key + 1);
    setResult({
      disease_name: scan.disease_name,
      confidence: scan.confidence,
      top_alternatives: scan.top_alternatives,
      precautions: scan.precautions,
      remedies: scan.remedies,
    });
    setExplanation(null);
    setReportError('');
    setHistorySaveError('');
    setActivePage('home');
    requestAnimationFrame(() => {
      document.querySelector('.results-panel')?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const handleDownloadReport = async () => {
    if (!result) return;
    setReportLoading(true);
    setReportError('');
    try {
      const { downloadDiagnosisReport } = await import('./reports/downloadDiagnosisReport');
      await downloadDiagnosisReport({
        result,
        imageFile: selectedImage,
        scan: currentScan,
      });
    } catch (downloadError) {
      setReportError(downloadError.message || 'The PDF report could not be generated.');
    } finally {
      setReportLoading(false);
    }
  };

  const handlePredict = async () => {
    if (!selectedImage || loading) return;

    setLoading(true);
    setError(null);
    setHistorySaveError('');
    setReportError('');
    setCurrentScan(null);

    try {
      const data = await predictDisease(selectedImage);
      setResult(data);
      if (isScanHistoryEnabled) {
        try {
          const savedScan = await saveScan({
            original_filename: selectedImage.name,
            disease_name: data.disease_name,
            confidence: data.confidence,
            top_alternatives: Array.isArray(data.top_alternatives) ? data.top_alternatives : [],
          });
          setCurrentScan(savedScan);
          setHistoryRefreshKey((key) => key + 1);
        } catch (saveError) {
          setHistorySaveError(translateApiError(
            `Prediction succeeded, but scan history was not saved: ${saveError.message}`,
            language,
          ));
        }
      }

      try {
        const explainData = await explainDisease(selectedImage);
        setExplanation(explainData);
      } catch (explainErr) {
        setExplanation({ error: explainErr.message || 'Grad-CAM could not be generated.' });
      }
    } catch (err) {
      const message = err && err.message
        ? err.message
        : 'The AI backend is unavailable right now. Please try again in a moment.';
      setError(translateApiError(message, language));
      setExplanation(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label={translate('brandHome', language)}>
          <div className="brand-mark" aria-hidden="true">🌿</div>
          <div className="brand-text">
            <span className="brand-name">VerdantAI</span>
            <small>{translate('brandTagline', language)}</small>
          </div>
        </div>

        <nav className="main-nav" aria-label={translate('mainNavigation', language)}>
          <button type="button" className={activePage === 'home' ? 'nav-link nav-link-active' : 'nav-link'} onClick={() => setActivePage('home')}>{translate('home', language)}</button>
          <button type="button" className={activePage === 'library' ? 'nav-link nav-link-active' : 'nav-link'} onClick={() => setActivePage('library')}>{translate('diseaseLibrary', language)}</button>
          {isScanHistoryEnabled && (
            <button type="button" className={activePage === 'history' ? 'nav-link nav-link-active' : 'nav-link'} onClick={() => setActivePage('history')}>{translate('scanHistory', language)}</button>
          )}
          <button type="button" className="nav-link" onClick={() => showHomeSection('about')}>{translate('about', language)}</button>
        </nav>

        <div className="topbar-actions">
          <label className="language-picker">
            <span>{translate('language', language)}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={translate('language', language)}>
              <option value="en">{translate('english', language)}</option>
              <option value="hi">{translate('hindi', language)}</option>
            </select>
          </label>
          <button type="button" className="nav-cta" onClick={startDiagnosis}>
            {translate('getStarted', language)}
          </button>
        </div>
      </header>

      <main className="page-content">
        {activePage === 'library' ? (
          <DiseaseLibraryPage onStartDiagnosis={startDiagnosis} language={language} />
        ) : activePage === 'history' && isScanHistoryEnabled ? (
          <ScanHistoryPage
            refreshKey={historyRefreshKey}
            onOpenScan={handleOpenScan}
            onStartDiagnosis={startDiagnosis}
            language={language}
          />
        ) : (
          <>
        <section className="hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow">{translate('heroEyebrow', language)}</div>
            <h1>{translate('heroTitle', language)}</h1>
            <p>{translate('heroDescription', language)}</p>

            <div className="hero-actions">
              <button type="button" className="primary-btn" onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' })}>
                {translate('scanLeaf', language)}
              </button>
              <button type="button" className="secondary-btn" onClick={() => setActivePage('library')}>
                {translate('viewLibrary', language)}
              </button>
            </div>

            <div className="hero-stats" aria-label={translate('platformMetrics', language)}>
              <div className="stat-item">
                <strong>15</strong>
                <span>{translate('diseaseClasses', language)}</span>
              </div>
              <div className="stat-item">
                <strong>24/7</strong>
                <span>{translate('fieldInsights', language)}</span>
              </div>
              <div className="stat-item">
                <strong>95%</strong>
                <span>{translate('monitoringFocus', language)}</span>
              </div>
            </div>
          </div>

          <div className="hero-panel" aria-label={translate('cropHealthPanel', language)}>
            <div className="signal-card">
              <div className="signal-header">
                <span className="signal-dot"></span>
                <span>{translate('liveCropScan', language)}</span>
              </div>
              <div className="signal-visual">
                <div className="leaf-shape"></div>
              </div>
              <div className="signal-meta">
                <div>
                  <small>{translate('cropStatus', language)}</small>
                  <strong>{translate('healthyStable', language)}</strong>
                </div>
                <span className="signal-badge">{translate('optimal', language)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="workspace-grid" aria-label={translate('workspaceLabel', language)}>
          <div className="upload-panel" id="upload">
            <ImageUpload key={uploadKey} onImageSelect={handleImageSelect} language={language} />

            <button
              type="button"
              className="primary-btn analyze-btn"
              onClick={handlePredict}
              disabled={!selectedImage || loading}
            >
              {loading ? translate('analyzing', language) : translate('analyzeLeaf', language)}
            </button>

            {error && (
              <div className="error-message animate-fade-in" role="alert">
                <strong>{translate('error', language)}</strong> {error}
              </div>
            )}
          </div>

          <div className="results-panel">
            {loading ? (
              <div className="card loading-indicator animate-fade-in" aria-live="polite">
                <div className="spinner"></div>
                <h3>{translate('loadingPredictionTitle', language)}</h3>
                <p>{translate('loadingPredictionText', language)}</p>
              </div>
            ) : (
              <PredictionResult
                result={result}
                explanation={explanation}
                onAnalyzeAnother={handleAnalyzeAnother}
                onDownloadReport={handleDownloadReport}
                reportLoading={reportLoading}
                scan={currentScan}
                hasOriginalImage={Boolean(selectedImage)}
                language={language}
              />
            )}

            {historySaveError && <div className="error-message" role="alert">{historySaveError}</div>}
            {reportError && <div className="error-message" role="alert">{translateApiError(reportError, language)}</div>}

            {!loading && !result && (
              <div className="empty-state card animate-fade-in" aria-live="polite">
                <div className="empty-state-icon" aria-hidden="true">📸</div>
                <h3>{translate('readyForScan', language)}</h3>
                <p>{translate('readyForScanText', language)}</p>
              </div>
            )}
          </div>
        </section>

        <section className="info-strip" aria-label={translate('productSections', language)}>
          <article className="mini-card" id="disease-library">
            <span className="mini-icon">🧬</span>
            <h3>{translate('diseaseLibrary', language)}</h3>
            <p>{translate('libraryDescription', language)}</p>
            <button type="button" className="mini-card-link" onClick={() => setActivePage('library')}>
              {translate('browseLibrary', language)} <span aria-hidden="true">→</span>
            </button>
          </article>

          {isScanHistoryEnabled && (
            <article className="mini-card" id="scan-history">
              <span className="mini-icon">🕘</span>
              <h3>{translate('scanHistory', language)}</h3>
              <p>{translate('historyCardText', language)}</p>
              <button type="button" className="mini-card-link" onClick={() => setActivePage('history')}>
                {translate('viewHistory', language)} <span aria-hidden="true">→</span>
              </button>
            </article>
          )}

          <article className="mini-card" id="about">
            <span className="mini-icon">🌾</span>
            <h3>{translate('about', language)}</h3>
            <p>{translate('aboutText', language)}</p>
          </article>
        </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
