"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Smoke test for the TypeScript property-test tooling (Jest + ts-jest + fast-check).
 *
 * This is NOT one of the design's correctness properties (1-30); it is Property 0,
 * a trivial tooling self-check that verifies the runner, the helper's iteration
 * floor, and the tag convention all work before real property tests are written.
 *
 * Feature: wren-writing-coach, Property 0: test tooling smoke check
 */
const fast_check_1 = __importDefault(require("fast-check"));
const property_1 = require("./property");
describe('TypeScript property-test tooling', () => {
    it('runs a fast-check property with the enforced iteration floor', () => {
        // Feature: wren-writing-coach, Property 0: test tooling smoke check
        const tag = (0, property_1.wrenProperty)({ number: 0, text: 'test tooling smoke check' }, fast_check_1.default.property(fast_check_1.default.integer(), fast_check_1.default.integer(), (a, b) => a + b === b + a));
        expect(tag).toBe(`Feature: ${property_1.FEATURE_SLUG}, Property 0: test tooling smoke check`);
    });
    it('raises a sub-floor iteration request up to the minimum', () => {
        let observedRuns = 0;
        (0, property_1.wrenProperty)({ number: 0, text: 'iteration floor check' }, fast_check_1.default.property(fast_check_1.default.constant(null), () => {
            observedRuns += 1;
            return true;
        }), { numRuns: 5 });
        expect(observedRuns).toBeGreaterThanOrEqual(property_1.MIN_PROPERTY_RUNS);
    });
    it('formats the canonical property tag', () => {
        expect((0, property_1.propertyTag)({ number: 10, text: 'No-ghostwriting guardrail' })).toBe('Feature: wren-writing-coach, Property 10: No-ghostwriting guardrail');
    });
});
