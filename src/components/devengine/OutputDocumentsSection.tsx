/**
 * OutputDocumentsSection — Parallel packaging documents that can be generated
 * at any time during development. These are NOT ladder stages.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Loader2, Package, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { OUTPUT_DOC_TYPES_BY_LANE, BASE_DOC_TYPES, formatToLane } from '@/config/documentLadders';

interface OutputDocumentsSectionProps {
  projectId: string;
  projectFormat: string;
  /** All existing project documents with doc_type */
  existingDocTypes: string[];
}

const OUTPUT_DOC_DESCRIPTIONS: Record<string, string> = {
  market_sheet: 'Market positioning and commercial overview',
  vertical_market_sheet: 'Market positioning for vertical drama formats',
  deck: 'Pitch deck and lookbook for packaging',
  trailer_script: 'Scripted trailer beat sheet for marketing',
};

export function OutputDocumentsSection({
  projectId,
  projectFormat,
  existingDocTypes,
}: OutputDocumentsSectionProps) {
  const qc = useQueryClient();
  const [generatingDoc, setGeneratingDoc] = useState<string | null>(null);

  const lane = formatToLane(projectFormat);
  const outputDocs = OUTPUT_DOC_TYPES_BY_LANE[lane] || [];

  if (outputDocs.length === 0) return null;

  const handleGenerate = async (docType: string) => {
    if (generatingDoc) return;
    setGeneratingDoc(docType);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('You must be logged in to generate documents');
        return;
      }
      const { data, error } = await supabase.functions.invoke('generate-document', {
        body: { projectId, docType, userId: user.id, mode: 'draft' },
      });
      if (error) {
        toast.error(`Failed to generate ${BASE_DOC_TYPES[docType]?.label || docType}`);
        console.error('[OutputDocs] generation error:', error);
      } else {
        const label = BASE_DOC_TYPES[docType]?.label || docType;
        toast.success(`${label} generation started`);
        qc.invalidateQueries({ queryKey: ['documents', projectId] });
        qc.invalidateQueries({ queryKey: ['dev-v2-documents', projectId] });
      }
    } catch (err: any) {
      toast.error('Generation failed');
      console.error('[OutputDocs] error:', err);
    } finally {
      setGeneratingDoc(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Output Documents
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {outputDocs.map((docType) => {
          const meta = BASE_DOC_TYPES[docType];
          const exists = existingDocTypes.includes(docType);
          const isGenerating = generatingDoc === docType;
          const label = meta?.label || docType.replace(/_/g, ' ');
          const description = OUTPUT_DOC_DESCRIPTIONS[docType] || meta?.description || '';

          return (
            <Card key={docType} className="bg-card/50 border-border/40">
              <CardContent className="p-3 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-medium text-foreground truncate">{label}</span>
                    {exists && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        exists
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight mb-2">
                    {description}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 gap-1"
                    onClick={() => handleGenerate(docType)}
                    disabled={isGenerating || !!generatingDoc}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : exists ? (
                      <RefreshCw className="h-3 w-3" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {exists ? 'Regenerate' : 'Generate'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
