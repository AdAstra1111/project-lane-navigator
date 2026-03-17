/**
 * CCE Phase 2 — Live Validation Tests
 * 
 * Uses real canon from "Crimson Veil of Kyoto" (97372a9d) and crafted drift samples
 * to validate that the semantic detector catches the four required drift classes.
 */

import { extractCanonConstraints, detectCanonDrift, buildCanonConstraintBlock } from "./canonConstraintEnforcement.ts";
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── Real canon from "Crimson Veil of Kyoto" ──
const REAL_CANON = {
  characters: [
    {
      name: "Hana",
      role: "Lead Protagonist, Courtesan & Spy",
      description: "A young courtesan trained from childhood in the arts of seduction and subterfuge, secretly working for 'The Serpent's Coil.'",
      backstory: "Sold into a life of elaborate deception from childhood, trained in seduction and intelligence gathering",
    },
    {
      name: "Kenji",
      role: "Love Interest, Samurai & Faction Leader",
      description: "A charismatic and honorable samurai rising in the Shogun's ranks, who genuinely falls for Hana.",
    },
    {
      name: "Lady Akane",
      role: "Madame of the Teahouse, Hana's Handler",
      description: "Hana's mentor and handler, who appears benevolent but is a ruthless enforcer.",
    },
  ],
  logline: "A young courtesan, sold into a life of elaborate deception, falls for a mysterious samurai while unknowingly serving a hidden syndicate that manipulates against the Shogun, forcing her to choose between her love and exposing a truth that will ignite war.",
  premise: "Hana, a courtesan trained in seduction and subterfuge, secretly gathers intelligence for 'The Serpent's Coil,' a society aiming to destabilize the Shogunate. Her current target is Kenji, a charismatic samurai.",
  tone_style: "The tone is melodramatic with accelerating pacing, reminiscent of forbidden romance and intricate political intrigue.",
  world_rules: [
    "Courtesans are trained in intelligence gathering and subterfuge.",
    "The pleasure quarters are centers of both art and political intrigue.",
    "The Shogunate's power is constantly threatened by internal and external factions.",
    "Loyalty is a complex and often shifting concept, with no clear 'good' or 'evil' sides.",
  ],
  forbidden_changes: [],
};

// ── Case A: Same protagonist name, changed profession/background ──
Deno.test("Case A: Identity drift — protagonist profession changed", () => {
  const constraints = extractCanonConstraints(REAL_CANON);
  
  // Verify extraction
  assertEquals(constraints.protagonist.name, "Hana");
  assertNotEquals(constraints.extractedFrom, "empty");

  // Drifted text: Hana is now a samurai warrior, not a courtesan/spy
  const driftedText = `
    In the bustling streets of Kyoto, Hana works as a samurai warrior, wielding her katana with deadly precision.
    Trained from birth in the warrior arts by her father, a legendary swordsman, Hana serves the Shogun directly 
    as a military commander. She leads an army of 500 soldiers against rebel factions. Kenji, her old rival 
    from the academy, now serves as her lieutenant. Lady Akane is the chief strategist of their military council.
    The story follows Hana's dramatic campaign to crush the rebellion through decisive military action.
  `;

  const result = detectCanonDrift(driftedText, constraints);
  
  console.log("Case A findings:", JSON.stringify(result.findings, null, 2));
  console.log("Case A passed:", result.passed);
  
  // Should detect identity/profession drift
  const identityFindings = result.findings.filter(f => f.domain === "identity");
  console.log(`Identity findings count: ${identityFindings.length}`);
  
  // Verify there is at least one identity finding
  assertNotEquals(identityFindings.length, 0, "Should detect identity/profession drift when courtesan becomes samurai warrior");
});

// ── Case B: Same character names, changed relationship meaning ──
Deno.test("Case B: Relationship drift — relationship type changed", () => {
  const constraints = extractCanonConstraints(REAL_CANON);
  
  // Drifted text: Kenji is now Hana's brother instead of love interest
  const driftedText = `
    Hana, a courtesan in the pleasure quarters, discovers a shocking truth about Kenji. 
    The samurai she has known is actually her long-lost brother, separated at birth.
    Kenji, her sibling, shares the same birthmark on his shoulder. Lady Akane, their mother,
    had sent them to different families to protect them from political enemies. 
    The melodramatic revelation unfolds as brother and sister Kenji and Hana 
    must now navigate the dangerous world of court intrigue together as siblings united.
  `;

  const result = detectCanonDrift(driftedText, constraints);
  
  console.log("Case B findings:", JSON.stringify(result.findings, null, 2));
  console.log("Case B passed:", result.passed);
  
  // Should detect relationship drift for Kenji (love interest → sibling) and Lady Akane (handler → mother)
  const relFindings = result.findings.filter(f => f.domain === "relationship");
  console.log(`Relationship findings count: ${relFindings.length}`);
  
  assertNotEquals(relFindings.length, 0, "Should detect relationship type contradiction");
});

