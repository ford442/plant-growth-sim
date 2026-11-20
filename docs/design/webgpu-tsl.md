# WebGPU renderer + TSL node materials — upgrade path

Issue #19 · track "Plant polish" · status: **optional, opt-in prototype**. The app
still defaults to the classic `WebGLRenderer`; nothing changes unless you ask.

## 1. TL;DR

- Try it: open the app with **`?renderer=webgpu`**, or use the **Renderer** panel in
  the plant sidebar (WebGL / WebGPU · TSL). The URL follows the toggle.
- What you get: plant leaves are shaded by a TSL node material
  (`src/components/plant/tsl/leafNodeMaterial.ts`) — veins, chlorophyll loss,
  back-scattered light, rain wetness and wind flutter, all driven by the weather.
- It never *requires* WebGPU. No adapter → `WebGPURenderer` runs on its WebGL2
  backend (TSL compiles to GLSL). Module fails to load → plain `WebGLRenderer`.
  Leaf chunk fails to load → the ordinary `meshStandardMaterial` stays.
- Only plant mode honours the opt-in. Gem and parasite always stay on WebGL
  (`NODE_READY_MODES` in `src/rendering/rendererPreference.ts`).

## 2. Audit (this repo, `package.json` / lockfile)

| Piece | Version | WebGPU / TSL status |
| --- | --- | --- |
| `three` | 0.186.1 | `WebGPURenderer` and TSL ship in core as the `three/webgpu` and `three/tsl` subpaths. `MeshSSSNodeMaterial` (translucency) is included. `tslFn` is gone — use `Fn`. |
| `@types/three` | 0.186.0 | Types the `three/webgpu` and `three/tsl` subpaths; the whole TSL material type-checks under `strict`. |
| `@react-three/fiber` | 9.8.2 | `gl` may be an **async factory**; it must `await renderer.init()` before returning (ours does). R3F owns a factory-built renderer and disposes it on unmount, including `WebGPURenderer`'s async `dispose()`. |
| `@react-three/drei` | 10.7.9 | `<Environment>` works under `WebGPURenderer` on the WebGL2 backend (lit surfaces matched the WebGL render to within 1/255). Not checked on a native WebGPU device. |
| `vite` | 6.x | `three/webgpu` is already split into a lazy chunk. In **dev**, the first time `three/tsl` is requested Vite re-optimises dependencies and reloads the page once; later loads are clean. |

Bundle (production build): the main chunk grew by ~9 KB (UI, store, preference
logic, `leafAppearance`). `three.webgpu` (715 KB / 201 KB gzip) and the leaf
material (12 KB) are separate chunks, fetched only after opting in — confirmed
against `vite preview`: default loads one JS file, `?renderer=webgpu` loads three.

## 3. How it fits together

```
getGraphicsCapability()          boot probe: WebGL2 tier + "did requestAdapter() succeed?"
        │
backendForMode(mode, preference) plant → the user's preference; gem/parasite → always 'webgl'
        │
rendererFactory({backend, capability})        (R3F `gl` factory; Canvas is re-keyed on backend)
   ├─ 'webgl'   → THREE.WebGLRenderer
   └─ 'webgpu'  → import('three/webgpu') → WebGPURenderer({ forceWebGL: !capability.webgpu })
                    └─ any failure → THREE.WebGLRenderer
        │
RendererLifecycle                reports describeRenderer(gl) → 'webgl' | 'webgpu' | 'webgl2-nodes'
        │
useLeafNodeMaterial()            if describeRenderer !== 'webgl': import('./tsl/leafNodeMaterial')
                                 else / on failure: null → PlantViewer draws meshStandardMaterial
```

Files: `src/rendering/{probeGraphicsCapability,createRenderer,rendererPreference,RendererLifecycle}`,
`src/stores/rendererStore.ts`, `src/components/RendererPanel.tsx`,
`src/components/plant/{leafAppearance,useLeafNodeMaterial}.ts`, `src/components/plant/tsl/leafNodeMaterial.ts`.

`ActiveRenderer` is what is *really* running, which can differ from what was
asked for: `webgl` (classic), `webgpu` (native device), `webgl2-nodes`
(`WebGPURenderer` on its WebGL2 backend — node materials work; compute and
storage buffers would not).

## 4. The prototype: TSL leaf material

`MeshSSSNodeMaterial` (a physical node material with a thickness / back-scatter
term), double-sided, on the existing instanced plane. Geometry is unchanged.

| Effect | Mechanism |
| --- | --- |
| Veins | midrib + lateral veins from `uv()`; no texture |
| Chlorophyll | `mix(senescent, speciesColour, chlorophyll)`; veins keep pigment longest (interveinal chlorosis) |
| Translucency | `thicknessColorNode` = leaf colour pushed yellow-green, scaled by hydration |
| Wetness | roughness 0.7 → 0.16 and ~22 % darker as it rises |
| Wind flutter | `positionNode`: tip-weighted, per-leaf phase from `hash(instanceIndex)`, along the leaf normal |

Inputs come from `leafAppearance()` (pure, unit-tested): `waterStatus` and
`nutrientStatus` → chlorophyll (a continuous version of the old hard switch to a
dry-leaf colour at `waterStatus < 0.35`); `precipitation` / `humidity` → wetness
(smoothed on frame time, quick to wet, slow to dry); `waterStatus` →
translucency; `wind` → flutter. They are written to **uniforms** each frame, so
weather never recompiles a pipeline.

