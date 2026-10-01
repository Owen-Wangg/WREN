import {
  AMPLIFY_APP_S3_ORIGIN,
  exactFrontendOrigins,
  isExactOrigin,
  parseCorsAllowedOrigins,
  s3CorsAllowedOrigins,
  corsPreflightResponseTemplate,
  corsLambdaEnvironment,
} from "../lib/corsOrigins.js";

describe("CORS origin helpers", () => {
  it("accepts scheme://host[:port] and rejects wildcards or paths", () => {
    expect(isExactOrigin("http://localhost:5173")).toBe(true);
    expect(isExactOrigin("https://coach.example.com")).toBe(true);
    expect(isExactOrigin("https://*.amplifyapp.com")).toBe(false);
    expect(isExactOrigin("https://coach.example.com/app")).toBe(false);
    expect(isExactOrigin("*")).toBe(false);
  });

  it("parses corsAllowedOrigins and rejects invalid entries", () => {
    expect(parseCorsAllowedOrigins(undefined)).toEqual([]);
    expect(parseCorsAllowedOrigins("https://a.example, https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(() => parseCorsAllowedOrigins("https://a.example, *")).toThrow(/invalid origin/);
  });

  it("always includes local Vite and adds customDomain plus www", () => {
    expect(exactFrontendOrigins({})).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    expect(exactFrontendOrigins({ customDomain: "coach.example.com" })).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://coach.example.com",
      "https://www.coach.example.com",
    ]);
  });

  it("does not double-prefix www when the custom domain already has it", () => {
    expect(exactFrontendOrigins({ customDomain: "www.coach.example.com" })).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://www.coach.example.com",
    ]);
  });

  it("keeps the Amplify S3 wildcard only as a localhost-only fallback (finding S-7)", () => {
    const origins = s3CorsAllowedOrigins({});
    expect(origins).toContain(AMPLIFY_APP_S3_ORIGIN);
    expect(origins).not.toContain("*");
  });

  it("drops the Amplify S3 wildcard once a custom domain pins the origin (finding S-7)", () => {
    const origins = s3CorsAllowedOrigins({ customDomain: "coach.example.com" });
    expect(origins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://coach.example.com",
      "https://www.coach.example.com",
    ]);
    expect(origins).not.toContain(AMPLIFY_APP_S3_ORIGIN);
    expect(origins).not.toContain("*");
  });

  it("drops the Amplify S3 wildcard when exact corsAllowedOrigins are provided (finding S-7)", () => {
    const origins = s3CorsAllowedOrigins({
      corsAllowedOrigins: ["https://a.example"],
    });
    expect(origins).toContain("https://a.example");
    expect(origins).not.toContain(AMPLIFY_APP_S3_ORIGIN);
    expect(origins).not.toContain("*");
  });

  it("emits Lambda env without a wildcard origin", () => {
    const env = corsLambdaEnvironment({ customDomain: "coach.example.com" });
    expect(env.CORS_ALLOWED_ORIGINS).toContain("https://coach.example.com");
    expect(env.CORS_ALLOWED_ORIGINS).not.toContain("*");
    expect(env.CORS_ALLOW_AMPLIFY_ORIGINS).toBe("true");
  });

  it("builds OPTIONS VTL that reflects allowlisted origins and Amplify hosts", () => {
    const template = corsPreflightResponseTemplate({ customDomain: "coach.example.com" });
    expect(template).toContain('$origin == "http://localhost:5173"');
    expect(template).toContain('$origin == "https://coach.example.com"');
    expect(template).toContain("amplifyapp");
    expect(template).not.toContain("'*'");
    expect(template).not.toContain('"*"');
  });
});
