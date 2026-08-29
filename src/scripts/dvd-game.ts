// Pure, DOM-free game logic for the DVD-logo breakout game. Kept separate
// from main.ts so it can be unit tested without a canvas or jsdom.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Ball extends Rect {
  vx: number;
  vy: number;
  color: string;
  /**
   * Marks a miniature interference clone spawned by wallHitTriggersSpawn.
   * Omitted (undefined) for the main logo. Only the main logo — the one
   * without this flag — can end or win the game; a small logo missing the
   * paddle just disappears.
   */
  kind?: "small";
}

export type Paddle = Rect;

export interface Bounds {
  w: number;
  h: number;
}

export interface StepResult {
  ball: Ball;
  /** The logo touched the top, left, or right wall this step. */
  wallHit: boolean;
  /** The logo touched the top wall and a side wall in the same step. */
  cornerHit: boolean;
  /** The logo hit a corner exactly — the game's win condition. */
  win: boolean;
  /** The paddle caught the logo. */
  bounced: boolean;
  /** The logo's bottom edge cleared the paddle's bottom edge, uncaught. */
  gameOver: boolean;
}

// Fallback/reference dimensions for the logo's hit box. main.ts measures the
// actual rendered glyph ink (via canvas TextMetrics) and passes that tight
// size into createInitialBall so collision matches the visible wordmark;
// these constants are the default used when no measured size is given (and
// the reference height used to pick the wordmark's font size).
export const BALL_WIDTH = 120;
export const BALL_HEIGHT = 54;
export const PADDLE_WIDTH = 105;
export const PADDLE_HEIGHT = 15;
export const PADDLE_MARGIN_BOTTOM = 24;
export const INITIAL_SPEED = { vx: 210, vy: 180 };
export const DEFAULT_COLOR = "#39ff88";

// Paddle-bounce speed bounds. INITIAL_SPEED's magnitude is ~276.6px/s;
// MIN_SPEED keeps a caught logo from ever feeling sluggish, MAX_SPEED keeps
// it controllable while staying well above SPEED_BOOST_MULTIPLIER's boosted
// speed (~276.6 * 1.7 ≈ 470) so the catch-streak skill isn't clamped away.
export const MIN_SPEED = 200;
export const MAX_SPEED = 640;
// Outgoing bounce angle is measured from straight up (0 = vertical) and
// capped at this magnitude so a paddle catch can never send the logo off
// at a near-horizontal trajectory — a centre hit stays vertical, an edge
// hit deflects diagonally by at most this many degrees from vertical.
export const MAX_BOUNCE_ANGLE = (56 * Math.PI) / 180;
// Ball-vs-ball collisions (resolveBallCollisions) swap only the velocity
// component on the axis of least penetration, leaving the other axis
// untouched — correct equal-mass elastic physics for an axis-aligned hit,
// but with no bound on the result: one logo can end up giving away nearly
// all its speed (too slow) while the other inherits a lopsided vx/vy split
// (near-horizontal, can't come back down). This ratio is the minimum share
// of total speed that must remain on the vertical axis after any such
// collision — looser than MAX_BOUNCE_ANGLE's paddle-catch bound since a
// free-flight bounce can legitimately travel in any direction, not just up.
export const MIN_VERTICAL_RATIO = 0.3;

