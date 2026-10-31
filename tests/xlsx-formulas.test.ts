/**
 * Spreadsheet formula recovery.
 *
 * SheetJS drops formula cells that carry no cached value — exactly what
 * openpyxl (and Qube's own writer) produce — so formulas are re-read from the
 * sheet XML. These tests lock that behaviour, including shared formulas and
 * the reference translation Excel relies on.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import { extractSheetFormulas, splitRef, translateFormula } from "@/lib/workspace/xlsx-formulas";

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Q1 &amp; Q2" sheetId="1" r:id="rId1"/>
    <sheet name="Empty" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

const SHEET1 = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="n"><v>2</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Apples</t></is></c><c r="D2"><f>B2*C2</f><v></v></c></row>
    <row r="3"><c r="D3"><f t="shared" si="0" ref="D3:D4">B3*C3</f><v></v></c></row>
    <row r="4"><c r="D4"><f t="shared" si="0"/><v></v></c></row>
    <row r="5"><c r="D5"><f>SUM(D2:D4)&amp;""</f><v></v></c></row>
    <row r="6"><c r="B6" t="n"><v>7</v></c></row>
  </sheetData>
</worksheet>`;

const SHEET2 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

async function buildZip(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", WORKBOOK);
  zip.file("xl/_rels/workbook.xml.rels", RELS);
  zip.file("xl/worksheets/sheet1.xml", SHEET1);
  zip.file("xl/worksheets/sheet2.xml", SHEET2);
  return zip;
}

describe("xlsx formula recovery", () => {
  it("reads formulas that have no cached value", async () => {
    const formulas = await extractSheetFormulas(await buildZip());
    assert.deepEqual(formulas["Q1 & Q2"], {
      "1:3": "=B2*C2",
      "2:3": "=B3*C3",
      "3:3": "=B4*C4",
      "4:3": '=SUM(D2:D4)&""',
    });
  });

  it("expands shared formulas relative to their master cell", async () => {
    const formulas = await extractSheetFormulas(await buildZip());
    assert.equal(formulas["Q1 & Q2"]["3:3"], "=B4*C4");
  });

  it("skips sheets with no formulas and decodes xml entities", async () => {
    const formulas = await extractSheetFormulas(await buildZip());
    assert.equal(formulas["Empty"], undefined);
    assert.ok(formulas["Q1 & Q2"]["4:3"].includes('&""'));
  });

  it("returns an empty map for a zip without a workbook", async () => {
    assert.deepEqual(await extractSheetFormulas(new JSZip()), {});
  });
});

describe("A1 references", () => {
  it("parses and normalises cell refs", () => {
    assert.deepEqual(splitRef("A1"), { row: 0, col: 0 });
    assert.deepEqual(splitRef("AA10"), { row: 9, col: 26 });
    assert.equal(splitRef("1A"), null);
    assert.equal(splitRef(""), null);
  });

  it("shifts relative references only", () => {
    assert.equal(translateFormula("B2*C2", 1, 0), "B3*C3");
    assert.equal(translateFormula("B2*C2", 0, 1), "C2*D2");
    assert.equal(translateFormula("$B$2*C2", 1, 1), "$B$2*D3");
    assert.equal(translateFormula("$B2+C$2", 2, 2), "$B4+E$2");
  });

  it("leaves function names and strings alone", () => {
    assert.equal(translateFormula('SUM(A1:A3)+IF(B1>2,"ok","no")', 1, 0), 'SUM(A2:A4)+IF(B2>2,"ok","no")');
    assert.equal(translateFormula("LOG10(100)", 1, 0), "LOG10(100)");
  });

  it("is a no-op for a zero delta", () => {
    assert.equal(translateFormula("A1+B2", 0, 0), "A1+B2");
  });
});
