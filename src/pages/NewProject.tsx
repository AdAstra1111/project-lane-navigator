import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { useProjects } from '@/hooks/useProjects';
import { ProjectFormat, ProjectInput } from '@/lib/types';
import { GENRES, BUDGET_RANGES, TARGET_AUDIENCES, TONES, FORMAT_OPTIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const STEPS = ['Basics', 'Material', 'Creative', 'Commercial'];

export default function NewProject() {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
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
      const result = await createProject.mutateAsync({ input: form, files });
      navigate(`/projects/${result.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl py-10">
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
                  <Label className="text-foreground">Format</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {FORMAT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, format: opt.value as ProjectFormat }))}
                        className={cn(
                          'glass-card rounded-lg p-4 text-center transition-all duration-200',
                          form.format === opt.value
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'hover:border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <span className="font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
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
                  <h2 className="text-2xl font-display font-bold text-foreground mb-1">Creative Profile</h2>
                  <p className="text-muted-foreground">Describe the creative identity of your project.</p>
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">Genre <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                  <div className="flex flex-wrap gap-2">
                    {GENRES.map(genre => (
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
                    {TARGET_AUDIENCES.map(opt => (
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
                    {TONES.map(opt => (
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
                  <h2 className="text-2xl font-display font-bold text-foreground mb-1">Commercial Profile</h2>
                  <p className="text-muted-foreground">Help us understand the market positioning.</p>
                </div>
                <div className="space-y-3">
                  <Label className="text-foreground">Budget Range</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BUDGET_RANGES.map(opt => (
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
                  <Label className="text-foreground">Comparable Titles <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea
                    value={form.comparable_titles}
                    onChange={(e) => setForm(prev => ({ ...prev, comparable_titles: e.target.value }))}
                    placeholder="e.g. Moonlight meets The Rider, with elements of Nomadland"
                    className="bg-muted border-border/50 focus:border-primary resize-none"
                    rows={3}
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    Reference films or shows that share a similar tone, audience, or market positioning.
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
          )}
        </div>
      </main>
    </div>
  );
}