function overlapsX(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

export function createInitialBall(bounds: Bounds, size?: { w: number; h: number }): Ball {
  const w = size?.w ?? BALL_WIDTH;
  const h = size?.h ?? BALL_HEIGHT;
  return {
    x: bounds.w / 2 - w / 2,
    y: bounds.h / 3 - h / 2,
    w,
    h,
    vx: INITIAL_SPEED.vx,
    vy: INITIAL_SPEED.vy,
    color: DEFAULT_COLOR,
  };
}

export function createInitialPaddle(bounds: Bounds): Paddle {
  return {
    x: bounds.w / 2 - PADDLE_WIDTH / 2,
    y: bounds.h - PADDLE_MARGIN_BOTTOM - PADDLE_HEIGHT,
    w: PADDLE_WIDTH,
    h: PADDLE_HEIGHT,
  };
}

export function movePaddle(paddle: Paddle, dx: number, bounds: Bounds): Paddle {
  const x = Math.min(Math.max(paddle.x + dx, 0), bounds.w - paddle.w);
  return { ...paddle, x };
}

/**
 * Advances the ball by `dt` seconds, bounces it off the top/left/right
 * walls, and resolves the bottom band: caught by the paddle it bounces back
 * up; missed (its bottom edge clears the paddle's bottom edge without
 * overlapping the paddle's x-range) it's game over.
 */
export function stepBall(ball: Ball, paddle: Paddle, bounds: Bounds, dt: number): StepResult {
  let x = ball.x + ball.vx * dt;
  let y = ball.y + ball.vy * dt;
  let vx = ball.vx;
  let vy = ball.vy;

  let hitXWall = false;
  let hitTopWall = false;

  if (x <= 0) {
    x = 0;
    vx = Math.abs(vx);
    hitXWall = true;
  } else if (x + ball.w >= bounds.w) {
    x = bounds.w - ball.w;
    vx = -Math.abs(vx);
    hitXWall = true;
  }

  if (y <= 0) {
    y = 0;
    vy = Math.abs(vy);
    hitTopWall = true;
  }

  const cornerHit = hitXWall && hitTopWall;
  let bounced = false;
  let gameOver = false;

  const bottom = y + ball.h;
  const paddleTop = paddle.y;
  const paddleBottom = paddle.y + paddle.h;

  if (vy > 0 && bottom >= paddleTop) {
    const candidate: Rect = { x, y, w: ball.w, h: ball.h };
    if (overlapsX(candidate, paddle)) {
      y = paddleTop - ball.h;

      // Elastic, angle-based reflection: outgoing speed is the (clamped)
      // incoming speed, and outgoing direction comes from where on the
      // paddle it was caught — not from adding an unbounded term onto vx,
      // which is what let the old model drift toward near-zero or
      // near-horizontal velocity over repeated catches.
      const incomingSpeed = Math.hypot(vx, vy);
      const speed = Math.min(Math.max(incomingSpeed, MIN_SPEED), MAX_SPEED);
      const paddleCenter = paddle.x + paddle.w / 2;
      const ballCenter = x + ball.w / 2;
      const normalizedHitOffset = Math.min(Math.max((ballCenter - paddleCenter) / (paddle.w / 2), -1), 1);
      const angle = normalizedHitOffset * MAX_BOUNCE_ANGLE;

      vx = speed * Math.sin(angle);
      vy = -speed * Math.cos(angle);
      bounced = true;
    } else if (bottom > paddleBottom) {
      gameOver = true;
    }
  }

  return {
    ball: { ...ball, x, y, vx, vy },
    wallHit: hitXWall || hitTopWall,
    cornerHit,
    win: cornerHit,
    bounced,
    gameOver,
  };
}

const FROZEN_STEP: Omit<StepResult, "ball"> = {
  wallHit: false,
  cornerHit: false,
  win: false,
  bounced: false,
  gameOver: false,
};

/**
 * Same contract as stepBall, but when `paused` is true the ball is returned
 * completely unchanged and no wall/corner/paddle/win/game-over condition can
 * fire — pausing freezes the logo in place and suspends all state updates.
 */
export function stepGame(
  ball: Ball,
  paddle: Paddle,
  bounds: Bounds,
  dt: number,
  paused: boolean,
): StepResult {
  if (paused) return { ball, ...FROZEN_STEP };
  return stepBall(ball, paddle, bounds, dt);
}

/**
 * Toggles the paused flag, but only while the game is still running — once
 * the game has ended (win or game-over), pause/resume presses are no-ops so
 * they can't be mistaken for a restart or otherwise disturb the final state.
 */
export function togglePause(paused: boolean, running: boolean): boolean {
  return running ? !paused : paused;
}

/**
 * A "small" logo is a miniature clone spawned when the main logo's
 * cumulative wall-collision count crosses a multiple of
 * SPAWN_COLLISION_THRESHOLD. It bounces and collides exactly like the main
 * logo, but missing it is not a failure condition — only the main logo (the
 * one without `kind: "small"`) can end or win the game.
 */
export const SMALL_BALL_SCALE = 0.5;
export const SPAWN_COLLISION_THRESHOLD = 10;
export const SPAWN_COUNT = 5;

/** Every CATCH_SKILL_THRESHOLDth cumulative catch of the main logo grants a temporary speed boost. */
export const CATCH_SKILL_THRESHOLD = 5;
export const SPEED_BOOST_MULTIPLIER = 1.7;
export const SPEED_BOOST_DURATION_MS = 5000;

export function isSmallBall(ball: Ball): boolean {
  return ball.kind === "small";
}

/** True on the exact catch that should grant the speed-boost skill (the 5th, 10th, 15th, ... cumulative catch). */
export function catchTriggersSpeedBoost(catchCount: number): boolean {
  return catchCount > 0 && catchCount % CATCH_SKILL_THRESHOLD === 0;
}

/** True on the exact wall hit that should spawn a new wave of small logos (the 10th, 20th, 30th, ... cumulative wall hit). */
export function wallHitTriggersSpawn(wallHitCount: number): boolean {
  return wallHitCount > 0 && wallHitCount % SPAWN_COLLISION_THRESHOLD === 0;
}

/**
 * Spawns `count` small logos around the main logo's center, launched outward
 * in evenly spaced directions at the main logo's current speed.
 */
export function createSmallBalls(main: Ball, bounds: Bounds, count: number = SPAWN_COUNT): Ball[] {
  const w = main.w * SMALL_BALL_SCALE;
  const h = main.h * SMALL_BALL_SCALE;
  const speed = Math.hypot(main.vx, main.vy) || Math.hypot(INITIAL_SPEED.vx, INITIAL_SPEED.vy);
  const cx = main.x + main.w / 2;
  const cy = main.y + main.h / 2;

  const balls: Ball[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const x = Math.min(Math.max(cx - w / 2 + Math.cos(angle) * main.w, 0), bounds.w - w);
    const y = Math.min(Math.max(cy - h / 2 + Math.sin(angle) * main.h, 0), bounds.h - h);
    balls.push({ x, y, w, h, vx, vy, color: main.color, kind: "small" });
  }
  return balls;
}

function overlapsRect(a: Rect, b: Rect): boolean {
  return overlapsX(a, b) && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Rescales a velocity to a speed within [MIN_SPEED, MAX_SPEED] (preserving
 * its direction) and, if that leaves the vertical axis carrying less than
 * MIN_VERTICAL_RATIO of the total speed, redistributes the same total speed
 * between the axes so the vertical share meets that minimum — keeping each
 * axis's original sign (defaulting to positive for a zero component) rather
 * than picking a new direction outright.
 */
function clampVelocity(vx: number, vy: number): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed === 0) return { vx: 0, vy: MIN_SPEED };

  const clampedSpeed = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
  let nx = (vx / speed) * clampedSpeed;
  let ny = (vy / speed) * clampedSpeed;

  const minVy = clampedSpeed * MIN_VERTICAL_RATIO;
  if (Math.abs(ny) < minVy) {
    const vySign = ny >= 0 ? 1 : -1;
    const vxSign = nx >= 0 ? 1 : -1;
    ny = minVy * vySign;
    nx = Math.sqrt(Math.max(clampedSpeed * clampedSpeed - ny * ny, 0)) * vxSign;
  }

  return { vx: nx, vy: ny };
}

