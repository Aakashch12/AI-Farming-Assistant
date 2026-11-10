const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = (
  configuredApiBaseUrl
  || (import.meta.env.DEV ? 'http://localhost:8000' : '')
).replace(/\/+$/, '');

export const isScanHistoryEnabled = import.meta.env.VITE_ENABLE_SCAN_HISTORY !== 'false';

const apiUrl = (path) => `${API_BASE_URL}${path}`;

const parseApiError = async (response) => {
  let errorMessage = `Request failed (${response.status}). Please try again.`;

  try {
    const errorData = await response.json();
    if (errorData?.detail) {
      const details = Array.isArray(errorData.detail)
        ? errorData.detail.map((item) => item.msg || item).join(', ')
        : errorData.detail;
      errorMessage = typeof details === 'string' ? details : errorMessage;
    } else if (errorData?.error) {
      errorMessage = errorData.error;
    }
  } catch {
    // Ignore JSON parse errors and fall back to the default message.
  }

  return errorMessage;
};

export const predictDisease = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(apiUrl('/predict'), {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Unable to reach the AI backend. Check the configured API URL and ensure the FastAPI service is running.',
        { cause: error },
      );
    }
    console.error('Prediction API Error:', error);
    throw error;
  }
};

export const explainDisease = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(apiUrl('/explain'), {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'AI attention map is unavailable because the backend is not responding. Check the configured API URL and try again.',
        { cause: error },
      );
    }
    console.error('Explainability API Error:', error);
    throw error;
  }
};

export const getDiseaseLibrary = async () => {
  try {
    const response = await fetch(apiUrl('/disease-library'));

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    if (!Array.isArray(data?.entries)) {
      throw new Error('The backend returned an unexpected disease library response.');
    }

    return {
      entries: data.entries
        .filter((entry) => (
          entry &&
          typeof entry.class_name === 'string' &&
          typeof entry.plant === 'string'
        ))
        .map((entry) => ({
          ...entry,
          precautions: Array.isArray(entry.precautions)
            ? entry.precautions.filter((item) => typeof item === 'string')
            : [],
          remedies: Array.isArray(entry.remedies)
            ? entry.remedies.filter((item) => typeof item === 'string')
            : [],
        })),
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Unable to reach the library service. Check the configured API URL and ensure the FastAPI service is running.',
        { cause: error },
      );
    }
    console.error('Disease library API Error:', error);
    throw error;
  }
};

export const saveScan = async (scan) => {
  if (!isScanHistoryEnabled) {
    throw new Error('Scan history is disabled for this deployment.');
  }
  try {
    const response = await fetch(apiUrl('/scans'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scan),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    if (!isValidScan(data)) {
      throw new Error('The backend returned an invalid saved scan.');
    }
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to save scan history because the local backend is unavailable.', { cause: error });
    }
    console.error('Save scan history API Error:', error);
    throw error;
  }
};

const isValidScan = (scan) => (
  scan &&
  typeof scan.id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scan.id) &&
  typeof scan.original_filename === 'string' &&
  scan.original_filename.length > 0 &&
  scan.original_filename.length <= 255 &&
  typeof scan.disease_name === 'string' &&
  Number.isFinite(scan.confidence) &&
  scan.confidence >= 0 &&
  scan.confidence <= 100 &&
  typeof scan.scanned_at === 'string' &&
  Number.isFinite(Date.parse(scan.scanned_at)) &&
  Array.isArray(scan.top_alternatives) &&
  scan.top_alternatives.length <= 2 &&
  scan.top_alternatives.every((item) => (
    item &&
    typeof item.disease_name === 'string' &&
    Number.isFinite(item.confidence) &&
    item.confidence >= 0 &&
    item.confidence <= 100
  )) &&
  Array.isArray(scan.precautions) &&
  scan.precautions.length <= 30 &&
  scan.precautions.every((item) => typeof item === 'string' && item.length <= 1000) &&
  Array.isArray(scan.remedies) &&
  scan.remedies.length <= 30 &&
  scan.remedies.every((item) => typeof item === 'string' && item.length <= 1000)
);

export const getScans = async (search = '') => {
  if (!isScanHistoryEnabled) {
    throw new Error('Scan history is disabled for this deployment.');
  }
  const url = new URL(apiUrl('/scans'), window.location.origin);
  if (search.trim()) url.searchParams.set('search', search.trim());

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(await parseApiError(response));

    const data = await response.json();
    if (!Array.isArray(data?.scans) || !data.scans.every(isValidScan)) {
      throw new Error('The backend returned an invalid scan history response.');
    }
    return data.scans;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to load scan history because the local backend is unavailable.', { cause: error });
    }
    console.error('Scan history API Error:', error);
    throw error;
  }
};

export const getScan = async (scanId) => {
  if (!isScanHistoryEnabled) {
    throw new Error('Scan history is disabled for this deployment.');
  }
  if (typeof scanId !== 'string' || !scanId.trim()) {
    throw new Error('A valid scan ID is required.');
  }

  try {
    const response = await fetch(
      apiUrl(`/scans/${encodeURIComponent(scanId)}`),
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(await parseApiError(response));

    const data = await response.json();
    if (!isValidScan(data)) throw new Error('The backend returned an invalid scan record.');
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to open the saved scan because the local backend is unavailable.', { cause: error });
    }
    console.error('Open scan API Error:', error);
    throw error;
  }
};
