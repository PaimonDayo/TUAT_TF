import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, crc32, uniqueSheetNames } from "./xlsx-writer";

/** Reads the stored (uncompressed) entries back through the central directory. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true), offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 8, true)).toBe(0);
    const start = offset + 30 + view.getUint16(offset + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    files.set(name, new TextDecoder().decode(data));
    at += 46 + nameLength;
  }
  return files;
}

describe("xlsx writer", () => {
  it("uses the standard ZIP CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("names columns past Z", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("keeps sheet names within Excel's rules", () => {
    expect(uniqueSheetNames(["100m", "100M", "a/b:c", "", "x".repeat(40), "x".repeat(40)]))
      .toEqual(["100m", "100M_2", "a・b・c", "シート", "x".repeat(31), "x".repeat(29) + "_2"]);
  });

  it("writes one worksheet per sheet with a frozen bold header and literal text", () => {
    const files = unzip(buildXlsx([
      { name: "100m", widths: [10, 18], rows: [["組", "氏名"], ["男子1組", "=HYPERLINK(\"x\")"], [3, null], ["a<b&c\u0007", ""]] },
      { name: "走り高跳び", rows: [["試技順"]] },
    ]));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="100m" sheetId="1" r:id="rId1"/><sheet name="走り高跳び" sheetId="2" r:id="rId2"/>');
    expect(files.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<col min="2" max="2" width="18" customWidth="1"/>');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">組</t></is></c>');
    // Formula-looking names stay text: there is no <f> element anywhere.
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t></is></c>');
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<row r="3"><c r="A3"><v>3</v></c></row>');
    expect(sheet).toContain("a&lt;b&amp;c</t>");
    expect(sheet).toContain('<row r="4"><c r="A4" t="inlineStr">');
    expect(files.get("xl/worksheets/sheet2.xml")).not.toContain("tabSelected");
  });

  it("refuses an empty workbook", () => {
    expect(() => buildXlsx([])).toThrow();
  });
});
