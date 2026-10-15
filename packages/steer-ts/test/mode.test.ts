import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, guidance, NeatrootsHalt } from "../src/index.js";

const firstTrace = "a".repeat(32);
const gateTrace = "b".repeat(32);
const note = { id: "n1", kind: "template", text: "Check the order first.", finding_id: "f1" };
const flush = vi.fn(async () => undefined);
let firstMode = "off";
const reply = async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  return Response.json(body.trace_id === firstTrace ? { mode: firstMode, note: null } : { mode: "gate", note });
};
const claim = vi.fn(reply);

beforeEach(() => {
  firstMode = "off";
  flush.mockClear();
  // Drops replies a test queued but never used, so they can't leak into the next test.
  claim.mockReset();
  claim.mockImplementation(reply);
  configure({ disabled: false, neatlogs: { flush } });
  vi.stubGlobal("fetch", claim);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("steering mode belongs to its trace", () => {
  it.each(["off", "advisory", "self-check"])("resolves and flushes a new run after a %s run", async (mode) => {
    firstMode = mode;
    expect(await guidance(firstTrace)).toBeUndefined();
    expect(await guidance(gateTrace)).toEqual(note);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(claim.mock.calls[1][1]?.body))).toMatchObject({ trace_id: gateTrace, gate_ms: 300 });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("still caches off for repeated calls on the same trace", async () => {
    await guidance(firstTrace);
    await guidance(firstTrace);
    expect(claim).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
    firstMode = "advisory";
    await guidance(firstTrace);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("keeps asking in off mode when one of the user's halt rules applies to the run", async () => {
    const halt = { id: "h1", kind: "halt", text: "Stop deleting.", finding_id: "f2" };
    claim.mockResolvedValueOnce(Response.json({ mode: "off", halts: true, note: null }));
    claim.mockResolvedValueOnce(Response.json({ mode: "off", halts: true, note: halt }));
    expect(await guidance(firstTrace)).toBeUndefined();
    await expect(guidance(firstTrace)).rejects.toBeInstanceOf(NeatrootsHalt);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("clears the cached trace when reconfigured", async () => {
    await guidance(firstTrace);
    configure({});
    await guidance(firstTrace);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
