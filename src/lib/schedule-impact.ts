/**
 * Schedule Impact Engine
 *
 * Derives schedule-aware metrics from scene data and shoot day assignments.
 * These metrics feed into the Finance Readiness and Readiness Score engines
 * so that any schedule change automatically recalculates project scores.
 */

export interface ScheduleMetrics {
  totalScenes: number;
  totalPages: number;
  scheduledScenes: number;
  unscheduledScenes: number;
  shootDayCount: number;
  avgPagesPerDay: number;

  // Risk signals
  nightSceneCount: number;
  nightSceneRatio: number;
  extSceneCount: number;
  extRatio: number;
  uniqueLocations: number;
  uniqueCast: number;

  // Clustering / efficiency
  locationMoves: number;          // estimated company moves across shoot days
  heavyDays: number;              // days exceeding page threshold
  castHoldDaysEstimate: number;   // sum of estimated hold days
  overtimeRiskLevel: 'low' | 'medium' | 'high';
  schedulingFlags: string[];

  // Confidence
  scheduleConfidence: 'low' | 'medium' | 'high';
  hasSchedule: boolean;
}

interface SceneInput {
  id: string;
  scene_number: string;
  heading: string;
  int_ext: string;
  time_of_day: string;
  location: string;
  cast_members: string[];
  page_count: number;
}

interface ShootDayInput {
  id: string;
  shoot_date: string;
  day_number: number;
}

interface ScheduleEntryInput {
  scene_id: string;
  shoot_day_id: string;
}

const PAGES_PER_DAY_FILM = 3.5;
const PAGES_PER_DAY_TV = 6;
const HEAVY_DAY_THRESHOLD = 5; // pages

