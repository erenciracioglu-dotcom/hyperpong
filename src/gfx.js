// HYPERPONG — rendering. Every object is drawn through the shared space warp.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WU, WARP_GLSL, warpP } from './warp.js';
import { BALL_R, PW, PH, PORTAL_R, BH_R } from './sim.js';

const TMP = { x: 0, y: 0, z: 0 };
const V3 = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

export const PU = {
  uColA: { value: new THREE.Color('#16e8ff') },
  uColB: { value: new THREE.Color('#ff2bd6') },
  uColC: { value: new THREE.Color('#6d5cff') },
  uBg1: { value: new THREE.Color('#03020f') },
  uBg2: { value: new THREE.Color('#140636') },
  uBeat: { value: 0 },
};

// ---------------------------------------------------------------- shaders
const STD_VS = /* glsl */ `
${WARP_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(warp(wp.xyz), 1.0);
}`;

// keeps an object's shape rigid: only its centre goes through the warp
const CENTER_VS = /* glsl */ `
${WARP_GLSL}
varying vec3 vL;
varying vec3 vN;
void main() {
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 off = (modelMatrix * vec4(position, 0.0)).xyz;
  vL = position;
  vN = normalize(mat3(viewMatrix) * off);
  gl_Position = projectionMatrix * viewMatrix * vec4(warp(c) + off, 1.0);
}`;

const BG_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BG_FS = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uBg1;
uniform vec3 uBg2;
uniform float uTime;
uniform float uBeat;
varying vec3 vDir;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float t = uTime * 0.03;
  float n1 = fbm(d * 2.2 + vec3(t, -t * 0.7, t * 0.4));
  float n2 = fbm(d * 4.6 + vec3(-t * 1.3, t, 0.0) + n1 * 1.6);
  vec3 col = mix(uBg1, uBg2, smoothstep(0.25, 0.78, n1));
  col += uColC * pow(smoothstep(0.35, 0.95, n2), 2.0) * 0.5;
  col += uColB * pow(smoothstep(0.45, 1.0, n1 * n2 * 1.7), 3.0) * 0.45;
  float ang = atan(d.y, d.x);
  float rad = acos(clamp(-d.z, -1.0, 1.0));
  float sw = 0.5 + 0.5 * sin(ang * 4.0 + log(rad + 0.02) * 9.0 - uTime * 1.8);
  float vort = exp(-rad * 4.5);
  col += mix(uColA, uColB, sw) * vort * (0.3 + 0.7 * sw) * 0.32;
  col += vec3(1.0) * exp(-rad * 34.0) * (0.7 + uBeat * 0.4);
  vec3 sp = d * 170.0;
  vec3 id = floor(sp);
  float hs = h31(id);
  float star = step(0.985, hs) * pow(max(0.0, 1.0 - length(fract(sp) - 0.5) * 2.2), 6.0);
  star *= 0.6 + 0.4 * sin(uTime * (2.0 + hs * 6.0) + hs * 40.0);
  col += vec3(0.9, 0.95, 1.0) * star * 2.4;
  gl_FragColor = vec4(col, 1.0);
}`;

const TUNNEL_VS = /* glsl */ `
${WARP_GLSL}
attribute float aWall;
uniform float uHW;
uniform float uHH;
varying vec3 vPos;
varying float vWall;
varying float vLat;
void main() {
  vec3 p = vec3(position.x * uHW, position.y * uHH, position.z);
  vPos = p;
  vWall = aWall;
  vLat = aWall < 1.5 ? position.x : position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(warp(p), 1.0);
}`;

const TUNNEL_FS = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uBg1;
uniform vec3 uBg2;
uniform float uBeat;
uniform float uTime;
uniform float uAIZ;
uniform vec4 uBalls[4];
uniform vec3 uBallCol[4];
uniform vec4 uWaves[4];
uniform vec3 uWaveCol[4];
uniform vec4 uImp[6];
uniform vec3 uImpCol[6];
uniform vec2 uGrav;
uniform float uGravOn;
varying vec3 vPos;
varying float vWall;
varying float vLat;
float gline(float x, float wpx) {
  float fw = fwidth(x);
  float d = abs(fract(x + 0.5) - 0.5);
  float l = 1.0 - smoothstep(wpx * fw, (wpx + 1.0) * fw, d);
  return l * (1.0 - smoothstep(0.08, 0.35, fw));
}
void main() {
  float wi = floor(vWall + 0.5);
  bool horiz = wi < 1.5;
  float lat = horiz ? vPos.x : vPos.y;
  float depth = max(-vPos.z, 0.0);
  float fog = exp(-depth * 0.05);
  float endFade = smoothstep(uAIZ - 3.5, uAIZ - 0.2, vPos.z);
  vec3 col = mix(uBg1, uBg2, 0.5 + 0.5 * vLat) * 0.45;

  float rings = gline(vPos.z, 0.55);
  float major = gline(vPos.z * 0.25, 0.9);
  float longi = gline(lat * 2.0, 0.55);
  float g = max(rings * 0.6, longi * 0.5) + major * 0.5;
  col += uColC * g * (0.34 + 0.26 * uBeat) * (0.25 + 0.75 * fog);

  float lane = floor(lat * 2.0 + 0.5);
  float flow = pow(0.5 + 0.5 * sin(vPos.z * 0.85 - uTime * 6.5 + lane * 2.3), 14.0);
  col += uColA * longi * flow * 0.55 * (0.2 + 0.8 * fog);

  float edge = smoothstep(0.94, 1.0, abs(vLat));
  col += uColA * edge * 0.28 * (0.25 + 0.75 * fog);
  col += uColA * exp(-pow(vPos.z / 0.03, 2.0)) * 0.8;
  col += uColB * exp(-pow((vPos.z - uAIZ) / 0.06, 2.0)) * 1.25;

  if (uGravOn > 0.001) {
    vec2 n = wi < 0.5 ? vec2(0.0, 1.0) : (wi < 1.5 ? vec2(0.0, -1.0) : (wi < 2.5 ? vec2(1.0, 0.0) : vec2(-1.0, 0.0)));
    float fl = pow(max(0.0, dot(-n, uGrav)), 3.0);
    col += uColB * fl * uGravOn * (0.12 + 0.5 * longi + 0.5 * rings);
  }

  for (int i = 0; i < 4; i++) {
    vec4 b = uBalls[i];
    if (b.w <= 0.0) continue;
    float dz = vPos.z - b.z;
    float near = 0.3 + 0.7 * smoothstep(0.4, 4.5, -b.z);
    float ring = (exp(-dz * dz / 0.0018) * 2.1 + exp(-abs(dz) * 3.0) * 0.1) * near;
    vec3 d3 = vPos - b.xyz;
    float light = 1.0 / (1.0 + dot(d3, d3) * 4.5);
    vec2 sp = horiz ? vec2(vPos.x - b.x, dz) : vec2(vPos.y - b.y, dz);
    float spot = exp(-dot(sp, sp) * 24.0);
    col += uBallCol[i] * b.w * (ring + light * 0.45 + spot * 1.5 * near);
  }
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.z <= 0.0) continue;
    float dz = abs(vPos.z - w.x) - w.y * 20.0;
    col += uWaveCol[i] * exp(-dz * dz * 8.0) * exp(-w.y * 1.8) * 0.9;
  }
  for (int i = 0; i < 6; i++) {
    vec4 im = uImp[i];
    if (im.w < 0.0 || im.w > 1.0) continue;
    float d = length(vPos - im.xyz);
    float r = im.w * 2.4;
    float ringI = exp(-pow((d - r) * 8.0, 2.0)) * (1.0 - im.w);
    float core = exp(-d * d * 25.0) * exp(-im.w * 7.0) * 2.2;
    col += uImpCol[i] * (ringI * 1.4 + core);
  }
  col *= endFade;
  gl_FragColor = vec4(col, (0.84 + 0.16 * clamp(g, 0.0, 1.0)) * endFade);
}`;

