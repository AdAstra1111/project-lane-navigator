import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Building2, Trash2, MapPin, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ExplorerLayout } from '@/components/explorer/ExplorerLayout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanies, ProductionCompany } from '@/hooks/useCompanies';
import { useAllCompanyLinks } from '@/hooks/useAllCompanyLinks';

export default function Companies() {
  const { companies, isLoading, createCompany, deleteCompany } = useCompanies();
  const { linkMap } = useAllCompanyLinks();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [showForm, setShowForm] = useState(false);

  const companyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of companies) {
      counts[c.id] = linkMap[c.id]?.size || 0;
    }
    return counts;
  }, [companies, linkMap]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    createCompany.mutate(newName.trim());
    setNewName('');
    setShowForm(false);
  };

  return (
    <ExplorerLayout
      breadcrumbs={[{ label: 'Companies' }]}
      title="Companies"
      subtitle={`${companies.length} compan${companies.length !== 1 ? 'ies' : 'y'}`}
      actions={
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Company
        </Button>
      }
    >
      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-lg p-4 mb-4 flex items-center gap-3"
        >
          <Input
            placeholder="Company name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
            className="max-w-sm"
          />
          <Button onClick={handleCreate} disabled={!newName.trim() || createCompany.isPending} size="sm">Create</Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setNewName(''); }}>Cancel</Button>
        </motion.div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />)}
        </div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-lg font-display font-semibold text-foreground mb-2">No companies yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">Create your first company to begin.</p>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Company
          </Button>
        </div>
      ) : (
        <div className="glass-card rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%]">Name</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map(company => (
                <TableRow key={company.id} className="cursor-pointer group" onClick={() => navigate(`/companies/${company.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {company.logo_url ? (
                        <div className="h-8 max-w-[80px] min-w-[32px] rounded overflow-hidden shrink-0 border border-border/50 bg-muted/30 p-0.5"
                          style={company.color_accent ? { borderColor: company.color_accent + '40' } : undefined}>
                          <img src={company.logo_url} alt={company.name} className="h-full w-full object-contain" />
                        </div>
                      ) : (
                        <div className="h-8 w-8 rounded flex items-center justify-center shrink-0"
                          style={{ backgroundColor: company.color_accent ? company.color_accent + '20' : 'hsl(var(--primary) / 0.1)' }}>
                          <Building2 className="h-4 w-4" style={{ color: company.color_accent || 'hsl(var(--primary))' }} />
                        </div>
                      )}
                      <span className="font-medium text-foreground group-hover:text-primary transition-colors truncate">{company.name}</span>
                      {company.color_accent && <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: company.color_accent }} />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="flex items-center justify-end gap-1.5">
                      <FolderOpen className="h-3 w-3 text-muted-foreground" />
                      <span>{companyCounts[company.id] || 0}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {company.jurisdiction ? (
                      <span className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{company.jurisdiction}</span>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">{new Date(company.updated_at || company.created_at).toLocaleDateString()}</span>
                  </TableCell>
                  <TableCell>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <ConfirmDialog title={`Delete ${company.name}?`} description="This will remove the company and unlink all its projects." onConfirm={() => deleteCompany.mutate(company.id)}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </ConfirmDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ExplorerLayout>
  );
}
