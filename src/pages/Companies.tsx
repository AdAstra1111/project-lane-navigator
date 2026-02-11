import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Building2, Trash2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCompanies, ProductionCompany } from '@/hooks/useCompanies';

function CompanyAvatar({ company }: { company: ProductionCompany }) {
  const accent = company.color_accent || undefined;
  if (company.logo_url) {
    return (
      <div
        className="h-10 max-w-[120px] min-w-[40px] rounded-lg overflow-hidden shrink-0 border border-border/50 bg-muted-foreground/10 dark:bg-muted-foreground/20 p-0.5"
        style={accent ? { borderColor: accent + '40' } : undefined}
      >
        <img src={company.logo_url} alt={company.name} className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div
      className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
      style={{ backgroundColor: accent ? accent + '20' : 'hsl(var(--primary) / 0.1)' }}
    >
      <Building2 className="h-5 w-5" style={{ color: accent || 'hsl(var(--primary))' }} />
    </div>
  );
}

export default function Companies() {
  const { companies, isLoading, createCompany, deleteCompany } = useCompanies();
  const [newName, setNewName] = useState('');
  const [showForm, setShowForm] = useState(false);

  const handleCreate = () => {
    if (!newName.trim()) return;
    createCompany.mutate(newName.trim());
    setNewName('');
    setShowForm(false);
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-end justify-between mb-8">
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
                  Production Companies
                </h1>
                <p className="text-muted-foreground mt-1">
                  {companies.length} compan{companies.length !== 1 ? 'ies' : 'y'}
                </p>
              </div>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                New Company
              </Button>
            </div>

            {showForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card rounded-lg p-4 mb-6 flex items-center gap-3"
              >
                <Input
                  placeholder="Company name..."
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  autoFocus
                  className="max-w-sm"
                />
                <Button onClick={handleCreate} disabled={!newName.trim() || createCompany.isPending}>
                  Create
                </Button>
                <Button variant="ghost" onClick={() => { setShowForm(false); setNewName(''); }}>
                  Cancel
                </Button>
              </motion.div>
            )}

            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="glass-card rounded-lg p-6 animate-pulse">
                    <div className="h-5 w-40 bg-muted rounded mb-2" />
                    <div className="h-3 w-24 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : companies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                  <Building2 className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-xl font-display font-semibold text-foreground mb-2">
                  Create your first production company
                </h2>
                <p className="text-muted-foreground mb-6 max-w-sm">
                  Group your projects under different production entities. Each company acts as its own dossier with a dedicated view of its slate.
                </p>
                <Button onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Company
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {companies.map((company, i) => (
                  <motion.div
                    key={company.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                    className="relative group"
                  >
                    <Link
                      to={`/companies/${company.id}`}
                      className="block glass-card rounded-lg p-6 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_30px_hsl(var(--glow-primary))]"
                      style={company.color_accent ? { borderColor: company.color_accent + '30' } : undefined}
                    >
                      <div className="flex items-start gap-3">
                        <CompanyAvatar company={company} />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-display font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {company.name}
                          </h3>
                          {company.jurisdiction && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {company.jurisdiction}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Created {new Date(company.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        {company.color_accent && (
                          <div
                            className="h-3 w-3 rounded-full shrink-0 mt-1"
                            style={{ backgroundColor: company.color_accent }}
                          />
                        )}
                      </div>
                    </Link>
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ConfirmDialog
                        title={`Delete ${company.name}?`}
                        description="This will remove the company and unlink all its projects. Projects themselves won't be deleted."
                        onConfirm={() => deleteCompany.mutate(company.id)}
                      >
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </ConfirmDialog>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </main>
      </div>
    </PageTransition>
  );
}
