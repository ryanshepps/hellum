export type RemoteGatewayConfig = {
  readonly mode: "remote-gateway";
  readonly apiBaseUrl: "/v1";
  readonly platformDisabled: true;
  readonly disablePlatform: true;
  readonly assistantName: string;
  readonly assistantId: string;
};

export function buildRemoteGatewayConfig(assistantName: string, assistantId: string): RemoteGatewayConfig {
  return {
    mode: "remote-gateway",
    apiBaseUrl: "/v1",
    platformDisabled: true,
    disablePlatform: true,
    assistantName,
    assistantId,
  };
}

function toSafeScriptJson(value: RemoteGatewayConfig): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export function injectConfig(rawHtml: string, config: RemoteGatewayConfig): string {
  const script = `<script>window.__VELLUM_CONFIG__=${toSafeScriptJson(config)}</script>`;
  return rawHtml.includes("</head>") ? rawHtml.replace("</head>", `${script}</head>`) : `${script}${rawHtml}`;
}
