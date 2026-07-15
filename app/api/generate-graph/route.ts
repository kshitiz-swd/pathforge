import OpenAI from "openai";
import { z } from "zod";
import { GRAPH_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  repairGraph,
  SkillGraphBaseSchema,
  SkillGraphSchema,
  type SkillGraph,
} from "@/lib/schema";

const GenerateGraphRequestSchema = z
  .object({
    goal: z.string().min(1),
  })
  .strict();

type ValidationResult =
  | { ok: true; graph: SkillGraph }
  | { ok: false; error: string; graph?: SkillGraph };

function parseGraphContent(content: string | null): ValidationResult {
  if (!content) {
    return { ok: false, error: "The model returned an empty response." };
  }

  try {
    const json: unknown = JSON.parse(content);
    const baseParsed = SkillGraphBaseSchema.safeParse(json);

    if (!baseParsed.success) {
      return { ok: false, error: z.prettifyError(baseParsed.error) };
    }

    const parsed = SkillGraphSchema.safeParse(baseParsed.data);

    if (!parsed.success) {
      return {
        ok: false,
        error: z.prettifyError(parsed.error),
        graph: baseParsed.data,
      };
    }

    return { ok: true, graph: parsed.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    return { ok: false, error: message };
  }
}

function buildUserPrompt(goal: string, validationError?: string) {
  const retryInstruction = validationError
    ? `\n\nThe previous response failed validation. Fix this error and return a valid JSON object only:\n${validationError}`
    : "";

  return `Generate a skill graph JSON object for this learning goal: ${goal}

The JSON object must match this shape exactly:
{
  "goal": "string",
  "nodes": [
    {
      "id": "string",
      "label": "string",
      "description": "one sentence",
      "state": "mastered | available | locked",
      "cluster": "string"
    }
  ],
  "edges": [
    {
      "source": "string",
      "target": "string",
      "type": "requires | choice"
    }
  ]
}${retryInstruction}`;
}

async function generateGraph(
  client: OpenAI,
  goal: string,
  validationError?: string,
): Promise<ValidationResult> {
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: GRAPH_SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(goal, validationError) },
    ],
  });

  return parseGraphContent(completion.choices[0]?.message.content ?? null);
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsedBody = GenerateGraphRequestSchema.safeParse(body);

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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const firstResult = await generateGraph(client, parsedBody.data.goal);

    if (firstResult.ok) {
      return Response.json(firstResult.graph);
    }

    const retryResult = await generateGraph(
      client,
      parsedBody.data.goal,
      firstResult.error,
    );

    if (retryResult.ok) {
      return Response.json(retryResult.graph);
    }

    if (retryResult.graph) {
      const repairedGraph = repairGraph(retryResult.graph);
      const repairedResult = SkillGraphSchema.safeParse(repairedGraph);

      if (repairedResult.success) {
        return Response.json(repairedResult.data);
      }

      return Response.json(
        {
          error: "Generated graph failed validation after repair.",
          details: [
            "Retry validation failed:",
            retryResult.error,
            "",
            "Repair validation failed:",
            z.prettifyError(repairedResult.error),
          ].join("\n"),
        },
        { status: 502 },
      );
    }

    return Response.json(
      { error: "Generated graph failed validation.", details: retryResult.error },
      { status: 502 },
    );
  } catch (error) {
    console.error("generate-graph failed:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error calling OpenAI.";
    return Response.json({ error: message }, { status: 500 });
  }
}
