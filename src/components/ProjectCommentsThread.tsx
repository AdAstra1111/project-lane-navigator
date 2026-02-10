import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Reply, Trash2, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useProjectComments,
  SECTION_LABELS,
  type ProjectComment,
} from '@/hooks/useCollaboration';
import { formatDistanceToNow } from 'date-fns';

function CommentBubble({
  comment,
  onReply,
  onDelete,
  currentUserId,
}: {
  comment: ProjectComment;
  onReply: (parentId: string) => void;
  onDelete: (commentId: string) => void;
  currentUserId: string | null;
}) {
  const [showReplies, setShowReplies] = useState(true);
  const isOwn = comment.user_id === currentUserId;

  return (
    <div className="group">
      <div className={`rounded-lg p-3 ${isOwn ? 'bg-primary/5 border border-primary/10' : 'bg-muted/40'}`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">
              {comment.display_name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onReply(comment.id)}
            >
              <Reply className="h-3 w-3 text-muted-foreground" />
            </Button>
            {isOwn && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onDelete(comment.id)}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{comment.content}</p>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-6 mt-2">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1.5 transition-colors"
          >
            {showReplies ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
          </button>
          <AnimatePresence>
            {showReplies && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 border-l-2 border-border/30 pl-3"
              >
                {comment.replies.map(reply => (
                  <CommentBubble
                    key={reply.id}
                    comment={reply}
                    onReply={onReply}
                    onDelete={onDelete}
                    currentUserId={currentUserId}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

interface ProjectCommentsThreadProps {
  projectId: string;
  currentUserId: string | null;
}

export function ProjectCommentsThread({ projectId, currentUserId }: ProjectCommentsThreadProps) {
  const [selectedSection, setSelectedSection] = useState<string>('general');
  const { comments, isLoading, addComment, deleteComment } = useProjectComments(projectId, selectedSection);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const handleSubmit = () => {
    if (!newComment.trim()) return;
    addComment.mutate(
      { content: newComment.trim(), parentId: replyTo || undefined, commentSection: selectedSection },
      {
        onSuccess: () => {
          setNewComment('');
          setReplyTo(null);
        },
      }
    );
  };

  const replyingToComment = replyTo ? comments.find(c => c.id === replyTo || c.replies?.some(r => r.id === replyTo)) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground text-lg">Discussion</h3>
          {comments.length > 0 && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {comments.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedSection} onValueChange={setSelectedSection}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SECTION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {/* Comment list */}
            {isLoading ? (
              <div className="space-y-2 mb-4">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6 mb-4">
                No comments in {SECTION_LABELS[selectedSection]?.toLowerCase() || 'this section'} yet.
              </p>
            ) : (
              <div className="space-y-3 mb-4 max-h-[400px] overflow-y-auto">
                {comments.map(comment => (
                  <CommentBubble
                    key={comment.id}
                    comment={comment}
                    onReply={setReplyTo}
                    onDelete={(id) => deleteComment.mutate(id)}
                    currentUserId={currentUserId}
                  />
                ))}
              </div>
            )}

            {/* Reply indicator */}
            {replyTo && (
              <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                <Reply className="h-3 w-3" />
                <span>Replying to a comment</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setReplyTo(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                className="min-h-[60px] text-sm resize-none"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSubmit();
                  }
                }}
              />
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!newComment.trim() || addComment.isPending}
                className="shrink-0 self-end"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
