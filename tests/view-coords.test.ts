import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mapToPage } from "../lib/browser/view-coords";

describe("view-coords: panel clicks map to page pixels", () => {
  it("maps 1:1 when the box matches the viewport", () => {
    assert.deepEqual(
      mapToPage(100, 200, { left: 0, top: 0, width: 1280, height: 900 }, { deviceWidth: 1280, deviceHeight: 900 }),
      { x: 100, y: 200 }
    );
  });
  it("accounts for downscale + letterbox bars", () => {
    // 1280x900 page drawn at 640x450 inside a 640x500 box (25px bars top/bottom).
    const p = mapToPage(320, 250, { left: 0, top: 0, width: 640, height: 500 }, { deviceWidth: 1280, deviceHeight: 900 });
    assert.deepEqual(p, { x: 640, y: 450 });
  });
  it("accounts for box offset on screen", () => {
    const p = mapToPage(110, 215, { left: 10, top: 15, width: 1280, height: 900 }, { deviceWidth: 1280, deviceHeight: 900 });
    assert.deepEqual(p, { x: 100, y: 200 });
  });
  it("returns null without viewport metrics or a real box", () => {
    assert.equal(mapToPage(1, 1, { left: 0, top: 0, width: 100, height: 100 }, null), null);
    assert.equal(mapToPage(1, 1, { left: 0, top: 0, width: 0, height: 0 }, { deviceWidth: 1280, deviceHeight: 900 }), null);
    assert.equal(mapToPage(1, 1, { left: 0, top: 0, width: 100, height: 100 }, { deviceWidth: 0, deviceHeight: 900 }), null);
  });
});
