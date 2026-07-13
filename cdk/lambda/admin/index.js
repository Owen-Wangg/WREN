/**
 * Placeholder handler — replaced by bundled service code at build time.
 * This file exists so CDK's Code.fromAsset can locate the asset directory.
 */
exports.handler = async (event, context) => {
  return {
    statusCode: 501,
    body: JSON.stringify({ code: "NOT_IMPLEMENTED", message: "Handler not yet wired." }),
  };
};
