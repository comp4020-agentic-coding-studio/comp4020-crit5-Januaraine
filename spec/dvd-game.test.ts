import { describe, expect, it } from "vitest";
import {
  BALL_SIZE,
  createInitialPaddle,
  movePaddle,
  stepBall,
  type Ball,
  type Bounds,
} from "../src/scripts/dvd-game";

const bounds: Bounds = { w: 480, h: 320 };

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return {
    x: 200,
    y: 100,
    w: BALL_SIZE,
    h: BALL_SIZE,
    vx: 100,
    vy: 100,
    color: "#39ff88",
    ...overrides,
  };
}

describe("stepBall: walls", () => {
  it("reflects vx off the left wall", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ x: 2, vx: -100 }), paddle, bounds, 0.1);
    expect(result.ball.vx).toBeGreaterThan(0);
    expect(result.ball.x).toBeGreaterThanOrEqual(0);
    expect(result.wallHit).toBe(true);
  });

  it("reflects vx off the right wall", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: bounds.w - BALL_SIZE - 2, vx: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.ball.vx).toBeLessThan(0);
    expect(result.wallHit).toBe(true);
  });

  it("reflects vy off the top wall", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ y: 1, vy: -100 }), paddle, bounds, 0.1);
    expect(result.ball.vy).toBeGreaterThan(0);
    expect(result.wallHit).toBe(true);
  });

  it("flags a corner hit only when a side wall and the top wall are hit together", () => {
    const paddle = createInitialPaddle(bounds);
    const corner = stepBall(makeBall({ x: 1, y: 1, vx: -100, vy: -100 }), paddle, bounds, 0.1);
    expect(corner.cornerHit).toBe(true);

    const sideOnly = stepBall(makeBall({ x: 1, y: 100, vx: -100, vy: 0 }), paddle, bounds, 0.1);
    expect(sideOnly.cornerHit).toBe(false);
  });
});

describe("stepBall: paddle band", () => {
  it("bounces off the paddle when overlapping it while descending", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: paddle.x + paddle.w / 2 - BALL_SIZE / 2, y: paddle.y - 5, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.bounced).toBe(true);
    expect(result.ball.vy).toBeLessThan(0);
    expect(result.gameOver).toBe(false);
  });

  it("ends the game when the ball clears the paddle's bottom edge without overlap", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y + paddle.h + 1, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.gameOver).toBe(true);
    expect(result.bounced).toBe(false);
  });

  it("does not end the game while the ball is still above the paddle band", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y - 100, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.gameOver).toBe(false);
    expect(result.bounced).toBe(false);
  });

  it("does not end the game while sliding past the paddle but still inside its band", () => {
    // A shorter ball than the paddle band, so "inside the band but not yet
    // past its bottom edge" is a reachable state to assert on.
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y + 1, h: 5, vy: 10 });
    const result = stepBall(ball, paddle, bounds, 0.01);
    expect(result.gameOver).toBe(false);
    expect(result.bounced).toBe(false);
  });
});

describe("movePaddle", () => {
  it("clamps to the left edge", () => {
    const paddle = createInitialPaddle(bounds);
    expect(movePaddle(paddle, -10000, bounds).x).toBe(0);
  });

  it("clamps to the right edge", () => {
    const paddle = createInitialPaddle(bounds);
    expect(movePaddle(paddle, 10000, bounds).x).toBe(bounds.w - paddle.w);
  });
});
