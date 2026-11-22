/**
 * The cyst wall as a rim light. The real wall is under 0.5 µm thick — a pixel at
 * this scale, and less than 1 % of a mature cyst's radius — so the wall is drawn
 * as a shell just that much larger than the body (`SliceModel` sets the gap from
 * the sim's `cyst.wall`), lit by a fresnel term: invisible face-on, bright at
 * the silhouette, where a thin glycosylated shell reads in dark-field.
 *
 * Plain classic-GLSL `ShaderMaterial` (parasite mode is WebGL-only; see
 * `NODE_READY_MODES`). Instancing is handled by hand: a ShaderMaterial does not
 * apply `instanceMatrix` for you, and `instanceColor` is the cyst's rim tint.
 * Scale is uniform, so the instance matrix can transform normals directly.
 */

export const WALL_VERTEX = /* glsl */ `
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vTint;

void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * local;
  vNormalView = normalize(normalMatrix * n);
  vViewDir = normalize(-mv.xyz);
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * mv;
}
`

export const WALL_FRAGMENT = /* glsl */ `
uniform float uPower;
uniform float uIntensity;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vTint;

void main() {
  float facing = clamp(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);
  float rim = pow(1.0 - facing, uPower);
  // additive blending: the shell adds light, it never darkens what is behind it
  gl_FragColor = vec4(vTint * uIntensity * rim, rim);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** How tightly the rim hugs the silhouette, and how bright it is. */
export const WALL_UNIFORMS = { uPower: { value: 2.6 }, uIntensity: { value: 1.7 } }
