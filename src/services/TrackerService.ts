import { PointObject } from "../types";

export interface TrackerStatusUpdate {
  id: string;
  status: "active" | "lost" | "removed";
}

class TrackerService {
  private pendingUpdates: Map<string, PointObject> = new Map();
  // Master state to track when we last heard from an object
  private lastSeen: Map<string, number> = new Map();
  // Track which objects are currently in 'lost' state to avoid redundant events
  private lostObjects: Set<string> = new Set();

  public ingestLocation(data: PointObject): void {
    if (!data.id || data.lat === undefined || data.lng === undefined) return;

    this.pendingUpdates.set(data.id, data);

    this.lastSeen.set(data.id, Date.now());

    // If it was lost and now we see it, it's active again
    if (this.lostObjects.has(data.id)) {
      this.lostObjects.delete(data.id);
    }
  }

  public getAndClearBatch(): PointObject[] {
    if (this.pendingUpdates.size === 0) return [];

    const batch = Array.from(this.pendingUpdates.values());

    this.pendingUpdates.clear();

    return batch;
  }

  /**
   * Scans all known objects and determines if any should be flagged as lost or removed.
   * @param lostThresholdMs Time since last update to flag as 'lost' (e.g. 30s)
   * @param removeThresholdMs Time since last update to remove entirely (e.g. 5m)
   */
  public checkStaleObjects(
    lostThresholdMs: number,
    removeThresholdMs: number,
  ): TrackerStatusUpdate[] {
    const now = Date.now();
    const updates: TrackerStatusUpdate[] = [];

    for (const [id, lastTime] of this.lastSeen.entries()) {
      const elapsed = now - lastTime;

      if (elapsed > removeThresholdMs) {
        // Time to remove completely
        this.lastSeen.delete(id);
        this.lostObjects.delete(id);

        updates.push({ id, status: "removed" });
      } else if (elapsed > lostThresholdMs && !this.lostObjects.has(id)) {
        // Flag as lost (only if not already flagged)
        this.lostObjects.add(id);

        updates.push({ id, status: "lost" });
      }
    }

    return updates;
  }
}

export const trackerService = new TrackerService();
