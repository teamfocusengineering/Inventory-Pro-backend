const normalizeReportText = (value) => String(value || '').trim().toLowerCase();

const toKey = (value) => normalizeReportText(value)
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const inferProductionLine = (...values) => {
  const text = values.map(normalizeReportText).join(' ');
  const direct = text.match(/\bd\s*([1-4])\b/);
  if (direct) return `D${direct[1]}`;
  if (/\bace\b/.test(text)) return 'D1';
  if (/\bfit\b/.test(text)) return 'D2';
  if (/\bneo\b/.test(text)) return 'D3';
  if (/\barc\b/.test(text)) return 'D4';
  return '';
};

const inferReportType = (...values) => {
  const text = values.map(normalizeReportText).join(' ');
  if (text.includes('visor') && text.includes('coating')) return 'visor-coating';
  if (text.includes('visor') && (text.includes('mechanism') || text.includes('vm top') || text.includes('visor top'))) {
    return 'visor-mechanism-top-moulding';
  }
  if (text.includes('visor') && (text.includes('mould') || text.includes('mold'))) return 'visor-moulding';
  if (text.includes('shell') && (text.includes('mould') || text.includes('mold'))) return 'shell-moulding';
  if (text.includes('chin cover')) return 'chin-cover-moulding';
  if (text.includes('spoiler')) return 'spoiler-moulding';
  if (text.includes('stagewise')) return 'stagewise-rejection';
  if (text.includes('bop') || text.includes('inward')) return 'bop-parts-receipt';
  if (text.includes('assembly') || text.includes('assy')) return 'helmet-assembly';
  return '';
};

const reportIdFor = (productionLine, reportType) => {
  const line = normalizeReportText(productionLine);
  if (!line || !reportType) return '';
  const ids = {
    'helmet-assembly': `${line}-helmet-assembly-drr`,
    'visor-moulding': `${line}-visor-moulding-drr`,
    'visor-mechanism-top-moulding': `visor-mechanism-top-moulding-${line}`,
    'visor-coating': `visor-coating-quality-performance-${line}`,
    'shell-moulding': `shell-moulding-quality-performance-${line}`,
    'chin-cover-moulding': `chin-cover-moulding-performance-${line}`,
    'spoiler-moulding': `spoiler-moulding-performance-${line}`,
    'stagewise-rejection': `stagewise-rejection-performance-${line}`,
    'bop-parts-receipt': `${line}-bop-parts-receipt`
  };
  return ids[reportType] || '';
};

const getInspectionClassification = (payload = {}) => {
  const productionLine = String(payload.productionLine || inferProductionLine(
    payload.productName,
    payload.code,
    payload.partDescription,
    payload.stageName
  )).toUpperCase();
  const reportType = payload.reportType || inferReportType(
    payload.stageName,
    payload.formName,
    payload.productName,
    payload.partDescription
  );
  const processName = payload.processName || payload.stageName || '';
  const partName = payload.partName || payload.partDescription || payload.productName || '';
  return {
    productionLine,
    reportType,
    processKey: payload.processKey || toKey(processName),
    processName,
    partKey: payload.partKey || toKey(partName),
    partName
  };
};

module.exports = {
  getInspectionClassification,
  inferProductionLine,
  inferReportType,
  normalizeReportText,
  reportIdFor,
  toKey
};