## 5. Rules for writing the next TSL material here

1. **Load it with a dynamic `import()` only.** A static import of `three/webgpu`
   or `three/tsl` anywhere on the default path pulls the whole WebGPU build into
   the WebGL-only bundle.
2. **Check `describeRenderer(gl)` first.** Node materials do not compile on
   `WebGLRenderer`. Always keep a classic-material fallback so a load failure
   leaves the scene complete.
3. Drive materials with **uniforms**, not by rebuilding the graph; read sim state
   in `useFrame` via `useSimStore.getState()` (repo convention).
4. `positionNode` runs **after** the instance matrix: `positionLocal` and
   `normalLocal` are already in the parent's space (so offsets are not in
   leaf-local units).
5. Mirror `color` / `roughness` / `metalness` onto the plain properties. Node
   materials still report `isMeshStandardMaterial`, so `plantExport.ts` (GLB)
   exports them as ordinary PBR — verified.
6. Create the material in a component that **outlives** re-keyed meshes
   (`ArchitectureView`, not `Leaves`), and dispose it yourself — R3F does not
   dispose `<primitive>` objects.
7. Do **not** dispose the renderer from component code. R3F already does, and
   `WebGPURenderer.dispose()` on the WebGL2 backend calls `loseContext()`: under
   React StrictMode the cleanup ran on a live renderer and blanked the canvas
   (this was a bug in `RendererLifecycle`, fixed here).

## 6. Verified, and not

Tested in headless Chromium (SwiftShader) against the dev server and a
production build. **This sandbox has no WebGPU adapter under any flag**, so the
native WebGPU backend was never exercised.

| Claim | Result |
| --- | --- |
| Default path unchanged on WebGL | ✅ renders as before; Cellular frame outline identical to ±1 px; 0 console errors |
| `?renderer=webgpu` renders on the WebGL2 node backend | ✅ Macro, Architecture, Cellular, Roots all render; 0 console errors |
| TSL leaf compiles and shows veins; healthy colour unchanged | ✅ mean leaf RGB 48,131,58 vs 44,127,55 (standard) |
| Water stress yellows the leaf, veins stay greener | ✅ |
| Rain darkens the leaf | ✅ (~14 % in the green channel) |
| Wind: nothing moves at wind 0; motion at wind 8 | ✅ — but the diff also contains the existing whole-plant sway, so **leaf-tip flutter itself was not isolated or eyeballed** |
| Back-scatter translucency | ⚠️ compiled and running, but the measured effect at the test light angle is small (+2…5 per channel). Needs a look on a real GPU and tuning |
| Wet *gloss* (specular) | ⚠️ roughness is lowered, but no highlight was visible at the tested angles |
| Toggle WebGL ⇄ WebGPU, mode round-trips, URL sync | ✅ |
| GLB export with the node leaf material | ✅ plain PBR green, roughness 0.7 (same exporter warning as the default path: it comes from the line-material branches) |
| WebGPU chunk blocked → falls back to `WebGLRenderer` | ✅ renders identically to the default |
| Leaf chunk blocked → standard leaves stay | ✅ warning logged |
| Native WebGPU device: WGSL output, UBO-instancing path, device disposal | ❌ **not tested** |
| Frame-rate cost | ❌ **not measured** (software rasteriser: ~12 vs ~60 FPS says nothing about real GPUs) |

## 7. Known differences and gotchas

- **Scene background is tone-mapped under `WebGPURenderer`.** R3F's ACES tone
  mapping makes three render through an intermediate target, and its output pass
  also tone-maps the clear colour, so `#0a0f0a` shows as ~(1,2,1) instead of
  (10,15,10). Objects and fog are unaffected. If it matters, set a background
  *node* or compensate; not done here.
- `THREE.LineLoop` is not supported by `WebGPURenderer` (it logs an error every
  frame). The Cellular frame was a `LineLoop`; it is now four `lineSegments`.
  Watch the console for other "Objects of type … are not supported" errors
  before flipping another mode.
- `PCFSoftShadowMap` is downgraded to `PCFShadowMap` with a console notice.
- Dev only: `three/tsl` is discovered late, so the first opt-in load after a
  fresh `npm run dev` reloads once.
- Branches are still `lineSegments` (`lineBasicMaterial`), so stems get no TSL
  material until tube branches land (AGENTS.md #1).

## 8. Upgrade steps for another mode

1. Walk **every view** of the mode with `?renderer=webgpu` and a console open;
   fix unsupported objects and any `ShaderMaterial` / `onBeforeCompile` (port to
   node materials).
2. Check `<Environment>`, shadows, fog and tone mapping against the WebGL render
   (compare pixels with the sim paused — animated views need a noise floor).
3. Flip `NODE_READY_MODES[mode]` to `true` and add a test case.
4. Write the TSL material(s) per §5, with a classic fallback.
5. Test on a **real WebGPU device** and on a WebGL-only browser before making
   anything the default.

## 9. Follow-ups

- Real-GPU pass: tune translucency (`thickness*` nodes) and wet gloss; measure frame time.
- Better leaf silhouette (alpha-masked from `uv()`) and instanced-leaf meshes (AGENTS.md #2).
- Rain droplets and a stem/bark material once tube branches exist.
- Gem optical materials (IOR, dispersion — #15) and the parasite pellicle / cyst wall (#3) are the next TSL consumers; both modes must first pass §8.
- Default to WebGPU only after §6's unverified rows are verified on hardware.
