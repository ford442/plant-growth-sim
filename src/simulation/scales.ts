/**
 * Plant view scales and the camera each one wants (pure data, no Three.js).
 *
 * One canvas serves every scale: the context runs with a logarithmic depth buffer
 * (`rendering/createRenderer.ts`), so the cellular view's tiny near plane and the
 * macro bed's far plane can share it without z-fighting.
 */
export type ViewScale = 'macro' | 'architecture' | 'cellular' | 'roots'

export interface ScaleCamera {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  near: number
  far: number
  minDistance: number
  maxDistance: number
}

export const SCALE_CAMERA: Record<ViewScale, ScaleCamera> = {
  // the whole bed, metres across
  macro: { position: [0, 7.5, 13], target: [0, 0.6, 0], fov: 45, near: 0.1, far: 200, minDistance: 3, maxDistance: 40 },
  // one plant, branches and leaves
  architecture: { position: [0, 4, 8], target: [0, 0, 0], fov: 45, near: 0.05, far: 200, minDistance: 1.5, maxDistance: 30 },
  // a stem cross-section: CellularView refits the distance to the viewport; near must be tiny
  cellular: { position: [0, 0, 6], target: [0, 0, 0], fov: 35, near: 0.001, far: 100, minDistance: 0.05, maxDistance: 20 },
  // the root volume, face-on to the soil slice
  roots: { position: [0.6, 0.4, 7.2], target: [0, -0.7, 0], fov: 45, near: 0.05, far: 200, minDistance: 1.5, maxDistance: 30 },
}
