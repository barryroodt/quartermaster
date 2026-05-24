import { describe, expect, test } from "bun:test";
import { paths } from "../../src/paths";

describe("paths", () => {
  test("dataDir is under HOME", () => {
    expect(paths.dataDir).toMatch(/\.quartermaster$/);
  });

  test("inventoryDb is dataDir/inventory.db", () => {
    expect(paths.inventoryDb).toBe(`${paths.dataDir}/inventory.db`);
  });

  test("trustJson is dataDir/trust.json", () => {
    expect(paths.trustJson).toBe(`${paths.dataDir}/trust.json`);
  });

  test("sessionMarker is dataDir/.init-nudge-shown", () => {
    expect(paths.sessionMarker).toBe(`${paths.dataDir}/.init-nudge-shown`);
  });

  test("claudeSkills is HOME/.claude/skills", () => {
    expect(paths.claudeSkills).toMatch(/\.claude\/skills$/);
  });
});