export function computeScheduleMetrics(
  scenes: SceneInput[],
  shootDays: ShootDayInput[],
  scheduleEntries: ScheduleEntryInput[],
  format?: string,
): ScheduleMetrics {
  const empty: ScheduleMetrics = {
    totalScenes: 0, totalPages: 0, scheduledScenes: 0, unscheduledScenes: 0,
    shootDayCount: 0, avgPagesPerDay: 0,
    nightSceneCount: 0, nightSceneRatio: 0, extSceneCount: 0, extRatio: 0,
    uniqueLocations: 0, uniqueCast: 0,
    locationMoves: 0, heavyDays: 0, castHoldDaysEstimate: 0,
    overtimeRiskLevel: 'low', schedulingFlags: [],
    scheduleConfidence: 'low', hasSchedule: false,
  };

  if (scenes.length === 0) return empty;

  const totalPages = scenes.reduce((s, sc) => s + (sc.page_count || 0), 0);
  const scheduledIds = new Set(scheduleEntries.map(e => e.scene_id));
  const scheduledScenes = scenes.filter(s => scheduledIds.has(s.id)).length;

  // Night / ext
  const nightScenes = scenes.filter(s => s.time_of_day?.toUpperCase() === 'NIGHT');
  const extScenes = scenes.filter(s => s.int_ext?.toUpperCase()?.startsWith('EXT'));

  // Locations & cast
  const locations = new Set(scenes.map(s => s.location).filter(Boolean));
  const allCast = new Set(scenes.flatMap(s => s.cast_members || []));

  // Per-day analysis
  const daySceneMap = new Map<string, SceneInput[]>();
  for (const entry of scheduleEntries) {
    const scene = scenes.find(s => s.id === entry.scene_id);
    if (!scene) continue;
    const arr = daySceneMap.get(entry.shoot_day_id) || [];
    arr.push(scene);
    daySceneMap.set(entry.shoot_day_id, arr);
  }

  let heavyDays = 0;
  let locationMoves = 0;
  const sortedDays = [...shootDays].sort((a, b) => a.shoot_date.localeCompare(b.shoot_date));

  for (const day of sortedDays) {
    const dayScenes = daySceneMap.get(day.id) || [];
    const dayPages = dayScenes.reduce((s, sc) => s + (sc.page_count || 0), 0);
    if (dayPages > HEAVY_DAY_THRESHOLD) heavyDays++;

    // Count distinct locations within a day (each beyond 1 = a company move)
    const dayLocations = new Set(dayScenes.map(s => s.location).filter(Boolean));
    if (dayLocations.size > 1) locationMoves += dayLocations.size - 1;
  }

  // Cast hold days estimate — for each cast member, count the span of days they appear
  let castHoldDays = 0;
  if (sortedDays.length > 0 && scheduleEntries.length > 0) {
    for (const actor of allCast) {
      const daysWithActor: number[] = [];
      for (let i = 0; i < sortedDays.length; i++) {
        const dayScenes = daySceneMap.get(sortedDays[i].id) || [];
        if (dayScenes.some(s => s.cast_members?.includes(actor))) {
          daysWithActor.push(i);
        }
      }
      if (daysWithActor.length >= 2) {
        const span = daysWithActor[daysWithActor.length - 1] - daysWithActor[0] + 1;
        const holdDays = span - daysWithActor.length; // days between first and last where they're not working
        castHoldDays += Math.max(0, holdDays);
      }
    }
  }

  // Avg pages per day
  const isTV = format?.toLowerCase()?.includes('series') || format?.toLowerCase()?.includes('tv');
  const targetPPD = isTV ? PAGES_PER_DAY_TV : PAGES_PER_DAY_FILM;
  const estimatedDays = shootDays.length > 0 ? shootDays.length : Math.ceil(totalPages / targetPPD);
  const avgPPD = estimatedDays > 0 ? totalPages / estimatedDays : 0;

  // Overtime risk
  const flags: string[] = [];
  let riskScore = 0;

  if (nightScenes.length / Math.max(scenes.length, 1) > 0.25) {
    riskScore += 2;
    flags.push(`Heavy night schedule (${nightScenes.length} scenes, ${Math.round(nightScenes.length / scenes.length * 100)}%)`);
  }
  if (extScenes.length / Math.max(scenes.length, 1) > 0.5) {
    riskScore += 1;
    flags.push(`High exterior ratio (${Math.round(extScenes.length / scenes.length * 100)}%) — weather dependency`);
  }
  if (locationMoves > shootDays.length * 0.5) {
    riskScore += 2;
    flags.push(`${locationMoves} company moves across ${shootDays.length} days — schedule pressure`);
  }
  if (heavyDays > shootDays.length * 0.3 && shootDays.length > 0) {
    riskScore += 2;
    flags.push(`${heavyDays} heavy days (>${HEAVY_DAY_THRESHOLD} pages) — overtime risk`);
  }
  if (avgPPD > targetPPD * 1.3) {
    riskScore += 1;
    flags.push(`Avg ${avgPPD.toFixed(1)} pages/day exceeds target ${targetPPD} — schedule is tight`);
  }
  if (castHoldDays > shootDays.length * 2 && shootDays.length > 0) {
    riskScore += 1;
    flags.push(`~${castHoldDays} estimated cast hold days — consider re-blocking`);
  }
  if (scenes.length > 0 && scheduledScenes === 0 && shootDays.length === 0) {
    flags.push('Scenes extracted but no shoot days created yet');
  }
  if (scheduledScenes > 0 && scheduledScenes < scenes.length) {
    flags.push(`${scenes.length - scheduledScenes} scenes still unscheduled`);
  }

  const overtimeRiskLevel: 'low' | 'medium' | 'high' = riskScore >= 4 ? 'high' : riskScore >= 2 ? 'medium' : 'low';

  // Schedule confidence
  let scheduleConfidence: 'low' | 'medium' | 'high' = 'low';
  if (shootDays.length > 0 && scheduledScenes >= scenes.length * 0.8) {
    scheduleConfidence = 'high';
  } else if (shootDays.length > 0 && scheduledScenes > 0) {
    scheduleConfidence = 'medium';
  }

  return {
    totalScenes: scenes.length,
    totalPages: Math.round(totalPages * 10) / 10,
    scheduledScenes,
    unscheduledScenes: scenes.length - scheduledScenes,
    shootDayCount: shootDays.length,
    avgPagesPerDay: Math.round(avgPPD * 10) / 10,
    nightSceneCount: nightScenes.length,
    nightSceneRatio: scenes.length > 0 ? nightScenes.length / scenes.length : 0,
    extSceneCount: extScenes.length,
    extRatio: scenes.length > 0 ? extScenes.length / scenes.length : 0,
    uniqueLocations: locations.size,
    uniqueCast: allCast.size,
    locationMoves,
    heavyDays,
    castHoldDaysEstimate: castHoldDays,
    overtimeRiskLevel,
    schedulingFlags: flags,
    scheduleConfidence,
    hasSchedule: shootDays.length > 0,
  };
}
