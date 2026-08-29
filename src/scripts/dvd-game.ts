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
      vy = -Math.abs(vy);
      const paddleCenter = paddle.x + paddle.w / 2;
      const ballCenter = x + ball.w / 2;
      const offset = (ballCenter - paddleCenter) / (paddle.w / 2);
      vx += offset * 60;
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
