import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/**
 * GLB export of the plant scene currently on screen.
 *
 * The exporter UI (SimControls) lives outside the R3F <Canvas>, so PlantViewer
 * registers its root group here and the UI exports whatever is registered.
 *
 * v0 limitations: static snapshot (no animation tracks; wind sway is baked in
 * at its current pose), branches and leaves use EXT_mesh_gpu_instancing (one
 * cylinder / plane instance per segment / leaf), and materials are plain PBR
 * colours (no textures).
 */
let root: THREE.Object3D | null = null

export function registerPlantRoot(obj: THREE.Object3D | null) {
  root = obj
}

export function canExportPlant() {
  return root !== null
}

export async function exportPlantGLB(): Promise<ArrayBuffer> {
  if (!root) throw new Error('No plant scene is mounted')
  root.updateMatrixWorld(true)
  // animated overlays (the Roots view's water particles) are not part of the plant: hide them for the export
  const hidden: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o.userData.noExport && o.visible) {
      o.visible = false
      hidden.push(o)
    }
  })
  try {
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true })
    return result as ArrayBuffer
  } finally {
    for (const o of hidden) o.visible = true
  }
}

export async function downloadPlantGLB(filename: string) {
  const buf = await exportPlantGLB()
  const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
