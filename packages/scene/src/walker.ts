/**
 * Moves the athlete's spot toward a goal at walking pace. Pure numbers, no three.js.
 * The scene reads x/z (and finds y from the terrain), and hands walk/phase/facing to the athlete.
 */

/** Metres per second. */
export const WALK_SPEED = 1.6;
/** Metres per full stride cycle (two steps). */
export const STRIDE = 1.5;
/** Closer than this counts as arrived. */
const ARRIVE = 0.02;

export class Walker {
  x = 0;
  z = 0;
  goalX = 0;
  goalZ = 0;
  /** 0 still .. 1 walking, eased so the gait starts and stops smoothly. */
  walk = 0;
  /** Stride phase in radians. */
  phase = 0;
  /** Yaw, radians; 0 faces +z (toward the home camera). */
  facing = 0;

  /** Jump straight to a spot (first view, reduced motion). */
  place(x: number, z: number) {
    this.x = this.goalX = x;
    this.z = this.goalZ = z;
    this.walk = 0;
    this.facing = 0;
  }

  setGoal(x: number, z: number) {
    this.goalX = x;
    this.goalZ = z;
  }

  get moving() {
    return Math.hypot(this.goalX - this.x, this.goalZ - this.z) > ARRIVE;
  }

  step(dt: number) {
    const dx = this.goalX - this.x;
    const dz = this.goalZ - this.z;
    const dist = Math.hypot(dx, dz);
    let faceGoal = 0;
    if (dist > ARRIVE) {
      const move = Math.min(dist, WALK_SPEED * dt * Math.max(0.25, this.walk));
      this.x += (dx / dist) * move;
      this.z += (dz / dist) * move;
      this.phase = (this.phase + (move / STRIDE) * Math.PI * 2) % (Math.PI * 2);
      faceGoal = Math.atan2(dx, dz);
      this.walk = Math.min(1, this.walk + dt * 3);
    } else {
      this.x = this.goalX;
      this.z = this.goalZ;
      this.walk = Math.max(0, this.walk - dt * 3);
    }
    // Turn the short way round toward the goal (or back to the camera once there).
    let d = faceGoal - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * (1 - Math.pow(0.01, dt));
  }
}
