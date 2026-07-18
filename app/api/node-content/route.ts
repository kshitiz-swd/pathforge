import OpenAI from "openai";
import { z } from "zod";
import { NODE_CONTENT_SYSTEM_PROMPT } from "@/lib/prompts";
import { NodeContentSchema, type NodeContent } from "@/lib/schema";

const NodeContentRequestSchema = z
  .object({
    goal: z.string().min(1),
    nodeId: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    prerequisites: z.array(z.string().min(1)),
  })
  .strict();

type NodeContentRequest = z.infer<typeof NodeContentRequestSchema>;
type ValidationResult =
  | { ok: true; content: NodeContent }
  | { ok: false; error: string };

const nodeContentCache = new Map<string, NodeContent>();

function parseNodeContent(content: string | null): ValidationResult {
  if (!content) {
    return { ok: false, error: "The model returned an empty response." };
  }

  try {
    const json: unknown = JSON.parse(content);
    const parsed = NodeContentSchema.safeParse(json);

    return parsed.success
      ? { ok: true, content: parsed.data }
      : { ok: false, error: z.prettifyError(parsed.error) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}

function buildUserPrompt(
  input: NodeContentRequest,
  validationError?: string,
): string {
  const retryInstruction = validationError
    ? `\n\nThe previous response failed validation. Fix this error and return a valid JSON object only:\n${validationError}`
    : "";

  return `Create learning content for this node:
${JSON.stringify(
    {
      skillLabel: input.label,
      skillDescription: input.description,
      overallGoal: input.goal,
      prerequisiteLabels: input.prerequisites,
    },
    null,
    2,
  )}${retryInstruction}`;
}

async function generateNodeContent(
  client: OpenAI,
  input: NodeContentRequest,
  validationError?: string,
): Promise<ValidationResult> {
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: NODE_CONTENT_SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input, validationError) },
    ],
  });

  return parseNodeContent(completion.choices[0]?.message.content ?? null);
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsedBody = NodeContentRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json(
      { error: z.prettifyError(parsedBody.error) },
      { status: 400 },
    );
  }

  const input = parsedBody.data;
  const cacheKey = `${input.goal}::${input.nodeId}`;
  const cachedContent = nodeContentCache.get(cacheKey);

  if (cachedContent) {
    return Response.json(cachedContent);
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const firstResult = await generateNodeContent(client, input);

    if (firstResult.ok) {
      nodeContentCache.set(cacheKey, firstResult.content);
      return Response.json(firstResult.content);
    }

    const retryResult = await generateNodeContent(
      client,
      input,
      firstResult.error,
    );

    if (retryResult.ok) {
      nodeContentCache.set(cacheKey, retryResult.content);
      return Response.json(retryResult.content);
    }

    return Response.json(
      {
        error: "Generated node content failed validation.",
        details: retryResult.error,
      },
      { status: 502 },
    );
  } catch (error) {
    console.error("node-content failed:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error calling OpenAI.";
    return Response.json({ error: message }, { status: 500 });
  }
}
