// Small portraits of the players, each a deep-sea character seen through a
// porthole. They react to the match, so the thought bubble has someone behind it.

export type AvatarKind = 'human' | 'random' | 'greedy' | 'chain';
export type AvatarMood = 'idle' | 'thinking' | 'decided' | 'excited' | 'win' | 'lose';

/** All characters are drawn for a porthole of this radius, then scaled. */
const ART_RADIUS = 34;
const RIVETS = 10;

interface AvatarPose {
  mood: AvatarMood;
  now: number;
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, { mood, now }: AvatarPose): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.4, radius * 0.5);
  ctx.strokeStyle = '#06121c';

  if (mood === 'win' || mood === 'excited') {
    // Closed, smiling eye.
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.35, radius * 0.9, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  if (mood === 'lose') {
    const r = radius * 0.72;
    ctx.strokeStyle = '#d5e2e8';
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    return;
  }
  // An occasional blink, offset per eye position so that they do not look mechanical.
  if ((now / 3400 + x * 0.002) % 1 < 0.035) {
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.stroke();
    return;
  }

  ctx.fillStyle = '#f4fbff';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Thinking: the pupil scans back and forth, as if reading the board.
  const look = mood === 'thinking' ? Math.sin(now / 340) * radius * 0.42 : radius * 0.22;
  const lift = mood === 'thinking' ? Math.cos(now / 510) * radius * 0.2 : 0;
  ctx.fillStyle = '#06121c';
  ctx.beginPath();
  ctx.arc(x + look, y + lift, radius * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + look - radius * 0.2, y + lift - radius * 0.22, radius * 0.17, 0, Math.PI * 2);
  ctx.fill();
}

function drawJellyfish(ctx: CanvasRenderingContext2D, pose: AvatarPose): void {
  const { now, mood } = pose;
  const speed = mood === 'thinking' ? 170 : 340;

  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  [-11, -4, 4, 11].forEach((x, index) => {
    ctx.strokeStyle = index % 2 === 0 ? '#3fe3d4' : '#9ff7ec';
    ctx.beginPath();
    ctx.moveTo(x, 3);
    for (let y = 3; y <= 24; y += 3) {
      ctx.lineTo(x + Math.sin(now / speed + y * 0.35 + index * 1.6) * 2.4, y);
    }
    ctx.stroke();
  });

  const pulse = 1 + Math.sin(now / speed) * 0.04;
  const dome = ctx.createRadialGradient(-5, -12, 2, 0, -4, 22);
  dome.addColorStop(0, '#d9fff9');
  dome.addColorStop(0.5, '#43e6d6');
  dome.addColorStop(1, '#13808a');
  ctx.save();
  ctx.scale(pulse, 2 - pulse);
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.moveTo(-18, 4);
  ctx.bezierCurveTo(-20, -24, 20, -24, 18, 4);
  ctx.quadraticCurveTo(12, 8, 6, 4);
  ctx.quadraticCurveTo(0, 8, -6, 4);
  ctx.quadraticCurveTo(-12, 8, -18, 4);
  ctx.fill();
  ctx.restore();

  drawEye(ctx, -6, -6, 3.6, pose);
  drawEye(ctx, 6, -6, 3.6, pose);
}

