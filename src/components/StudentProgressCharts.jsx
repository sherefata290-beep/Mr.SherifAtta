/**
 * Pure SVG charts for student Progress page.
 * Attendance chart = lessons only. Quiz level chart = quiz results only.
 * No mock data — empty states when insufficient real data.
 */

function pct(part, total) {
  if (!total) return 0;
  return Math.round((Number(part) / Number(total)) * 1000) / 10;
}

/** Horizontal / stacked attendance breakdown — lessons only */
export function AttendanceStatusChart({ lessons = [] }) {
  const list = Array.isArray(lessons) ? lessons : [];
  const completed = list.filter((l) => l.session_status === 'completed').length;
  const inProgress = list.filter((l) => l.session_status === 'in_progress').length;
  const notStarted = list.filter(
    (l) => !l.session_status || l.session_status === 'not_started'
  ).length;
  const total = list.length || completed + inProgress + notStarted;

  const segments = [
    { key: 'completed', label: '🟢 مكتملة', count: completed, color: '#059669' },
    { key: 'in_progress', label: '🟡 قيد المتابعة', count: inProgress, color: '#d97706' },
    { key: 'not_started', label: '🔴 لم تبدأ', count: notStarted, color: '#dc2626' },
  ];

  const hasData = total > 0;

  // Donut geometry
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 68;
  const stroke = 28;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const arcs = hasData
    ? segments.map((s) => {
        const len = total ? (s.count / total) * c : 0;
        const dash = `${len} ${Math.max(0, c - len)}`;
        const o = offset;
        offset += len;
        return { ...s, dash, offset: -o + c * 0.25 };
      })
    : [];

  return (
    <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-stone-900 text-lg flex items-center gap-2">
            <span aria-hidden>📊</span>
            نسبة الحضور والمتابعة
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            يعتمد على الحصص فقط — 🟢 مكتملة · 🟡 قيد المتابعة · 🔴 لم تبدأ
          </p>
        </div>
        {hasData ? (
          <span className="text-xs font-bold text-stone-600 bg-stone-100 px-2.5 py-1 rounded-lg tabular-nums">
            {total} حصة
          </span>
        ) : null}
      </div>

      {!hasData ? (
        <div className="py-10 text-center text-sm text-stone-500">
          لا توجد بيانات كافية لعرض الحضور
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div className="flex justify-center">
            <div className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f5f5f4" strokeWidth={stroke} />
                {arcs.map((a) =>
                  a.count > 0 ? (
                    <circle
                      key={a.key}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke={a.color}
                      strokeWidth={stroke}
                      strokeDasharray={a.dash}
                      strokeDashoffset={a.offset}
                      strokeLinecap="butt"
                      style={{ transition: 'stroke-dasharray 0.4s ease' }}
                    />
                  ) : null
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-stone-900 tabular-nums">
                  {pct(completed, total)}%
                </span>
                <span className="text-[11px] text-stone-500 font-medium">مكتمل</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {segments.map((s) => {
              const p = pct(s.count, total);
              return (
                <div key={s.key}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-semibold text-stone-800">{s.label}</span>
                    <span className="font-black text-stone-900 tabular-nums">
                      {s.count} <span className="text-stone-400 font-semibold text-xs">({p}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${p}%`, backgroundColor: s.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Quiz level progression — quiz results only (actual scores over time).
 * Needs at least 1 completed result to show chart; message if none.
 */
export function QuizLevelChart({ results = [] }) {
  const points = (Array.isArray(results) ? results : [])
    .filter((r) => r && r.percentage != null && Number.isFinite(Number(r.percentage)))
    .map((r) => ({
      id: r.id,
      title: r.quiz_title || `اختبار #${r.quiz_id}`,
      percentage: Math.min(100, Math.max(0, Number(r.percentage))),
      at: r.completed_at ? new Date(r.completed_at).getTime() : 0,
      score: r.score,
      total: r.total_questions,
    }))
    .filter((p) => p.at > 0 || true)
    .sort((a, b) => {
      // chronological: oldest → newest
      if (a.at && b.at) return a.at - b.at;
      return Number(a.id || 0) - Number(b.id || 0);
    });

  // Prefer unique quizzes keeping best chronological last attempt? User asked actual scores over time
  // Use each result as a point (attempts). If too many, keep last 12.
  const series = points.slice(-12);
  const enough = series.length >= 1;

  const first = series[0];
  const last = series[series.length - 1];
  const delta =
    enough && first && last
      ? Math.round((Number(last.percentage) - Number(first.percentage)) * 10) / 10
      : null;

  // SVG line chart
  const W = 560;
  const H = 200;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const coords = series.map((p, i) => {
    const x =
      series.length === 1
        ? padL + innerW / 2
        : padL + (i / (series.length - 1)) * innerW;
    const y = padT + innerH - (p.percentage / 100) * innerH;
    return { ...p, x, y, i };
  });

  const pathD =
    coords.length > 0
      ? coords
          .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
          .join(' ')
      : '';

  const areaD =
    coords.length > 0
      ? `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
      : '';

  return (
    <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-stone-900 text-lg flex items-center gap-2">
            <span aria-hidden>📈</span>
            مستوى الطالب في الاختبارات
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            يعتمد على درجات الاختبارات الفعلية فقط — تطور النسبة بمرور الوقت
          </p>
        </div>
        {enough ? (
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 tabular-nums">
              آخر نتيجة: {last.percentage}%
            </span>
            {delta != null && series.length >= 2 ? (
              <span
                className={`px-2.5 py-1 rounded-lg border tabular-nums ${
                  delta > 0
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : delta < 0
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-stone-100 text-stone-700 border-stone-200'
                }`}
              >
                التطور منذ أول اختبار: {delta > 0 ? '+' : ''}
                {delta}%
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {!enough ? (
        <div className="py-10 text-center text-sm text-stone-500 font-medium">
          لا توجد بيانات كافية لعرض التطور
        </div>
      ) : (
        <>
          <div className="w-full overflow-x-auto -mx-1 px-1">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full min-w-[280px] max-w-full h-auto"
              role="img"
              aria-label="مخطط تطور درجات الاختبارات"
            >
              {/* grid lines */}
              {[0, 25, 50, 75, 100].map((g) => {
                const y = padT + innerH - (g / 100) * innerH;
                return (
                  <g key={g}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={padL + innerW}
                      y2={y}
                      stroke="#e7e5e4"
                      strokeWidth="1"
                    />
                    <text
                      x={padL - 8}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="10"
                      fill="#a8a29e"
                    >
                      {g}
                    </text>
                  </g>
                );
              })}
              {areaD ? (
                <path d={areaD} fill="rgba(180, 83, 9, 0.12)" stroke="none" />
              ) : null}
              {pathD ? (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#b45309"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {coords.map((c) => (
                <g key={`${c.id}-${c.i}`}>
                  <circle cx={c.x} cy={c.y} r="5" fill="#b45309" stroke="#fff" strokeWidth="2" />
                  <title>
                    {c.title}: {c.percentage}%
                  </title>
                </g>
              ))}
            </svg>
          </div>

          {/* compact legend of last points on mobile */}
          <div className="mt-3 flex flex-wrap gap-2">
            {series.slice(-5).map((p, idx) => (
              <span
                key={`${p.id}-${idx}`}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-stone-50 border border-stone-100 text-[11px] text-stone-700 max-w-full"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-700 shrink-0" />
                <span className="truncate max-w-[140px]">{p.title}</span>
                <span className="font-black text-stone-900 tabular-nums">{p.percentage}%</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
