/**
 * Deterministic warning → action mapping for CIK warning pills.
 * Shared between Trailer and Storyboard UIs.
 */
export function warningActionFor(w: string): { title: string; steps: string[] } {
  const l = w.toLowerCase();

  if (l.includes("arc") || l.includes("structure") || l.includes("peak") || l.includes("escalation")) {
    return {
      title: "Structure needs a clearer build and payoff.",
      steps: [
        "Ensure escalation rises across units and the peak lands late.",
        "Remove or reorder flat units rather than adding new ones.",
      ],
    };
  }

  if (l.includes("pacing") || l.includes("tempo") || l.includes("duration") || l.includes("length")) {
    return {
      title: "Pacing may feel uneven or sluggish.",
      steps: [
        "Tighten or split long units; avoid adding new content.",
        "Aim for smoother energy changes between adjacent units.",
      ],
    };
  }

  if (l.includes("tone") || l.includes("contrast") || l.includes("energy") || l.includes("flat")) {
    return {
      title: "Tone/energy contrast may be too low or too erratic.",
      steps: [
        "Increase contrast between key beats (calm → punchy) without changing premise.",
        "Reduce tonal jumps by deleting outlier units first.",
      ],
    };
  }

  if (l.includes("metadata") || l.includes("expected") || l.includes("unit") || l.includes("count")) {
    return {
      title: "Metadata or unit structure may be inconsistent.",
      steps: [
        "Verify unit count matches the expected count and keys are stable.",
        "Prefer trimming/padding deterministically over redesign.",
      ],
    };
  }

  if (l.includes("fail") || l.includes("missing") || l.includes("error")) {
    return {
      title: "A required constraint may not be met.",
      steps: [
        "Fix the highest-priority constraint first (missing/invalid fields).",
        "Re-run after minimal deletion-based edits.",
      ],
    };
  }

  return {
    title: "Review this warning and adjust minimally.",
    steps: ["Prefer deletion/reordering over adding new content."],
  };
}