const BALL_FS = /* glsl */ `
uniform vec3 uCol;
uniform float uGhost;
uniform float uFlash;
uniform float uRot;
uniform float uTime;
uniform vec3 uAxis;
varying vec3 vL;
varying vec3 vN;
vec3 rotA(vec3 p, vec3 ax, float a) { return p * cos(a) + cross(ax, p) * sin(a) + ax * dot(ax, p) * (1.0 - cos(a)); }
void main() {
  vec3 n = normalize(vN);
  float fres = pow(1.0 - abs(n.z), 2.0);
  vec3 p = rotA(normalize(vL), uAxis, uRot);
  float bands = smoothstep(0.6, 0.95, sin(p.y * 8.0));
  float seam = smoothstep(0.85, 1.0, sin(atan(p.z, p.x) * 3.0));
  vec3 col = vec3(1.9) * (1.0 - fres) + uCol * (2.6 * fres + bands * 1.6 + seam * 0.8) + vec3(3.0) * uFlash;
  float a = 1.0;
  if (uGhost > 0.5) {
    a = 0.35 + 0.3 * sin(uTime * 31.0 + vL.y * 24.0);
    col = mix(col, uCol * 1.5, 0.5);
  }
  gl_FragColor = vec4(col, a);
}`;

const GLOW_VS = /* glsl */ `
${WARP_GLSL}
uniform float uSize;
uniform float uWarpOn;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  if (uWarpOn > 0.5) c = warp(c);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FS = /* glsl */ `
uniform vec3 uCol;
uniform float uInt;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r2 = dot(p, p) * 4.0;
  float g = (exp(-r2 * 6.0) * 0.8 + exp(-r2 * 30.0) * 1.6) * smoothstep(1.0, 0.6, r2);
  gl_FragColor = vec4(uCol * g * uInt, 1.0);
}`;

const RIB_VS = /* glsl */ `
${WARP_GLSL}
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aT;
uniform float uWidth;
uniform float uAspect;
uniform float uWarpOn;
varying float vT;
varying float vSide;
vec4 clipOf(vec3 p) {
  vec3 q = uWarpOn > 0.5 ? warp(p) : p;
  return projectionMatrix * viewMatrix * vec4(q, 1.0);
}
void main() {
  vec4 c = clipOf(position);
  vec4 a = clipOf(aPrev);
  vec4 b = clipOf(aNext);
  vec2 sa = a.xy / max(a.w, 0.001);
  vec2 sb = b.xy / max(b.w, 0.001);
  vec2 d = (sb - sa) * vec2(uAspect, 1.0);
  if (dot(d, d) < 1e-10) d = vec2(1.0, 0.0);
  d = normalize(d);
  vec2 nrm = vec2(-d.y, d.x);
  nrm.x /= uAspect;
  float w = uWidth * (1.0 - aT * 0.8);
  c.xy += nrm * aSide * w * projectionMatrix[1][1];
  vT = aT;
  vSide = aSide;
  gl_Position = c;
}`;

const RIB_FS = /* glsl */ `
uniform vec3 uCol;
uniform float uInt;
varying float vT;
varying float vSide;
void main() {
  float a = pow(1.0 - vT, 1.5) * (1.0 - vSide * vSide * 0.75);
  gl_FragColor = vec4(uCol * a * uInt * 1.8, 1.0);
}`;

const PART_VS = /* glsl */ `
${WARP_GLSL}
attribute vec3 aCol;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying vec3 vC;
varying float vA;
void main() {
  vC = aCol;
  vA = aAlpha;
  vec4 mv = viewMatrix * vec4(warp(position), 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aAlpha <= 0.0 ? 0.0 : clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 220.0);
}`;

const PART_FS = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float g = exp(-r * 3.5) * (1.0 - smoothstep(0.7, 1.0, r));
  gl_FragColor = vec4(vC * g * vA * 2.2, 1.0);
}`;

