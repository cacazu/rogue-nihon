// Regions follow the anatomy of the original 32px sprites. The first matching
// region owns each pixel; all other pixels stay in the body. Coordinates are
// inclusive and refer to the original image, never to a regenerated design.
const profiles = {
  aquator: { kind: 'blob', head: [10, 5, 22, 13], partA: [0, 13, 10, 24], partB: [23, 12, 31, 24], legY: 25, split: 16 },
  bat: { kind: 'wings', head: [13, 14, 19, 24], partA: [0, 0, 12, 31], partB: [20, 0, 31, 31], legY: 22, split: 16, joint: 16, strength: 3 },
  centaur: { kind: 'quadruped', head: [16, 2, 26, 8], partA: [20, 9, 31, 18], tail: [0, 16, 7, 25], legY: 24, split: 16, direction: 1 },
  dragon: { kind: 'quadruped', head: [6, 2, 17, 14], partA: [20, 5, 31, 23], partB: [6, 15, 12, 24], tail: [0, 22, 10, 31], legY: 26, split: 17 },
  emu: { kind: 'bird', head: [4, 2, 14, 17], partA: [21, 16, 31, 23], tail: [22, 20, 31, 26], legY: 24, split: 18 },
  venus_flytrap: { kind: 'plant', partA: [12, 2, 26, 10], partB: [13, 11, 26, 18], tail: [0, 19, 13, 25], legY: 25, split: 16 },
  griffin: { kind: 'quadruped', head: [3, 8, 13, 17], partA: [18, 2, 31, 22], tail: [22, 23, 31, 26], legY: 25, split: 16 },
  hobgoblin: { kind: 'humanoid', head: [11, 3, 21, 13], partA: [0, 8, 10, 23], partB: [21, 15, 31, 25], legY: 24, split: 16 },
  ice_monster: { kind: 'humanoid', head: [11, 2, 21, 14], partA: [0, 13, 10, 24], partB: [22, 13, 31, 24], legY: 25, split: 16 },
  jabberwock: { kind: 'humanoid', head: [12, 3, 23, 14], partA: [0, 13, 11, 24], partB: [23, 13, 31, 24], legY: 25, split: 16, direction: 1 },
  kestrel: { kind: 'wings', head: [16, 20, 25, 26], partA: [0, 0, 13, 24], partB: [21, 0, 31, 20], tail: [0, 25, 15, 31], legY: 26, split: 20, joint: 17, strength: 1, direction: 1 },
  leprechaun: { kind: 'humanoid', head: [10, 2, 22, 17], partA: [0, 17, 11, 24], partB: [22, 14, 31, 23], legY: 24, split: 16, direction: 1 },
  medusa: { kind: 'spectral', head: [10, 2, 20, 14], partA: [0, 15, 12, 23], partB: [19, 15, 31, 23], legY: 24, split: 16 },
  nymph: { kind: 'humanoid', head: [11, 2, 19, 12], partA: [0, 13, 12, 22], partB: [19, 13, 31, 22], legY: 23, split: 16, direction: 1 },
  orc: { kind: 'humanoid', head: [12, 4, 22, 13], partA: [0, 12, 11, 23], partB: [23, 13, 31, 23], legY: 24, split: 16 },
  phantom: { kind: 'spectral', head: [10, 2, 22, 17], partA: [0, 17, 11, 25], partB: [23, 17, 31, 25], legY: 24, split: 16 },
  quagga: { kind: 'quadruped', head: [2, 3, 12, 19], tail: [26, 17, 31, 24], legY: 24, split: 16 },
  rattlesnake: { kind: 'snake', head: [8, 2, 21, 12], partA: [16, 13, 24, 21], tail: [25, 10, 31, 24], legY: 23, split: 15 },
  snake: { kind: 'snake', head: [16, 2, 28, 12], partA: [17, 13, 27, 20], tail: [0, 19, 10, 31], legY: 24, split: 16, direction: 1 },
  troll: { kind: 'humanoid', head: [10, 3, 22, 14], partA: [0, 14, 10, 23], partB: [23, 14, 31, 23], legY: 24, split: 16 },
  black_unicorn: { kind: 'quadruped', head: [2, 4, 12, 19], tail: [27, 16, 31, 25], legY: 23, split: 16 },
  vampire: { kind: 'humanoid', head: [11, 2, 21, 13], partA: [0, 13, 10, 25], partB: [22, 13, 31, 25], legY: 25, split: 16 },
  wraith: { kind: 'spectral', head: [12, 2, 21, 16], partA: [0, 16, 12, 24], partB: [22, 16, 31, 24], legY: 24, split: 16 },
  xeroc: { kind: 'blob', head: [11, 4, 22, 17], partA: [0, 17, 10, 31], partB: [23, 14, 31, 31], legY: 24, split: 16 },
  yeti: { kind: 'humanoid', head: [10, 2, 22, 13], partA: [0, 13, 10, 24], partB: [23, 13, 31, 24], legY: 25, split: 16 },
  zombie: { kind: 'humanoid', head: [11, 2, 18, 12], partA: [0, 13, 11, 22], partB: [18, 10, 31, 20], legY: 23, split: 16, direction: 1 }
};
const inside = (x, y, r) => r && x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3];
const wave = (phase, amplitude = 1) => ({ wave: { phase, amplitude } });

