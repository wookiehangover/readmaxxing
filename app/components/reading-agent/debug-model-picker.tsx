import { useEffect, useState } from "react";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  DEBUG_READING_AGENT_MODELS,
  DEFAULT_DEBUG_READING_AGENT_MODEL,
  isDebugReadingAgentModel,
  type DebugReadingAgentModel,
} from "~/lib/reading-agent/debug-model";

const MODEL_OPTIONS = DEBUG_READING_AGENT_MODELS.map((model) => ({ label: model, value: model }));

async function selectedModelFrom(response: Response): Promise<DebugReadingAgentModel> {
  if (!response.ok) throw new Error(`Model request failed (${response.status})`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("selectedModel" in body)) {
    throw new Error("Model response was invalid");
  }
  if (!isDebugReadingAgentModel(body.selectedModel)) throw new Error("Model response was invalid");
  return body.selectedModel;
}

export function DebugModelPicker() {
  const [selectedModel, setSelectedModel] = useState<DebugReadingAgentModel>(
    DEFAULT_DEBUG_READING_AGENT_MODEL,
  );
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/reading-agent/debug", { signal: controller.signal })
      .then(selectedModelFrom)
      .then(setSelectedModel)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load model");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, []);

  async function selectModel(model: DebugReadingAgentModel) {
    const previous = selectedModel;
    setSelectedModel(model);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/reading-agent/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setSelectedModel(await selectedModelFrom(response));
    } catch (cause) {
      setSelectedModel(previous);
      setError(cause instanceof Error ? cause.message : "Unable to save model");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next ingest model</CardTitle>
        <CardDescription>
          Debug-only selection for the next ReadingScribe call. Latest usage remains authoritative.
          {error ? ` ${error}.` : ""}
        </CardDescription>
        <CardAction>
          <Select
            items={MODEL_OPTIONS}
            value={selectedModel}
            disabled={pending}
            onValueChange={(value) => {
              if (isDebugReadingAgentModel(value)) void selectModel(value);
            }}
          >
            <SelectTrigger aria-label="Next ingest model" className="max-w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
