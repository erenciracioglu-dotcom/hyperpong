// HYPERPONG — shared space warp.
// Physics lives in a straight box tunnel. Everything is *rendered* through this
// deformation (twist / bend / breathing / stretch). It is the identity at the
// player's paddle plane (z = 0), so what you control always feels honest, while
// the far end of the tunnel is free to lie to your eyes.

export const WU = {
  uTwist: { value: 0 },
  uBendX: { value: 0 },
  uBendY: { value: 0 },
  uBreath: { value: 0 },
  uStretch: { value: 0 },
  uL: { value: 18 },
  uTime: { value: 0 },
};

export const WARP_GLSL = /* glsl */ `
uniform float uTwist;
uniform float uBendX;
uniform float uBendY;
uniform float uBreath;
uniform float uStretch;
uniform float uL;
uniform float uTime;
vec3 warp(vec3 p) {
  float s = clamp(-p.z / uL, 0.0, 1.25);
  float w = s * s;
  float br = 1.0 + uBreath * s * sin(uTime * 2.2 + p.z * 0.55);
  p.xy *= br;
  float a = uTwist * w;
  float c = cos(a);
  float sn = sin(a);
  p.xy = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y);
  p.x += uBendX * w * uL * 0.22;
  p.y += uBendY * w * uL * 0.22;
  p.z *= 1.0 + uStretch * s;
  return p;
}
`;

// CPU mirror of warp() — must stay identical to the GLSL above.
export function warpP(x, y, z, o) {
  const L = WU.uL.value;
  let s = -z / L;
  s = s < 0 ? 0 : s > 1.25 ? 1.25 : s;
  const w = s * s;
  const br = 1 + WU.uBreath.value * s * Math.sin(WU.uTime.value * 2.2 + z * 0.55);
  x *= br;
  y *= br;
  const a = WU.uTwist.value * w;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  o.x = c * x - sn * y + WU.uBendX.value * w * L * 0.22;
  o.y = sn * x + c * y + WU.uBendY.value * w * L * 0.22;
  o.z = z * (1 + WU.uStretch.value * s);
  return o;
}

// Inverse of warpP: visual space -> physics space.
export function warpInv(xv, yv, zv, o) {
  const L = WU.uL.value;
  const K = WU.uStretch.value;
  let z;
  if (zv >= 0 || Math.abs(K) < 1e-6) z = zv;
  else {
    const lim = -1.25 * L * (1 + 1.25 * K);
    if (zv <= lim) z = zv / (1 + 1.25 * K);
    else {
      const q = K / L;
      z = (1 - Math.sqrt(Math.max(0, 1 - 4 * q * zv))) / (2 * q);
    }
  }
  let s = -z / L;
  s = s < 0 ? 0 : s > 1.25 ? 1.25 : s;
  const w = s * s;
  const x = xv - WU.uBendX.value * w * L * 0.22;
  const y = yv - WU.uBendY.value * w * L * 0.22;
  const a = -WU.uTwist.value * w;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const br = 1 + WU.uBreath.value * s * Math.sin(WU.uTime.value * 2.2 + z * 0.55);
  o.x = (c * x - sn * y) / br;
  o.y = (sn * x + c * y) / br;
  o.z = z;
  return o;
}
