"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEATURE_SLUG = exports.MIN_PROPERTY_RUNS = void 0;
exports.propertyTag = propertyTag;
exports.wrenProperty = wrenProperty;
/**
 * Shared property-based-testing helper for WREN Writing Coach (TypeScript / fast-check).
 *
 * Enforces the two conventions from the design's Testing Strategy:
 *   1. Every property test runs a minimum of 100 iterations.
 *   2. Every property test is tagged with a comment referencing its design
 *      property in the form:
 *        `Feature: wren-writing-coach, Property {number}: {property text}`
 *
 * Each correctness property (1-30) is implemented by a SINGLE property-based
 * test. Use `wrenProperty(...)` to run one; it guarantees the iteration floor
 * and surfaces the canonical tag so traceability holds even if a caller forgets
 * the comment.
 *
 * fast-check docs: https://fast-check.dev/
 */
const fast_check_1 = __importDefault(require("fast-check"));
/** Minimum number of generated examples every WREN property test must run. */
exports.MIN_PROPERTY_RUNS = 100;
/** The feature slug used in the property tag convention. */
exports.FEATURE_SLUG = 'wren-writing-coach';
/**
 * Build the canonical property tag string, e.g.
 * `Feature: wren-writing-coach, Property 10: No-ghostwriting guardrail ...`
 */
function propertyTag(meta) {
    return `Feature: ${exports.FEATURE_SLUG}, Property ${meta.number}: ${meta.text}`;
}
/**
 * Run a fast-check property with the WREN conventions enforced.
 *
 * - The iteration count is raised to at least {@link MIN_PROPERTY_RUNS}; callers
 *   may request MORE but never fewer.
 * - The canonical tag is attached to any thrown error so a failure is traceable
 *   back to its design property.
 *
 * @returns the canonical property tag (useful for logging / assertions).
 */
function wrenProperty(meta, property, params = {}) {
    const tag = propertyTag(meta);
    const numRuns = Math.max(params.numRuns ?? exports.MIN_PROPERTY_RUNS, exports.MIN_PROPERTY_RUNS);
    try {
        fast_check_1.default.assert(property, { ...params, numRuns });
    }
    catch (error) {
        if (error instanceof Error) {
            error.message = `[${tag}] ${error.message}`;
        }
        throw error;
    }
    return tag;
}
