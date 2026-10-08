import { Fn, Stack, Token } from "aws-cdk-lib";
import YAML from "js-yaml";

import {
  appSyncRealtimeHost,
  buildAmplifyCustomHeadersYaml,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  urlHost,
} from "../lib/amplifySecurityHeaders.js";

const inputs = {
  apiEndpoint: "https://abc123.execute-api.ca-central-1.amazonaws.com/dev/",
  appSyncGraphqlUrl: "https://gql123.appsync-api.ca-central-1.amazonaws.com/graphql",
  documentsBucketName: "wren-dev-documents",
  region: "ca-central-1",
};

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name = "", ...sources] = d.split(" ");
      return [name, sources];
    }),
  );
}

describe("urlHost", () => {
  it("extracts the host from literal URLs", () => {
    expect(urlHost(inputs.apiEndpoint)).toBe("abc123.execute-api.ca-central-1.amazonaws.com");
    expect(urlHost("wss://h.example:443/x?y")).toBe("h.example:443");
  });

  it("keeps embedded tokens inside the host", () => {
    const url = `https://${Fn.importValue("id")}.execute-api.ca-central-1.amazonaws.com/dev/`;
    const host = urlHost(url);
    expect(Token.isUnresolved(host)).toBe(true);
    expect(host.endsWith(".execute-api.ca-central-1.amazonaws.com")).toBe(true);
  });

  it("splits fully opaque tokens with intrinsics", () => {
    const stack = new Stack();
    const resolved = stack.resolve(urlHost(Fn.importValue("url")));
    expect(resolved).toEqual({
      "Fn::Select": [2, { "Fn::Split": ["/", { "Fn::ImportValue": "url" }] }],
    });
  });

  it("rejects literal strings that are not URLs", () => {
    expect(() => urlHost("not-a-url")).toThrow(/Cannot determine host/);
  });
});

describe("appSyncRealtimeHost", () => {
  it("maps the GraphQL host to the realtime host", () => {
    expect(appSyncRealtimeHost("gql123.appsync-api.ca-central-1.amazonaws.com")).toBe(
      "gql123.appsync-realtime-api.ca-central-1.amazonaws.com",
    );
  });

  it("uses intrinsics for opaque tokens", () => {
    const stack = new Stack();
    const resolved = stack.resolve(appSyncRealtimeHost(Fn.importValue("host")));
    expect(resolved).toEqual({
      "Fn::Join": [
        "appsync-realtime-api",
        { "Fn::Split": ["appsync-api", { "Fn::ImportValue": "host" }] },
      ],
    });
  });
});

describe("buildContentSecurityPolicy", () => {
  const csp = directives(buildContentSecurityPolicy(inputs));

  it("locks down framing, plugins, base URI, forms, and scripts", () => {
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'"]);
  });

  it("limits connect-src to the exact hosts the SPA calls", () => {
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "https://abc123.execute-api.ca-central-1.amazonaws.com",
      "https://cognito-idp.ca-central-1.amazonaws.com",
      "https://gql123.appsync-api.ca-central-1.amazonaws.com",
      "wss://gql123.appsync-realtime-api.ca-central-1.amazonaws.com",
      "https://wren-dev-documents.s3.ca-central-1.amazonaws.com",
    ]);
  });

  it("never allows unsafe-eval or a bare scheme in connect-src", () => {
    const text = buildContentSecurityPolicy(inputs);
    expect(text).not.toContain("unsafe-eval");
    for (const source of csp.get("connect-src") ?? []) {
      expect(source).not.toMatch(/^(https|wss|http|ws):$/);
      expect(source).not.toContain("*");
    }
  });
});

describe("buildAmplifyCustomHeadersYaml", () => {
  it("produces Amplify customHeaders YAML that round-trips every header", () => {
    const parsed = YAML.load(buildAmplifyCustomHeadersYaml(inputs)) as {
      customHeaders: Array<{ pattern: string; headers: Array<{ key: string; value: string }> }>;
    };
    expect(parsed.customHeaders).toHaveLength(1);
    expect(parsed.customHeaders[0]?.pattern).toBe("**");
    expect(parsed.customHeaders[0]?.headers).toEqual(buildSecurityHeaders(inputs));
  });
});
