import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectBotWall, BOT_CHECK_HINT } from "../lib/browser/bot-wall";

describe("bot-wall detection", () => {
  it("recognizes Cloudflare's 'Just a moment...' interstitial", () => {
    const wall = detectBotWall(
      "Title: Just a moment...\n\nnopecha.com\nPerforming security verification\n\nThis website uses a security service to protect against malicious bots.",
    );
    assert.equal(wall?.vendor, "cloudflare");
  });

  it("recognizes the visible Cloudflare checkbox text", () => {
    assert.equal(detectBotWall('Verify you are human\nCloudflare\nPrivacy • Help')?.vendor, "cloudflare");
  });

  it("recognizes a reCAPTCHA widget, not an article that mentions it", () => {
    assert.equal(detectBotWall("Please complete the reCAPTCHA. I'm not a robot")?.vendor, "recaptcha");
    assert.equal(
      detectBotWall("A history of reCAPTCHA and how CAPTCHAs became invisible in modern web design."),
      null,
    );
  });

  it("recognizes hCaptcha, DataDome, AWS WAF and Akamai", () => {
    assert.equal(detectBotWall("hCaptcha\nI am human\nVerify")?.vendor, "hcaptcha");
    assert.equal(detectBotWall('<script src="https://ct.captcha-delivery.com/c.js"></script>')?.vendor, "datadome");
    assert.equal(detectBotWall("In order to continue, verify you're not a robot. gokuProps")?.vendor, "awswaf");
    assert.equal(detectBotWall("bm-verify: Access denied")?.vendor, "akamai");
  });

  it("does not flag ordinary pages", () => {
    assert.equal(detectBotWall("Example Domain\nThis domain is for use in documentation examples."), null);
    assert.equal(detectBotWall("Checkout\nPlace order\nTotal: $42.00"), null);
    assert.equal(detectBotWall(""), null);
  });

  it("tells the model to hand off instead of retrying", () => {
    assert.match(BOT_CHECK_HINT, /BOT CHECK DETECTED/i);
    assert.match(BOT_CHECK_HINT, /Browser panel/i);
    assert.match(BOT_CHECK_HINT, /do not replay/i);
  });
});
