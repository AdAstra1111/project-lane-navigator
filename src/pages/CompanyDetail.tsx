import { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, LinkIcon, Upload, Palette, MapPin, Pencil, Check, X, UserPlus, Trash2, Users, FolderOpen, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useCompany, useCompanyProjects, useProjectCompanies, useCompanies } from '@/hooks/useCompanies';
import { useCompanyMembers } from '@/hooks/useCompanyMembers';
import { useProjects } from '@/hooks/useProjects';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ROLE_LABELS, type ProjectRole } from '@/hooks/useCollaboration';

const ACCENT_PRESETS = [
  '#C4913A', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6',
  '#F59E0B', '#EC4899', '#06B6D4', '#84CC16', '#F97316',
];

function LinkProjectControl({ companyId, existingProjectIds }: { companyId: string; existingProjectIds: string[] }) {
  const { projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const { linkProject } = useProjectCompanies(undefined);

  const unlinkedProjects = projects.filter(p => !existingProjectIds.includes(p.id));

  const handleLink = () => {
    if (!selectedProjectId) return;
    linkProject.mutate({ projectId: selectedProjectId, companyId });
    setSelectedProjectId('');
  };

  if (unlinkedProjects.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Link a project..." />
        </SelectTrigger>
        <SelectContent>
          {unlinkedProjects.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={handleLink} disabled={!selectedProjectId || linkProject.isPending}>
        <LinkIcon className="h-3.5 w-3.5 mr-1" />
        Link
      </Button>
    </div>
  );
}

function CompanyBrandingSection({ companyId, logoUrl, colorAccent, jurisdiction }: {
  companyId: string;
  logoUrl: string;
  colorAccent: string;
  jurisdiction: string;
}) {
  const { updateCompany } = useCompanies();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingJurisdiction, setEditingJurisdiction] = useState(false);
  const [jurisdictionDraft, setJurisdictionDraft] = useState(jurisdiction);
  const [uploading, setUploading] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/${companyId}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('company-logos').getPublicUrl(path);
      updateCompany.mutate({ id: companyId, logo_url: publicUrl });
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAccentChange = (color: string) => {
    updateCompany.mutate({ id: companyId, color_accent: color });
  };

  const saveJurisdiction = () => {
    updateCompany.mutate({ id: companyId, jurisdiction: jurisdictionDraft.trim() });
    setEditingJurisdiction(false);
  };

  return (
    <div className="glass-card rounded-lg p-5 mb-8">
      <h3 className="text-sm font-semibold text-foreground mb-4">Company Branding</h3>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-center gap-2">
          <div
            className="h-16 max-w-[200px] min-w-[64px] rounded-lg border-2 border-dashed border-border overflow-hidden flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors bg-muted-foreground/10 dark:bg-muted-foreground/20"
            onClick={() => fileInputRef.current?.click()}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-full w-auto object-contain p-1" />
            ) : (
              <Upload className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          <span className="text-[10px] text-muted-foreground">{uploading ? 'Uploading...' : 'Logo'}</span>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Accent Colour</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {ACCENT_PRESETS.map(c => (
              <button
                key={c}
                onClick={() => handleAccentChange(c)}
                className={`h-6 w-6 rounded-full border-2 transition-all ${
                  colorAccent === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            {colorAccent && !ACCENT_PRESETS.includes(colorAccent) && (
              <div className="h-6 w-6 rounded-full border-2 border-foreground" style={{ backgroundColor: colorAccent }} />
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Jurisdiction</span>
          </div>
          {editingJurisdiction ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={jurisdictionDraft}
                onChange={e => setJurisdictionDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveJurisdiction()}
                placeholder="e.g. UK, Ireland, France..."
                className="h-8 w-44 text-sm"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveJurisdiction}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingJurisdiction(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              onClick={() => { setJurisdictionDraft(jurisdiction); setEditingJurisdiction(true); }}
              className="text-sm text-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              {jurisdiction || 'Not set'}
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompanyMembersSection({ companyId }: { companyId: string }) {
  const { members, isLoading, addMember, removeMember, updateMember } = useCompanyMembers(companyId);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('creative');

  const handleAdd = () => {
    if (!email.trim()) return;
    addMember.mutate(
      { email: email.trim(), displayName: name.trim() || email.trim(), defaultRole: role },
      { onSuccess: () => { setEmail(''); setName(''); setAdding(false); } }
    );
  };

  return (
    <div className="glass-card rounded-lg p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Company Partners</h3>
          {members.length > 0 && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {members.length}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => setAdding(!adding)}>
          <UserPlus className="h-3 w-3 mr-1" />
          Add Partner
        </Button>
      </div>

      {adding && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="border border-border/50 rounded-lg p-4 mb-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="text-sm" />
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="text-sm" type="email" />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as ProjectRole[]).map(r => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!email.trim() || addMember.isPending}>
              {addMember.isPending ? 'Adding…' : 'Add to Roster'}
            </Button>
          </div>
        </motion.div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No partners added yet. Add team members to quickly invite them to linked projects.
        </p>
      ) : (
        <div className="space-y-1">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors group">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-display font-semibold text-primary">
                    {(member.display_name || member.email).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{member.display_name || member.email}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{member.email}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {ROLE_LABELS[member.default_role as ProjectRole] || member.default_role}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Select value={member.default_role} onValueChange={v => updateMember.mutate({ id: member.id, default_role: v })}>
                  <SelectTrigger className="h-7 w-[120px] text-xs border-border/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as ProjectRole[]).map(r => (
                      <SelectItem key={r} value={r} className="text-xs">{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeMember.mutate(member.id)}>
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: company, isLoading: companyLoading } = useCompany(id);
  const { data: companyProjects = [], isLoading: projectsLoading } = useCompanyProjects(id);

  const isLoading = companyLoading || projectsLoading;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-10">
          {/* Breadcrumb */}
          <Breadcrumb className="mb-6">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link to="/companies">Companies</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{company?.name || '…'}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          {isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-64 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
          ) : company ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  {company.logo_url ? (
                    <div
                      className="h-14 max-w-[180px] min-w-[56px] rounded-lg overflow-hidden border border-border/50 bg-muted-foreground/10 dark:bg-muted-foreground/20 p-1"
                      style={company.color_accent ? { borderColor: company.color_accent + '40' } : undefined}
                    >
                      <img src={company.logo_url} alt={company.name} className="h-full w-auto object-contain" />
                    </div>
                  ) : (
                    <div
                      className="h-14 w-14 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: company.color_accent ? company.color_accent + '20' : 'hsl(var(--primary) / 0.1)' }}
                    >
                      <Building2 className="h-7 w-7" style={{ color: company.color_accent || 'hsl(var(--primary))' }} />
                    </div>
                  )}
                  <div>
                    <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                      {company.name}
                    </h1>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-muted-foreground">
                        {companyProjects.length} project{companyProjects.length !== 1 ? 's' : ''}
                      </p>
                      {company.jurisdiction && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {company.jurisdiction}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <LinkProjectControl
                  companyId={company.id}
                  existingProjectIds={companyProjects.map((p: any) => p.id)}
                />
              </div>

              <CompanyBrandingSection
                companyId={company.id}
                logoUrl={company.logo_url}
                colorAccent={company.color_accent}
                jurisdiction={company.jurisdiction}
              />

              <CompanyMembersSection companyId={company.id} />

              {/* Projects folder tile */}
              <h3 className="text-sm font-semibold text-foreground mb-3">Contents</h3>
              <button
                onClick={() => navigate(`/companies/${id}/projects`)}
                className="glass-card rounded-lg p-6 w-full text-left transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_30px_hsl(var(--glow-primary))] group"
              >
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FolderOpen className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-display font-semibold text-foreground group-hover:text-primary transition-colors">
                      Projects
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {companyProjects.length} project{companyProjects.length !== 1 ? 's' : ''} linked
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </button>
            </motion.div>
          ) : (
            <p className="text-muted-foreground">Company not found.</p>
          )}
        </main>
      </div>
    </PageTransition>
  );
}
