import type { CalibrationSettings, Eye } from '../../shared/types';
import { VISUAL_TEST_CONFIG } from '../../shared/config';

export interface RenderStimulus { xDeg: number; yDeg: number; intensity: number; }

export function backgroundToRGB(intensity: number): { red: number; green: number; blue: number } {
  // A subtly warm neutral avoids the flat mid-gray field while keeping the
  // background close to, but chromatically distinct from, an achromatic stimulus.
  return {
    red: Math.round(clamp01(intensity + VISUAL_TEST_CONFIG.rendering.backgroundRedOffset) * 255),
    green: Math.round(clamp01(intensity + VISUAL_TEST_CONFIG.rendering.backgroundGreenOffset) * 255),
    blue: Math.round(clamp01(intensity + VISUAL_TEST_CONFIG.rendering.backgroundBlueOffset) * 255)
  };
}

export function intensityToRGB(intensity: number, calibration: CalibrationSettings): string {
  // The target hue is pure white; opacity controls its uncalibrated contrast.
  const alpha = Math.min(1, Math.max(0, intensity * calibration.maximumStimulusIntensity));
  return `rgba(255, 255, 255, ${alpha})`;
}

function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }

export function visualAngleToPosition(
  xDeg: number, yDeg: number, viewportWidth: number, viewportHeight: number, calibration: CalibrationSettings
): { x: number; y: number } {
  const xNormalized = Math.tan(xDeg * Math.PI / 180) / Math.tan(calibration.horizontalFovDeg * Math.PI / 360);
  const yNormalized = Math.tan(yDeg * Math.PI / 180) / Math.tan(calibration.verticalFovDeg * Math.PI / 360);
  return { x: viewportWidth * (0.5 + xNormalized * 0.5), y: viewportHeight * (0.5 - yNormalized * 0.5) };
}

export class StereoCanvasRenderer {
  private context: CanvasRenderingContext2D;
  private activeEye: Eye | null = null;
  private stimulus: RenderStimulus | null = null;
  private calibration: CalibrationSettings;

  constructor(private canvas: HTMLCanvasElement, calibration: CalibrationSettings) {
    this.context = canvas.getContext('2d', { alpha: false })!;
    this.calibration = calibration;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  configure(calibration: CalibrationSettings): void { this.calibration = calibration; this.draw(); }
  setActiveEye(eye: Eye | null): void { this.activeEye = eye; this.draw(); }
  // Presentation changes are drawn by the phone's requested display frame so
  // reported timestamps correspond to the frame that applies the change.
  setStimulus(stimulus: RenderStimulus | null): void { this.stimulus = stimulus; }

  draw(): void {
    const { width, height } = this.canvas;
    const halfWidth = width / 2;
    const background = backgroundToRGB(this.calibration.backgroundIntensity);
    // The non-tested eye is fully suppressed with black.
    this.context.fillStyle = '#000000';
    this.context.fillRect(0, 0, width, height);
    if (this.activeEye) {
      this.context.fillStyle = `rgb(${background.red}, ${background.green}, ${background.blue})`;
      this.context.fillRect(this.activeEye === 'left' ? 0 : halfWidth, 0, halfWidth, height);
    }
    this.drawEye('left', 0, halfWidth, height);
    this.drawEye('right', halfWidth, halfWidth, height);
  }

  private drawEye(eye: Eye, offsetX: number, width: number, height: number): void {
    if (eye !== this.activeEye) return;
    const center = visualAngleToPosition(0, 0, width, height, this.calibration);
    this.context.strokeStyle = VISUAL_TEST_CONFIG.rendering.fixationColor;
    this.context.lineWidth = Math.max(1, devicePixelRatio);
    const arm = Math.max(4, height * 0.012);
    this.context.beginPath();
    this.context.moveTo(offsetX + center.x - arm, center.y); this.context.lineTo(offsetX + center.x + arm, center.y);
    this.context.moveTo(offsetX + center.x, center.y - arm); this.context.lineTo(offsetX + center.x, center.y + arm);
    this.context.stroke();
    if (!this.stimulus) return;
    const position = visualAngleToPosition(this.stimulus.xDeg, this.stimulus.yDeg, width, height, this.calibration);
    const edge = visualAngleToPosition(this.calibration.stimulusDiameterDeg / 2, 0, width, height, this.calibration);
    const radius = Math.max(VISUAL_TEST_CONFIG.rendering.minimumStimulusRadiusCssPx * devicePixelRatio, Math.abs(edge.x - center.x));
    this.context.fillStyle = intensityToRGB(this.stimulus.intensity, this.calibration);
    this.context.beginPath(); this.context.arc(offsetX + position.x, position.y, radius, 0, Math.PI * 2); this.context.fill();
  }

  private resize(): void {
    const ratio = Math.min(VISUAL_TEST_CONFIG.rendering.maximumCanvasPixelRatio, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(innerWidth * ratio);
    this.canvas.height = Math.round(innerHeight * ratio);
    this.draw();
  }
}
