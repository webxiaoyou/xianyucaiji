/**
 * XlsxLite: Minimal XLSX builder with inline images anchored to cells.
 * Only supports:
 * - One workbook, one worksheet
 * - Inline string cells
 * - Row heights and column widths
 * - Drawings with oneCellAnchor images (PNG/JPEG/WEBP)
 * - STORE (no compression) ZIP
 * Keep under ~400 LOC
 */
(function () {
  // UTF-8 encode string to Uint8Array
  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  // CRC32
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0 ^ -1;
    for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }

  // ZIP builder (STORE)
  function buildZip(files) {
    // files: [{path, bytes:Uint8Array}]
    let localParts = [];
    let centralParts = [];
    let offset = 0;

    function pushUint32(arr, n) {
      arr.push(n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF);
    }
    function pushUint16(arr, n) {
      arr.push(n & 0xFF, (n >>> 8) & 0xFF);
    }

    for (const f of files) {
      const nameBytes = utf8(f.path);
      const data = f.bytes;
      const crc = crc32(data);
      const comp = 0; // store
      const modTime = 0;
      const modDate = 0;

      // Local file header
      const local = [];
      pushUint32(local, 0x04034b50);
      pushUint16(local, 20); // version needed
      pushUint16(local, 0); // flags
      pushUint16(local, comp); // method
      pushUint16(local, modTime);
      pushUint16(local, modDate);
      pushUint32(local, crc);
      pushUint32(local, data.length);
      pushUint32(local, data.length);
      pushUint16(local, nameBytes.length);
      pushUint16(local, 0); // extra len

      const localHeader = new Uint8Array(local.length + nameBytes.length + data.length);
      localHeader.set(new Uint8Array(local), 0);
      localHeader.set(nameBytes, local.length);
      localHeader.set(data, local.length + nameBytes.length);
      localParts.push(localHeader);

      // Central directory header
      const central = [];
      pushUint32(central, 0x02014b50);
      pushUint16(central, 20); // version made by
      pushUint16(central, 20); // version needed
      pushUint16(central, 0); // flags
      pushUint16(central, comp);
      pushUint16(central, modTime);
      pushUint16(central, modDate);
      pushUint32(central, crc);
      pushUint32(central, data.length);
      pushUint32(central, data.length);
      pushUint16(central, nameBytes.length);
      pushUint16(central, 0); // extra len
      pushUint16(central, 0); // comment len
      pushUint16(central, 0); // disk start
      pushUint16(central, 0); // internal attrs
      pushUint32(central, 0); // external attrs
      pushUint32(central, offset);

      const centralHeader = new Uint8Array(central.length + nameBytes.length);
      centralHeader.set(new Uint8Array(central), 0);
      centralHeader.set(nameBytes, central.length);
      centralParts.push(centralHeader);

      offset += localHeader.length;
    }

    // End of central directory
    let centralSize = 0;
    for (const part of centralParts) centralSize += part.length;
    const centralOffset = offset;

    const eocd = [];
    function pushBytes(arr, bytes) { for (let b of bytes) arr.push(b); }

    // concat local parts
    let totalSize = offset + centralSize + 22;
    const out = new Uint8Array(totalSize);
    let p = 0;
    for (const part of localParts) { out.set(part, p); p += part.length; }
    for (const part of centralParts) { out.set(part, p); p += part.length; }

    const end = [];
    pushUint32(end, 0x06054b50);
    pushUint16(end, 0); // disk number
    pushUint16(end, 0); // start disk
    pushUint16(end, files.length);
    pushUint16(end, files.length);
    pushUint32(end, centralSize);
    pushUint32(end, centralOffset);
    pushUint16(end, 0); // comment length
    out.set(new Uint8Array(end), p);
    return out;
  }

  // XML esc
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'''}[c]));
  }

  // Convert dataURL to Uint8Array
  function dataUrlToBytes(dataUrl) {
    const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error('Invalid dataURL');
    const b64 = m[2];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1] };
  }

  // EMU
  const EMU_PER_PX = 9525;

  // Build XLSX with one sheet, inline strings and images anchored to cells.
  // rows: string[][], images: [{row: number, col: number, dataUrl: string, widthPx?:number, heightPx?:number}]
  async function buildXlsx({ sheetName = 'Sheet1', rows, images }) {
    // Prepare XML parts
    const nRows = rows.length;
    const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);

    function colLetter(n) { // 1-based
      let s = '';
      while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    }
    function cellRef(r1, c1) { // 1-based
      return colLetter(c1) + String(r1);
    }

    // sheetData with inlineStr
    const header = rows[0] || [];
    const lastRef = cellRef(nRows, Math.max(1, nCols));
    let sheetData = '<sheetData>';
    for (let r = 1; r <= nRows; r++) {
      const row = rows[r - 1] || [];
      sheetData += `<row r="${r}">`;
      for (let c = 1; c <= row.length; c++) {
        const v = row[c - 1];
        if (v == null || v === '') continue;
        sheetData += `<c r="${cellRef(r, c)}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
      }
      sheetData += `</row>`;
    }
    sheetData += '</sheetData>';

    // Column widths: index col ~6, cover col ~14.3 (~100px), others ~20
    let colsXml = '<cols>';
    for (let c = 1; c <= nCols; c++) {
      let w = 20;
      if (c === 1) w = 6;
      if (c === 2) w = 14.3;
      colsXml += `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`;
    }
    colsXml += '</cols>';

    // Row heights: header ~18pt, data rows ~75pt
    // We'll rebuild sheetData with row ht? Simpler: add after with <sheetFormatPr> defaultRowHeight, but Excel may ignore precise.
    // Instead, add explicit ht on each data row:
    let sheetDataWithHeights = '<sheetData>';
    for (let r = 1; r <= nRows; r++) {
      const row = rows[r - 1] || [];
      const ht = r === 1 ? 18 : 75;
      sheetDataWithHeights += `<row r="${r}" ht="${ht}" customHeight="1">`;
      for (let c = 1; c <= row.length; c++) {
        const v = row[c - 1];
        if (v == null || v === '') continue;
        sheetDataWithHeights += `<c r="${cellRef(r, c)}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
      }
      sheetDataWithHeights += `</row>`;
    }
    sheetData = sheetDataWithHeights + '</sheetData>';

    // Drawing: oneCellAnchor per image
    const mediaFiles = [];
    let drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
    const drawingRels = [];
    let picId = 1;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const row = Math.max(2, img.row); // 1-based row, ensure >=2
      const col = Math.max(2, img.col); // 1-based col, ensure >=2 (B)
      const { bytes, mime } = dataUrlToBytes(img.dataUrl);
      const ext = mime.includes('png') ? 'png' : (mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' : (mime.includes('webp') ? 'webp' : 'png');
      const mediaPath = `xl/media/image${i + 1}.${ext}`;
      mediaFiles.push({ path: mediaPath, bytes });

      const relId = `rId${i + 1}`;
      drawingRels.push({ Id: relId, Target: `../media/image${i + 1}.${ext}`, Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' });

      const cx = (img.widthPx || 100) * EMU_PER_PX;
      const cy = (img.heightPx || 100) * EMU_PER_PX;

      drawingXml += `
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>${col - 1}</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>${row - 1}</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${cx}" cy="${cy}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="${picId}" name="Picture ${picId}"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="${relId}"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>`;
      picId++;
    }
    drawingXml += '\n</xdr:wsDr>';

    // drawing rels xml
    let drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
    for (const r of drawingRels) {
      drawingRelsXml += `<Relationship Id="${r.Id}" Type="${r.Type}" Target="${r.Target}"/>`;
    }
    drawingRelsXml += '</Relationships>';

    // sheet rels (link to drawing)
    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;

    // sheet xml
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${colsXml}
  ${sheetData}
  <drawing r:id="rId1"/>
</worksheet>`;

    // workbook, rels
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

    const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

    // root rels
    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

    // props
    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Export</dc:title>
  <dc:creator>XlsxLite</dc:creator>
  <cp:lastModifiedBy>XlsxLite</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;

    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>XlsxLite</Application>
</Properties>`;

    // content types
    let contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/_rels/.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`;
    // Add image content types and overrides
    // Actually images go under Default by extension; to be safe, add Defaults for png/jpg/webp if present
    const exts = new Set();
    for (const mf of mediaFiles) {
      const ext = mf.path.split('.').pop().toLowerCase();
      exts.add(ext);
    }
    let ctAdd = '';
    if (exts.has('png')) ctAdd += `  <Default Extension="png" ContentType="image/png"/>\n`;
    if (exts.has('jpg') || exts.has('jpeg')) ctAdd += `  <Default Extension="jpg" ContentType="image/jpeg"/>\n`;
    if (exts.has('jpeg')) ctAdd += `  <Default Extension="jpeg" ContentType="image/jpeg"/>\n`;
    if (exts.has('webp')) ctAdd += `  <Default Extension="webp" ContentType="image/webp"/>\n`;
    if (ctAdd) {
      contentTypes = contentTypes.replace('</Types>', ctAdd + '</Types>');
    }

    // Assemble files
    const files = [
      { path: '[Content_Types].xml', bytes: utf8(contentTypes) },
      { path: '_rels/.rels', bytes: utf8(rootRelsXml) },
      { path: 'docProps/core.xml', bytes: utf8(coreXml) },
      { path: 'docProps/app.xml', bytes: utf8(appXml) },
      { path: 'xl/workbook.xml', bytes: utf8(workbookXml) },
      { path: 'xl/_rels/workbook.xml.rels', bytes: utf8(wbRelsXml) },
      { path: 'xl/worksheets/sheet1.xml', bytes: utf8(sheetXml) },
      { path: 'xl/worksheets/_rels/sheet1.xml.rels', bytes: utf8(sheetRelsXml) },
      { path: 'xl/drawings/drawing1.xml', bytes: utf8(drawingXml) },
      { path: 'xl/drawings/_rels/drawing1.xml.rels', bytes: utf8(drawingRelsXml) },
    ];
    for (const mf of mediaFiles) files.push({ path: mf.path, bytes: mf.bytes });

    const zipBytes = buildZip(files);
    return new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function exportXlsxWithImages({ filename, rows, images }) {
    const blob = await buildXlsx({ rows, images, sheetName: 'Sheet1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // expose
  window.XlsxLite = {
    buildXlsx,
    exportXlsxWithImages
  };
})();