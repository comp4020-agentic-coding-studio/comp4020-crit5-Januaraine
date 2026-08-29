import { createInitialBall, createInitialPaddle, movePaddle, stepBall, type Ball, type Paddle } from "./dvd-game";

function initGame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  overlay: HTMLDivElement,
  restartButton: HTMLButtonElement,
): void {
  ctx.imageSmoothingEnabled = false;

  const bounds = { w: canvas.width, h: canvas.height };
  const PADDLE_SPEED = 260; // px/s
  const COLORS = ["#39ff88", "#ff4d6d", "#ffd93d", "#4dd2ff", "#c77dff"];
  const MOVE_KEYS = new Set(["KeyA", "KeyD", "ArrowLeft", "ArrowRight", "Space"]);

  let ball: Ball = createInitialBall(bounds);
  let paddle: Paddle = createInitialPaddle(bounds);
  let colorIndex = 0;
  let running = true;
  let flashUntil = 0;
  let lastTime = performance.now();
  let pointerX: number | null = null;

  const keys = { left: false, right: false };

  function pointerToCanvasX(clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (bounds.w / rect.width);
  }

  function reset(): void {
    ball = createInitialBall(bounds);
    paddle = createInitialPaddle(bounds);
    colorIndex = 0;
    pointerX = null;
    flashUntil = 0;
    running = true;
    overlay.hidden = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function draw(): void {
    const flashing = performance.now() < flashUntil;
    ctx.fillStyle = flashing ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, bounds.w, bounds.h);

    ctx.fillStyle = ball.color;
    ctx.fillRect(ball.x, ball.y, ball.w, ball.h);
    ctx.fillStyle = "#000000";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DVD", ball.x + ball.w / 2, ball.y + ball.h / 2 + 1);

    ctx.fillStyle = "#e6e6f0";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
  }

  function loop(time: number): void {
    if (!running) return;
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    let dx = 0;
    if (keys.left) dx -= PADDLE_SPEED * dt;
    if (keys.right) dx += PADDLE_SPEED * dt;
    if (dx !== 0) paddle = movePaddle(paddle, dx, bounds);

    if (pointerX !== null) {
      const targetX = pointerX - paddle.w / 2;
      paddle = movePaddle(paddle, targetX - paddle.x, bounds);
    }

    const result = stepBall(ball, paddle, bounds, dt);
    ball = result.ball;

    if (result.wallHit) {
      colorIndex = (colorIndex + 1) % COLORS.length;
      ball = { ...ball, color: COLORS[colorIndex]! };
    }
    if (result.cornerHit) {
      flashUntil = time + 150;
    }

    draw();

    if (result.gameOver) {
      running = false;
      overlay.hidden = false;
      return;
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (event) => {
    if (MOVE_KEYS.has(event.code)) event.preventDefault();
    if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = true;
    if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = true;
    if (!running && (event.code === "Space" || event.code === "Enter")) reset();
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = false;
    if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = false;
  });

  canvas.addEventListener("mousemove", (event) => {
    pointerX = pointerToCanvasX(event.clientX);
  });

  canvas.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (touch) pointerX = pointerToCanvasX(touch.clientX);
    },
    { passive: false },
  );

  canvas.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (touch) pointerX = pointerToCanvasX(touch.clientX);
    },
    { passive: false },
  );

  restartButton.addEventListener("click", reset);

  draw();
  requestAnimationFrame(loop);
}

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const overlay = document.querySelector<HTMLDivElement>("#game-over");
const restartButton = document.querySelector<HTMLButtonElement>("#restart");

if (canvas && overlay && restartButton) {
  const ctx = canvas.getContext("2d");
  if (ctx) initGame(canvas, ctx, overlay, restartButton);
}