/**
 * Shared implementation behind resolveBallCollisions: also reports, per
 * input index, whether that logo took part in any collision this step (used
 * by stepEntities so a logo can recolor on a logo-vs-logo hit, not just a
 * wall hit).
 */
function resolveBallCollisionsWithFlags(balls: Ball[]): { balls: Ball[]; collided: boolean[] } {
  const result = balls.map((b) => ({ ...b }));
  const collided = balls.map(() => false);

  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i]!;
      const b = result[j]!;
      if (!overlapsRect(a, b)) continue;

      const overlapXAmt = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapYAmt = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

      if (overlapXAmt < overlapYAmt) {
        const push = overlapXAmt / 2;
        const aIsLeft = a.x < b.x;
        a.x += aIsLeft ? -push : push;
        b.x += aIsLeft ? push : -push;
        [a.vx, b.vx] = [b.vx, a.vx];
      } else {
        const push = overlapYAmt / 2;
        const aIsAbove = a.y < b.y;
        a.y += aIsAbove ? -push : push;
        b.y += aIsAbove ? push : -push;
        [a.vy, b.vy] = [b.vy, a.vy];
      }

      ({ vx: a.vx, vy: a.vy } = clampVelocity(a.vx, a.vy));
      ({ vx: b.vx, vy: b.vy } = clampVelocity(b.vx, b.vy));
      collided[i] = true;
      collided[j] = true;
    }
  }

  return { balls: result, collided };
}

/**
 * Resolves overlaps between any two logos (main or small) as an equal-mass
 * elastic collision: separates them along the axis of least penetration and
 * swaps their velocity component on that axis, then rebounds each logo's
 * resulting velocity through clampVelocity so the exchange can't leave one
 * logo almost stationary or the other stuck on a near-horizontal path.
 */
