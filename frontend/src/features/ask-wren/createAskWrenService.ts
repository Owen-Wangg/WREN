/**
 * Factory: live API when `VITE_USE_LIVE_API`, otherwise in-memory mock.
 */
import { appConfig } from '@/config/env';
import type { HttpClient } from '@/services';

import { ApiAskWrenService } from './apiAskWrenService';
import type { AskWrenService } from './askWrenService';
import { MockAskWrenService } from './mockAskWrenService';

export function createAskWrenService(client: HttpClient): AskWrenService {
  if (appConfig.useLiveApi) {
    return new ApiAskWrenService(client);
  }
  return new MockAskWrenService();
}
