import { readFileSync } from "node:fs";
import * as path from "node:path";
import { load } from "js-yaml";

describe("OpenAPI metadata field route", () => {
  const definition = load(
    readFileSync(path.join(__dirname, "..", "lib", "openapi.yaml"), "utf8"),
  ) as {
    paths: Record<string, Record<string, any>>;
  };

  it("exposes an authenticated student-readable metadata catalog", () => {
    const route = definition.paths["/v1/document-types/{documentTypeId}/metadata-fields"];

    expect(route?.get?.operationId).toBe("listCustomMetadataFields");
    expect(route?.get?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/CustomMetadataField" },
    });
    expect(route?.get?.["x-amazon-apigateway-integration"]?.uri?.["Fn::Sub"]).toContain(
      "${AdminFunctionArn}",
    );
    expect(route?.get?.security).toBeUndefined();
    expect(route?.options?.security).toEqual([]);
  });
});