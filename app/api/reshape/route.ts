import OpenAI from "openai";
import { z } from "zod";
import {
  findTerminalGoalNodeId,
  recomputeNodeStates,
} from "@/lib/node-states";
import { RESHAPE_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  ReshapeResponseSchema,
  SkillEdgeSchema,
  type ReshapeResponse,
} from "@/lib/schema";

const ReshapeRequestSchema = z
  .object({
    goal: z.string().min(1),
    knowledge: z.string().min(1),
    graph: z
      .object({
        nodes: z
          .array(
            z
              .object({
                id: z.string().min(1),
                label: z.string().min(1),
                state: z.enum(["mastered", "available", "locked"]),
              })
              .strict(),
          )
          .min(1),
        edges: z.array(SkillEdgeSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const nodeIds = new Set(input.graph.nodes.map((node) => node.id));

    if (nodeIds.size !== input.graph.nodes.length) {
      ctx.addIssue({
        code: "custom",
        path: ["graph", "nodes"],
        message: "Every graph node id must be unique.",
      });
    }

    input.graph.edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: "custom",
          path: ["graph", "edges", index],
          message: "Every edge source and target must reference a graph node.",
        });
      }
    });

    if (!findTerminalGoalNodeId(input.graph.nodes, input.graph.edges)) {
      ctx.addIssue({
        code: "custom",
        path: ["graph", "nodes"],
        message: "The graph must contain exactly one terminal goal node.",
      });
    }
  });

type ReshapeRequest = z.infer<typeof ReshapeRequestSchema>;
type ValidationResult =
  | { ok: true; proposal: ReshapeResponse }
  | { ok: false; error: string };

function parseProposal(
  content: string | null,
  expectedIds: Set<string>,
): ValidationResult {
  if (!content) {
    return { ok: false, error: "The model returned an empty response." };
  }

  try {
    const json: unknown = JSON.parse(content);
    const parsed = ReshapeResponseSchema.safeParse(json);

    if (!parsed.success) {
      return { ok: false, error: z.prettifyError(parsed.error) };
    }

    const responseIds = parsed.data.states.map((entry) => entry.id);
    const uniqueResponseIds = new Set(responseIds);
    const unexpectedIds = responseIds.filter((id) => !expectedIds.has(id));
    const missingIds = [...expectedIds].filter(
      (id) => !uniqueResponseIds.has(id),
    );

    if (
      uniqueResponseIds.size !== responseIds.length ||
      unexpectedIds.length > 0 ||
      missingIds.length > 0 ||
      responseIds.length !== expectedIds.size
    ) {
      return {
        ok: false,
        error: [
          "The response must contain every supplied node id exactly once.",
          unexpectedIds.length > 0
            ? `Unexpected ids: ${unexpectedIds.join(", ")}`
            : "",
          missingIds.length > 0 ? `Missing ids: ${missingIds.join(", ")}` : "",
          uniqueResponseIds.size !== responseIds.length
            ? "Duplicate ids were returned."
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    return { ok: true, proposal: parsed.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}

function buildUserPrompt(
  input: ReshapeRequest,
  validationError?: string,
): string {
  const retryInstruction = validationError
    ? `\n\nThe previous response failed validation. Fix this error and return valid JSON only:\n${validationError}`
    : "";

  return `Update this learning map from the learner's existing knowledge:\n${JSON.stringify(
    input,
    null,
    2,
  )}${retryInstruction}`;
}

async function generateProposal(
  client: OpenAI,
  input: ReshapeRequest,
  expectedIds: Set<string>,
  validationError?: string,
): Promise<ValidationResult> {
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: RESHAPE_SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input, validationError) },
    ],
  });

  return parseProposal(
    completion.choices[0]?.message.content ?? null,
    expectedIds,
  );
}

function deriveStates(
  input: ReshapeRequest,
  proposal: ReshapeResponse,
): ReshapeResponse {
  const proposedMasteredIds = new Set(
    proposal.states
      .filter((entry) => entry.state === "mastered")
      .map((entry) => entry.id),
  );
  const masteredIds = new Set(
    input.graph.nodes
      .filter(
        (node) =>
          (node.state === "mastered" || proposedMasteredIds.has(node.id)),
      )
      .map((node) => node.id),
  );

  return {
    states: recomputeNodeStates(
      input.graph.nodes,
      input.graph.edges,
      masteredIds,
    ),
  };
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsedBody = ReshapeRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json(
      { error: z.prettifyError(parsedBody.error) },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const input = parsedBody.data;
  const expectedIds = new Set(input.graph.nodes.map((node) => node.id));
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const firstResult = await generateProposal(client, input, expectedIds);
    const result = firstResult.ok
      ? firstResult
      : await generateProposal(client, input, expectedIds, firstResult.error);

    if (!result.ok) {
      return Response.json(
        { error: "Reshape proposal failed validation.", details: result.error },
        { status: 502 },
      );
    }

    return Response.json(deriveStates(input, result.proposal));
  } catch (error) {
    console.error("reshape failed:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error calling OpenAI.";
    return Response.json({ error: message }, { status: 500 });
  }
}
