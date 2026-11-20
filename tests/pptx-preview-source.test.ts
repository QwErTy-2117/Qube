import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import {
  preparePptxForPreview,
  pptxFontStack,
} from "../lib/workspace/pptx-preview-source";

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

const MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
</p:sldMaster>`;

const SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r>
              <a:rPr sz="2100">
                <a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>
                <a:latin typeface="Calibri"/><a:ea typeface=""/>
              </a:rPr>
              <a:t>Body text</a:t>
            </a:r>
          </a:p>
          <a:p>
            <a:r>
              <a:rPr sz="2100">
                <a:solidFill><a:schemeClr val="lt2"><a:shade val="80000"/></a:schemeClr></a:solidFill>
                <a:latin typeface="+mj-lt"/>
              </a:rPr>
              <a:t>Title text</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

async function makePptx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/slideMasters/slideMaster1.xml", MASTER);
  zip.file("ppt/slides/slide1.xml", SLIDE);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

describe("pptx preview source normalisation", () => {
  it("rewrites theme colours with their DrawingML transforms", async () => {
    const input = await makePptx();
    const prepared = await preparePptxForPreview(input);
    const zip = await JSZip.loadAsync(prepared.buffer);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");

    // accent1 #4F81BD with lumMod 75% -> #376092.
    assert.match(slide, /<a:srgbClr val="376092">/);
    // lt2 #EEECE1 with shade 80% -> #BEBDB4.
    assert.match(slide, /<a:srgbClr val="BEBDB4">/);
    assert.doesNotMatch(slide, /a:schemeClr/);
  });

  it("gives Latin runs an East Asian typeface so the renderer uses the real font", async () => {
    const input = await makePptx();
    const prepared = await preparePptxForPreview(input);
    const zip = await JSZip.loadAsync(prepared.buffer);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");

    assert.match(slide, /<a:latin typeface="Calibri"\/><a:ea typeface="Calibri"\/>/);
    // +mj-lt resolves to the theme's major font (Calibri here).
    assert.match(slide, /<a:latin typeface="\+mj-lt"\/><a:ea typeface="Calibri"\/>/);
    assert.doesNotMatch(slide, /<a:ea\b[^>]*typeface=""[^>]*\/>/);
  });

  it("returns the theme fonts for inherited text", async () => {
    const prepared = await preparePptxForPreview(await makePptx());
    assert.equal(prepared.majorFont, "Calibri");
    assert.equal(prepared.minorFont, "Calibri");
  });

  it("builds a font stack without duplicating the primary font", () => {
    assert.equal(
      pptxFontStack("Calibri"),
      '"Calibri", Carlito, "Liberation Sans", sans-serif',
    );
    assert.equal(
      pptxFontStack("Cambria"),
      '"Cambria", Calibri, Carlito, "Liberation Sans", sans-serif',
    );
    assert.match(pptxFontStack(null), /^"Calibri"/);
  });

  it("returns the original buffer when the archive is not a pptx", async () => {
    const input = new TextEncoder().encode("not a zip").buffer;
    const prepared = await preparePptxForPreview(input);
    assert.equal(prepared.buffer, input);
    assert.equal(prepared.majorFont, null);
    assert.equal(prepared.minorFont, null);
  });
});