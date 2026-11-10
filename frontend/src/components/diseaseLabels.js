export const diseaseLabel = (className) => {
  let name = className;

  if (className.startsWith('Pepper__bell___')) {
    name = className.slice('Pepper__bell___'.length);
  } else if (className.startsWith('Potato___')) {
    name = className.slice('Potato___'.length);
  } else if (className.startsWith('Tomato_')) {
    name = className.slice('Tomato_'.length).replace(/^_+/, '');
  }

  if (name.toLowerCase() === 'healthy') return 'Healthy';

  return name
    .replace(/_+/g, ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
};
