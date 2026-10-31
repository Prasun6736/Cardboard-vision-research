import { jsPDF } from 'jspdf';
import type { Eye, SessionData, ThresholdResult, TrialRecord } from '../../shared/types';
import { VISUAL_TEST_CONFIG } from '../../shared/config';
import { FIELD_MAP_REFERENCE, fieldMapReportLines } from '../../shared/fieldMapReference';
import {
  calculateSignalDetection, SIGNAL_DETECTION_DEFINITIONS, signalDetectionFormulaLines,
  type SignalDetectionMetrics
} from '../../shared/signalDetection';
import { allVisualReferenceSections, type ReportReferenceSection } from '../../shared/reportReference';

export function renderDetectionSummary(element: HTMLElement, trials: TrialRecord[]): void {
  if (!trials.length) { element.innerHTML = '<span>Complete trials to calculate</span>'; return; }
  const metrics = metricsForTrials(trials);
  element.innerHTML = `
    <div class="detection-content">
      <table class="response-matrix" aria-label="Signal detection response matrix">
        <thead><tr><th></th><th>Stimulus present</th><th>Stimulus absent</th></tr></thead>
        <tbody>
          <tr><th>Responded</th><td class="positive">Hit<strong>${metrics.hits}</strong></td><td class="negative">False alarm<strong>${metrics.falseAlarms}</strong></td></tr>
          <tr><th>No response</th><td class="negative">Miss<strong>${metrics.misses}</strong></td><td class="positive">Correct rejection<strong>${metrics.correctRejections}</strong></td></tr>
        </tbody>
      </table>
      <div class="detection-metrics">
        <div><span>Hit rate</span><strong>${formatPercent(metrics.hitRate)}</strong></div>
        <div><span>False-alarm rate</span><strong>${formatPercent(metrics.falseAlarmRate)}</strong></div>
        <div><span>d-prime</span><strong>${formatNumber(metrics.dPrime)}</strong></div>
        <div><span>Response bias</span><strong>${formatNumber(metrics.responseBias)}</strong></div>
      </div>
    </div>
    ${formulaExplanationHtml(metrics)}`;
}

export function renderMap(element: HTMLElement, thresholds: ThresholdResult[], eye: Eye = 'left'): void {
  if (!thresholds.length) { element.innerHTML = '<span>No results yet</span>'; return; }
  element.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 720; canvas.height = 380;
  canvas.setAttribute('aria-label', `${eye} eye relative sensitivity map`);
  element.append(canvas);
  const context = canvas.getContext('2d')!;
  const plot = { left: 48, top: 25, width: 624, height: 312 };
  const {
    xMinDeg: xMin, xMaxDeg: xMax, yMinDeg: yMin, yMaxDeg: yMax
  } = VISUAL_TEST_CONFIG.resultMap;
  const toX = (degrees: number) => plot.left + (degrees - xMin) / (xMax - xMin) * plot.width;
  const toY = (degrees: number) => plot.top + (yMax - degrees) / (yMax - yMin) * plot.height;

  // Inverse-distance interpolation is visualization only; it does not create
  // additional measured points or normative reference data.
  const image = context.createImageData(plot.width, plot.height);
  for (let py = 0; py < plot.height; py++) {
    const yDeg = yMax - py / plot.height * (yMax - yMin);
    for (let px = 0; px < plot.width; px++) {
      const xDeg = xMin + px / plot.width * (xMax - xMin);
      let weighted = 0, weights = 0;
      for (const point of thresholds) {
        const distanceSquared = (xDeg - point.xDeg) ** 2 + (yDeg - point.yDeg) ** 2;
        const weight = 1 / Math.max(0.5, distanceSquared);
        weighted += sensitivityForPoint(point) * weight;
        weights += weight;
      }
      const sensitivity = weighted / weights;
      const shade = Math.round(28 + sensitivity * 227);
      const index = (py * plot.width + px) * 4;
      image.data[index] = shade; image.data[index + 1] = shade; image.data[index + 2] = shade; image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, plot.left, plot.top);

  context.strokeStyle = '#11182755'; context.lineWidth = 1;
  context.fillStyle = '#d9e0e8'; context.font = '11px ui-monospace, monospace';
  context.textAlign = 'center'; context.textBaseline = 'top';
  for (let degree = xMin; degree <= xMax; degree += VISUAL_TEST_CONFIG.resultMap.gridStepDeg) {
    const x = toX(degree); context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.top + plot.height); context.stroke();
    context.fillText(`${degree}°`, x, plot.top + plot.height + 8);
  }
  context.textAlign = 'right'; context.textBaseline = 'middle';
  for (let degree = yMin; degree <= yMax; degree += VISUAL_TEST_CONFIG.resultMap.gridStepDeg) {
    const y = toY(degree); context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.left + plot.width, y); context.stroke();
    context.fillText(`${degree}°`, plot.left - 7, y);
  }
  context.strokeStyle = '#0b0f14'; context.lineWidth = 2;
  context.beginPath(); context.moveTo(toX(0), plot.top); context.lineTo(toX(0), plot.top + plot.height); context.stroke();
  context.beginPath(); context.moveTo(plot.left, toY(0)); context.lineTo(plot.left + plot.width, toY(0)); context.stroke();

  for (const point of thresholds) {
    const sensitivityScore = Math.round(sensitivityForPoint(point) * 100);
    const x = toX(point.xDeg), y = toY(point.yDeg);
    context.fillStyle = '#0b1118dd'; context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#ffffffaa'; context.lineWidth = 1; context.stroke();
    context.fillStyle = '#ffffff'; context.font = 'bold 10px ui-monospace, monospace'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(String(sensitivityScore), x, y);
  }
  context.fillStyle = '#9eabb9'; context.font = '10px ui-sans-serif, sans-serif'; context.textBaseline = 'bottom';
  context.textAlign = 'left'; context.fillText(eye === 'left' ? 'TEMPORAL' : 'NASAL', plot.left, 18);
  context.textAlign = 'right'; context.fillText(eye === 'left' ? 'NASAL' : 'TEMPORAL', plot.left + plot.width, 18);
  context.textAlign = 'center'; context.fillText('SUPERIOR (+Y)', canvas.width / 2, 18);
  context.textBaseline = 'top'; context.fillText('INFERIOR (-Y)', canvas.width / 2, plot.top + plot.height + 20);
  context.textBaseline = 'bottom'; context.fillText('Tested scores: 0 = not seen, 100 = seen · intermediate shading is interpolated · not calibrated dB', canvas.width / 2, canvas.height - 2);
}

