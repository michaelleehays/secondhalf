import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { toWorldView } from "@second-half/engine";
import { createResistanceLayer } from "../src/resistance";
import { RING_OUTER, cellCenter, resistanceSpot, ringAt, sectorAt } from "../src/layout";

const view = toWorldView(SAMPLE_STATE);
const settle = (layer: ReturnType<typeof createResistanceLayer>) => {
  for (let i = 0; i < 200; i++) layer.tick(0, 0.05);
};
const crystal = (layer: ReturnType<typeof createResistanceLayer>, id: string) =>
  layer.group.getObjectByName(`resistance-${id}`)!.children[0]!;

describe("Resistance markers", () => {
  it("places one marker per entry outside the 101 ring, in its target area's slice", () => {
    const layer = createResistanceLayer();
    layer.update(view.resistance, () => null);
    expect(layer.hitProxies).toHaveLength(view.resistance.length);
    for (const r of view.resistance) {
      const g = layer.group.getObjectByName(`resistance-${r.id}`)!;
      expect(Math.hypot(g.position.x, g.position.z)).toBeGreaterThan(RING_OUTER[0]);
      expect(sectorAt(g.position.x, g.position.z).area).toBe(r.targetArea);
    }
  });

  it("sizes markers by strength", () => {
    const layer = createResistanceLayer();
    layer.update(view.resistance, () => null);
    settle(layer);
    // Sample: temptation is at 5, stress at 1.
    expect(crystal(layer, "temptation").scale.x).toBeGreaterThan(crystal(layer, "stress").scale.x * 1.5);
  });

  it("draws an attack line only when the attacked goal resolves to a cell", () => {
    const layer = createResistanceLayer();
    layer.update(view.resistance, () => null);
    expect(layer.group.getObjectByName("attack-temptation")).toBeUndefined();
    layer.update(view.resistance, (id) => (id === "money-101" ? { area: "money", level: 1 } : null));
    const line = layer.group.getObjectByName("attack-temptation") as THREE.Mesh<THREE.TubeGeometry>;
    expect(line).toBeDefined();
    const end = line.geometry.parameters.path.getPoint(1);
    const [cx, , cz] = cellCenter("money", 1);
    expect(Math.hypot(end.x - cx, end.z - cz)).toBeLessThan(0.01);
    // Only temptation (strength 5) attacks in the sample.
    expect(layer.group.children.filter((c) => c.name.startsWith("attack-"))).toHaveLength(1);
    layer.update(view.resistance.map((r) => ({ ...r, attackingGoalId: undefined })), () => null);
    expect(layer.group.getObjectByName("attack-temptation")).toBeUndefined();
    layer.dispose();
  });

  it("hides markers that leave the view", () => {
    const layer = createResistanceLayer();
    layer.update(view.resistance, () => null);
    layer.update(view.resistance.filter((r) => r.id !== "stress"), () => null);
    expect(layer.group.getObjectByName("resistance-stress")!.visible).toBe(false);
    expect(layer.crystalPosition("stress", new THREE.Vector3())).toBe(false);
    expect(layer.crystalPosition("fatigue", new THREE.Vector3())).toBe(true);
  });
});

describe("layout helpers", () => {
  it("puts each cell centre inside its own cell", () => {
    for (const level of [1, 2, 3, 4] as const) {
      const [x, , z] = cellCenter("work", level);
      expect(ringAt(Math.hypot(x, z))).toBe(level);
      expect(sectorAt(x, z).area).toBe("work");
    }
  });

  it("puts Resistance spots on the plain", () => {
    const [x, , z] = resistanceSpot("body");
    expect(ringAt(Math.hypot(x, z))).toBe(0);
  });
});
