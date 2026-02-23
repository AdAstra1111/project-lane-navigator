import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, Building2, Lightbulb, Sparkles } from 'lucide-react';
import { ProcessStageProgress, type ProcessStage } from '@/components/ProcessStageProgress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { useProjects } from '@/hooks/useProjects';
import { useCompanies } from '@/hooks/useCompanies';
import { ProjectFormat, ProjectInput } from '@/lib/types';
import { MODE_GENRES, MODE_AUDIENCES, MODE_TONES, MODE_BUDGETS, MODE_COMPARABLE_CONFIG, MODE_CREATIVE_LABEL, MODE_COMMERCIAL_LABEL } from '@/lib/constants';
import { FORMAT_META } from '@/lib/mode-engine';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const ANALYSE_STAGES: ProcessStage[] = [
  { label: 'Uploading documents…', durationSec: 5 },
  { label: 'Extracting text from files…', durationSec: 15 },
  { label: 'Analysing structure & genre…', durationSec: 20 },
  { label: 'Evaluating market positioning…', durationSec: 15 },
  { label: 'Classifying monetisation lane…', durationSec: 10 },
  { label: 'Finalising analysis…', durationSec: 8 },
];

const CLASSIFY_STAGES: ProcessStage[] = [
  { label: 'Processing project details…', durationSec: 5 },
  { label: 'Classifying monetisation lane…', durationSec: 15 },
  { label: 'Finalising…', durationSec: 5 },
];

const STEPS = ['Basics', 'Material', 'Creative', 'Commercial'];

