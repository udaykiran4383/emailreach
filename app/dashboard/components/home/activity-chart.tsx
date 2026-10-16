'use client'

import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Table2 } from 'lucide-react'

export interface ChartDay {
  date: string
  label: string
  sent: number
  opened: number
  replied: number
}

// Categorical slots 1-3 of the validated reference palette (fixed order: sent, opened, replied)
// SVG fill attributes can't resolve var(), so bars are painted through CSS classes (see <style> below)
const SERIES = [
  { key: 'sent', label: 'Sent', color: 'var(--viz-series-1)', className: 'viz-series-1' },
  { key: 'opened', label: 'Opened', color: 'var(--viz-series-2)', className: 'viz-series-2' },
  { key: 'replied', label: 'Replied', color: 'var(--viz-series-3)', className: 'viz-series-3' },
] as const

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const day = payload[0]?.payload as ChartDay
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">
        {label} · {day.date}
      </p>
      {SERIES.map(s => (
        <div key={s.key} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="font-medium tabular-nums text-foreground">{day[s.key]}</span>
        </div>
      ))}
    </div>
  )
}

export default function ActivityChart({ data }: { data: ChartDay[] }) {
  const [showTable, setShowTable] = useState(false)
  const total = data.reduce((sum, d) => sum + d.sent + d.opened + d.replied, 0)

  return (
    <div className="viz-root rounded-2xl border border-border/50 bg-card p-5">
      <style>{`
        .viz-root {
          --viz-series-1: #2a78d6;
          --viz-series-2: #eb6834;
          --viz-series-3: #1baf7a;
          --viz-grid: color-mix(in oklab, currentColor 10%, transparent);
        }
        .dark .viz-root {
          --viz-series-1: #3987e5;
          --viz-series-2: #d95926;
          --viz-series-3: #199e70;
        }
        .viz-root .viz-series-1 .recharts-rectangle { fill: var(--viz-series-1); }
        .viz-root .viz-series-2 .recharts-rectangle { fill: var(--viz-series-2); }
        .viz-root .viz-series-3 .recharts-rectangle { fill: var(--viz-series-3); }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Last 7 days</h3>
          <p className="text-xs text-muted-foreground">Emails sent, opened and replied to per day</p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Legend">
            {SERIES.map(s => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setShowTable(v => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-pressed={showTable}
          >
            {showTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Day</th>
                {SERIES.map(s => (
                  <th key={s.key} className="py-2 pr-4 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.date} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-4 text-foreground">
                    {d.label} <span className="text-muted-foreground">{d.date.slice(5)}</span>
                  </td>
                  {SERIES.map(s => (
                    <td key={s.key} className="py-1.5 pr-4 text-right tabular-nums text-foreground">
                      {d[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : total === 0 ? (
        <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          No email activity in the last 7 days
        </div>
      ) : (
        <div className="h-[220px] w-full text-muted-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'currentColor' }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'currentColor' }} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--viz-grid)' }} />
              {SERIES.map(s => (
                <Bar key={s.key} dataKey={s.key} name={s.label} className={s.className} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
