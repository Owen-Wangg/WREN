import { toCrossRegionInferenceProfileId } from './bedrockModelId';

describe('toCrossRegionInferenceProfileId', () => {
  it('prefixes bare Anthropic foundation-model ids with us.', () => {
    expect(toCrossRegionInferenceProfileId('anthropic.claude-sonnet-4-6')).toBe(
      'us.anthropic.claude-sonnet-4-6',
    );
  });

  it('leaves US CRIS profile ids unchanged', () => {
    expect(toCrossRegionInferenceProfileId('us.anthropic.claude-sonnet-4-6')).toBe(
      'us.anthropic.claude-sonnet-4-6',
    );
  });

  it('prefixes bare Meta foundation-model ids with us.', () => {
    expect(toCrossRegionInferenceProfileId('meta.llama3-70b')).toBe('us.meta.llama3-70b');
  });
});