export default function NewProject() {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const { companies } = useCompanies();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [ideaText, setIdeaText] = useState('');
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [form, setForm] = useState<ProjectInput>({
    title: '',
    format: 'film',
    genres: [],
    budget_range: '',
    target_audience: '',
    tone: '',
    comparable_titles: '',
  });

  const toggleGenre = (genre: string) => {
    setForm(prev => ({
      ...prev,
      genres: prev.genres.includes(genre)
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre],
    }));
  };

  const canProceed = () => {
    switch (step) {
      case 0: return form.title.trim().length > 0 && form.format;
      case 1: return true; // Documents are optional
      case 2: return form.genres.length > 0 && form.target_audience && form.tone;
      case 3: return form.budget_range;
      default: return false;
    }
  };

  const handleSubmit = async () => {
    try {
      const result = await createProject.mutateAsync({ input: form, files, companyId: selectedCompanyId || undefined });
      navigate(`/projects/${result.id}`);
    } catch (err: any) {
      const message = err?.message || 'Failed to create project';
      if (message.includes('credits exhausted')) {
        toast.error('AI credits exhausted', {
          description: 'Please add more credits to your Lovable account to continue analysing projects.',
        });
      } else if (message.includes('Rate limit')) {
        toast.error('Too many requests', {
          description: 'Please wait a moment and try again.',
        });
      } else {
        toast.error('Analysis failed', {
          description: message,
        });
      }
      console.error('Failed to create project:', err);
    }
  };

  const handleIdeaCreate = async () => {
    if (!ideaText.trim()) return;
    setIdeaLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('idea-to-project', {
        body: { ideaText: ideaText.trim() },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed');
      toast.success('Project created from your idea!');
      navigate(`/projects/${data.projectId}`);
    } catch (err: any) {
      toast.error('Could not create project', { description: err.message });
    } finally {
      setIdeaLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl py-10">

        {/* Idea Quick-Create Box */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6 mb-8 border-primary/20 bg-primary/5"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
              <Lightbulb className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Develop a new project from just an idea</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Paste your notes, logline, or rough concept — AI will extract the details and create a project instantly.</p>
            </div>
          </div>
          <Textarea
            value={ideaText}
            onChange={(e) => setIdeaText(e.target.value)}
            placeholder="e.g. A psychological thriller set in a remote Antarctic research station where a crew of six begins to suspect one of them is not who they claim to be. Low budget, character-driven, practical effects only…"
            className="bg-background/60 border-border/50 focus:border-primary resize-none mb-3 text-sm"
            rows={4}
            maxLength={3000}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{ideaText.length}/3000 characters</span>
            <Button
              onClick={handleIdeaCreate}
              disabled={ideaText.trim().length < 10 || ideaLoading}
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
            >
              {ideaLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating project…</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5" /> Create Project from Idea</>
              )}
            </Button>
          </div>
        </motion.div>

        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">or fill in details manually</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors shrink-0',
                  i < step
                    ? 'bg-primary text-primary-foreground'
                    : i === step
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={cn(
                'text-sm font-medium hidden sm:inline',
                i <= step ? 'text-foreground' : 'text-muted-foreground'
              )}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'flex-1 h-px',
                  i < step ? 'bg-primary/50' : 'bg-border'
                )} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {/* Step 0: Basics */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-1">Project Basics</h2>
                  <p className="text-muted-foreground">What are you working on?</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Project Title</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g. The Last Crossing"
                    className="bg-muted border-border/50 focus:border-primary text-lg h-12"
                    maxLength={200}
                  />
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">Project Type</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {FORMAT_META.map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, format: opt.value as ProjectFormat, genres: [], target_audience: '', tone: '', budget_range: '' }))}
                          className={cn(
                            'glass-card rounded-lg p-4 text-left transition-all duration-200',
                            form.format === opt.value
                              ? 'border-primary/60 bg-primary/10 text-foreground'
                              : 'hover:border-border text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Icon className={cn('h-4 w-4', form.format === opt.value ? opt.color : '')} />
                            <span className="font-medium text-sm">{opt.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{opt.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {companies.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-foreground">Production Company <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <div className="grid grid-cols-2 gap-3">
                      {companies.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCompanyId(prev => prev === c.id ? null : c.id)}
                          className={cn(
                            'glass-card rounded-lg p-4 text-left transition-all duration-200 flex items-center gap-3',
                            selectedCompanyId === c.id
                              ? 'border-primary/60 bg-primary/10 text-foreground'
                              : 'hover:border-border text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <Building2 className="h-4 w-4 shrink-0" />
                          <span className="font-medium truncate">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 1: Material Upload */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-1">Upload Material</h2>
                  <p className="text-muted-foreground">
                    Upload scripts, pitch decks, treatments, or any written material. 
                    The AI will analyze the content directly to determine your project's lane.
                  </p>
                </div>
                <FileUpload files={files} onFilesChange={setFiles} />
                <div className="glass-card rounded-lg p-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    <span className="text-foreground font-medium">How it works:</span> When you upload material, 
                    the AI performs a structured three-pass analysis — evaluating narrative structure, creative signal, 
                    and market reality — to classify your project based on the execution on the page, not just metadata.
                  </p>
                </div>
                {files.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    You can skip this step — the AI will classify based on your form inputs instead.
                  </p>
                )}
              </div>
            )}

            {/* Step 2: Creative */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-1">{MODE_CREATIVE_LABEL[form.format].title}</h2>
                  <p className="text-muted-foreground">{MODE_CREATIVE_LABEL[form.format].subtitle}</p>
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">{MODE_CREATIVE_LABEL[form.format].genreLabel} <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                  <div className="flex flex-wrap gap-2">
                    {MODE_GENRES[form.format].map(genre => (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => toggleGenre(genre)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-sm font-medium border transition-all duration-200',
                          form.genres.includes(genre)
                            ? 'bg-primary/15 text-primary border-primary/40'
                            : 'bg-muted/50 text-muted-foreground border-border/50 hover:text-foreground hover:border-border'
                        )}
                      >
                        {genre}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">Target Audience</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {MODE_AUDIENCES[form.format].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, target_audience: opt.value }))}
                        className={cn(
                          'glass-card rounded-lg px-4 py-3 text-left text-sm transition-all duration-200',
                          form.target_audience === opt.value
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'hover:border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">Tone</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {MODE_TONES[form.format].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, tone: opt.value }))}
                        className={cn(
                          'glass-card rounded-lg px-4 py-3 text-left text-sm transition-all duration-200',
                          form.tone === opt.value
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'hover:border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Commercial */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-1">{MODE_COMMERCIAL_LABEL[form.format].title}</h2>
                  <p className="text-muted-foreground">{MODE_COMMERCIAL_LABEL[form.format].subtitle}</p>
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">Budget Range</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MODE_BUDGETS[form.format].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, budget_range: opt.value }))}
                        className={cn(
                          'glass-card rounded-lg px-4 py-3 text-center text-sm transition-all duration-200',
                          form.budget_range === opt.value
                            ? 'border-primary/60 bg-primary/10 text-foreground font-medium'
                            : 'hover:border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">{MODE_COMPARABLE_CONFIG[form.format].label} <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea
                    value={form.comparable_titles}
                    onChange={(e) => setForm(prev => ({ ...prev, comparable_titles: e.target.value }))}
                    placeholder={MODE_COMPARABLE_CONFIG[form.format].placeholder}
                    className="bg-muted border-border/50 focus:border-primary resize-none"
                    rows={3}
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    {MODE_COMPARABLE_CONFIG[form.format].hint}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-10 pt-6 border-t border-border/50">
          <Button
            variant="ghost"
            onClick={() => step === 0 ? navigate('/dashboard') : setStep(s => s - 1)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {step === 1 && files.length === 0 ? 'Skip' : 'Continue'}
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <>
              <Button
                onClick={handleSubmit}
                disabled={!canProceed() || createProject.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {createProject.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    {files.length > 0 ? 'Analysing Material…' : 'Classifying…'}
                  </>
                ) : (
                  <>
                    {files.length > 0 ? 'Analyse & Classify' : 'Classify Project'}
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </>
                )}
              </Button>
              {createProject.isPending && (
                <div className="w-full mt-3">
                  <ProcessStageProgress
                    isActive={createProject.isPending}
                    stages={files.length > 0 ? ANALYSE_STAGES : CLASSIFY_STAGES}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
