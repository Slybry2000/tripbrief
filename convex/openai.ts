import { ConvexError } from "convex/values";

// One place where the OpenAI Responses API is called, so every call in this app
// is store-free, schema-constrained and given the same time budget.
export async function structuredResponse(args: {
  apiKey: string;
  model: string;
  developer: string;
  user: string;
  schemaName: string;
  schema: unknown;
  timeoutMs?: number;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        store: false,
        input: [
          { role: "developer", content: args.developer },
          { role: "user", content: args.user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: args.schemaName,
            strict: true,
            schema: args.schema,
          },
        },
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
    });
  } catch {
    throw new ConvexError("The AI service could not be reached.");
  }
  if (!response.ok)
    throw new ConvexError(
      `The AI service refused the request (status ${response.status}).`,
    );
  const body: unknown = await response.json();
  const text = extractOutputText(body);
  try {
    return JSON.parse(text);
  } catch {
    throw new ConvexError("The AI service returned invalid structured data.");
  }
}

export function extractOutputText(body: unknown): string {
  if (
    !body ||
    typeof body !== "object" ||
    !("output" in body) ||
    !Array.isArray(body.output)
  )
    throw new ConvexError("The AI service returned an unexpected response.");
  for (const item of body.output) {
    if (
      !item ||
      typeof item !== "object" ||
      !("content" in item) ||
      !Array.isArray(item.content)
    )
      continue;
    for (const part of item.content)
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      )
        return part.text;
  }
  throw new ConvexError("The AI service returned no structured result.");
}
