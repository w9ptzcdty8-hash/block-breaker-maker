export const BOARD_WIDTH = 360;
export const BOARD_HEIGHT = 560;
export const FIXED_STEP = 1 / 120;
export const MIN_BOUNCE_ANGLE = Math.PI / 6;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function limitShallowAngle(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= 0) return;

  const minimumVerticalSpeed = speed * Math.sin(MIN_BOUNCE_ANGLE);
  if (Math.abs(ball.vy) >= minimumVerticalSpeed) return;

  const verticalDirection = ball.vy > 0 ? 1 : -1;
  const horizontalDirection = ball.vx < 0 ? -1 : 1;
  ball.vy = minimumVerticalSpeed * verticalDirection;
  ball.vx = Math.sqrt(Math.max(0, speed * speed - ball.vy * ball.vy)) * horizontalDirection;
}

export function circleRectCollision(ball, rect) {
  const closestX = clamp(ball.x, rect.x, rect.x + rect.width);
  const closestY = clamp(ball.y, rect.y, rect.y + rect.height);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  const distanceSquared = dx * dx + dy * dy;

  if (distanceSquared > ball.radius * ball.radius) return null;

  if (distanceSquared > 0.0001) {
    const distance = Math.sqrt(distanceSquared);
    return {
      nx: dx / distance,
      ny: dy / distance,
      penetration: ball.radius - distance,
    };
  }

  const distances = [
    { value: ball.x - rect.x, nx: -1, ny: 0 },
    { value: rect.x + rect.width - ball.x, nx: 1, ny: 0 },
    { value: ball.y - rect.y, nx: 0, ny: -1 },
    { value: rect.y + rect.height - ball.y, nx: 0, ny: 1 },
  ];
  distances.sort((a, b) => a.value - b.value);

  return {
    nx: distances[0].nx,
    ny: distances[0].ny,
    penetration: ball.radius + distances[0].value,
  };
}

export function resolveCollision(ball, collision) {
  ball.x += collision.nx * (collision.penetration + 0.05);
  ball.y += collision.ny * (collision.penetration + 0.05);

  const dot = ball.vx * collision.nx + ball.vy * collision.ny;
  if (dot < 0) {
    ball.vx -= 2 * dot * collision.nx;
    ball.vy -= 2 * dot * collision.ny;
    limitShallowAngle(ball);
  }
}

export function reflectFromPaddle(ball, paddle) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const hitPosition = clamp((ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2), -1, 1);
  let vx = speed * hitPosition * 0.88;

  if (Math.abs(vx) < speed * 0.12) {
    const direction = ball.vx < 0 ? -1 : 1;
    vx = speed * 0.12 * direction;
  }

  ball.vx = vx;
  ball.vy = -Math.sqrt(Math.max(0, speed * speed - vx * vx));
  limitShallowAngle(ball);
  ball.y = paddle.y - ball.radius - 0.1;
}
