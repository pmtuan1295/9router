import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: vi.fn(async () => null),
  filterModelsListForKey: vi.fn(async (_ctx, models) => models),
}));

const { GET, DEFAULT_MODEL_LIST_KINDS } = await import("../../src/app/api/v1/models/route.js");

function connect(enabledModels) {
  db.getProviderConnections.mockResolvedValue([{
    id: 1,
    provider: "openai",
    isActive: true,
    providerSpecificData: { enabledModels },
  }]);
}

async function list() {
  const res = await GET(new Request("https://router.test/v1/models"));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe("GET /v1/models includes image-generation models", () => {
  it("lists llm and image kinds by default", () => {
    expect(DEFAULT_MODEL_LIST_KINDS).toEqual(["llm", "image"]);
  });

  it("returns chat and image models, tagging image ones with kind", async () => {
    connect(["gpt-4o", "gpt-image-1", "dall-e-3"]);
    const data = await list();
    const chat = data.find((m) => m.id === "openai/gpt-4o");
    const image = data.find((m) => m.id === "openai/gpt-image-1");
    const dalle = data.find((m) => m.id === "openai/dall-e-3");

    expect(chat).toBeDefined();
    expect(chat).not.toHaveProperty("kind");
    expect(image).toMatchObject({ kind: "image", capabilities: { imageOutput: true } });
    expect(image).not.toHaveProperty("context_length");
    expect(dalle).toMatchObject({ kind: "image" });
  });

  it("still hides non-image media models (tts, embedding)", async () => {
    connect(["gpt-4o", "tts-1", "text-embedding-3-small"]);
    const data = await list();
    expect(data.find((m) => m.id === "openai/tts-1")).toBeUndefined();
    expect(data.find((m) => m.id === "openai/text-embedding-3-small")).toBeUndefined();
  });

  it("tags image combos and skips token limits for them", async () => {
    connect(["gpt-4o"]);
    db.getCombos.mockResolvedValueOnce([
      { name: "my-images", kind: "image", models: ["openai/gpt-image-1"] },
      { name: "my-chat", models: ["openai/gpt-4o"] },
    ]);
    const data = await list();
    const imageCombo = data.find((m) => m.id === "my-images");
    expect(imageCombo).toMatchObject({ kind: "image", owned_by: "combo" });
    expect(imageCombo).not.toHaveProperty("context_length");
    expect(data.find((m) => m.id === "my-chat")).not.toHaveProperty("kind");
  });
});