const PADDLE_FS = /* glsl */ `
uniform vec3 uCol;
uniform vec2 uBox;
uniform vec2 uPlane;
uniform vec3 uHit;
uniform float uFlash;
uniform float uStun;
uniform float uShield;
uniform float uPlayer;
uniform float uBeat;
uniform float uTime;
varying vec2 vUv;
float sdRB(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float hexD(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
vec2 hexG(vec2 uv) { vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5; vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h; return dot(a, a) < dot(b, b) ? a : b; }
void main() {
  vec2 p = (vUv - 0.5) * uPlane;
  if (uStun > 0.0) {
    float n = fract(sin(floor(p.y * 22.0 + uTime * 40.0) * 91.7) * 437.5);
    p.x += (n - 0.5) * 0.22 * uStun;
  }
  float d = sdRB(p, uBox, 0.14);
  float inside = 1.0 - smoothstep(-0.008, 0.008, d);
  float edge = exp(-abs(d) * 60.0) * 1.5 + exp(-max(d, 0.0) * 12.0) * 0.3 * step(0.0, d);
  float hx = smoothstep(0.38, 0.5, hexD(hexG(p * 8.0)));
  float fillK = uPlayer > 0.5 ? 0.8 : 1.8;
  float edgeK = uPlayer > 0.5 ? 1.05 : 2.0;
  float fill = inside * (0.03 + hx * (0.045 + 0.04 * uBeat)) * fillK;
  float ch = 0.0;
  if (uPlayer > 0.5) {
    float r = length(p);
    ch += exp(-pow((r - 0.085) * 120.0, 2.0)) * 0.8;
    ch += exp(-abs(p.y) * 280.0) * step(0.13, abs(p.x)) * step(abs(p.x), 0.27) * 0.8;
    ch += exp(-abs(p.x) * 280.0) * step(0.13, abs(p.y)) * step(abs(p.y), 0.27) * 0.8;
    ch += exp(-r * r * 3000.0) * 1.2;
  }
  float hr = length(p - uHit.xy);
  float rip = exp(-pow((hr - uHit.z * 3.0) * 14.0, 2.0)) * exp(-uHit.z * 3.5) * inside * 2.4;
  float shield = uShield * inside * (0.3 + 0.7 * hx) * (0.6 + 0.4 * sin(uTime * 14.0 + p.x * 9.0));
  vec3 col = uCol * (edge * edgeK + fill + rip + uFlash * inside * 1.2 + shield * 1.6) + vec3(1.0) * ch * (0.6 + 0.5 * uFlash);
  if (uStun > 0.0) col = mix(col, col.brg * 1.6, uStun * step(0.5, fract(uTime * 18.0)));
  gl_FragColor = vec4(col, 1.0);
}`;

const RET_FS = /* glsl */ `
uniform vec3 uCol;
uniform float uProg;
uniform float uOn;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float rad = 0.2 + (1.0 - uProg) * 0.75;
  float ring = exp(-pow((r - rad) * 45.0, 2.0)) * (0.5 + uProg);
  float a = atan(p.y, p.x) + uTime * 1.5;
  float tick = step(0.94, abs(sin(a * 2.0))) * exp(-pow((r - rad - 0.07) * 35.0, 2.0));
  float dotc = exp(-r * r * 500.0) * uProg;
  gl_FragColor = vec4(uCol * (ring + tick * 0.9 + dotc) * uOn * 0.9, 1.0);
}`;

