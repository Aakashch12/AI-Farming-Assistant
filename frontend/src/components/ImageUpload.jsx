import { useState, useRef, useEffect } from 'react';
import './ImageUpload.css';
import { translate } from '../i18n';

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ImageUpload = ({ onImageSelect, language = 'en' }) => {
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [validationMessage, setValidationMessage] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const validateFile = (file) => {
    if (!file) {
      return 'noFileSelected';
    }

    const fileType = file.type || '';
    const extension = file.name ? file.name.split('.').pop()?.toLowerCase() : '';
    const isSupportedType = ACCEPTED_TYPES.includes(fileType) || ['jpg', 'jpeg', 'png', 'webp'].includes(extension);

    if (!isSupportedType) {
      return 'unsupportedFile';
    }

    if (file.size <= 0) {
      return 'emptyFile';
    }

    if (file.size > MAX_FILE_SIZE) {
      return 'oversizedFile';
    }

    return '';
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) {
      setValidationMessage('noFileSelected');
      onImageSelect(null);
      return;
    }

    handleFile(file);
  };

  const handleChange = (e) => {
    e.preventDefault();
    const file = e.target.files && e.target.files[0];
    if (!file) {
      setValidationMessage('noFileSelected');
      onImageSelect(null);
      return;
    }

    handleFile(file);
  };

  const handleFile = (file) => {
    const validationError = validateFile(file);
    if (validationError) {
      setValidationMessage(validationError);
      onImageSelect(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setValidationMessage('');
    onImageSelect(file);
  };

  const clearSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setValidationMessage('');
    onImageSelect(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFilePicker();
    }
  };

  return (
    <div className="card upload-card animate-fade-in">
      <div className="upload-header">
        <div>
          <p className="upload-kicker">{translate('leafScan', language)}</p>
          <h2>{translate('uploadPlantImage', language)}</h2>
        </div>
      </div>

      <p className="upload-copy">{translate('uploadCopy', language)}</p>

      {!previewUrl ? (
        <div
          className={`drop-zone ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={openFilePicker}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          aria-label={translate('uploadPlantAria', language)}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={handleChange}
            className="file-input"
            aria-label={translate('selectPlantImageAria', language)}
          />
          <div className="drop-content">
            <div className="upload-icon-wrap" aria-hidden="true">
              <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
              </svg>
            </div>
            <p className="drop-title">{translate('dragDrop', language)}</p>
            <span className="divider">{translate('or', language)}</span>
            <button className="button select-btn" type="button" onClick={(e) => { e.stopPropagation(); openFilePicker(); }}>
              {translate('browseFiles', language)}
            </button>
          </div>
        </div>
      ) : (
        <div className="preview-container">
          <div className="preview-frame">
            <img src={previewUrl} alt={translate('plantPreviewAlt', language)} className="image-preview" />
          </div>
          <div className="preview-actions">
            <button type="button" className="button select-btn replace-btn" onClick={openFilePicker}>
              {translate('replaceImage', language)}
            </button>
            <button type="button" className="button clear-btn" onClick={clearSelection}>
              {translate('removeImage', language)}
            </button>
          </div>
        </div>
      )}

      {validationMessage && (
        <div className="validation-message" role="alert" aria-live="polite">
          {translate(validationMessage, language)}
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