export function monsterAnimation(id, original) {
  const profile = profiles[id.replace('monster.', '')];
  if (!profile) throw Error('Missing anatomy profile: ' + id);
  const groups = Object.fromEntries(['core', 'head', 'partA', 'partB', 'tail', 'feetA', 'feetB'].map(name => [name, []]));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const rgba = original.subarray((y * 32 + x) * 4, (y * 32 + x + 1) * 4);
    if (!rgba[3]) continue;
    let name = ['head', 'partA', 'partB', 'tail'].find(name => inside(x, y, profile[name]));
    name ||= y >= profile.legY ? (x <= profile.split ? 'feetA' : 'feetB') : 'core';
    groups[name].push({ x, y, rgba });
  }
  const d = profile.direction || -1;
  const poses = {
    idle: [
      { partA: [0, -1], partB: [0, 1], tail: [-1, 0] },
      { partA: [-1, 0], partB: [1, -1], tail: [0, -1] },
      { partA: [0, 1], partB: [-1, 0], tail: [1, 0] }
    ],
    move: [
      { feetA: [-1, -1], feetB: [1, 0], partA: [0, 1], partB: [0, -1], tail: [-1, 1] },
      { feetA: [0, 1], feetB: [0, -1], partA: [-1, 0], partB: [-1, 0], tail: [0, -1] },
      { feetA: [1, 0], feetB: [-1, -1], partA: [0, -1], partB: [0, 1], tail: [1, 1] }
    ],
    attack: [
      { partA: [0, -2], partB: [-d, 0], feetA: [-1, 0], tail: [0, -1] },
      { partA: [2 * d, -1], partB: [2 * d, 1], core: [d, 0], head: [d, 0], feetA: [d, 1], tail: [-d, 0] },
      { partA: [d, -1], partB: [-d, 1], feetB: [0, 1], tail: [1, -1] }
    ],
    hurt: [
      { core: [-d, 0], head: [-d, -1], partA: [0, 1], partB: [-d, 1], tail: [d, 1] },
      { core: [-d, 1], head: [-d, 1], partA: [-d, 2], partB: [d, 1], feetA: [0, 1], feetB: [-1, 0], tail: [d, -1] },
      { partA: [1, -1], partB: [-1, 1], feetB: [1, -1], tail: [-1, -1] }
    ]
  };
  if (profile.kind === 'quadruped' || profile.kind === 'bird') {
    poses.idle = [
      { tail: [-1, 0], partA: [0, -1], head: [0, -1] },
      { tail: [0, -1], partA: [0, -2], head: [0, 1] },
      { tail: [1, 0], partA: [0, 1], head: [-d, 0] }
    ];
    const front = d < 0 ? 'feetA' : 'feetB';
    poses.attack = [
      { head: [-d, -1], [front]: [0, -2], partA: [0, -2], tail: [0, -1] },
      { head: [2 * d, 1], core: [d, 0], [front]: [d, -1], partA: [d, -1], tail: [-d, 0] },
      { head: [d, 0], [front]: [0, -1], partA: [0, 1], tail: [1, -1] }
    ];
  }
  if (profile.kind === 'wings') {
    const bend = value => ({ bend: value, joint: profile.joint });
    const s = profile.strength;
    poses.idle = [
      { partA: bend(1), partB: bend(-1) },
      { partA: bend(-1), partB: bend(1), head: [0, -1] },
      { partA: bend(1), partB: bend(1), tail: [1, 0] }
    ];
    poses.move = [
      { partA: bend(s), partB: bend(-s), tail: [-1, 0], core: [0, -1], head: [0, -1] },
      { partA: bend(-1), partB: bend(-1), tail: [1, 0], feetA: [0, 1], feetB: [0, 1] },
      { partA: bend(-s), partB: bend(s), tail: [0, -1], core: [0, 1], head: [0, 1] }
    ];
    poses.attack = [
      { partA: bend(-2), partB: bend(2), head: [-d, -1], feetA: [0, -1] },
      { partA: bend(-3), partB: bend(3), head: [d, 1], core: [d, 1], feetA: [d, 2], feetB: [d, 2], tail: [-1, 0] },
      { partA: bend(2), partB: bend(-1), head: [0, 1], feetB: [-1, 0] }
    ];
  }
  if (profile.kind === 'snake') {
    poses.idle = [0, 2, 4].map((p, i) => ({ core: wave(p), feetA: wave(p), feetB: wave(p), tail: [i - 1, -1] }));
    poses.move = [0, 2, 4].map((p, i) => ({ core: wave(p, 2), feetA: wave(p + 1, 2), feetB: wave(p + 1, 2), tail: [1 - i, 0], head: [i === 1 ? d : 0, i === 2 ? 1 : 0] }));
    poses.attack = [
      { head: [-d, -1], partA: [-d, 0], core: wave(1), tail: [0, -1] },
      { head: [2 * d, 1], partA: [d, 1], core: wave(3), feetA: wave(3), tail: [-d, 0] },
      { head: [d, 0], partA: [0, 1], core: wave(5), tail: [1, -1] }
    ];
    poses.hurt = [0, 2, 4].map((p, i) => ({ head: [-d, i === 1 ? 1 : 0], core: wave(p + 1, 2), feetA: wave(p, 2), feetB: wave(p, 2), tail: [-1, i - 1] }));
  }
  if (profile.kind === 'spectral' || profile.kind === 'blob') {
    for (const [state, frames] of Object.entries(poses)) for (const [i, pose] of frames.entries()) {
      pose.feetA = wave(i * 2 + (state === 'move' ? 1 : 0), state === 'move' ? 2 : 1);
      pose.feetB = wave(i * 2 + 2, state === 'hurt' ? 2 : 1);
    }
  }
  if (profile.kind === 'plant') {
    poses.idle = [
      { partA: [0, -1], partB: [0, 1], tail: [-1, 0] },
      { partA: [-1, 0], partB: [1, 0], tail: [0, -1] },
      { partA: [0, 1], partB: [0, -1], tail: [1, 0] }
    ];
    poses.attack = [
      { partA: [0, -2], partB: [0, 2], tail: [-1, -1] },
      { partA: [-1, 1], partB: [-1, -2], core: [-1, 0], tail: [1, 1] },
      { partA: [1, -1], partB: [1, 1], tail: [0, -1], feetA: [1, 0] }
    ];
  }
  return { groups, poses, profile, order: ['core', 'tail', 'feetA', 'feetB', 'head', 'partA', 'partB'] };
}

