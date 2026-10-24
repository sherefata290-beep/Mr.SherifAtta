import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Normalize any cell value to a clean printable string */
export function cellText(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (value instanceof Date) {
    return value.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  // strip zero-width / bidi control chars that break PDF rendering
  return String(value)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || '—';
}

function validateReport({ headers, rows }) {
  if (!headers?.length) {
    alert('لا توجد أعمدة للتصدير');
    return false;
  }
  if (!rows?.length) {
    alert('لا توجد بيانات للتصدير');
    return false;
  }
  return true;
}

function buildStamp() {
  return new Date().toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeRows(headers, rows) {
  const colCount = headers.length;
  return (rows || []).map((row) => {
    const arr = Array.isArray(row) ? row : [];
    const cells = [];
    for (let i = 0; i < colCount; i += 1) {
      cells.push(cellText(arr[i]));
    }
    return cells;
  });
}

function buildReportHtml({ title, subtitle = '', headers, rows, mode = 'print' }) {
  const stamped = buildStamp();
  const safeHeaders = (headers || []).map((h) => cellText(h));
  const safeRows = normalizeRows(safeHeaders, rows);

  const thead = safeHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const tbody = safeRows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');

  const toolbar =
    mode === 'print'
      ? `
    <div class="toolbar no-print">
      <button class="btn-print" onclick="window.print()">طباعة</button>
      <button class="btn-close" onclick="window.close()">إغلاق</button>
    </div>`
      : mode === 'pdf'
        ? ''
        : `
    <div class="toolbar no-print">
      <button class="btn-close" onclick="window.close()">إغلاق</button>
    </div>`;

  const autoPrint =
    mode === 'print'
      ? `
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          window.focus();
          window.print();
        }, 250);
      });
    </script>`
      : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      direction: rtl;
      text-align: right;
    }
    body {
      font-family: "Segoe UI", Tahoma, Arial, "Noto Naskh Arabic", "Noto Sans Arabic", "Geeza Pro", "Arabic Typesetting", sans-serif;
      margin: 0;
      padding: 24px;
      color: #1c1917;
      background: #ffffff;
      -webkit-font-smoothing: antialiased;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 20px;
      position: sticky;
      top: 0;
      background: #fff;
      padding: 10px 0;
      border-bottom: 1px solid #e7e5e4;
      z-index: 10;
    }
    .toolbar button {
      border: none;
      border-radius: 10px;
      padding: 10px 16px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
    }
    .btn-print { background: #b45309; color: #fff; }
    .btn-close { background: #e7e5e4; color: #1c1917; }
    .header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #b45309;
      padding-bottom: 14px;
    }
    .header h1 {
      margin: 0 0 6px;
      font-size: 22px;
      color: #1c1917;
      font-weight: 800;
    }
    .header .brand {
      color: #b45309;
      font-weight: 700;
      margin: 0 0 4px;
    }
    .header p {
      margin: 4px 0;
      color: #57534e;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      table-layout: auto;
    }
    th, td {
      border: 1px solid #d6d3d1;
      padding: 8px 10px;
      text-align: right;
      vertical-align: middle;
      word-break: break-word;
      white-space: normal;
    }
    th {
      background: #fef3c7;
      color: #78350f;
      font-weight: 700;
    }
    tr:nth-child(even) td { background: #fafaf9; }
    td.ltr, th.ltr { direction: ltr; text-align: left; unicode-bidi: plaintext; }
    .footer {
      margin-top: 18px;
      text-align: center;
      color: #78716c;
      font-size: 11px;
    }
    @media print {
      .no-print, .toolbar { display: none !important; }
      body { padding: 8mm; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  ${toolbar}
  <div class="report-root" id="report-root">
    <div class="header">
      <p class="brand">English Mastery · Mr. Sherif Atta</p>
      <h1>${escapeHtml(cellText(title))}</h1>
      ${subtitle ? `<p>${escapeHtml(cellText(subtitle))}</p>` : ''}
      <p>تاريخ التصدير: ${escapeHtml(stamped)} · عدد السجلات: ${safeRows.length}</p>
    </div>
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
    <div class="footer">English Mastery — تقرير إداري</div>
  </div>
  ${autoPrint}
</body>
</html>`;
}

/**
 * Open a print-only report window and trigger the system print dialog.
 */
export function openPrintableReport({ title, subtitle = '', headers, rows }) {
  if (!validateReport({ headers, rows })) return;

  const html = buildReportHtml({ title, subtitle, headers, rows, mode: 'print' });
  const win = window.open('', '_blank');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة للطباعة');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function showExportOverlay(message) {
  const el = document.createElement('div');
  el.id = 'pdf-export-overlay';
  el.setAttribute('dir', 'rtl');
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(28,25,23,0.45)',
    'color:#fff',
    'font-family:Segoe UI,Tahoma,Arial,sans-serif',
    'font-size:16px',
    'font-weight:700',
  ].join(';');
  el.innerHTML = `<div style="background:#1c1917;padding:18px 28px;border-radius:14px;border:1px solid #44403c">${escapeHtml(message)}</div>`;
  document.body.appendChild(el);
  return () => {
    try { el.remove(); } catch {}
  };
}

/**
 * Download a real PDF with correct Arabic text by rendering HTML → canvas → PDF.
 * (jsPDF built-in fonts do not support Arabic glyphs.)
 */
export async function downloadPdfReport({ title, subtitle = '', headers, rows, fileName }) {
  if (!validateReport({ headers, rows })) return;

  const hide = showExportOverlay('جاري إنشاء ملف PDF بالبيانات الصحيحة...');

  try {
    const html = buildReportHtml({ title, subtitle, headers, rows, mode: 'pdf' });
    const parser = new DOMParser();
    const docHtml = parser.parseFromString(html, 'text/html');
    const reportNode = docHtml.getElementById('report-root');
    if (!reportNode) throw new Error('تعذر تجهيز محتوى التقرير');

    // Off-screen host with fixed A4-ish width for stable layout
    const host = document.createElement('div');
    host.setAttribute('dir', 'rtl');
    host.style.cssText = [
      'position:fixed',
      'left:-10000px',
      'top:0',
      'width:794px',
      'background:#ffffff',
      'color:#1c1917',
      'z-index:-1',
      'pointer-events:none',
    ].join(';');

    const style = document.createElement('style');
    style.textContent = `
      #pdf-capture-root {
        direction: rtl;
        text-align: right;
        font-family: "Segoe UI", Tahoma, Arial, "Noto Naskh Arabic", "Noto Sans Arabic", sans-serif;
        padding: 28px;
        background: #ffffff;
        color: #1c1917;
        width: 794px;
        box-sizing: border-box;
      }
      #pdf-capture-root .header {
        text-align: center;
        margin-bottom: 18px;
        border-bottom: 2px solid #b45309;
        padding-bottom: 12px;
      }
      #pdf-capture-root .header h1 {
        margin: 0 0 6px;
        font-size: 22px;
        color: #1c1917;
        font-weight: 800;
      }
      #pdf-capture-root .brand {
        color: #b45309;
        font-weight: 700;
        margin: 0 0 4px;
      }
      #pdf-capture-root .header p {
        margin: 4px 0;
        color: #57534e;
        font-size: 13px;
      }
      #pdf-capture-root table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      #pdf-capture-root th, #pdf-capture-root td {
        border: 1px solid #d6d3d1;
        padding: 8px 10px;
        text-align: right;
        vertical-align: middle;
        word-break: break-word;
        white-space: normal;
      }
      #pdf-capture-root th {
        background: #fef3c7;
        color: #78350f;
        font-weight: 700;
      }
      #pdf-capture-root tr:nth-child(even) td { background: #fafaf9; }
      #pdf-capture-root .footer {
        margin-top: 16px;
        text-align: center;
        color: #78716c;
        font-size: 11px;
      }
    `;

    const capture = document.createElement('div');
    capture.id = 'pdf-capture-root';
    capture.innerHTML = reportNode.innerHTML;

    host.appendChild(style);
    host.appendChild(capture);
    document.body.appendChild(host);

    // Wait a frame so fonts/layout settle
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = await html2canvas(capture, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 794,
      scrollX: 0,
      scrollY: 0,
    });

    host.remove();

    const imgData = canvas.toDataURL('image/jpeg', 0.96);
    const orientation = headers.length > 7 ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight, undefined, 'FAST');
    heightLeft -= usableHeight;

    while (heightLeft > 1) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight, undefined, 'FAST');
      heightLeft -= usableHeight;
    }

    // Page numbers
    const pageCount = pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(120, 113, 108);
      pdf.text(
        `English Mastery  |  ${i} / ${pageCount}`,
        pageWidth / 2,
        pageHeight - 4,
        { align: 'center' }
      );
    }

    const safeName = (fileName || title || 'report')
      .replace(/[^\w\u0600-\u06FF\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'report';

    pdf.save(`${safeName}.pdf`);
  } catch (err) {
    console.error('PDF export error:', err);
    alert(err?.message || 'فشل إنشاء ملف PDF. حاول مرة أخرى.');
  } finally {
    hide();
  }
}

/** @deprecated use openPrintableReport or downloadPdfReport */
export function openReport(options) {
  return openPrintableReport(options);
}