const DISK_FS = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uTime;
uniform float uOn;
varying vec3 vL;
void main() {
  float r = length(vL.xy);
  float a = atan(vL.y, vL.x);
  float t = clamp((r - 1.25) / (3.4 - 1.25), 0.0, 1.0);
  float sw = 0.5 + 0.5 * sin(a * 7.0 - uTime * 5.0 / max(r, 0.5) + r * 4.0);
  float sw2 = 0.5 + 0.5 * sin(a * 17.0 + uTime * 3.0 - r * 9.0);
  float inten = pow(1.0 - t, 2.4) * (0.45 + 0.55 * sw * (0.6 + 0.4 * sw2));
  float dop = 0.45 + 0.75 * (0.5 + 0.5 * sin(a + 0.6));
  vec3 hot = vec3(1.0, 0.86, 0.62);
  vec3 col = mix(uColA, hot, pow(1.0 - t, 2.5)) * inten * dop * 1.5;
  float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.75, t);
  gl_FragColor = vec4(col * edge * uOn, 1.0);
}`;

const PORTAL_FS = /* glsl */ `
uniform vec3 uCol;
uniform float uTime;
uniform float uFlash;
uniform float uOn;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.7;
  float r = length(p);
  float a = atan(p.y, p.x);
  float ring = exp(-pow((r - 1.0) * 16.0, 2.0)) * 2.4 + exp(-abs(r - 1.0) * 6.0) * 0.35;
  float inside = 1.0 - smoothstep(0.95, 1.0, r);
  float sw = 0.5 + 0.5 * sin(a * 5.0 + log(r + 0.04) * 9.0 - uTime * 4.5);
  float core = inside * (0.12 + 0.6 * sw * sw * (1.0 - r * 0.8));
  float sparks = inside * pow(0.5 + 0.5 * sin(a * 21.0 - uTime * 8.0 + r * 18.0), 24.0) * 0.9;
  float rim = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ang = uTime * (1.3 + fi * 0.4) + fi * 2.1;
    vec2 q = vec2(cos(ang), sin(ang));
    rim += exp(-dot(p - q, p - q) * 60.0);
  }
  vec3 col = uCol * (ring + core + sparks + uFlash * inside * 2.5) + vec3(1.0) * rim * 1.5;
  gl_FragColor = vec4(col * uOn, 1.0);
}`;

const MEMBRANE_FS = /* glsl */ `
uniform vec3 uCol;
uniform float uTime;
uniform float uFlash;
uniform float uOn;
uniform vec2 uSize;
uniform vec4 uG[4];
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float wv = 0.0;
  for (int i = 0; i < 4; i++) {
    if (uG[i].w <= 0.0) continue;
    float d = length(p - uG[i].xy);
    wv += sin(d * 16.0 - uTime * 9.0) * exp(-d * 0.9);
  }
  float lines = pow(0.5 + 0.5 * sin((p.x * 0.7 + p.y) * 18.0 + uTime * 1.5), 40.0) * 0.12;
  vec2 e = uSize * 0.5 - abs(p);
  float edge = exp(-min(e.x, e.y) * 25.0);
  float v = 0.04 + abs(wv) * 0.1 + lines + edge * 0.9 + uFlash * 0.8;
  gl_FragColor = vec4(uCol * v * uOn, 1.0);
}`;

const FINAL_FS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uCA;
uniform float uVig;
uniform float uGrain;
uniform float uSlow;
uniform float uRewind;
uniform float uGlitch;
uniform vec3 uFlash;
uniform vec4 uShock;
uniform vec4 uBH;
uniform float uBHOn;
uniform float uScan;
varying vec2 vUv;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float gl = uRewind * 0.6 + uGlitch;
  if (gl > 0.001) {
    float band = floor(uv.y * 48.0);
    float n = hash12(vec2(band, floor(uTime * 24.0)));
    uv.x += (n - 0.5) * 0.05 * gl * step(0.72, n);
    float roll = fract(uTime * 0.6);
    uv.x += uRewind * 0.012 * exp(-pow((uv.y - roll) * 28.0, 2.0)) * sin(uv.y * 400.0);
  }
  if (uShock.w > 0.0) {
    vec2 d = (uv - uShock.xy) * vec2(aspect, 1.0);
    float r = length(d);
    float k = exp(-pow((r - uShock.z) * 16.0, 2.0)) * uShock.w;
    uv -= (d / max(r, 1e-4)) / vec2(aspect, 1.0) * k * 0.035;
  }
  float shadow = 1.0;
  float ringGlow = 0.0;
  if (uBHOn > 0.5) {
    vec2 d = (uv - uBH.xy) * vec2(aspect, 1.0);
    float r = max(length(d), 1e-4);
    float rh = uBH.z;
    float re = uBH.w;
    float fall = 1.0 - smoothstep(re * 2.5, re * 6.0, r);
    float nr = mix(r, r - re * re / r, fall);
    uv = uBH.xy + (d / r) * nr / vec2(aspect, 1.0);
    shadow = smoothstep(rh * 0.97, rh * 1.05, r);
    ringGlow = exp(-pow((r - rh * 1.12) / (rh * 0.07), 2.0));
  }
  vec2 c = uv - 0.5;
  float ca = uCA * (0.5 + dot(c, c) * 3.0) + uGlitch * 0.012 + uRewind * 0.006;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + c * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - c * ca).b;
  col *= shadow;
  col += vec3(1.0, 0.82, 0.55) * ringGlow * 1.6;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * vec3(0.65, 1.0, 1.25), uSlow * 0.6);
  col = mix(col, vec3(lum) * vec3(1.15, 0.85, 1.3), uRewind * 0.45);
  col += uRewind * 0.12 * (hash12(vUv * uRes + uTime * 60.0) - 0.5);
  col *= 1.0 - uScan * 0.07 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5708));
  col += uFlash;
  vec2 vc = (vUv - 0.5) * vec2(aspect * 0.8, 1.0);
  col *= mix(1.0, smoothstep(1.05, 0.2, length(vc)), uVig);
  col += (hash12(vUv * uRes + fract(uTime) * 97.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

const FINAL = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uCA: { value: 0.002 }, uVig: { value: 0.6 }, uGrain: { value: 0.028 }, uSlow: { value: 0 },
    uRewind: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: new THREE.Vector3() },
    uShock: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, uBH: { value: new THREE.Vector4(0.5, 0.5, 0.02, 0.05) },
    uBHOn: { value: 0 }, uScan: { value: 0.5 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: FINAL_FS,
};

// ---------------------------------------------------------------- helpers
function tunnelGeometry(zNear, zFar, segZ) {
  const pos = [];
  const wall = [];
  const idx = [];
  const walls = [[-1, -1, 1, -1], [-1, 1, 1, 1], [-1, -1, -1, 1], [1, -1, 1, 1]];
  const segU = 4;
  let base = 0;
  walls.forEach((w, wi) => {
    for (let j = 0; j <= segZ; j++) {
      const z = zNear + (zFar - zNear) * (j / segZ);
      for (let i = 0; i <= segU; i++) {
        const t = i / segU;
        pos.push(w[0] + (w[2] - w[0]) * t, w[1] + (w[3] - w[1]) * t, z);
        wall.push(wi);
      }
    }
    for (let j = 0; j < segZ; j++) {
      for (let i = 0; i < segU; i++) {
        const a = base + j * (segU + 1) + i;
        const b = a + 1;
        const c = a + segU + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    base += (segZ + 1) * (segU + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 1));
  g.setIndex(idx);
  return g;
}

function glowMat(warpOn, size, color) {
  return new THREE.ShaderMaterial({
    uniforms: { ...WU, uCol: { value: new THREE.Color(color || '#ffffff') }, uSize: { value: size }, uInt: { value: 1 }, uWarpOn: { value: warpOn ? 1 : 0 } },
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function paddleMat(colU, isPlayer) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...WU, uCol: colU, uBox: { value: new THREE.Vector2(PW / 2, PH / 2) }, uPlane: { value: new THREE.Vector2(PW + 0.5, PH + 0.5) },
      uHit: { value: new THREE.Vector3(0, 0, 9) }, uFlash: { value: 0 }, uStun: { value: 0 }, uShield: { value: 0 },
      uPlayer: { value: isPlayer ? 1 : 0 }, uBeat: PU.uBeat,
    },
    vertexShader: STD_VS, fragmentShader: PADDLE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

class Ribbon {
  constructor(max, width, warpOn, order) {
    this.max = max;
    this.pts = [];
    const n = max * 2;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.next = new Float32Array(n * 3);
    this.t = new Float32Array(n);
    const side = new Float32Array(n);
    for (let i = 0; i < max; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aPrev = new THREE.BufferAttribute(this.prev, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNext = new THREE.BufferAttribute(this.next, 3).setUsage(THREE.DynamicDrawUsage);
    this.aT = new THREE.BufferAttribute(this.t, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aPrev', this.aPrev);
    g.setAttribute('aNext', this.aNext);
    g.setAttribute('aT', this.aT);
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...WU, uCol: { value: new THREE.Color(1, 1, 1) }, uWidth: { value: width }, uAspect: { value: 1 }, uWarpOn: { value: warpOn ? 1 : 0 }, uInt: { value: 1 } },
      vertexShader: RIB_VS, fragmentShader: RIB_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }
  push(x, y, z) {
    const p = this.pts.length >= this.max ? this.pts.pop() : { x: 0, y: 0, z: 0 };
    p.x = x; p.y = y; p.z = z;
    this.pts.unshift(p);
  }
  clear() {
    this.pts.length = 0;
    this.geo.setDrawRange(0, 0);
  }
  commit(aspect) {
    this.mat.uniforms.uAspect.value = aspect;
    const P = this.pts;
    const n = P.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const a = P[i > 0 ? i - 1 : 0];
      const b = P[i < n - 1 ? i + 1 : n - 1];
      const t = i / (n - 1);
      for (let k = 0; k < 2; k++) {
        const v = i * 2 + k;
        const o = v * 3;
        this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
        this.prev[o] = a.x; this.prev[o + 1] = a.y; this.prev[o + 2] = a.z;
        this.next[o] = b.x; this.next[o + 1] = b.y; this.next[o + 2] = b.z;
        this.t[v] = t;
      }
    }
    this.aPos.needsUpdate = true;
    this.aPrev.needsUpdate = true;
    this.aNext.needsUpdate = true;
    this.aT.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
}

class Particles {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.base = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.cur = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...WU, uScale: { value: 500 } },
      vertexShader: PART_VS, fragmentShader: PART_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }
  spawn(x, y, z, vx, vy, vz, life, size, c, drag) {
    const i = this.cur;
    this.cur = (this.cur + 1) % this.n;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = c.r; this.col[k + 1] = c.g; this.col[k + 2] = c.b;
    this.life[i] = life;
    this.max[i] = life;
    this.base[i] = size;
    this.drag[i] = drag;
  }
  burst(x, y, z, count, c, speed, life, size, drag = 2.2) {
    for (let j = 0; j < count; j++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.25 + Math.random() * 0.75);
      this.spawn(x, y, z, r * Math.cos(th) * s, r * Math.sin(th) * s, u * s, life * (0.5 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.8), c, drag);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] *= d; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const a = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = a * a;
      this.size[i] = this.base[i] * (0.4 + 0.6 * a);
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}

class BallSlot {
  constructor(gfx) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...WU, uCol: { value: new THREE.Color() }, uGhost: { value: 0 }, uFlash: { value: 0 }, uRot: { value: 0 }, uAxis: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: CENTER_VS, fragmentShader: BALL_FS, transparent: true,
    });
    this.mesh = new THREE.Mesh(gfx.geoSphere, this.mat);
    this.mesh.renderOrder = 5;
    this.glowMat = glowMat(true, 1.6);
    this.glow = new THREE.Mesh(gfx.geoQuad, this.glowMat);
    this.glow.renderOrder = 6;
    this.trail = new Ribbon(18, 0.14, true, 4);
    this.retMat = new THREE.ShaderMaterial({
      uniforms: { ...WU, uCol: { value: new THREE.Color() }, uProg: { value: 0 }, uOn: { value: 1 } },
      vertexShader: STD_VS, fragmentShader: RET_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ret = new THREE.Mesh(gfx.geoQuad, this.retMat);
    this.ret.scale.set(2, 2, 1);
    this.ret.renderOrder = 11;
    for (const o of [this.mesh, this.glow, this.trail.mesh, this.ret]) {
      o.frustumCulled = false;
      o.visible = false;
      gfx.scene.add(o);
    }
    this.id = -1;
    this.tele = 0;
  }
  setVisible(v) {
    this.mesh.visible = v;
    this.glow.visible = v;
    this.trail.mesh.visible = v;
    if (!v) this.ret.visible = false;
  }
}

// ---------------------------------------------------------------- Gfx
export class Gfx {
  constructor(canvas, quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 600);
    this.camera.position.set(0, 0, 2.6);
    this.baseFov = 72;
    this.camZ = 2.6;
    this.hw = 2.5;
    this.hh = 1.7;
    this.geoQuad = new THREE.PlaneGeometry(1, 1);
    this.geoSphere = new THREE.SphereGeometry(1, 32, 20);
    this.f = { twist: 0, bh: 0, portals: 0, quantum: 0, grav: 0 };
    this.shake = 0; this.recoil = 0; this.glitch = 0; this.flashAmt = 0; this.caK = 0;
    this.flashCol = new THREE.Color();
    this.vertigo = 0; this.kickA = 0; this.kickT = 9; this.tilt = 0; this.slowV = 0; this.rewV = 0;
    this.shockT = 9;
    this.shockPos = new THREE.Vector2(0.5, 0.5);
    this.palKeys = ['uColA', 'uColB', 'uColC', 'uBg1', 'uBg2'];
    this.palFrom = {};
    this.palTo = {};
    this.palT = 1;
    for (const k of this.palKeys) {
      this.palFrom[k] = PU[k].value.clone();
      this.palTo[k] = PU[k].value.clone();
    }
    this.waves = [null, null, null, null];
    this.waveI = 0;
    this.imps = [null, null, null, null, null, null];
    this.impI = 0;
    this.pHit = { p: { x: 0, y: 0, t: 9, f: 0 }, a: { x: 0, y: 0, t: 9, f: 0 } };
    this.portalFl = [0, 0];
    this.memFl = 0;
    this.aiShieldFl = 0;
    this.tmpC = new THREE.Color();
    this.buildScene();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.72, 0.38, 0.72);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FINAL);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
  }

  buildScene() {
    const S = this.scene;
    // nebula sky
    this.bg = new THREE.Mesh(
      new THREE.SphereGeometry(300, 48, 24),
      new THREE.ShaderMaterial({ uniforms: { ...PU, uTime: WU.uTime }, vertexShader: BG_VS, fragmentShader: BG_FS, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    );
    this.bg.renderOrder = -10;
    this.bg.frustumCulled = false;
    S.add(this.bg);

    // tunnel
    const U = (this.tunnelU = {
      ...WU, ...PU,
      uHW: { value: 2.5 }, uHH: { value: 1.7 }, uAIZ: { value: -18 },
      uBalls: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uBallCol: { value: [0, 1, 2, 3].map(() => new THREE.Color()) },
      uWaves: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uWaveCol: { value: [0, 1, 2, 3].map(() => new THREE.Color()) },
      uImp: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, -1)) },
      uImpCol: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Color()) },
      uGrav: { value: new THREE.Vector2(0, -1) }, uGravOn: { value: 0 },
    });
    this.tunnel = new THREE.Mesh(
      tunnelGeometry(4.2, -24, 280),
      new THREE.ShaderMaterial({ uniforms: U, vertexShader: TUNNEL_VS, fragmentShader: TUNNEL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.tunnel.frustumCulled = false;
    this.tunnel.renderOrder = 0;
    S.add(this.tunnel);

    // paddles
    this.padP = new THREE.Mesh(this.geoQuad, paddleMat(PU.uColA, true));
    this.padA = new THREE.Mesh(this.geoQuad, paddleMat(PU.uColB, false));
    for (const p of [this.padP, this.padA]) {
      p.scale.set(PW + 0.5, PH + 0.5, 1);
      p.frustumCulled = false;
      S.add(p);
    }
    this.padP.renderOrder = 10;
    this.padA.renderOrder = 9;

    // balls
    this.slots = [0, 1, 2, 3].map(() => new BallSlot(this));

    // black hole accretion disk (the shadow + lensing happen in post)
    this.disk = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 3.4, 128, 3),
      new THREE.ShaderMaterial({
        uniforms: { ...WU, uColA: PU.uColA, uColB: PU.uColB, uOn: { value: 0 } },
        vertexShader: CENTER_VS, fragmentShader: DISK_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    this.disk.frustumCulled = false;
    this.disk.renderOrder = 3;
    this.disk.visible = false;
    S.add(this.disk);

    // wormholes
    this.portals = ['#ffa31a', '#1ab8ff'].map((c) => {
      const mesh = new THREE.Mesh(
        this.geoQuad,
        new THREE.ShaderMaterial({
          uniforms: { ...WU, uCol: { value: new THREE.Color(c) }, uFlash: { value: 0 }, uOn: { value: 0 } },
          vertexShader: STD_VS, fragmentShader: PORTAL_FS,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.visible = false;
      S.add(mesh);
      return mesh;
    });

    // quantum membrane
    this.mem = new THREE.Mesh(
      this.geoQuad,
      new THREE.ShaderMaterial({
        uniforms: { ...WU, uCol: PU.uColB, uFlash: { value: 0 }, uOn: { value: 0 }, uSize: { value: new THREE.Vector2(5, 3.4) }, uG: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) } },
        vertexShader: STD_VS, fragmentShader: MEMBRANE_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    this.mem.frustumCulled = false;
    this.mem.renderOrder = 1;
    this.mem.visible = false;
    S.add(this.mem);

    // your pulse shots (live in visual space) and the enemy's glitch bolts (physical)
    this.shotVis = [];
    for (let i = 0; i < 10; i++) {
      const trail = new Ribbon(3, 0.045, false, 12);
      const gm = glowMat(false, 0.55);
      const glow = new THREE.Mesh(this.geoQuad, gm);
      glow.renderOrder = 13;
      glow.frustumCulled = false;
      trail.mesh.visible = false;
      glow.visible = false;
      S.add(trail.mesh, glow);
      this.shotVis.push({ trail, glow, gm });
    }
    this.boltVis = [];
    for (let i = 0; i < 4; i++) {
      const trail = new Ribbon(12, 0.12, true, 12);
      trail.mat.uniforms.uCol.value.set('#ff2a44');
      const gm = glowMat(true, 1.0, '#ff3355');
      const glow = new THREE.Mesh(this.geoQuad, gm);
      glow.renderOrder = 13;
      glow.frustumCulled = false;
      trail.mesh.visible = false;
      glow.visible = false;
      S.add(trail.mesh, glow);
      this.boltVis.push({ trail, glow, gm, id: -1 });
    }

    this.particles = new Particles(2600);
    S.add(this.particles.points);
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.pr = Math.min(dpr, q >= 2 ? 1.6 : q === 1 ? 1.1 : 0.75);
    this.renderer.setPixelRatio(this.pr);
    this.composer.setPixelRatio(this.pr);
    this.resize();
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.final.uniforms.uRes.value.set(w * this.pr, h * this.pr);
  }

  // ---- events from the game
  col(k) {
    if (k === 'a') return PU.uColA.value;
    if (k === 'b') return PU.uColB.value;
    if (k === 'c') return PU.uColC.value;
    return this.tmpC.set(k);
  }
  setDim(dim) {
    this.setPalette(dim.pal);
  }
  setPalette(pal) {
    for (const k of this.palKeys) this.palFrom[k].copy(PU[k].value);
    this.palTo.uColA.set(pal.a);
    this.palTo.uColB.set(pal.b);
    this.palTo.uColC.set(pal.c);
    this.palTo.uBg1.set(pal.bg1);
    this.palTo.uBg2.set(pal.bg2);
    this.palT = 0;
  }
  burst(x, y, z, n, c, speed, life, size, drag) {
    this.particles.burst(x, y, z, n, this.col(c), speed, life, size, drag);
  }
  wave(z, c) {
    this.waves[this.waveI++ % 4] = { z, t: 0, c: this.col(c).clone() };
  }
  impact(x, y, z, c) {
    this.imps[this.impI++ % 6] = { x, y, z, t: 0, c: this.col(c).clone() };
  }
  paddleHit(side, lx, ly) {
    const h = this.pHit[side];
    h.x = lx;
    h.y = ly;
    h.t = 0;
    h.f = 1;
  }
  shakeIt(a) { this.shake = Math.min(1, Math.max(this.shake, a)); }
  flash(c, amt) { this.flashCol.copy(this.col(c)); this.flashAmt = Math.max(this.flashAmt, amt); }
  glitchIt(a) { this.glitch = Math.max(this.glitch, a); }
  caKick(a) { this.caK = Math.min(0.03, this.caK + a); }
  kick() {
    if (this.f.twist > 0.2) {
      this.kickA = (Math.random() < 0.5 ? -1 : 1) * 0.35;
      this.kickT = 0;
    }
  }
  vertigoPulse() { this.vertigo = 1; }
  recoilIt() { this.recoil = 1; }
  portalFlash(i) { this.portalFl[i] = 1; }
  membraneFlash() { this.memFl = 1; }
  aiShield() { this.aiShieldFl = 1; }
  shockAt(x, y, z) {
    warpP(x, y, z, TMP);
    V3.set(TMP.x, TMP.y, TMP.z).project(this.camera);
    this.shockPos.set(V3.x * 0.5 + 0.5, V3.y * 0.5 + 0.5);
    this.shockT = 0;
  }
  clearTrails() {
    for (const s of this.slots) s.trail.clear();
  }

  // ---- per-frame sync of everything visible with the game state
  sync(G, rdt, beat) {
    const W = G.W;
    if (!W) return;
    const cam = this.camera;
    const t = WU.uTime.value;
    const st = W.t;
    const aspect = cam.aspect;
    PU.uBeat.value = beat;

    if (this.palT < 1) {
      this.palT = Math.min(1, this.palT + rdt / 1.6);
      const e = this.palT * this.palT * (3 - 2 * this.palT);
      for (const k of this.palKeys) PU[k].value.copy(this.palFrom[k]).lerp(this.palTo[k], e);
    }
    const kk = 1 - Math.exp(-rdt * 3);
    this.hw += (W.hw - this.hw) * kk;
    this.hh += (W.hh - this.hh) * kk;

    const m = W.mech;
    const f = this.f;
    f.twist = approach(f.twist, m.twist ? 1 : 0, rdt * 0.7);
    f.bh = approach(f.bh, m.bh ? 1 : 0, rdt * 1.2);
    f.portals = approach(f.portals, m.portals ? 1 : 0, rdt * 1.5);
    f.quantum = approach(f.quantum, m.quantum ? 1 : 0, rdt * 1.5);
    f.grav = approach(f.grav, m.gravity ? 1 : 0, rdt * 1.5);

    // ---- space warp (driven by simulation time, so a rewind rewinds space too)
    this.kickT += rdt;
    const tw = f.twist;
    WU.uTwist.value = tw * (1.6 * Math.sin(st * 0.33) + 0.45 * Math.sin(st * 0.71 + 1.0)) + this.kickA * Math.exp(-this.kickT * 2.8) * Math.sin(this.kickT * 13);
    WU.uBendX.value = tw * 0.42 * Math.sin(st * 0.21);
    WU.uBendY.value = tw * 0.3 * Math.sin(st * 0.27 + 1.0);
    WU.uBreath.value = 0.025 + tw * 0.1;
    this.vertigo = Math.max(0, this.vertigo - rdt * 0.85);
    const vp = Math.sin(Math.min(1, this.vertigo) * Math.PI);
    WU.uStretch.value = 0.6 * vp;
    WU.uL.value = W.L;

    // ---- camera: rides behind your paddle, rolls with gravity
    const tanH = Math.tan((this.baseFov * Math.PI) / 360);
    const need = Math.max((this.hw + 0.12) / (tanH * aspect), (this.hh + 0.12) / tanH);
    this.camZ += (Math.max(2.3, need) - this.camZ) * (1 - Math.exp(-rdt * 3));
    W.missZ = this.camZ - 0.45;
    this.shake = Math.max(0, this.shake - rdt * 1.6);
    const sh = this.shake * this.shake * 0.8;
    this.recoil = Math.max(0, this.recoil - rdt * 6);
    const P = G.P;
    this.tilt += (clamp(-P.vx * 0.0035, -0.06, 0.06) - this.tilt) * (1 - Math.exp(-rdt * 6));
    const roll = G.roll + this.tilt;
    cam.position.set(P.x * 0.26 + (Math.random() - 0.5) * sh, P.y * 0.26 + (Math.random() - 0.5) * sh, this.camZ + this.recoil * 0.12);
    cam.up.set(-Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(P.x * 0.07, P.y * 0.07, -W.L);
    const fov = this.baseFov + vp * 22;
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.bg.position.copy(cam.position);

    // ---- tunnel
    const TU = this.tunnelU;
    TU.uHW.value = this.hw;
    TU.uHH.value = this.hh;
    TU.uAIZ.value = -W.L;
    TU.uGravOn.value = f.grav;
    TU.uGrav.value.set(Math.sin(W.grav.ang), -Math.cos(W.grav.ang));
    for (let i = 0; i < 4; i++) {
      const w = this.waves[i];
      const u = TU.uWaves.value[i];
      if (w) {
        w.t += rdt;
        u.set(w.z, w.t, w.t < 1.6 ? 1 : 0, 0);
        TU.uWaveCol.value[i].copy(w.c);
      } else u.set(0, 0, 0, 0);
    }
    for (let i = 0; i < 6; i++) {
      const im = this.imps[i];
      const u = TU.uImp.value[i];
      if (im) {
        im.t += rdt;
        u.set(im.x, im.y, im.z, im.t);
        TU.uImpCol.value[i].copy(im.c);
      } else u.set(0, 0, 0, -1);
    }

    // ---- paddles
    const hp = this.pHit.p;
    hp.t += rdt;
    hp.f = Math.max(0, hp.f - rdt * 4);
    this.padP.position.set(P.x, P.y, this.recoil * 0.04);
    const uP = this.padP.material.uniforms;
    uP.uHit.value.set(hp.x, hp.y, hp.t);
    uP.uFlash.value = hp.f;
    uP.uStun.value = G.invertT > 0 ? 0.6 : 0;
    const ha = this.pHit.a;
    ha.t += rdt;
    ha.f = Math.max(0, ha.f - rdt * 4);
    this.padA.position.set(W.ai.x, W.ai.y, -W.L);
    const uA = this.padA.material.uniforms;
    uA.uHit.value.set(ha.x, ha.y, ha.t);
    uA.uFlash.value = ha.f;
    uA.uStun.value = W.ai.stun > 0 ? 1 : 0;
    this.aiShieldFl = Math.max(0, this.aiShieldFl - rdt * 3);
    uA.uShield.value = Math.max(W.ai.immune > 0 && W.ai.stun <= 0 ? 0.35 : 0, this.aiShieldFl);

    // ---- balls
    const balls = W.balls;
    for (const s of this.slots) {
      if (s.id < 0) continue;
      let found = false;
      for (const b of balls) if (b.id === s.id && b.alive) found = true;
      if (!found) s.id = -1;
    }
    for (const b of balls) {
      if (!b.alive) continue;
      let has = false;
      for (const s of this.slots) if (s.id === b.id) has = true;
      if (has) continue;
      const s = this.slots.find((x) => x.id < 0);
      if (s) {
        s.id = b.id;
        s.trail.clear();
        s.tele = b.tele;
      }
    }
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i];
      const ub = TU.uBalls.value[i];
      const b = s.id >= 0 ? balls.find((x) => x.id === s.id) : null;
      if (!b) {
        s.setVisible(false);
        ub.set(0, 0, 0, 0);
        continue;
      }
      s.setVisible(true);
      const colr = b.owner === 'p' ? PU.uColA.value : PU.uColB.value;
      s.mesh.position.set(b.x, b.y, b.z);
      s.mesh.scale.setScalar(BALL_R);
      const u = s.mat.uniforms;
      u.uCol.value.copy(colr).lerp(WHITE, 0.15);
      u.uGhost.value = b.ghost ? 1 : 0;
      s.mat.depthWrite = !b.ghost;
      b.flash = Math.max(0, b.flash - rdt * 3);
      u.uFlash.value = b.flash;
      u.uRot.value = b.rot;
      const sm = Math.hypot(b.sx, b.sy);
      if (sm > 0.05) u.uAxis.value.set(-b.sy / sm, b.sx / sm, 0);
      s.glow.position.copy(s.mesh.position);
      const gu = s.glowMat.uniforms;
      gu.uCol.value.copy(colr);
      const nearK = 0.35 + 0.65 * clamp((-b.z - 0.4) / 4.5, 0, 1);
      gu.uSize.value = (b.ghost ? 0.9 : 1.3) * (0.6 + 0.4 * nearK);
      gu.uInt.value = (b.ghost ? 0.45 : 1 + b.flash) * nearK;
      if (b.tele !== s.tele) {
        s.trail.clear();
        s.tele = b.tele;
      }
      if (b.held) s.trail.clear();
      else if (rdt > 0) s.trail.push(b.x, b.y, Math.min(b.z, this.camZ - 0.35));
      s.trail.mat.uniforms.uCol.value.copy(colr);
      s.trail.mat.uniforms.uInt.value = b.ghost ? 0.4 : 1;
      s.trail.commit(aspect);
      ub.set(b.x, b.y, b.z, b.ghost ? 0.3 : 1);
      TU.uBallCol.value[i].copy(colr);
      if (b.vz > 0 && !b.passP && !b.held) {
        s.ret.visible = true;
        s.ret.position.set(b.x, b.y, 0.01);
        const ru = s.retMat.uniforms;
        ru.uProg.value = clamp(1 + b.z / W.L, 0, 1);
        ru.uCol.value.copy(colr);
        ru.uOn.value = b.ghost ? 0.5 : 1;
      } else s.ret.visible = false;
    }

    // ---- black hole
    const FU = this.final.uniforms;
    const fb = f.bh;
    this.disk.visible = fb > 0.01;
    FU.uBHOn.value = 0;
    if (fb > 0.01) {
      this.disk.position.set(W.bh.x, W.bh.y, W.bh.z);
      this.disk.scale.setScalar(BH_R * fb);
      this.disk.rotation.set(1.15 + Math.sin(st * 0.2) * 0.15, 0.3, st * 0.05);
      this.disk.material.uniforms.uOn.value = fb;
      warpP(W.bh.x, W.bh.y, W.bh.z, TMP);
      V3.set(TMP.x, TMP.y, TMP.z).applyMatrix4(cam.matrixWorldInverse);
      const depth = -V3.z;
      if (depth > 0.3) {
        V3.applyMatrix4(cam.projectionMatrix);
        const rh = (BH_R * fb * cam.projectionMatrix.elements[5]) / (2 * depth);
        FU.uBH.value.set(V3.x * 0.5 + 0.5, V3.y * 0.5 + 0.5, rh, rh * 2.6);
        FU.uBHOn.value = 1;
      }
    }

    // ---- wormholes
    const fp = f.portals;
    for (let i = 0; i < 2; i++) {
      const p = W.portals[i];
      const mesh = this.portals[i];
      mesh.visible = fp > 0.01;
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.setScalar(PORTAL_R * 2 * 1.35 * (0.3 + 0.7 * fp));
      this.portalFl[i] = Math.max(0, this.portalFl[i] - rdt * 2.5);
      const u = mesh.material.uniforms;
      u.uOn.value = fp;
      u.uFlash.value = this.portalFl[i];
    }

    // ---- quantum membrane
    const fq = f.quantum;
    this.mem.visible = fq > 0.01;
    this.mem.position.set(0, 0, -W.L / 2);
    this.mem.scale.set(this.hw * 2, this.hh * 2, 1);
    const mu = this.mem.material.uniforms;
    mu.uSize.value.set(this.hw * 2, this.hh * 2);
    mu.uOn.value = fq;
    this.memFl = Math.max(0, this.memFl - rdt * 2.5);
    mu.uFlash.value = this.memFl;
    let gi = 0;
    for (const b of balls) if (b.alive && b.ghost && gi < 4) mu.uG.value[gi++].set(b.x, b.y, 0, 1);
    for (; gi < 4; gi++) mu.uG.value[gi].set(0, 0, 0, 0);

    // ---- pulse shots
    for (let i = 0; i < this.shotVis.length; i++) {
      const v = this.shotVis[i];
      const s = G.shots[i];
      if (!s) {
        v.trail.mesh.visible = false;
        v.glow.visible = false;
        continue;
      }
      v.trail.mesh.visible = true;
      v.glow.visible = true;
      const hx = s.ox + s.dx * s.s;
      const hy = s.oy + s.dy * s.s;
      const hz = s.oz + s.dz * s.s;
      const ts = Math.max(s.s0, s.s - 3.0);
      const tx = s.ox + s.dx * ts;
      const ty = s.oy + s.dy * ts;
      const tz = s.oz + s.dz * ts;
      v.trail.pts.length = 0;
      v.trail.push(tx, ty, tz);
      v.trail.push((tx + hx) * 0.5, (ty + hy) * 0.5, (tz + hz) * 0.5);
      v.trail.push(hx, hy, hz);
      v.trail.mat.uniforms.uCol.value.copy(PU.uColA.value);
      v.trail.commit(aspect);
      v.glow.position.set(hx, hy, hz);
      v.gm.uniforms.uCol.value.copy(PU.uColA.value);
    }

    // ---- enemy glitch bolts
    for (let i = 0; i < this.boltVis.length; i++) {
      const v = this.boltVis[i];
      const o = W.bolts[i];
      if (!o || !o.alive) {
        v.trail.mesh.visible = false;
        v.glow.visible = false;
        v.id = -1;
        continue;
      }
      if (v.id !== o.id) {
        v.trail.clear();
        v.id = o.id;
      }
      v.trail.mesh.visible = true;
      v.glow.visible = true;
      if (rdt > 0) v.trail.push(o.x, o.y, Math.min(o.z, this.camZ - 0.35));
      v.trail.commit(aspect);
      v.glow.position.set(o.x, o.y, o.z);
      v.gm.uniforms.uSize.value = 0.9 + 0.25 * Math.sin(t * 30);
    }

    // ---- particles
    this.particles.update(rdt * Math.max(0.3, G.timeScale));
    this.particles.mat.uniforms.uScale.value = (this.renderer.domElement.height / 2) * cam.projectionMatrix.elements[5];

    // ---- post
    FU.uTime.value = t;
    this.caK *= Math.exp(-rdt * 6);
    FU.uCA.value = 0.0018 + this.caK + (G.chronoOn ? 0.004 : 0);
    this.slowV = approach(this.slowV, G.chronoOn || G.state === 'missWindow' ? 1 : 0, rdt * 4);
    FU.uSlow.value = this.slowV;
    this.rewV = approach(this.rewV, G.state === 'rewind' ? 1 : 0, rdt * 5);
    FU.uRewind.value = this.rewV;
    this.glitch = Math.max(0, this.glitch - rdt * 1.6);
    FU.uGlitch.value = this.glitch + (G.invertT > 0 ? 0.18 : 0);
    this.flashAmt = Math.max(0, this.flashAmt - rdt * 2.2);
    FU.uFlash.value.set(this.flashCol.r * this.flashAmt, this.flashCol.g * this.flashAmt, this.flashCol.b * this.flashAmt);
    this.shockT += rdt;
    FU.uShock.value.set(this.shockPos.x, this.shockPos.y, this.shockT * 0.9, this.shockT < 0.9 ? 1 - this.shockT / 0.9 : 0);
  }

  render() {
    this.composer.render();
  }
}
