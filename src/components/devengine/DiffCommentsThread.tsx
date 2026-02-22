import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageSquare, CheckCircle, RotateCw } from 'lucide-react';
import type { DiffComment } from '@/lib/scene-graph/types';

interface DiffCommentsThreadProps {
  comments: DiffComment[];
  sceneId?: string;
  beforeVersionId?: string;
  afterVersionId?: string;
  isLoading: boolean;
  onAddComment: (params: { sceneId?: string; beforeVersionId?: string; afterVersionId?: string; parentId?: string; comment: string }) => Promise<any>;
  onResolve: (params: { commentId: string; status: 'resolved' | 'open' }) => Promise<any>;
  isAddingComment: boolean;
}

export function DiffCommentsThread({
  comments, sceneId, beforeVersionId, afterVersionId,
  isLoading, onAddComment, onResolve, isAddingComment,
}: DiffCommentsThreadProps) {
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Filter to relevant comments
  const filtered = sceneId
    ? comments.filter(c => c.scene_id === sceneId)
    : comments;

  const handleAdd = async () => {
    if (!newComment.trim()) return;
    await onAddComment({ sceneId, beforeVersionId, afterVersionId, comment: newComment });
    setNewComment('');
  };

  const handleReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    await onAddComment({ sceneId, beforeVersionId, afterVersionId, parentId, comment: replyText });
    setReplyText('');
    setReplyTo(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        <MessageSquare className="h-3 w-3" /> Comments ({filtered.length})
      </div>

      <ScrollArea className="max-h-[200px]">
        <div className="space-y-1.5">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-auto" />}
          {filtered.map((c) => (
            <div key={c.id} className="space-y-1">
              <div className={`p-1.5 rounded border text-[10px] ${c.status === 'resolved' ? 'border-border/30 opacity-60' : 'border-border/50'}`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="font-medium text-foreground/80">{c.created_by?.slice(0, 8) || 'User'}</span>
                  <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                  <Badge variant="outline" className={`text-[8px] h-3.5 px-1 ml-auto ${c.status === 'resolved' ? 'text-green-600' : ''}`}>
                    {c.status}
                  </Badge>
                  <button
                    className="p-0.5 hover:bg-muted rounded"
                    onClick={() => onResolve({ commentId: c.id, status: c.status === 'open' ? 'resolved' : 'open' })}
                  >
                    {c.status === 'open' ? <CheckCircle className="h-2.5 w-2.5 text-green-500" /> : <RotateCw className="h-2.5 w-2.5 text-muted-foreground" />}
                  </button>
                </div>
                <p className="text-foreground/90">{c.comment}</p>
                <button className="text-[9px] text-primary hover:underline mt-0.5" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                  Reply
                </button>
              </div>

              {/* Replies */}
              {c.children && c.children.length > 0 && (
                <div className="ml-3 space-y-1">
                  {c.children.map((child) => (
                    <div key={child.id} className="p-1 rounded border border-border/30 text-[10px]">
                      <span className="font-medium text-foreground/80">{child.created_by?.slice(0, 8) || 'User'}: </span>
                      <span>{child.comment}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input */}
              {replyTo === c.id && (
                <div className="ml-3 flex gap-1">
                  <Textarea
                    className="text-[10px] min-h-[30px] flex-1"
                    placeholder="Reply..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                  />
                  <Button size="sm" className="h-7 text-[10px]" onClick={() => handleReply(c.id)} disabled={isAddingComment}>
                    {isAddingComment ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Send'}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!isLoading && filtered.length === 0 && (
            <p className="text-[10px] text-muted-foreground text-center py-2">No comments yet.</p>
          )}
        </div>
      </ScrollArea>

      {/* New comment */}
      <div className="flex gap-1">
        <Textarea
          className="text-[10px] min-h-[30px] flex-1"
          placeholder="Add a comment..."
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
        />
        <Button size="sm" className="h-7 text-[10px]" onClick={handleAdd} disabled={isAddingComment || !newComment.trim()}>
          {isAddingComment ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Send'}
        </Button>
      </div>
    </div>
  );
}
