import { computeWritingProgress, writingProgressLabel } from './writingProgress';

describe('computeWritingProgress', () => {
  it('keeps a long first draft without coach or feedback below Strong', () => {
    const percent = computeWritingProgress({
      wordCount: 2000,
      draftVersion: 1,
      hasFeedback: false,
      hasAskedCoach: false,
    });
    expect(percent).toBe(25);
    expect(writingProgressLabel(percent)).toBe('Draft taking shape');
  });

  it('stays Solid on v1 even after feedback if the coach was never asked', () => {
    const percent = computeWritingProgress({
      wordCount: 2000,
      draftVersion: 1,
      hasFeedback: true,
      hasAskedCoach: false,
    });
    expect(percent).toBe(50);
    expect(writingProgressLabel(percent)).toBe('Solid draft in progress');
  });

  it('reaches Strong after revision with feedback', () => {
    const percent = computeWritingProgress({
      wordCount: 600,
      draftVersion: 2,
      hasFeedback: true,
      hasAskedCoach: true,
    });
    expect(percent).toBe(80);
    expect(writingProgressLabel(percent)).toBe('Strong draft — keep refining');
  });

  it('treats an empty first draft as just getting started', () => {
    const percent = computeWritingProgress({
      wordCount: 0,
      draftVersion: 1,
      hasFeedback: false,
    });
    expect(percent).toBe(0);
    expect(writingProgressLabel(percent)).toBe('Just getting started');
  });
});