function drawAngler(ctx: CanvasRenderingContext2D, pose: AvatarPose): void {
  const { now, mood } = pose;

  // Tail, behind the body.
  ctx.fillStyle = '#b8452d';
  ctx.beginPath();
  ctx.moveTo(-13, 4);
  ctx.lineTo(-27, -7 + Math.sin(now / 260) * 2);
  ctx.lineTo(-25, 6);
  ctx.lineTo(-27, 16 - Math.sin(now / 260) * 2);
  ctx.closePath();
  ctx.fill();

  const body = ctx.createRadialGradient(-3, -7, 2, 2, 3, 22);
  body.addColorStop(0, '#ffad6b');
  body.addColorStop(0.55, '#e4633a');
  body.addColorStop(1, '#8f2c26');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(2, 3, 19, 0, Math.PI * 2);
  ctx.fill();

  // Lure on a stalk: it flickers while thinking.
  const flicker = mood === 'thinking' ? 0.55 + 0.45 * Math.abs(Math.sin(now / 150)) : 0.9;
  const lureX = 16 + Math.sin(now / 480) * 1.5;
  const lureY = -23 + Math.cos(now / 480);
  ctx.strokeStyle = '#ffb178';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-2, -15);
  ctx.quadraticCurveTo(4, -27, lureX, lureY);
  ctx.stroke();
  const glow = ctx.createRadialGradient(lureX, lureY, 0, lureX, lureY, 9);
  glow.addColorStop(0, `rgba(255, 250, 200, ${flicker})`);
  glow.addColorStop(0.35, `rgba(255, 215, 90, ${flicker * 0.75})`);
  glow.addColorStop(1, 'rgba(255, 190, 60, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(lureX, lureY, 9, 0, Math.PI * 2);
  ctx.fill();

  drawEye(ctx, 8, -4, 5.2, pose);

  // The mouth opens wide when something big is happening.
  const open = mood === 'excited' || mood === 'win' ? 7.5 : mood === 'lose' ? 1.2 : 3.2;
  const mouthY = 11;
  ctx.fillStyle = '#2a0a14';
  ctx.beginPath();
  ctx.ellipse(6, mouthY, 12, open, 0, 0, Math.PI * 2);
  ctx.fill();
  if (mood !== 'lose') {
    ctx.fillStyle = '#fff6e6';
    for (let x = -3; x <= 14; x += 4.2) {
      ctx.beginPath();
      ctx.moveTo(x - 1.7, mouthY - open + 0.6);
      ctx.lineTo(x + 1.7, mouthY - open + 0.6);
      ctx.lineTo(x, mouthY - open + 4.4);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawNautilus(ctx: CanvasRenderingContext2D, pose: AvatarPose): void {
  const { now, mood } = pose;

  // Tentacles and head, peeking out of the shell.
  ctx.strokeStyle = '#e6b9a5';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 4; i++) {
    const startY = 6 + i * 3;
    ctx.beginPath();
    ctx.moveTo(12, startY);
    ctx.quadraticCurveTo(21, startY + 2 + Math.sin(now / 300 + i) * 2, 27, startY + 5 + Math.sin(now / 240 + i * 1.4) * 2.5);
    ctx.stroke();
  }
  ctx.fillStyle = '#d99d86';
  ctx.beginPath();
  ctx.ellipse(11, 5, 10, 10.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const shell = ctx.createRadialGradient(-11, -9, 2, -5, -1, 22);
  shell.addColorStop(0, '#f5ecff');
  shell.addColorStop(0.5, '#b48bff');
  shell.addColorStop(1, '#4f2ea8');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(-5, -1, 19, 0, Math.PI * 2);
  ctx.fill();

  // The spiral: while thinking, a point of light runs along it, working out the chain.
  const spiralPoint = (t: number): [number, number] => {
    const radius = 1.5 + t * 15;
    const angle = t * Math.PI * 5.4 + 0.6;
    return [-5 + Math.cos(angle) * radius, -1 + Math.sin(angle) * radius];
  };
  ctx.strokeStyle = 'rgba(40, 18, 96, 0.75)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.02) {
    const [x, y] = spiralPoint(t);
    if (t === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (mood === 'thinking' || mood === 'excited') {
    const [x, y] = spiralPoint(1 - ((now / 1100) % 1));
    const spark = ctx.createRadialGradient(x, y, 0, x, y, 6);
    spark.addColorStop(0, 'rgba(255, 255, 255, 1)');
    spark.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spark;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEye(ctx, 15, 1, 4, pose);
}

function drawDiver(ctx: CanvasRenderingContext2D, pose: AvatarPose): void {
  const { now, mood } = pose;

  // Collar and shoulders.
  const collar = ctx.createLinearGradient(0, 14, 0, 30);
  collar.addColorStop(0, '#a36d24');
  collar.addColorStop(1, '#4e3210');
  ctx.fillStyle = collar;
  ctx.beginPath();
  ctx.moveTo(-14, 12);
  ctx.lineTo(14, 12);
  ctx.lineTo(25, 30);
  ctx.lineTo(-25, 30);
  ctx.closePath();
  ctx.fill();

  const helmet = ctx.createRadialGradient(-8, -12, 2, 0, -2, 24);
  helmet.addColorStop(0, '#ffe39a');
  helmet.addColorStop(0.55, '#d59a35');
  helmet.addColorStop(1, '#6e4613');
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.arc(0, -2, 21, 0, Math.PI * 2);
  ctx.fill();

  // Bolts around the rim.
  ctx.fillStyle = '#5a3a10';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * 17.6, -2 + Math.sin(angle) * 17.6, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Visor: the light inside brightens while it is this player's turn.
  const light = mood === 'thinking' ? 0.7 + Math.sin(now / 320) * 0.25 : mood === 'lose' ? 0.15 : 0.55;
  const visor = ctx.createRadialGradient(0, -2, 1, 0, -2, 13);
  visor.addColorStop(0, `rgba(120, 245, 235, ${light})`);
  visor.addColorStop(1, '#06202c');
  ctx.fillStyle = '#06202c';
  ctx.beginPath();
  ctx.arc(0, -2, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = visor;
  ctx.fill();
  ctx.strokeStyle = '#7a5216';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  drawEye(ctx, -5, -3, 3.3, pose);
  drawEye(ctx, 5, -3, 3.3, pose);

  // Glass reflection.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, -2, 10, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();
}

const CHARACTERS: Record<AvatarKind, (ctx: CanvasRenderingContext2D, pose: AvatarPose) => void> = {
  random: drawJellyfish,
  greedy: drawAngler,
  chain: drawNautilus,
  human: drawDiver,
};

/** A few bubbles rising through the porthole, a sign of the character's activity. */
function drawRisingBubbles(ctx: CanvasRenderingContext2D, now: number): void {
  ctx.strokeStyle = 'rgba(190, 240, 255, 0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const t = (now / 1500 + i * 0.27) % 1;
    const x = -22 + i * 15 + Math.sin(t * 9 + i) * 2;
    ctx.beginPath();
    ctx.arc(x, 30 - t * 60, 1.2 + i * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  kind: AvatarKind,
  cx: number,
  cy: number,
  radius: number,
  mood: AvatarMood,
  accent: string,
  active: boolean,
  facingLeft: boolean,
  now: number,
): void {
  const scale = radius / ART_RADIUS;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Water inside the porthole.
  const water = ctx.createRadialGradient(0, -12, 2, 0, 0, ART_RADIUS);
  water.addColorStop(0, '#12445a');
  water.addColorStop(1, '#04101a');
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.arc(0, 0, ART_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, ART_RADIUS - 1, 0, Math.PI * 2);
  ctx.clip();

  if (mood === 'thinking') drawRisingBubbles(ctx, now);

  let offsetX = 0;
  let offsetY = Math.sin(now / 620) * 1.6;
  let tilt = 0;
  if (mood === 'excited') {
    offsetX = Math.sin(now / 28) * 1.6;
    offsetY = Math.cos(now / 34) * 1.6;
  } else if (mood === 'win') {
    offsetY = -Math.abs(Math.sin(now / 190)) * 6 + 2;
  } else if (mood === 'lose') {
    offsetY = 7;
    tilt = 0.32;
  }

  ctx.save();
  ctx.translate(offsetX, offsetY);
  if (facingLeft) ctx.scale(-1, 1);
  ctx.rotate(tilt);
  CHARACTERS[kind](ctx, { mood, now });
  ctx.restore();

  if (mood === 'lose') {
    ctx.fillStyle = 'rgba(3, 8, 14, 0.5)';
    ctx.fillRect(-ART_RADIUS, -ART_RADIUS, ART_RADIUS * 2, ART_RADIUS * 2);
  }
  ctx.restore();

  // Riveted frame; the accent ring brightens on this player's turn.
  ctx.strokeStyle = '#17303d';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, ART_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#5d7f8d';
  for (let i = 0; i < RIVETS; i++) {
    const angle = (i / RIVETS) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * ART_RADIUS, Math.sin(angle) * ART_RADIUS, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = active ? 0.75 + Math.sin(now / 420) * 0.25 : 0.35;
  ctx.strokeStyle = accent;
  ctx.lineWidth = active ? 2 : 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, ART_RADIUS - 3.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}
