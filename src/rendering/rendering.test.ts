import { describe, expect, it } from 'vitest'
import { describeRenderer } from './createRenderer'
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
