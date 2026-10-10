// Regression: after dying, a respawned soldier must stand upright again (v1.1 fix).
import { CharacterView, type CharacterState } from '../../src/client/render/characters';

const base: CharacterState = {
  speed: 4, crouch: 0, airborne: false, pitch: 0, yaw: 0, firingKick: 0, reloading: 0, throwing: 0,
  planting: false, defusing: false, alive: true, deathAge: 0, weaponId: 'ak', weaponClass: 'rifle', strafe: 0,
};

describe('character model', () => {
  it('stands upright again after a death animation (respawn / new round)', () => {
    for (const team of ['T', 'CT'] as const) {
      const cv = new CharacterView(team, 1);
      const pelvis = cv.root.children[0];
      for (let t = 0; t <= 1; t += 0.05) cv.update({ ...base, alive: false, deathAge: t }, 0.05);
      expect(Math.abs(pelvis.rotation.x) + Math.abs(pelvis.rotation.z)).toBeGreaterThan(0.5); // lying down
      for (let i = 0; i < 10; i++) cv.update({ ...base }, 1 / 60);
      expect(pelvis.rotation.x).toBe(0);
      expect(pelvis.rotation.z).toBe(0);
      expect(pelvis.position.y).toBeGreaterThan(0.8);
    }
  });

  it('every variant builds for both teams', () => {
    for (let v = 0; v < 4; v++) for (const team of ['T', 'CT'] as const) expect(new CharacterView(team, v).root.children.length).toBeGreaterThan(0);
  });
});
