/**
 * shaders.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * GLSL source strings for Nova's WebGL2 renderer.
 *
 * Design principle: All geometry is stored in MATH coordinates (the coordinate
 * system the student thinks in). The vertex shader performs the one transform:
 *   math (x,y)  →  screen pixels  →  clip space [-1, 1]
 *
 * This means pan = update u_origin (1 uniform write, 0 buffer changes).
 * Zoom = update u_scale + u_origin (2 writes, 0 buffer changes).
 * Only equation edits or large zoom changes require resampling + buffer upload.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── Main vertex shader ────────────────────────────────────────────────────────
// Shared by curves, grid lines, and axis lines.
//
// Inputs:
//   a_position   — math-space (x, y) coordinate
//   u_resolution — canvas size in physical pixels (accounts for DPR)
//   u_origin     — where math (0, 0) sits in physical pixels
//   u_scale      — physical pixels per one math unit
//
// The transform chain:
//   math.x → pixel.x = u_origin.x + math.x * u_scale
//   math.y → pixel.y = u_origin.y - math.y * u_scale   (y-axis flipped)
//   pixel  → clip    = pixel / u_resolution * 2 - 1    (normalise to [-1, 1])
//   clip.y           = -clip.y                          (WebGL Y-up vs canvas Y-down)
export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_position;         // math coordinates (x, y)

uniform vec2  u_resolution;  // canvas width, height in physical px
uniform vec2  u_origin;      // physical px position of math origin (0,0)
uniform float u_scale;       // physical px per math unit

void main() {
  // Step 1: math → physical pixel coordinates
  float px = u_origin.x + a_position.x * u_scale;
  float py = u_origin.y - a_position.y * u_scale;  // flip y

  // Step 2: pixel → clip space [-1, 1]
  vec2 clip = (vec2(px, py) / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;  // WebGL Y-up vs DOM/canvas Y-down

  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 6.0;  // for hover dot rendering
}
`;

// ── Main fragment shader ──────────────────────────────────────────────────────
// Outputs a flat color. Opacity is baked into u_color.a.
// Used for all geometry: curves, grid lines, axis lines, hover dot.
export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision mediump float;

uniform vec4 u_color;   // RGBA, all channels [0, 1]

out vec4 fragColor;

void main() {
  fragColor = u_color;
}
`;