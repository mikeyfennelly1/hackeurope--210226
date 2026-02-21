import { describe, expect, it } from "vitest";
import { BlueprintBuilder, BlueprintUtils, resolveSubjects } from "./index";

describe("definition blueprint", () => {
  it("builds and validates a valid definition blueprint", () => {
    const definition = new BlueprintBuilder("trade-graph")
      .addNode({ name: "source", role: "producer" })
      .addNode({
        name: "sink",
        role: "consumer",
        subscribesTo: ["source"],
      })
      .addNode({
        name: "decision",
        role: "decision",
        subscribesTo: ["source"],
        decide: () => "buy",
      })
      .build();

    const result = BlueprintUtils.validate(definition);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid subscribesTo references", () => {
    const result = BlueprintUtils.validate({
      name: "trade-graph",
      nodes: [
        { name: "source", role: "producer" },
        {
          name: "decision",
          role: "decision",
          subscribesTo: ["missing-node"],
          decide: () => "sell",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "nodes[1].subscribesTo[0]",
      message: 'References non-existent node "missing-node"',
    });
  });

  it("resolves subjects only for producer and hybrid nodes", () => {
    const subjects = resolveSubjects({
      name: "trade-graph",
      nodes: [
        { name: "source", role: "producer" },
        { name: "compute", role: "hybrid", subscribesTo: ["source"] },
        { name: "sink", role: "consumer", subscribesTo: ["compute"] },
        {
          name: "decision",
          role: "decision",
          subscribesTo: ["compute"],
          decide: () => "buy",
        },
      ],
    });

    expect(subjects.get("source")).toBe("trade-graph.source");
    expect(subjects.get("compute")).toBe("trade-graph.compute");
    expect(subjects.has("sink")).toBe(false);
    expect(subjects.has("decision")).toBe(false);
  });
});
