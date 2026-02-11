import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Users, Search, MessageSquare, Phone, Mail, X, ChevronDown, Landmark, Radio, BookOpen, CalendarIcon } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Header } from '@/components/Header';
import { useBuyerContacts, useBuyerMeetings, type BuyerContact } from '@/hooks/useBuyerCRM';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { exportMeetingToICS, composeBuyerEmail } from '@/lib/ics-export';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const RELATIONSHIP_STATUSES = ['new', 'warm', 'active', 'priority', 'dormant'] as const;
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/15 text-blue-400',
  warm: 'bg-amber-500/15 text-amber-400',
  active: 'bg-emerald-500/15 text-emerald-400',
  priority: 'bg-purple-500/15 text-purple-400',
  dormant: 'bg-muted text-muted-foreground',
};

function MeetingLog({ contactId }: { contactId: string }) {
  const { meetings, addMeeting } = useBuyerMeetings(contactId);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ notes: '', outcome: '', meeting_type: 'general', location: '' });

  const handleAdd = () => {
    addMeeting.mutate(form);
    setForm({ notes: '', outcome: '', meeting_type: 'general', location: '' });
    setShowAdd(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Meeting History</span>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3 w-3 mr-1" />Log Meeting
        </Button>
      </div>

      {showAdd && (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.meeting_type} onValueChange={v => setForm(f => ({ ...f, meeting_type: v }))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['general', 'market', 'screening', 'pitch', 'follow-up'].map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="h-8 text-xs" placeholder="Location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
          </div>
          <Textarea className="text-xs min-h-[60px]" placeholder="Meeting notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <Input className="h-8 text-xs" placeholder="Outcome / next steps" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleAdd}>Save</Button>
          </div>
        </div>
      )}

      {meetings.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">No meetings logged yet.</p>
      ) : (
        <div className="space-y-1.5">
          {meetings.map(m => (
            <div key={m.id} className="text-xs p-2 rounded bg-muted/30 group">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Badge variant="outline" className="text-[10px]">{m.meeting_type}</Badge>
                <span>{new Date(m.meeting_date).toLocaleDateString()}</span>
                {m.location && <span>· {m.location}</span>}
                <button
                  onClick={() => exportMeetingToICS({ buyer_name: contactId, meeting_type: m.meeting_type, meeting_date: m.meeting_date, location: m.location, notes: m.notes })}
                  className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
                  title="Add to calendar"
                >
                  <CalendarIcon className="h-3 w-3" />
                </button>
              </div>
              {m.notes && <p className="text-foreground">{m.notes}</p>}
              {m.outcome && <p className="text-muted-foreground mt-1">→ {m.outcome}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BuyerCRM() {
  const { contacts, addContact, updateContact, deleteContact } = useBuyerContacts();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ buyer_name: '', company: '', company_type: '', email: '', territories: '' as string, appetite_notes: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = contacts.filter(c =>
    c.buyer_name.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = () => {
    addContact.mutate({
      ...form,
      territories: form.territories.split(',').map(t => t.trim()).filter(Boolean),
    });
    setForm({ buyer_name: '', company: '', company_type: '', email: '', territories: '', appetite_notes: '' });
    setShowForm(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-3xl py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Buyer CRM</h1>
              <p className="text-muted-foreground mt-1">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
            </div>
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus className="h-4 w-4 mr-1.5" />Add Contact
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search contacts..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Add Form */}
          {showForm && (
            <div className="glass-card rounded-xl p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Contact name" value={form.buyer_name} onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))} />
                <Input placeholder="Company" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select value={form.company_type} onValueChange={v => setForm(f => ({ ...f, company_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Company type" /></SelectTrigger>
                  <SelectContent>
                    {['distributor', 'sales-agent', 'streamer', 'broadcaster', 'financier', 'producer', 'other'].map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/-/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <Input placeholder="Territories (comma-separated)" value={form.territories} onChange={e => setForm(f => ({ ...f, territories: e.target.value }))} />
              <Textarea placeholder="Appetite notes..." value={form.appetite_notes} onChange={e => setForm(f => ({ ...f, appetite_notes: e.target.value }))} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button onClick={handleAdd} disabled={!form.buyer_name}>Save Contact</Button>
              </div>
            </div>
          )}

          {/* Contact List */}
          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Users className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-foreground mb-2">Build your buyer network</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                Track distributors, sales agents, streamers, and financiers. Log meetings and manage relationships — all in context of your projects.
              </p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-1.5" />Add Your First Contact
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(contact => (
                <Collapsible key={contact.id} open={expandedId === contact.id} onOpenChange={open => setExpandedId(open ? contact.id : null)}>
                  <div className="glass-card rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-primary">{contact.buyer_name[0]?.toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground truncate">{contact.buyer_name}</span>
                            <Badge className={`text-[10px] border-0 ${STATUS_COLORS[contact.relationship_status] || STATUS_COLORS.new}`}>
                              {contact.relationship_status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {contact.company && <span>{contact.company}</span>}
                            {contact.company_type && <span>· {contact.company_type.replace(/-/g, ' ')}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {contact.email && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => composeBuyerEmail({ buyer_name: contact.buyer_name, email: contact.email, company: contact.company })}>
                                  <Mail className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Compose email with context</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <Select value={contact.relationship_status} onValueChange={v => updateContact.mutate({ id: contact.id, relationship_status: v })}>
                          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {RELATIONSHIP_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <CollapsibleTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedId === contact.id ? 'rotate-180' : ''}`} />
                          </Button>
                        </CollapsibleTrigger>
                        <ConfirmDialog
                          title={`Delete ${contact.buyer_name}?`}
                          description="This will permanently remove this contact and all their meeting history."
                          onConfirm={() => deleteContact.mutate(contact.id)}
                        >
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </ConfirmDialog>
                      </div>
                    </div>

                    <CollapsibleContent>
                      {contact.appetite_notes && (
                        <p className="text-xs text-muted-foreground mt-3 p-2 bg-muted/30 rounded">{contact.appetite_notes}</p>
                      )}
                      {contact.territories.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {contact.territories.map(t => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                        </div>
                      )}
                      <MeetingLog contactId={contact.id} />
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
