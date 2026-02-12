/**
 * Daily Report Logger
 *
 * UI for logging daily production reports (scenes shot, pages, incidents).
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ClipboardList, Plus, Trash2, Calendar, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useDailyReports, type DailyReport } from '@/hooks/useProductionMonitoring';
import { format } from 'date-fns';

interface Props {
  projectId: string;
}

export function DailyReportLogger({ projectId }: Props) {
  const { reports, addReport, deleteReport } = useDailyReports(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    report_date: format(new Date(), 'yyyy-MM-dd'),
    scenes_shot: 0,
    pages_shot: 0,
    setup_count: 0,
    call_time: '06:00',
    wrap_time: '18:00',
    notes: '',
    incidents: '',
    incident_severity: 'none',
    weather: '',
  });

  const handleSubmit = () => {
    addReport.mutate({
      report_date: form.report_date,
      scenes_shot: form.scenes_shot,
      pages_shot: Number(form.pages_shot),
      setup_count: form.setup_count,
      call_time: form.call_time,
      wrap_time: form.wrap_time,
      notes: form.notes,
      incidents: form.incidents,
      incident_severity: form.incident_severity,
      weather: form.weather,
    }, {
      onSuccess: () => {
        setAdding(false);
        setForm(f => ({ ...f, notes: '', incidents: '', incident_severity: 'none', scenes_shot: 0, pages_shot: 0, setup_count: 0 }));
      },
    });
  };

  const severityColors: Record<string, string> = {
    none: 'text-muted-foreground',
    minor: 'text-amber-400',
    major: 'text-orange-400',
    critical: 'text-red-400',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-sm">Daily Reports</h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{reports.length} logged</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Log Day
        </Button>
      </div>

      {adding && (
        <div className="bg-muted/20 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Date</label>
              <Input type="date" value={form.report_date} onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Scenes Shot</label>
              <Input type="number" min={0} value={form.scenes_shot} onChange={e => setForm(f => ({ ...f, scenes_shot: parseInt(e.target.value) || 0 }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Pages Shot</label>
              <Input type="number" min={0} step={0.125} value={form.pages_shot} onChange={e => setForm(f => ({ ...f, pages_shot: parseFloat(e.target.value) || 0 }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Setups</label>
              <Input type="number" min={0} value={form.setup_count} onChange={e => setForm(f => ({ ...f, setup_count: parseInt(e.target.value) || 0 }))} className="h-8 text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Call Time</label>
              <Input type="time" value={form.call_time} onChange={e => setForm(f => ({ ...f, call_time: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Wrap Time</label>
              <Input type="time" value={form.wrap_time} onChange={e => setForm(f => ({ ...f, wrap_time: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Weather</label>
              <Input value={form.weather} onChange={e => setForm(f => ({ ...f, weather: e.target.value }))} placeholder="Clear, Overcast…" className="h-8 text-xs" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase">Notes</label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="text-xs min-h-[50px] resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Incidents</label>
              <Textarea value={form.incidents} onChange={e => setForm(f => ({ ...f, incidents: e.target.value }))} placeholder="Any delays, issues, or incidents…" className="text-xs min-h-[50px] resize-none" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Incident Severity</label>
              <Select value={form.incident_severity} onValueChange={v => setForm(f => ({ ...f, incident_severity: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={addReport.isPending}>Save Report</Button>
          </div>
        </div>
      )}

      {/* Report List */}
      {reports.length > 0 ? (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {reports.map(r => (
            <div key={r.id} className="flex items-center gap-3 bg-muted/20 rounded-lg px-3 py-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{format(new Date(r.report_date), 'MMM d, yyyy')}</span>
                  {r.incident_severity !== 'none' && (
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 ${severityColors[r.incident_severity]}`}>
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                      {r.incident_severity}
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {r.scenes_shot} scenes · {Number(r.pages_shot).toFixed(1)} pages · {r.setup_count} setups
                  {r.call_time && r.wrap_time ? ` · ${r.call_time}–${r.wrap_time}` : ''}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => deleteReport.mutate(r.id)}>
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      ) : !adding ? (
        <p className="text-xs text-muted-foreground text-center py-4">No daily reports logged yet. Click "Log Day" to start tracking.</p>
      ) : null}
    </motion.div>
  );
}
