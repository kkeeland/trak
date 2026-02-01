/**
 * JSONL merge conflict resolution
 * 
 * When git merge creates conflict markers in trak.jsonl,
 * this module detects and resolves them using last-write-wins
 * (newer updated_at timestamp wins per task ID).
 */

import { JsonlTask } from './jsonl.js';

export interface ConflictResolution {
  taskId: string;
  winner: 'ours' | 'theirs';
  oursUpdated: string;
  theirsUpdated: string;
}

export interface MergeResult {
  records: JsonlTask[];
  hadConflicts: boolean;
  resolutions: ConflictResolution[];
}

/**
 * Detect whether a JSONL file content has git merge conflict markers
 */
export function hasConflictMarkers(content: string): boolean {
  return content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>');
}

/**
 * Parse a JSONL file that may contain git merge conflict markers.
 * Extracts both sides of each conflict block, then merges using last-write-wins.
 */
export function resolveConflicts(content: string): MergeResult {
  if (!hasConflictMarkers(content)) {
    // No conflicts — parse normally
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const records = lines.map((line, i) => {
      try {
        return JSON.parse(line) as JsonlTask;
      } catch {
        throw new Error(`Invalid JSON on line ${i + 1}`);
      }
    });
    return { records, hadConflicts: false, resolutions: [] };
  }

  // Split into sections: non-conflict lines + conflict blocks
  const oursRecords: JsonlTask[] = [];
  const theirsRecords: JsonlTask[] = [];
  const sharedRecords: JsonlTask[] = [];

  const lines = content.split('\n');
  let inConflict = false;
  let side: 'ours' | 'theirs' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('<<<<<<<')) {
      inConflict = true;
      side = 'ours';
      continue;
    }

    if (trimmed.startsWith('=======') && inConflict) {
      side = 'theirs';
      continue;
    }

    if (trimmed.startsWith('>>>>>>>') && inConflict) {
      inConflict = false;
      side = null;
      continue;
    }

    try {
      const record = JSON.parse(trimmed) as JsonlTask;
      if (inConflict && side === 'ours') {
        oursRecords.push(record);
      } else if (inConflict && side === 'theirs') {
        theirsRecords.push(record);
      } else {
        sharedRecords.push(record);
      }
    } catch {
      // Skip unparseable lines (could be conflict marker artifacts)
      continue;
    }
  }

  // Build maps by task ID
  const oursMap = new Map<string, JsonlTask>();
  for (const r of oursRecords) oursMap.set(r.id, r);

  const theirsMap = new Map<string, JsonlTask>();
  for (const r of theirsRecords) theirsMap.set(r.id, r);

  const sharedMap = new Map<string, JsonlTask>();
  for (const r of sharedRecords) sharedMap.set(r.id, r);

  // Merge: shared records + resolved conflicts
  const merged = new Map<string, JsonlTask>();
  const resolutions: ConflictResolution[] = [];

  // Add shared (non-conflicted) records first
  for (const [id, record] of sharedMap) {
    merged.set(id, record);
  }

  // Collect all conflicted task IDs
  const conflictIds = new Set([...oursMap.keys(), ...theirsMap.keys()]);

  for (const id of conflictIds) {
    const ours = oursMap.get(id);
    const theirs = theirsMap.get(id);

    if (ours && theirs) {
      // Both sides have this task — last-write-wins
      const oursTime = new Date(ours.updated_at).getTime();
      const theirsTime = new Date(theirs.updated_at).getTime();
      const winner = theirsTime > oursTime ? 'theirs' : 'ours';
      merged.set(id, winner === 'ours' ? ours : theirs);
      resolutions.push({
        taskId: id,
        winner,
        oursUpdated: ours.updated_at,
        theirsUpdated: theirs.updated_at,
      });
    } else if (ours) {
      // Only in ours
      merged.set(id, ours);
    } else if (theirs) {
      // Only in theirs (new task from other side)
      merged.set(id, theirs);
    }
  }

  // Sort by created_at to maintain stable order
  const records = Array.from(merged.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return { records, hadConflicts: true, resolutions };
}
