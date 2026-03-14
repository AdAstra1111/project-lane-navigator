/**
 * FormattedDocContent — renders document content intelligently.
 * Detects JSON and renders structured documents (character bibles, etc.)
 * as readable prose instead of raw JSON.
 */
import { useState } from 'react';
import { Code, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  text: string;
  editable?: boolean;
  onChange?: (val: string) => void;
  className?: string;
}

// Field display labels
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  age: 'Age',
  role: 'Role',
  physical_description: 'Physical Description',
  first_impression: 'First Impression',
  backstory: 'Backstory',
  motivation: 'Motivation',
  arc: 'Character Arc',
  relationships: 'Relationships',
  voice: 'Voice',
  dialogue_style: 'Dialogue Style',
  secrets: 'Secrets',
  strengths: 'Strengths',
  weaknesses: 'Weaknesses',
  fears: 'Fears',
  goals: 'Goals',
  flaw: 'Fatal Flaw',
  fatal_flaw: 'Fatal Flaw',
  want: 'Want',
  need: 'Need',
  wound: 'Wound',
  ghost: 'Ghost',
  lie: 'The Lie They Believe',
  truth: 'The Truth',
  change: 'Change / Arc',
  traits: 'Key Traits',
  signature_behaviours: 'Signature Behaviours',
  signature_behaviors: 'Signature Behaviours',
  episode_appearances: 'Episode Appearances',
  casting_notes: 'Casting Notes',
  notes: 'Notes',
};

function CharacterCard({ char, index }: { char: Record<string, any>; index: number }) {
  const name = char.name || char.character_name || `Character ${index + 1}`;
  const role = char.role || char.character_role || '';

  const excludeKeys = new Set(['name', 'character_name', 'role', 'character_role']);
  const fields = Object.entries(char).filter(([k]) => !excludeKeys.has(k));

  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      paddingBottom: '2rem',
      marginBottom: '2rem',
    }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{
          fontSize: '1rem',
          fontWeight: 600,
          color: 'var(--foreground, #e2e0dc)',
          marginBottom: '0.2rem',
        }}>
          {name}
        </div>
        {role && (
          <div style={{
            fontSize: '0.7rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#c49a3d',
            opacity: 0.8,
          }}>
            {role}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {fields.map(([key, value]) => {
          if (!value || value === '' || value === null) return null;
          const label = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const displayValue = Array.isArray(value)
            ? value.join(', ')
            : typeof value === 'object'
              ? JSON.stringify(value, null, 2)
              : String(value);

          return (
            <div key={key}>
              <div style={{
                fontSize: '0.65rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(138,136,128,0.7)',
                marginBottom: '0.2rem',
              }}>
                {label}
              </div>
              <div style={{
                fontSize: '0.85rem',
                lineHeight: 1.65,
                color: 'rgba(226,224,220,0.85)',
                whiteSpace: 'pre-wrap',
              }}>
                {displayValue}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tryParseJSON(text: string): any | null {
  const trimmed = text.trim();
  // Try direct parse first (content starts with { or [)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* fall through to extraction */ }
  }
  // Try extracting the first JSON object/array even if there's leading text
  // Handles formats like "CHARACTERS\n{...}" or markdown-wrapped JSON
  const start = trimmed.search(/[{[]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* not JSON */ }
  }
  return null;
}

function renderJSON(parsed: any) {
  // Array of characters
  if (Array.isArray(parsed)) {
    // Check if it's an array of character objects
    if (parsed.length > 0 && typeof parsed[0] === 'object') {
      return (
        <div>
          {parsed.map((item, i) => (
            <CharacterCard key={i} char={item} index={i} />
          ))}
        </div>
      );
    }
    // Simple array
    return (
      <ul style={{ paddingLeft: '1.25rem', color: 'rgba(226,224,220,0.85)', fontSize: '0.85rem', lineHeight: 1.7 }}>
        {parsed.map((item: any, i: number) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }

  // Unwrap common wrapper keys: CHARACTER_BIBLE, character_bible, CHARACTERS, etc.
  const WRAPPER_KEYS = ['CHARACTER_BIBLE', 'character_bible', 'CHARACTERS', 'characters_list', 'cast'];
  for (const wk of WRAPPER_KEYS) {
    if (parsed[wk] && typeof parsed[wk] === 'object') {
      return renderJSON(parsed[wk]);
    }
  }

  // Object with a "characters" key
  if (parsed.characters && Array.isArray(parsed.characters)) {
    return (
      <div>
        {parsed.characters.map((char: any, i: number) => (
          <CharacterCard key={i} char={char} index={i} />
        ))}
      </div>
    );
  }

  // Single character object (has name or role)
  if (parsed.name || parsed.role || parsed.character_name) {
    return <CharacterCard char={parsed} index={0} />;
  }

  // Generic object — render as labelled fields
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {Object.entries(parsed).map(([key, value]) => {
        if (!value) return null;
        const label = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const display = Array.isArray(value)
          ? (typeof value[0] === 'object' ? null : value.join(', '))
          : typeof value === 'object' ? null : String(value);

        if (display === null && Array.isArray(value) && typeof value[0] === 'object') {
          return (
            <div key={key}>
              <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(138,136,128,0.7)', marginBottom: '0.5rem' }}>{label}</div>
              {value.map((item: any, i: number) => (
                <CharacterCard key={i} char={item} index={i} />
              ))}
            </div>
          );
        }

        return (
          <div key={key}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(138,136,128,0.7)', marginBottom: '0.2rem' }}>{label}</div>
            <div style={{ fontSize: '0.85rem', lineHeight: 1.65, color: 'rgba(226,224,220,0.85)', whiteSpace: 'pre-wrap' }}>{display || JSON.stringify(value, null, 2)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function FormattedDocContent({ text, editable, onChange, className }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = tryParseJSON(text);
  const isJSON = parsed !== null;

  if (!isJSON || showRaw) {
    return (
      <div>
        {isJSON && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground"
              onClick={() => setShowRaw(false)}>
              <Eye className="h-3 w-3" /> Formatted view
            </Button>
          </div>
        )}
        <textarea
          className={className || "w-full h-[300px] text-sm text-foreground whitespace-pre-wrap font-body leading-relaxed bg-transparent border-none outline-none resize-none focus:ring-0"}
          value={text}
          onChange={e => onChange?.(e.target.value)}
          readOnly={!editable}
          placeholder="Start writing here…"
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground"
          onClick={() => setShowRaw(true)}>
          <Code className="h-3 w-3" /> Raw
        </Button>
      </div>
      <div style={{ minHeight: 300 }}>
        {renderJSON(parsed)}
      </div>
    </div>
  );
}
