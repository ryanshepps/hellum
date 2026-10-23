export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteContext = {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
};

export type Route = {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly handle: (context: RouteContext) => Promise<Response> | Response;
};

export type RouteMatch = {
  readonly route: Route;
  readonly params: Readonly<Record<string, string>>;
};

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function matchRoute(routes: readonly Route[], method: string, path: string): RouteMatch | null {
  const segments = trimSlashes(path).split("/");
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const patternSegments = trimSlashes(route.pattern).split("/");
    if (patternSegments.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    const matches = patternSegments.every((patternSegment, index) => {
      const segment = segments[index] ?? "";
      if (patternSegment.startsWith(":")) {
        params[patternSegment.slice(1)] = decodeURIComponent(segment);
        return segment.length > 0;
      }
      return patternSegment === segment;
    });
    if (matches) {
      return { route, params };
    }
  }
  return null;
}