function download(name: string, content: string, type: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function exportJson(session: SessionData): void {
  const report = {
    ...session,
    signalDetection: {
      left: metricsForTrials(session.eyes.left.trials),
      right: metricsForTrials(session.eyes.right.trials)
    }
  };
  download(`${session.sessionId}.json`, JSON.stringify(report, null, 2), 'application/json');
}

export function exportCsv(session: SessionData): void {
  const headers = ['sessionId','participantId','participantName','participantAge','participantGender','trialId','eye','isCatch','xDeg','yDeg','intensity','requestedDurationMs','phoneShownAt','phoneHiddenAt','actualDurationMs','seen','desktopResponseAt','estimatedReactionTimeMs','trialStartedAt'];
  const rows = (['left', 'right'] as Eye[]).flatMap(eye => session.eyes[eye].trials.map(trial => headers.map(key => {
    const participantValues: Record<string, unknown> = { participantId: session.participant.participantId, participantName: session.participant.name, participantAge: session.participant.age, participantGender: session.participant.gender };
    const value = key === 'sessionId' ? session.sessionId : key in participantValues ? participantValues[key] : trial[key as keyof typeof trial];
    return JSON.stringify(value ?? '');
  }).join(',')));
  download(`${session.sessionId}.csv`, [headers.join(','), ...rows].join('\n'), 'text/csv');
}

export function exportPdf(session: SessionData, leftMap: HTMLElement, rightMap: HTMLElement): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pdf.setProperties({ title: `${session.sessionId} visual-field report`, subject: 'Experimental visual-field research report' });
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text('Visual Field Research Report', 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80);
  pdf.text('Experimental prototype - not instrument validated or calibrated.', 18, 25);
  pdf.setTextColor(25); pdf.setFontSize(10);
  const participantLines = [
    `Participant: ${session.participant.name}`,
    `Participant ID: ${session.participant.participantId}`,
    `Age / gender: ${session.participant.age} / ${session.participant.gender}`,
    `Session: ${session.sessionId}`,
    `Started: ${new Date(session.startedAt).toLocaleString()}`
  ];
  participantLines.forEach((line, index) => pdf.text(line, 18, 36 + index * 6));
  if (session.participant.notes) pdf.text(`Notes: ${session.participant.notes}`, 18, 69, { maxWidth: 175 });

  drawPdfDetection(pdf, 18, 81, 'Left eye response analysis', metricsForTrials(session.eyes.left.trials));
  drawPdfDetection(pdf, 108, 81, 'Right eye response analysis', metricsForTrials(session.eyes.right.trials));
  pdf.setFontSize(8); pdf.setTextColor(90);
  pdf.text('d-prime and response bias use log-linear correction. Catch trials contain no stimulus.', 18, 136);
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('Response definitions', 18, 148);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  SIGNAL_DETECTION_DEFINITIONS.forEach((line, index) => pdf.text(line, 18, 155 + index * 6));
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text('Recorded test settings', 18, 185);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  [
    `Result status: ${session.completedAt ? 'complete' : 'partial'}   Completed: ${session.completedAt ? new Date(session.completedAt).toLocaleString() : 'not completed'}`,
    `Stimulus / response window: ${session.settings.stimulusDurationMs} ms / ${session.settings.responseWindowMs} ms`,
    `Pre-stimulus delay: ${session.settings.preStimulusMinMs}-${session.settings.preStimulusMaxMs} ms   Inter-trial delay: ${session.settings.interTrialMinMs}-${session.settings.interTrialMaxMs} ms`,
    `Field of view: ${session.settings.calibration.horizontalFovDeg}° horizontal x ${session.settings.calibration.verticalFovDeg}° vertical`,
    `Display: ${session.settings.calibration.screenWidth} x ${session.settings.calibration.screenHeight} px   pixel ratio ${session.settings.calibration.pixelRatio}`,
    `Stimulus diameter: ${session.settings.calibration.stimulusDiameterDeg}°   background / maximum intensity: ${session.settings.calibration.backgroundIntensity} / ${session.settings.calibration.maximumStimulusIntensity}`,
    `Recorded trials: left ${session.eyes.left.trials.length} / right ${session.eyes.right.trials.length}`
  ].forEach((line, index) => pdf.text(line, 18, 193 + index * 6));

  addVisualFormulaPage(pdf, session);
  addReferencePages(pdf, allVisualReferenceSections());
  addEyePage(pdf, 'left', session.eyes.left.thresholds, leftMap);
  addEyePage(pdf, 'right', session.eyes.right.thresholds, rightMap);
  pdf.save(`${session.sessionId}.pdf`);
}

