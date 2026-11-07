/**
 * Skeleton / rigging system.
 *
 * STATUS: stub — not implemented.
 * This module is reserved for the rigging and skeleton system. It exists
 * so the architecture is prepared and future code can be dropped in here
 * without restructuring the app.
 */
export class Skeleton {
  readonly bones: unknown[] = [];
  readonly root: unknown = null;

  constructor() {
    // TODO: build bone hierarchy, bind pose, skinning matrices.
  }
}

export const RIGGING_STATUS = 'not-implemented';