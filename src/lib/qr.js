/**
 * Parent-track QR helpers (client-side only).
 * Token stays opaque — only URL with random token is encoded.
 */

export function parentTrackUrl(token, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  const t = String(token || '').trim();
  if (!t) return '';
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}/track/${encodeURIComponent(t)}`;
}

/** Build QR image URL (no student data — only tracking URL) */
export function qrImageUrl(data, size = 320) {
  const text = encodeURIComponent(String(data || ''));
  const s = Math.min(Math.max(Number(size) || 320, 120), 800);
  // Multiple providers as fallbacks are handled by caller; primary:
  return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&margin=12&data=${text}`;
}

export function qrImageUrlAlt(data, size = 320) {
  const text = encodeURIComponent(String(data || ''));
  const s = Math.min(Math.max(Number(size) || 320, 120), 800);
  return `https://quickchart.io/qr?text=${text}&size=${s}&margin=2`;
}

export async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('فشل تحميل صورة QR'));
    img.src = url;
  });
}

export async function downloadQrPng({ token, studentName = 'طالب', origin } = {}) {
  const url = parentTrackUrl(token, origin);
  if (!url) throw new Error('لا يوجد رمز متابعة');
  let img;
  try {
    img = await loadImage(qrImageUrl(url, 480));
  } catch {
    img = await loadImage(qrImageUrlAlt(url, 480));
  }

  const canvas = document.createElement('canvas');
  const pad = 48;
  const titleH = 56;
  const footerH = 40;
  canvas.width = img.width + pad * 2;
  canvas.height = img.height + pad * 2 + titleH + footerH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 22px Tahoma, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('QR متابعة الطالب', canvas.width / 2, pad - 8 + 28);
  ctx.font = '16px Tahoma, Arial, sans-serif';
  ctx.fillStyle = '#b45309';
  ctx.fillText(String(studentName || 'طالب'), canvas.width / 2, pad - 8 + 50);
  ctx.drawImage(img, pad, pad + titleH);
  ctx.fillStyle = '#78716c';
  ctx.font = '12px Tahoma, Arial, sans-serif';
  ctx.fillText('English Mastery · للطباعة وتسليم ولي الأمر', canvas.width / 2, canvas.height - 16);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('فشل إنشاء صورة PNG');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `qr-track-${String(studentName || 'student').replace(/\s+/g, '-')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

export async function downloadQrPdf({ token, studentName = 'طالب', gradeLabel = '', origin } = {}) {
  const url = parentTrackUrl(token, origin);
  if (!url) throw new Error('لا يوجد رمز متابعة');
  const { jsPDF } = await import('jspdf');
  let dataUrl;
  try {
    const img = await loadImage(qrImageUrl(url, 400));
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    dataUrl = c.toDataURL('image/png');
  } catch {
    const img = await loadImage(qrImageUrlAlt(url, 400));
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    dataUrl = c.toDataURL('image/png');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('English Mastery', pageW / 2, 28, { align: 'center' });
  doc.setFontSize(14);
  doc.text('Student Progress QR', pageW / 2, 38, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(String(studentName || 'Student'), pageW / 2, 50, { align: 'center' });
  if (gradeLabel) doc.text(String(gradeLabel), pageW / 2, 58, { align: 'center' });

  const qrSize = 90;
  const qrX = (pageW - qrSize) / 2;
  doc.addImage(dataUrl, 'PNG', qrX, 70, qrSize, qrSize);

  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text('Scan to view attendance, lessons, quizzes & progress.', pageW / 2, 170, { align: 'center' });
  doc.setFontSize(8);
  doc.setTextColor(120);
  // Do not print full token; short hint only
  doc.text('Secure parent link · Mr. Sherif Atta', pageW / 2, 180, { align: 'center' });

  doc.save(`qr-track-${String(studentName || 'student').replace(/\s+/g, '-')}.pdf`);
  return true;
}

export function printQr({ token, studentName = 'طالب', gradeLabel = '', origin } = {}) {
  const url = parentTrackUrl(token, origin);
  if (!url) throw new Error('لا يوجد رمز متابعة');
  const imgSrc = qrImageUrl(url, 360);
  const w = window.open('', '_blank', 'width=480,height=700');
  if (!w) throw new Error('اسمح بالنوافذ المنبثقة للطباعة');
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>QR متابعة — ${String(studentName).replace(/[<>]/g, '')}</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;text-align:center;padding:24px;color:#1c1917}
  h1{font-size:20px;margin:0 0 6px}
  h2{font-size:16px;color:#b45309;margin:0 0 16px;font-weight:600}
  img{width:300px;height:300px;border:1px solid #e7e5e4;border-radius:12px;padding:12px}
  p{color:#57534e;font-size:13px}
  .brand{color:#78716c;font-size:12px;margin-top:18px}
</style></head><body>
  <h1>QR متابعة الطالب</h1>
  <h2>${String(studentName || 'طالب').replace(/[<>]/g, '')}${gradeLabel ? ` — ${String(gradeLabel).replace(/[<>]/g, '')}` : ''}</h2>
  <img src="${imgSrc}" alt="QR" />
  <p>امسح الرمز لمتابعة الحضور والحصص والاختبارات</p>
  <div class="brand">English Mastery · Mr. Sherif Atta</div>
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`);
  w.document.close();
}