export function resolveBallCollisions(balls: Ball[]): Ball[] {
  return resolveBallCollisionsWithFlags(balls).balls;
}

export interface EntitiesStepResult {
  /**
   * Every logo that should still be in play next frame — the main logo is
   * always included; small logos that fell past the paddle uncaught are
   * dropped (that's not a failure, they just disappear).
   */
  balls: Ball[];
  /** The main logo's own step result — the only one that can end or win the game. */
  main: StepResult;
  /** Parallel to `balls`: whether that logo hit a wall this step, so each small logo can recolor on its own wall hits too. */
  wallHits: boolean[];
  /** Parallel to `balls`: whether that logo collided with another logo this step. */
  collisions: boolean[];
}

/**
 * Multi-logo counterpart to stepGame: steps every logo against the walls and
 * paddle, resolves logo-vs-logo collisions, and drops any small logo that
 * missed the paddle. Only the main logo (the one without `kind: "small"`)
 * can trigger win/gameOver.
 */
export function stepEntities(
  balls: Ball[],
  paddle: Paddle,
  bounds: Bounds,
  dt: number,
  paused: boolean,
): EntitiesStepResult {
  if (paused) {
    const main = balls.find((b) => !isSmallBall(b)) ?? balls[0]!;
    return {
      balls,
      main: { ball: main, ...FROZEN_STEP },
      wallHits: balls.map(() => false),
      collisions: balls.map(() => false),
    };
  }

  const stepped = balls.map((ball) => stepBall(ball, paddle, bounds, dt));
  const { balls: resolved, collided } = resolveBallCollisionsWithFlags(stepped.map((s) => s.ball));

  const kept: Ball[] = [];
  const wallHits: boolean[] = [];
  const collisions: boolean[] = [];
  let main: StepResult | undefined;

  for (let i = 0; i < resolved.length; i++) {
    const ball = resolved[i]!;
    const stepResult = stepped[i]!;
    if (isSmallBall(ball)) {
      if (stepResult.gameOver) continue;
      kept.push(ball);
      wallHits.push(stepResult.wallHit);
      collisions.push(collided[i]!);
    } else {
      main = { ...stepResult, ball };
      kept.push(ball);
      wallHits.push(stepResult.wallHit);
      collisions.push(collided[i]!);
    }
  }

  return { balls: kept, main: main!, wallHits, collisions };
}

/**
 * Keyboard and mouse/touch are independent input methods, not mutually
 * exclusive modes: either can move the paddle at any time, and whichever one
 * the player actually used most recently ("source") is the one whose intent
 * is applied on the next step. This is what lets keyboard immediately regain
 * control after mouse use, without the two fighting over the paddle every
 * frame or requiring the game to be re-focused.
 */
export type InputSource = "keyboard" | "pointer";

export interface InputState {
  keyLeft: boolean;
  keyRight: boolean;
  pointerX: number | null;
  source: InputSource | null;
}

export function createInputState(): InputState {
  return { keyLeft: false, keyRight: false, pointerX: null, source: null };
}

/**
 * Records a keyboard move key's pressed/released state. Pressing a move key
 * (not releasing one) hands input authority to the keyboard, so a stale
 * pointer position from earlier mouse use can no longer override it.
 */
export function setInputKey(
  state: InputState,
  direction: "left" | "right",
  pressed: boolean,
): InputState {
  const next: InputState =
    direction === "left" ? { ...state, keyLeft: pressed } : { ...state, keyRight: pressed };
  return pressed ? { ...next, source: "keyboard" } : next;
}

/** Records a mouse/touch pointer position and hands input authority to it. */
export function setInputPointer(state: InputState, x: number): InputState {
  return { ...state, pointerX: x, source: "pointer" };
}

/**
 * Resolves how far to move the paddle this step from whichever input source
 * is currently authoritative — keyboard velocity for "keyboard", or the
 * offset to the last known pointer position for "pointer". Returns 0 before
 * any input has ever been received.
 */
export function resolvePaddleDelta(
  state: InputState,
  paddle: Paddle,
  speed: number,
  dt: number,
): number {
  if (state.source === "keyboard") {
    let dx = 0;
    if (state.keyLeft) dx -= speed * dt;
    if (state.keyRight) dx += speed * dt;
    return dx;
  }
  if (state.source === "pointer" && state.pointerX !== null) {
    return state.pointerX - paddle.w / 2 - paddle.x;
  }
  return 0;
}