function addReferencePages(pdf: jsPDF, sections: readonly ReportReferenceSection[]): void {
  pdf.addPage();
  let y = 18;
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text('Reference and interpretation guide', 18, y); y += 12;
  for (const section of sections) {
    const required = 8 + section.lines.reduce((height, line) => height + (pdf.splitTextToSize(line, 168) as string[]).length * 4.1 + 2, 0);
    if (y + required > 279) { pdf.addPage(); y = 18; }
    pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(section.title, 18, y); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(65);
    for (const line of section.lines) {
      const wrapped = pdf.splitTextToSize(`- ${line}`, 168) as string[];
      pdf.text(wrapped, 22, y); y += wrapped.length * 4.1 + 2;
    }
    y += 3;
  }
}

function addVisualFormulaPage(pdf: jsPDF, session: SessionData): void {
  pdf.addPage(); pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text('Signal-detection formulas and substituted values', 18, 18);
  (['left', 'right'] as Eye[]).forEach((eye, eyeIndex) => {
    const y = eyeIndex ? 155 : 34;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(`${eye.toUpperCase()} EYE`, 18, y);
    pdf.setFont('courier', 'normal'); pdf.setFontSize(7.5);
    signalDetectionFormulaLines(metricsForTrials(session.eyes[eye].trials)).forEach((line, index) => {
      const wrapped = pdf.splitTextToSize(line, 174) as string[];
      pdf.text(wrapped, 18, y + 10 + index * 13);
    });
  });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90);
  pdf.text('Hc/FAc use correction. Higher d-prime means better separation; positive bias is conservative.', 18, 286);
}

