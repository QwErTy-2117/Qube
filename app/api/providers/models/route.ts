export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { baseURL, apiKey } = body as { baseURL?: string; apiKey?: string };

    if (!baseURL || typeof baseURL !== "string") {
      return Response.json({ error: "baseURL is required" }, { status: 400 });
    }

    const base = baseURL.replace(/\/+$/, "");

    const tryFetch = async (url: string): Promise<Response> => {
      return fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey || ""}`,
          "Content-Type": "application/json",
        },
      });
    };

    let url = base + "/models";
    let res = await tryFetch(url);

    if (res.status === 404 && !base.endsWith("/v1")) {
      url = base + "/v1/models";
      res = await tryFetch(url);
    }

    if (!res.ok) {
      return Response.json(
        { error: `Failed to fetch models from ${url}: ${res.status} ${res.statusText}` },
        { status: res.status }
      );
    }

    const json = await res.json();
    return Response.json(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