// ── Case C: Ambiguous supernatural escalated to literal ──
Deno.test("Case C: World-rule drift — grounded escalated to supernatural", () => {
  const constraints = extractCanonConstraints(REAL_CANON);
  
  // Canon world rules are grounded (political intrigue, no supernatural)
  console.log("Canon supernatural mode:", constraints.worldRuleMode.supernatural);
  
  // Drifted text: introduces confirmed supernatural elements
  const driftedText = `
    Hana, a courtesan in the pleasure district, discovers she has supernatural powers.
    The ghost of an ancient priestess reveals that Hana is actually a witch with telekinetic abilities.
    The ghost is real — it appears before multiple witnesses and demonstrates divine miracle powers.
    Hana casts a spell to protect Kenji from a demon that has possessed Lady Akane.
    Using her magic, she performs a ritual to summon the spirits of the dead ancestors.
    The curse is real — it transforms enemies into stone. Hana truly is possessed by supernatural forces.
    She unleashes her supernatural abilities to defeat the shadow government conspiracy.
  `;

  const result = detectCanonDrift(driftedText, constraints);
  
  console.log("Case C findings:", JSON.stringify(result.findings, null, 2));
  console.log("Case C passed:", result.passed);
  
  // Should detect world-rule escalation
  const worldRuleFindings = result.findings.filter(f => f.domain === "world_rule");
  console.log(`World rule findings count: ${worldRuleFindings.length}`);
  
  assertNotEquals(worldRuleFindings.length, 0, "Should detect supernatural escalation in grounded canon");
  
  // Should have at least one violation (not just warning)
  const violations = result.findings.filter(f => f.severity === "violation");
  console.log(`Violation count: ${violations.length}`);
});

// ── Case D: Contained premise escalated to broader mythology ──
Deno.test("Case D: Scope escalation — local intrigue becomes global conspiracy", () => {
  const constraints = extractCanonConstraints(REAL_CANON);
  
  // Drifted text: Shogunate intrigue becomes alien invasion / save the world
  const driftedText = `
    Hana, a courtesan in the pleasure district, uncovers that The Serpent's Coil is not merely 
    a political society but a global conspiracy connected to an ancient prophecy.
    The chosen one, Hana discovers, is destined to save the world from interdimensional beings 
    that have infiltrated the Shogunate. The fate of humanity rests on her shoulders.
    Kenji reveals that the multiverse is collapsing and only Hana's bloodline can stop it.
    Lady Akane is actually an alien invasion scout from a parallel dimension.
    The melodramatic story escalates as Hana must save civilization from nuclear apocalypse.
  `;

  const result = detectCanonDrift(driftedText, constraints);
  
  console.log("Case D findings:", JSON.stringify(result.findings, null, 2));
  console.log("Case D passed:", result.passed);
  
  const scopeFindings = result.findings.filter(f => f.domain === "scope_escalation");
  console.log(`Scope escalation findings count: ${scopeFindings.length}`);
  
  assertNotEquals(scopeFindings.length, 0, "Should detect scope escalation beyond canon");
});

// ── Case E: Canon-safe control — should pass cleanly ──
Deno.test("Case E: Canon-safe control — no false positives", () => {
  const constraints = extractCanonConstraints(REAL_CANON);
  
  // Canon-faithful text
  const safeText = `
    Hana, a courtesan trained in the arts of seduction and subterfuge, moves through the 
    pleasure quarters with practiced grace. Her mission from The Serpent's Coil is clear: 
    gather intelligence on the rising samurai Kenji. But as their encounters deepen, 
    Hana finds genuine feelings stirring beneath her calculated smiles.
    
    Lady Akane watches from the shadows, her handler's eye sharp and unforgiving. 
    The teahouse buzzes with whispered political intrigue as factions within the Shogunate 
    maneuver for advantage. Loyalty shifts like sand in the wind.
    
    Kenji, charismatic and honor-bound, confides in Hana about the threats facing the Shogun.
    The melodramatic tension between duty and desire intensifies with each stolen moment.
    Hana must choose between her loyalty to The Serpent's Coil and the forbidden love 
    that threatens to expose everything she has worked for.
  `;

  const result = detectCanonDrift(safeText, constraints);
  
  console.log("Case E findings:", JSON.stringify(result.findings, null, 2));
  console.log("Case E passed:", result.passed);
  console.log("Case E violations:", result.findings.filter(f => f.severity === "violation").length);
  console.log("Case E warnings:", result.findings.filter(f => f.severity === "warning").length);
  
  // Should pass with no violations
  assertEquals(result.passed, true, "Canon-safe text should pass drift detection");
  
  // Should have zero violations
  const violations = result.findings.filter(f => f.severity === "violation");
  assertEquals(violations.length, 0, "Canon-safe text should have zero violations");
});