function addEyePage(pdf: jsPDF, eye: Eye, thresholds: ThresholdResult[], map: HTMLElement): void {
  pdf.addPage(); pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text(`${eye.toUpperCase()} EYE`, 18, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90);
  pdf.text('Experimental single-presentation response map with interpolated grayscale between tested locations.', 18, 25);
  const canvas = map.querySelector('canvas');
  if (canvas) pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 18, 32, 174, 92);
  else { pdf.setFontSize(11); pdf.text('No field-map data available.', 18, 45); }
  drawPdfMapLegend(pdf, 18, 130);
  pdf.setTextColor(25); pdf.setFontSize(8); pdf.setFont('helvetica', 'bold'); pdf.text('Field-map reference', 18, 145);
  pdf.setFont('helvetica', 'normal');
  let referenceY = 151;
  for (const line of fieldMapReportLines(eye)) {
    const wrapped = pdf.splitTextToSize(line, 174) as string[];
    pdf.text(wrapped, 18, referenceY);
    referenceY += wrapped.length * 3.5 + 1.5;
  }
  const locationTitleY = referenceY + 2;
  pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text('Tested location responses', 18, locationTitleY);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  const sorted = [...thresholds].sort((a, b) => b.yDeg - a.yDeg || a.xDeg - b.xDeg);
  sorted.forEach((point, index) => {
    const column = index >= 12 ? 1 : 0; const row = index % 12;
    const sensitivity = Math.round(sensitivityForPoint(point) * 100);
    pdf.text(`${point.xDeg >= 0 ? '+' : ''}${point.xDeg}°, ${point.yDeg >= 0 ? '+' : ''}${point.yDeg}°   score ${sensitivity}   trials ${point.trials}`, 18 + column * 88, locationTitleY + 7 + row * 7);
  });
  pdf.setFontSize(8); pdf.setTextColor(95);
  pdf.text('Research prototype only. Accurate luminance and optical calibration are not implemented.', 18, 286);
}

function drawPdfMapLegend(pdf: jsPDF, x: number, y: number): void {
  const width = 80, segments = 40;
  for (let index = 0; index < segments; index++) {
    const shade = Math.round(28 + index / (segments - 1) * 227);
    pdf.setFillColor(shade, shade, shade); pdf.rect(x + index * width / segments, y, width / segments + 0.1, 5, 'F');
  }
  pdf.setDrawColor(150); pdf.rect(x, y, width, 5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(55);
  [0, 25, 50, 75, 100].forEach(value => pdf.text(String(value), x + width * value / 100, y + 10, { align: value === 0 ? 'left' : value === 100 ? 'right' : 'center' }));
  pdf.text(`Scale: 0 = not seen; 100 = seen. 25, 50, and 75 are interpolated shading. ${FIELD_MAP_REFERENCE.shading}`, x + width + 8, y + 4, { maxWidth: 85 });
}

function drawPdfDetection(pdf: jsPDF, x: number, y: number, title: string, metrics: SignalDetectionMetrics): void {
  pdf.setTextColor(25); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(title, x, y);
  const cells = [
    { label: 'Hit', value: metrics.hits, positive: true }, { label: 'False alarm', value: metrics.falseAlarms, positive: false },
    { label: 'Miss', value: metrics.misses, positive: false }, { label: 'Correct reject', value: metrics.correctRejections, positive: true }
  ];
  cells.forEach((cell, index) => {
    const cellX = x + (index % 2) * 40; const cellY = y + 5 + Math.floor(index / 2) * 18;
    const color = cell.positive ? [220, 233, 216] : [241, 222, 212];
    pdf.setFillColor(color[0], color[1], color[2]);
    pdf.rect(cellX, cellY, 40, 18, 'F'); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.text(cell.label, cellX + 2, cellY + 5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(String(cell.value), cellX + 20, cellY + 13, { align: 'center' });
  });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
  pdf.text(`Hit rate ${formatPercent(metrics.hitRate)}   FA rate ${formatPercent(metrics.falseAlarmRate)}`, x, y + 47);
  pdf.text(`d-prime ${formatNumber(metrics.dPrime)}   bias ${formatNumber(metrics.responseBias)}`, x, y + 53);
}

function metricsForTrials(trials: TrialRecord[]): SignalDetectionMetrics {
  return calculateSignalDetection(trials.map(trial => ({ signalPresent: !trial.isCatch, responded: trial.seen })));
}

function formatPercent(value: number | null): string { return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`; }
function formatNumber(value: number | null): string { return value === null ? 'N/A' : value.toFixed(2); }
function sensitivityForPoint(point: ThresholdResult): number {
  return point.relativeSensitivity ?? (1 - point.threshold);
}

function formulaExplanationHtml(metrics: SignalDetectionMetrics): string {
  return `<details class="formula-panel" open>
    <summary>Definitions and formula values</summary>
    <div class="definition-list">${SIGNAL_DETECTION_DEFINITIONS.map(line => `<p>${line}</p>`).join('')}</div>
    <div class="formula-lines">${signalDetectionFormulaLines(metrics).map(line => `<code>${line}</code>`).join('')}</div>
    <p class="formula-note">Hc and FAc use a 0.5 log-linear correction so rates of exactly 0 or 1 do not produce infinite z-scores. Higher d-prime indicates better separation of present versus absent trials. Positive bias is more conservative; negative bias is more liberal.</p>
  </details>`;
}
