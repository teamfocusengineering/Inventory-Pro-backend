const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getInspectionClassification,
  inferProductionLine,
  inferReportType,
  reportIdFor
} = require('../utils/reportClassification');

test('infers production lines from D labels and product families', () => {
  assert.equal(inferProductionLine('D3 - Helmet Assembly'), 'D3');
  assert.equal(inferProductionLine('ACE helmet'), 'D1');
  assert.equal(inferProductionLine('ARC shell'), 'D4');
});

test('classifies the supported MIS report families', () => {
  assert.equal(inferReportType('visor coating inspection'), 'visor-coating');
  assert.equal(inferReportType('shell moulding'), 'shell-moulding');
  assert.equal(inferReportType('helmet assy'), 'helmet-assembly');
});

test('preserves explicit classification and generates stable keys', () => {
  const result = getInspectionClassification({
    productionLine: 'D2',
    reportType: 'helmet-assembly',
    processName: 'Pad Printing',
    partName: 'Helmet Shell'
  });
  assert.equal(result.processKey, 'pad-printing');
  assert.equal(result.partKey, 'helmet-shell');
  assert.equal(reportIdFor(result.productionLine, result.reportType), 'd2-helmet-assembly-drr');
});