export function transformPixels(pixels, change) {
  const mapped = pixels.map(pixel => {
    let x = pixel.x, y = pixel.y;
    if (Array.isArray(change)) { x += change[0]; y += change[1]; }
    else if (change.wave) x += Math.round(Math.sin((y + change.wave.phase) * Math.PI / 4) * change.wave.amplitude);
    else if (change.bend) y += Math.round((x - change.joint) * change.bend / 8);
    else if (change.pivot) {
      x = change.target[0] + pixel.y - change.pivot[1];
      y = change.target[1] - pixel.x + change.pivot[0];
    }
    return { ...pixel, x, y };
  });
  if (!mapped.length) return mapped;
  const minX = Math.min(...mapped.map(p => p.x)), maxX = Math.max(...mapped.map(p => p.x));
  const minY = Math.min(...mapped.map(p => p.y)), maxY = Math.max(...mapped.map(p => p.y));
  if (maxX - minX >= 32 || maxY - minY >= 32) throw Error('Articulated part exceeds the tile');
  // Keep the complete articulated part inside the original tile, with no crop.
  const dx = minX < 0 ? -minX : maxX > 31 ? 31 - maxX : 0;
  const dy = minY < 0 ? -minY : maxY > 31 ? 31 - maxY : 0;
  return mapped.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
}
