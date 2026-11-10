import { jsPDF } from 'jspdf';
import { diseaseLabel } from '../components/diseaseLabels';

const getTextItems = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : []
);

const getAlternatives = (value) => (
  Array.isArray(value)
    ? value.filter((item) => (
      item &&
      typeof item.disease_name === 'string' &&
      Number.isFinite(item.confidence) &&
      item.confidence >= 0 &&
      item.confidence <= 100
    ))
    : []
);

const imageAsJpeg = async (file) => {
  if (!file) return null;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Could not prepare the uploaded image for the PDF report.');
  }
  try {
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  return canvas.toDataURL('image/jpeg', 0.88);
};

export const downloadDiagnosisReport = async ({ result, imageFile, scan }) => {
  if (!result || typeof result.disease_name !== 'string') {
    throw new Error('A valid prediction is required to create a report.');
  }

  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('The prediction confidence is invalid; no report was created.');
  }

  const document = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const ensureRoom = (height) => {
    if (y + height > pageHeight - 18) {
      document.addPage();
      y = 20;
    }
  };

  const addParagraph = (text, { bold = false, color = [54, 75, 61], gap = 2 } = {}) => {
    const lines = document.splitTextToSize(String(text), contentWidth);
    ensureRoom(lines.length * 5.2 + gap);
    document.setFont('helvetica', bold ? 'bold' : 'normal');
    document.setFontSize(10);
    document.setTextColor(...color);
    document.text(lines, margin, y);
    y += lines.length * 5.2 + gap;
  };

  const addSection = (title) => {
    ensureRoom(12);
    y += 3;
    document.setFont('helvetica', 'bold');
    document.setFontSize(12);
    document.setTextColor(32, 91, 59);
    document.text(title, margin, y);
    y += 7;
  };

  document.setFillColor(28, 91, 58);
  document.rect(0, 0, pageWidth, 38, 'F');
  document.setFont('helvetica', 'bold');
  document.setFontSize(20);
  document.setTextColor(255, 255, 255);
  document.text('VerdantAI', margin, 17);
  document.setFont('helvetica', 'normal');
  document.setFontSize(10);
  document.text('Plant health diagnosis report', margin, 27);
  y = 48;

  const scanDate = scan?.scanned_at || new Date().toISOString();
  const parsedDate = new Date(scanDate);
  addParagraph(`Report date: ${Number.isNaN(parsedDate.getTime()) ? 'Unavailable' : parsedDate.toLocaleString()}`, {
    color: [91, 111, 96],
  });
  addParagraph(`Image reference: ${scan?.original_filename || imageFile?.name || 'Not available'}`, {
    color: [91, 111, 96],
  });

  if (imageFile) {
    const image = await imageAsJpeg(imageFile);
    const imageProperties = document.getImageProperties(image);
    const maxWidth = contentWidth;
    const maxHeight = 76;
    const scale = Math.min(maxWidth / imageProperties.width, maxHeight / imageProperties.height);
    const imageWidth = imageProperties.width * scale;
    const imageHeight = imageProperties.height * scale;
    ensureRoom(imageHeight + 11);
    document.addImage(
      image,
      'JPEG',
      margin + (contentWidth - imageWidth) / 2,
      y,
      imageWidth,
      imageHeight,
    );
    y += imageHeight + 8;
  } else {
    addParagraph('The original image was not retained. This report contains saved scan details only.', {
      color: [91, 111, 96],
    });
  }

  addSection('Prediction');
  addParagraph(diseaseLabel(result.disease_name), { bold: true, color: [28, 70, 45] });
  addParagraph(`Model class: ${result.disease_name}`);
  addParagraph(`Model confidence: ${confidence.toFixed(2)}%`);

  const alternatives = getAlternatives(result.top_alternatives);
  if (alternatives.length > 0) {
    addSection('Alternative predictions');
    alternatives.forEach((item) => {
      addParagraph(`${diseaseLabel(item.disease_name)} - ${item.confidence.toFixed(2)}%`);
    });
  }

  const precautions = getTextItems(result.precautions);
  if (precautions.length > 0) {
    addSection('Precautions');
    precautions.forEach((item) => addParagraph(`- ${item}`));
  }

  const remedies = getTextItems(result.remedies);
  if (remedies.length > 0) {
    addSection('Recommended next steps');
    remedies.forEach((item) => addParagraph(`- ${item}`));
  }

  addSection('Important disclaimer');
  addParagraph(
    'This report summarizes an AI model prediction and general educational guidance. '
    + 'The confidence score is not a guarantee of correctness and this result is not a confirmed diagnosis. '
    + 'Verify concerns with a qualified local agricultural professional before taking consequential action.',
  );
  addParagraph('Uploaded images are not stored in scan history by this application.', {
    color: [91, 111, 96],
  });

  const pageCount = document.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    document.setPage(page);
    document.setFont('helvetica', 'normal');
    document.setFontSize(8);
    document.setTextColor(120, 132, 122);
    document.text(`VerdantAI - Educational report - ${page}/${pageCount}`, margin, pageHeight - 9);
  }

  const dateSuffix = Number.isNaN(parsedDate.getTime())
    ? 'scan'
    : parsedDate.toISOString().slice(0, 10);
  const safeClass = result.disease_name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');
  document.save(`VerdantAI-${safeClass || 'diagnosis'}-${dateSuffix}.pdf`);
};
