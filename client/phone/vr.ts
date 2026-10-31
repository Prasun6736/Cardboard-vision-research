import type { CalibrationSettings, Eye } from '../../shared/types';
import { VISUAL_TEST_CONFIG } from '../../shared/config';
import { backgroundToRGB, type RenderStimulus } from './renderer';

type XRSessionLike = {
  requestReferenceSpace(type: string): Promise<unknown>;
  updateRenderState(value: unknown): void;
  requestAnimationFrame(callback: (time: number, frame: any) => void): number;
  end(): Promise<void>;
  addEventListener(type: string, callback: () => void): void;
  renderState: { baseLayer?: any };
};

export class ImmersivePresenter {
  private session: XRSessionLike | null = null;
  private referenceSpace: unknown;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private activeEye: Eye | null = null;
  private stimulus: RenderStimulus | null = null;

  constructor(private canvas: HTMLCanvasElement, private calibration: CalibrationSettings) {}

  async supported(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    return xr ? xr.isSessionSupported('immersive-vr').catch(() => false) : false;
  }

  async enter(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: { requestSession(mode: string, options?: unknown): Promise<XRSessionLike> } }).xr;
    if (!xr || !(await this.supported())) return false;
    const gl = this.canvas.getContext('webgl', { xrCompatible: true }) as WebGLRenderingContext | null;
    if (!gl) return false;
    this.session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    await (gl as WebGLRenderingContext & { makeXRCompatible?: () => Promise<void> }).makeXRCompatible?.();
    const Layer = (window as unknown as { XRWebGLLayer: new (session: unknown, gl: WebGLRenderingContext) => unknown }).XRWebGLLayer;
    this.session.updateRenderState({ baseLayer: new Layer(this.session, gl) });
    this.referenceSpace = await this.session.requestReferenceSpace('local');
    this.gl = gl; this.program = this.createProgram(gl);
    this.canvas.style.display = 'block';
    this.session.addEventListener('end', () => { this.session = null; this.canvas.style.display = 'none'; });
    this.requestFrame(() => undefined);
    return true;
  }

  configure(value: CalibrationSettings): void { this.calibration = value; }
  setActiveEye(value: Eye | null): void { this.activeEye = value; }
  setStimulus(value: RenderStimulus | null): void { this.stimulus = value; }
  isActive(): boolean { return Boolean(this.session); }

  requestFrame(callback: (timestamp: number) => void): void {
    if (!this.session) { requestAnimationFrame(callback); return; }
    this.session.requestAnimationFrame((timestamp, frame) => {
      this.renderXRFrame(frame);
      callback(timestamp);
    });
  }

  private renderXRFrame(frame: any): void {
    if (!this.session || !this.gl || !this.program) return;
    const pose = frame.getViewerPose(this.referenceSpace);
    const layer = this.session.renderState.baseLayer;
    if (!pose || !layer) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    const background = backgroundToRGB(this.calibration.backgroundIntensity);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const view of pose.views) {
      const viewport = layer.getViewport(view);
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height);
      if (view.eye !== this.activeEye) continue;
      gl.clearColor(background.red / 255, background.green / 255, background.blue / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawPoint(0, 0, 7, VISUAL_TEST_CONFIG.rendering.xrFixationIntensity);
      this.drawPoint(-0.012, 0, 3, VISUAL_TEST_CONFIG.rendering.xrFixationIntensity);
      this.drawPoint(0.012, 0, 3, VISUAL_TEST_CONFIG.rendering.xrFixationIntensity);
      if (this.stimulus) {
        const x = Math.tan(this.stimulus.xDeg * Math.PI / 180) / Math.tan(this.calibration.horizontalFovDeg * Math.PI / 360);
        const y = Math.tan(this.stimulus.yDeg * Math.PI / 180) / Math.tan(this.calibration.verticalFovDeg * Math.PI / 360);
        this.drawPoint(x, y, Math.max(3, this.calibration.stimulusDiameterDeg * 4), 1, this.stimulus.intensity * this.calibration.maximumStimulusIntensity);
      }
    }
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
  }

  private drawPoint(x: number, y: number, size: number, intensity: number, alpha = 1): void {
    const gl = this.gl!; const program = this.program!;
    gl.uniform2f(gl.getUniformLocation(program, 'uPosition'), x, y);
    gl.uniform1f(gl.getUniformLocation(program, 'uSize'), size);
    gl.uniform1f(gl.getUniformLocation(program, 'uIntensity'), intensity);
    gl.uniform1f(gl.getUniformLocation(program, 'uAlpha'), alpha);
    gl.drawArrays(gl.POINTS, 0, 1);
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram {
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertex, 'attribute float a; uniform vec2 uPosition; uniform float uSize; void main(){ gl_Position=vec4(uPosition,0.,1.); gl_PointSize=uSize; }'); gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragment, 'precision mediump float; uniform float uIntensity; uniform float uAlpha; void main(){ vec2 p=gl_PointCoord-.5; if(length(p)>.5) discard; gl_FragColor=vec4(vec3(uIntensity),uAlpha); }'); gl.compileShader(fragment);
    const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); return program;
  }
}
