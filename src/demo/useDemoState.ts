/**
 * Demo state engine — manages mock data mutations triggered by demo actions.
 */
import { useState, useCallback } from 'react';
import { MOCK_DOCS, MOCK_NOTES, DEMO_CONFIG, type MockDoc, type MockNote, type DemoAction } from './demoConfig';

export interface DemoState {
  docs: MockDoc[];
  notes: MockNote[];
  fixApplied: boolean;
  versionApproved: boolean;
  packageOpen: boolean;
}

export function useDemoState() {
  const [state, setState] = useState<DemoState>({
    docs: structuredClone(MOCK_DOCS),
    notes: structuredClone(MOCK_NOTES),
    fixApplied: false,
    versionApproved: false,
    packageOpen: false,
  });

  const executeAction = useCallback((action: DemoAction) => {
    if (!action) return;

    setState(prev => {
      const next = structuredClone(prev);

      if (action === 'APPLY_FIX' && !prev.fixApplied) {
        // Add Script v3 to the screenplay doc
        const scriptDoc = next.docs.find(d => d.id === 'doc-script');
        if (scriptDoc) {
          scriptDoc.versions.push({
            version_number: 3,
            label: 'Note fix v3 — midpoint reversal',
            status: 'draft',
            created_at: new Date().toISOString().slice(0, 10),
            change_summary: 'Applied fix: Act 2 midpoint now contains true reversal. 1 scene rewritten.',
          });
          // Mark note as resolved
          const note = next.notes.find(n => n.id === 'note-1');
          if (note) note.status = 'resolved';
        }
        next.fixApplied = true;
      }

      if (action === 'APPROVE_VERSION' && prev.fixApplied && !prev.versionApproved) {
        const scriptDoc = next.docs.find(d => d.id === 'doc-script');
        if (scriptDoc) {
          // Supersede v2, approve v3
          const v2 = scriptDoc.versions.find(v => v.version_number === 2);
          if (v2) v2.status = 'superseded';
          const v3 = scriptDoc.versions.find(v => v.version_number === 3);
          if (v3) v3.status = 'approved';
          scriptDoc.approved_version = 3;
        }
        next.versionApproved = true;
      }

      if (action === 'OPEN_PACKAGE') {
        next.packageOpen = true;
      }

      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState({
      docs: structuredClone(MOCK_DOCS),
      notes: structuredClone(MOCK_NOTES),
      fixApplied: false,
      versionApproved: false,
      packageOpen: false,
    });
  }, []);

  return { state, executeAction, reset };
}
