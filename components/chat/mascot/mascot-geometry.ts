"use client";

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Procedural Qube body + fixed eye placement.
//
// The draft this is based on had the eyes off-center (x = -0.15 / +0.35,
// both pushed to the right of the face — visible in the reference render).
// Fixed: symmetric ±EYE_X, centered on the face, seated on the front shell.
// ---------------------------------------------------------------------------

export const MASCOT = {
  halfW: 1.05,
  halfH: 0.925,
  halfD: 0.9,
  exp: 4.2,
  // FIXED eye layout (was -0.15 / +0.35 — asymmetric).
  eyeX: 0.26,
  eyeY: 0.16,
  eyeZ: 0.92,
  eyeSX: 0.19,
  eyeSY: 0.31,
  eyeSZ: 0.12,
} as const;

export function buildBodyGeometry(): THREE.BufferGeometry {
  const sub = 48; // 80 in the draft is overkill for a 32px logo
  const geom = new THREE.BoxGeometry(1, 1, 1, sub, sub, sub);
  const pos = geom.attributes.position;
  const vertex = new THREE.Vector3();
  const { halfW, halfH, halfD, exp } = MASCOT;
  const b = 1;
  const belly = -0.2;
  const crown = 0.12;
  const squish = 0.15;

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    const px = vertex.x * 2;
    const py = vertex.y * 2;
    const pz = vertex.z * 2;
    const absX = Math.abs(px);
    const absY = Math.abs(py);
    const absZ = Math.abs(pz);
    const lengthSq =
      Math.pow(absX, exp) + Math.pow(absY, exp) + Math.pow(absZ, exp);
    const superFactor =
      lengthSq > 0.00001 ? Math.pow(lengthSq, -1 / exp) : 1;

    const finalX = px * (1 - b + superFactor * b);
    const finalY = py * (1 - b + superFactor * b);
    const finalZ = pz * (1 - b + superFactor * b);

    let wx = finalX * halfW;
    let wy = finalY * halfH;
    let wz = finalZ * halfD;

    if (wx < 0) wx -= Math.abs(wx / halfW) * belly * 0.35 * halfW;
    if (wy > 0)
      wy +=
        (1 -
          Math.min(
            1,
            Math.pow(wx / halfW, 2) * 0.4 + Math.pow(wz / halfD, 2) * 0.4,
          )) *
        crown *
        0.4 *
        halfH;
    if (wy < 0) wy *= 1 - squish * 0.15;
    if (wz > 0)
      wz +=
        Math.max(
          0,
          (1 - Math.pow(wx / halfW, 2)) * (1 - Math.pow(wy / halfH, 2)),
        ) *
        0.12 *
        halfD;

    pos.setXYZ(i, wx, wy, wz);
  }
  geom.computeVertexNormals();
  return geom;
}

export function buildEyeGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 24, 24);
  g.scale(MASCOT.eyeSX, MASCOT.eyeSY, MASCOT.eyeSZ);
  g.computeVertexNormals();
  return g;
}
