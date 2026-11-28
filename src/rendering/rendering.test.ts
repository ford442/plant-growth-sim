import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CONTEXT_FLAGS, KEY_LIGHT_SHADOW, OUTPUT, configureOutput, describeRenderer } from './createRenderer'
import { attachGpuLossHandlers } from './gpuLossRecovery'
import { useSimStore } from '../stores/simStore'
import { WALL_FRAGMENT, WALL_VERTEX } from '../components/parasite/slice/wallShader'
import {
  NODE_READY_MODES,
  backendForMode,
  parseRendererPreference,
  withRendererPreference,
} from './rendererPreference'

describe('renderer preference', () => {
  it('defaults to the classic WebGL renderer', () => {
    expect(parseRendererPreference('')).toBe('webgl')
    expect(parseRendererPreference('?foo=1')).toBe('webgl')
    expect(parseRendererPreference('?renderer=nonsense')).toBe('webgl')
  })

  it('opts in only on an explicit ?renderer=webgpu', () => {
    expect(parseRendererPreference('?renderer=webgpu')).toBe('webgpu')
    expect(parseRendererPreference('?x=1&renderer=webgpu')).toBe('webgpu')
  })

  it('round-trips through the query string without touching other keys', () => {
    expect(withRendererPreference('', 'webgpu')).toBe('?renderer=webgpu')
    expect(withRendererPreference('?a=1', 'webgpu')).toBe('?a=1&renderer=webgpu')
    expect(withRendererPreference('?a=1&renderer=webgpu', 'webgl')).toBe('?a=1')
    expect(withRendererPreference('?renderer=webgpu', 'webgl')).toBe('')
    expect(parseRendererPreference(withRendererPreference('?a=1', 'webgpu'))).toBe('webgpu')
  })

  it('only node-ready modes honour the WebGPU preference', () => {
    expect(backendForMode('plant', 'webgpu')).toBe(NODE_READY_MODES.plant ? 'webgpu' : 'webgl')
    expect(backendForMode('plant', 'webgl')).toBe('webgl')
    // gem mode was walked on the node renderer (TSL gem material, docs/design/webgpu-tsl.md §8)
    expect(NODE_READY_MODES.gem).toBe(true)
    expect(backendForMode('gem', 'webgpu')).toBe('webgpu')
    expect(backendForMode('gem', 'webgl')).toBe('webgl')
    // modes that have not been ported stay on WebGL whatever was asked for
    for (const mode of ['gem', 'parasite'] as const) {
      if (!NODE_READY_MODES[mode]) expect(backendForMode(mode, 'webgpu')).toBe('webgl')
    }
  })
})

describe('describeRenderer', () => {
  it('tells the three renderers apart', () => {
    expect(describeRenderer({})).toBe('webgl')
    expect(describeRenderer(null)).toBe('webgl')
    expect(describeRenderer({ isWebGPURenderer: true, backend: { isWebGPUBackend: true } })).toBe('webgpu')
    expect(describeRenderer({ isWebGPURenderer: true, backend: { isWebGLBackend: true } })).toBe('webgl2-nodes')
  })
})

describe('context flags', () => {
  it('names the flags the app relies on', () => {
    expect(CONTEXT_FLAGS).toEqual({
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      logarithmicDepthBuffer: true,
    })
  })

  it('configureOutput sets tone mapping and colour space explicitly', () => {
    const gl = { toneMapping: THREE.NoToneMapping, toneMappingExposure: 3, outputColorSpace: 'srgb-linear' }
    configureOutput(gl)
    expect(gl.toneMapping).toBe(OUTPUT.toneMapping)
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping)
    expect(gl.toneMappingExposure).toBe(1)
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace)
  })

  it('shadow frustum is a real box around the plant view', () => {
    expect(KEY_LIGHT_SHADOW.mapSize).toEqual([1024, 1024])
    expect(KEY_LIGHT_SHADOW.far).toBeGreaterThan(KEY_LIGHT_SHADOW.near)
    expect(KEY_LIGHT_SHADOW.extent).toBeGreaterThan(3.5) // the ground disk radius
  })

  it('the hand-written cyst-wall shader writes log depth like the built-in materials', () => {
    for (const chunk of ['logdepthbuf_pars_vertex', 'logdepthbuf_vertex']) expect(WALL_VERTEX).toContain(`<${chunk}>`)
    for (const chunk of ['logdepthbuf_pars_fragment', 'logdepthbuf_fragment']) expect(WALL_FRAGMENT).toContain(`<${chunk}>`)
  })
})

describe('GPU context loss', () => {
  it('prevents default (so the browser restores) and leaves the simulation untouched', () => {
    const canvas = new EventTarget() as unknown as HTMLCanvasElement
    const events: string[] = []
    const detach = attachGpuLossHandlers(
      { domElement: canvas },
      { onLost: (k) => events.push(`lost:${k}`), onRestored: (k) => events.push(`restored:${k}`) },
    )

    const sim = useSimStore.getState()
    sim.tick(0.5)
    const before = useSimStore.getState()
    const snapshot = { age: before.age, species: before.species, weather: before.weather }
    expect(snapshot.age).toBeGreaterThan(0)

    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(events).toEqual(['lost:context-lost', 'restored:context-lost'])

    const after = useSimStore.getState()
    expect(after.age).toBe(snapshot.age)
    expect(after.species).toBe(snapshot.species)
    expect(after.weather).toBe(snapshot.weather)

    detach()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(events).toHaveLength(2) // detached: no more callbacks
    useSimStore.getState().reset()
  })
})
