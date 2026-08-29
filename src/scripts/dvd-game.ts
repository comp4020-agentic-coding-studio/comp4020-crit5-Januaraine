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
    cornerHit: hitXWall && hitTopWall,
    bounced,
    gameOver,
  };
}
