/**
 * PATCH autosave size-limit gate. Uses the already-computed TipTap word count
 * so the stored draft.word_count and the gate agree.
 */
import type { APIGatewayProxyResult } from 'aws-lambda';

import { enforceSizeLimitForWordCount } from './sizeLimit';

export function overSizeLimitHttpResponse(
  wordCount: number,
  documentTypeSizeLimitWords: number | null,
  platformSizeLimitWords?: number | null,
  charCount?: number,
): APIGatewayProxyResult | null {
  const sizeResult = enforceSizeLimitForWordCount(
    wordCount,
    {
      documentTypeSizeLimitWords,
      platformSizeLimitWords,
    },
    charCount,
  );
  if (sizeResult.status !== 'over-limit') {
    return null;
  }
  return {
    statusCode: 400,
    body: JSON.stringify({
      code: 'OVER_SIZE_LIMIT',
      message: sizeResult.message,
      measuredWords: sizeResult.measuredWords,
      effectiveLimitWords: sizeResult.effectiveLimitWords,
      ...(sizeResult.measuredChars !== undefined
        ? { measuredChars: sizeResult.measuredChars }
        : {}),
      ...(sizeResult.effectiveLimitChars !== undefined
        ? { effectiveLimitChars: sizeResult.effectiveLimitChars }
        : {}),
    }),
  };
}
